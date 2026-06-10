import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AgentSession from '../db/models/agentSession.js'
import SessionMessage from '../db/models/sessionMessage.js'
import WebhookEvent from '../db/models/webhookEvent.js'
import Project from '../db/models/project.js'
import AgentTemplate from '../db/models/agentTemplate.js'
import WebhookConfig from '../db/models/webhookConfig.js'
import AdminConfig from '../db/models/adminConfig.js'
import { parseOpenClawStdout } from '../utils/openclawSession.js'
import { eventDescription, eventSourceUrl, eventSourceLabel } from '../utils/eventFormat.js'
import config from '../config.js'
import { spawnOpenClaw } from '../utils/openclawCli.js'
import { scheduleDashboardBroadcast } from './notification-ws.js'
import { notifyFlowFailure, markEventFailed } from './webhook-flow-notify.js'

const OPENCLAW_AGENTS_DIR = config.openclaw.agentsDir
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GITLAB_TOOLS_SRC = path.resolve(__dirname, '../plugins/gitlab-tools.js')

function sanitizeAgentName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

/** 每次调度前同步最新 gitlab-tools 插件到 Agent 目录 */
function syncGitlabToolsPlugin(cliName) {
  if (!fs.existsSync(GITLAB_TOOLS_SRC)) return
  const pluginsDir = path.join(OPENCLAW_AGENTS_DIR, sanitizeAgentName(cliName), 'agent', 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.copyFileSync(GITLAB_TOOLS_SRC, path.join(pluginsDir, 'gitlab-tools.js'))
}

function buildGitlabSpawnEnv({ projectPath, gitlabId, issueIid }) {
  const env = { ...process.env, GITLAB_WEBHOOK_DISABLED: '1' }
  if (projectPath && !projectPath.startsWith('project#')) {
    env.BCENTER_GITLAB_PROJECT_PATH = projectPath
  }
  if (gitlabId != null && gitlabId !== '') {
    env.BCENTER_GITLAB_ID = String(gitlabId)
  }
  if (issueIid != null && issueIid !== '') {
    env.BCENTER_ISSUE_IID = String(issueIid)
  }
  return env
}

function buildAgentDispatchNotification({ tpl, event, ev, projectPath, projectName, sessionKey, tools, executeOrder, chainFrom }) {
  const desc = eventDescription(event)
  const sourceUrl = eventSourceUrl(event)
  const sourceLabel = eventSourceLabel(event)
  const instructionLine = (tpl.agent_config?.instructions || '')
    .replace(/[#*`]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)[0] || '执行自动化任务'

  const lines = [
    `项目: ${projectPath}${projectName && projectName !== projectPath ? ` (${projectName})` : ''}`,
    `事件: ${event.event_type}${ev.action ? ` · ${ev.action}` : ''}`,
    `描述: ${desc}`
  ]

  if (sourceLabel) {
    lines.push(`来源: ${sourceLabel}${sourceUrl ? `\n链接: ${sourceUrl}` : ''}`)
  } else if (sourceUrl) {
    lines.push(`链接: ${sourceUrl}`)
  }

  if (ev.iid) {
    lines.push(`Issue/MR: #${ev.iid}${ev.title ? ` · ${ev.title.slice(0, 80)}` : ''}`)
  }
  if (ev.state || ev.labels) {
    const statePart = ev.state ? `状态 ${ev.state}` : ''
    const labelPart = ev.labels ? `标签 ${ev.labels}` : ''
    lines.push([statePart, labelPart].filter(Boolean).join(' · '))
  }
  if (ev.user) lines.push(`触发用户: ${ev.user}`)
  if (ev.comment) lines.push(`评论: ${ev.comment.slice(0, 120)}${ev.comment.length > 120 ? '…' : ''}`)

  lines.push(
    '',
    `Agent: ${tpl.name}`,
    `用途: ${instructionLine}`,
    '',
    '运行参数:',
    `  session-key: ${sessionKey}`,
    `  agent: ${sanitizeAgentName(tpl.name)}`,
    `  timeout: 600s`
  )

  if (executeOrder != null) lines.push(`  execute_order: ${executeOrder}`)
  if (chainFrom) lines.push(`  chain: ${chainFrom} → ${tpl.name}`)
  if (tools.length) lines.push(`  tools: ${tools.join(', ')}`)
  if (tpl.workspace_path) lines.push(`  workspace: ${tpl.workspace_path}`)
  if (tpl.agent_config?.event_types?.length) {
    lines.push(`  event_types: ${tpl.agent_config.event_types.join(', ')}`)
  }

  return {
    type: 'info',
    title: `${tpl.name} 已启动 · ${projectPath}`,
    message: lines.join('\n')
  }
}

/**
 * OpenClaw Agent 管理器
 * 
 * 完全基于 AgentTemplate 配置分发事件：
 * - 里程碑模板 → 内联 API 调用（不走 OpenClaw）
 * - 其他模板 → 通过 openclaw CLI 调度 agent
 */
class AgentManager {

  /**
   * 提取事件信息
   */
  extractEvent(event) {
    const payload = event.payload || {}
    const obj = payload.object_attributes || {}
    const noteable = payload.issue || payload.merge_request || {}
    const isNote = event.event_type === 'Note Hook'
    const rawLabels = payload.labels || obj.labels || []
    const noteableType = isNote
      ? (obj.noteable_type || (payload.issue ? 'Issue' : payload.merge_request ? 'MergeRequest' : ''))
      : ''
    return {
      project_path: payload.project?.path_with_namespace || '',
      eventType: event.event_type || '',
      iid: isNote ? (noteable.iid || obj.noteable_iid) : obj.iid,
      title: (isNote ? noteable.title : obj.title) || '',
      state: isNote ? noteable.state : obj.state,
      labels: (Array.isArray(rawLabels) ? rawLabels : []).map(l => l.title || l).join(','),
      comment: isNote ? (obj.note || '').slice(0, 500) : '',
      user: payload.user?.username || '',
      action: obj.action || event.event_action || '',
      noteable_type: noteableType,
      milestoneAssigned: payload.changes?.milestone_id?.current != null
    }
  }

  // ──────────────────────────────────────────────
  // 事件分发（唯一入口）
  // ──────────────────────────────────────────────

  /**
   * 获取当前活跃 Agent 会话数
   */
  async getActiveSessionCount() {
    try {
      return await AgentSession.count({ where: { status: 'active' } })
    } catch {
      return 0
    }
  }

  /**
   * 获取最大并发 Agent 限制
   */
  async getMaxConcurrentAgents() {
    try {
      const cfg = await AdminConfig.findOne({ where: { config_key: 'max_concurrent_agents' } })
      return parseInt(cfg?.config_value || '10', 10)
    } catch {
      return 10
    }
  }

  /**
   * 检查是否达到并发限制，如果达到则推送通知并返回 true
   */
  async isConcurrencyLimitReached() {
    const max = await this.getMaxConcurrentAgents()
    const active = await this.getActiveSessionCount()
    if (active >= max) {
      console.warn(`Concurrency limit reached: ${active}/${max} agents running, skipping dispatch`)
      return true
    }
    return false
  }

  /**
   * 处理 webhook 事件 — 完全基于模板配置分发
   * 
   * 流程：
   * 1. 查项目关联的已部署模板
   * 2. 按 event_type 匹配
   * 3. milestone 模板 → 内联 API
   * 4. 其他模板 → 走 OpenClaw agent
   */
  async handleEvent(event) {
    if (!event) return
    try {
    await WebhookEvent.update({ status: 'processing' }, { where: { id: event.id } })
    const ev = this.extractEvent(event)

    // 跳过 bot 自身触发的事件
    if (ev.user === 'devops-robot') {
      await WebhookEvent.update({
        status: 'completed',
        agent_handled: 1,
        dispatch_note: 'Bot 自身触发的事件已忽略'
      }, { where: { id: event.id } })
      return
    }

    const webhookCfg = await WebhookConfig.findOne({ where: { project_id: event.project_id } })
    if (!webhookCfg?.is_enabled) {
      await WebhookEvent.update({
        status: 'completed',
        agent_handled: 0,
        dispatch_note: '项目未启用 Webhook，跳过 Agent 调度'
      }, { where: { id: event.id } })
      return
    }

    const { getDeployedEventTemplates, filterTemplatesForEvent, getTemplateExecuteOrder } = await import('./agent-binding.js')
    const allEventTemplates = await getDeployedEventTemplates()

    let matchedAny = false
    let dispatchFailed = false
    const dispatchedNames = []

    const matched = filterTemplatesForEvent(allEventTemplates, event, ev)
    const matchedTemplates = matched
      .map(tpl => ({ template: tpl, order: getTemplateExecuteOrder(tpl) }))
      .sort((a, b) => a.order - b.order)

    if (matchedTemplates.length === 0) {
      let dispatchNote
      if (!allEventTemplates.length) {
        dispatchNote = '无已部署的「事件触发」Agent 模板'
      } else {
        const actionPart = ev.action ? ` · action=${ev.action}` : ''
        dispatchNote = `无模板匹配 ${event.event_type}${actionPart}（请在 Agent 模板配置触发规则）`
      }
      await WebhookEvent.update({
        status: 'completed',
        agent_handled: 0,
        dispatch_note: dispatchNote
      }, { where: { id: event.id } })
      return
    }

    // 检查并发限制
    if (await this.isConcurrencyLimitReached()) {
      const max = await this.getMaxConcurrentAgents()
      const active = await this.getActiveSessionCount()
      const dispatchNote = `活跃 Agent 已达上限（${active}/${max}），事件已跳过`
      await WebhookEvent.update({
        status: 'completed',
        agent_handled: 0,
        dispatch_note: dispatchNote
      }, { where: { id: event.id } })
      return
    }

    // 串行执行：等上一个 agent 完成后再启动下一个
    for (const mt of matchedTemplates) {
      const tpl = mt.template
      matchedAny = true

      try {
        console.log(`Dispatch #${event.id}: ${tpl.name} (order ${mt.order})`)
        await this.spawnAgentFromTemplate(tpl, event, ev, { executeOrder: mt.order })
        dispatchedNames.push(tpl.name)

        const chain = tpl.agent_config.chain || []
        for (const link of chain) {
          if (!this.matchChainCondition(link.when || [], ev)) continue
          try {
            const downstream = await this.findDownstreamAgent(event.project_id, link.agent)
            if (downstream) {
              console.log(`Chain: ${tpl.name} → ${link.agent} for event #${event.id}`)
              await this.spawnAgentFromTemplate(downstream, event, ev, { chainFrom: tpl.name })
              matchedAny = true
            } else {
              const hint = `下游 Agent「${link.agent}」未在 OpenClaw 注册，请在 Agent 模板页对「${link.agent}」或「${tpl.name}」重新点击「初始化到 OpenClaw」`
              console.warn(`⚠️ Chain: ${tpl.name} → ${link.agent} 跳过 — ${hint}`)
              dispatchFailed = true
              await notifyFlowFailure({
                title: `Chain 未就绪: ${link.agent}`,
                message: hint,
                event
              })
            }
          } catch (chainErr) {
            dispatchFailed = true
            console.error(`Chain dispatch error (#${event.id}):`, chainErr.message)
            await notifyFlowFailure({
              title: `Chain 调度失败: ${link.agent}`,
              message: chainErr.message,
              event
            })
          }
        }
      } catch (spawnErr) {
        dispatchFailed = true
        console.error(`spawnAgentFromTemplate error (#${event.id}, ${tpl.name}):`, spawnErr.message)
        await notifyFlowFailure({
          title: `Agent 调度失败: ${tpl.name}`,
          message: spawnErr.message,
          event
        })
      }
    }

    if (!matchedAny) {
      console.log(`Event #${event.id} (${event.event_type}) 无匹配模板，跳过`)
    }

    if (dispatchFailed) {
      await markEventFailed(event.id, 'Agent 调度或执行失败')
    } else {
      const dispatchNote = matchedAny
        ? `已调度: ${[...new Set(dispatchedNames)].join(' → ')}`
        : '未匹配到可执行的 Agent 模板'
      await WebhookEvent.update({
        status: 'completed',
        agent_handled: matchedAny ? 1 : 0,
        dispatch_note: dispatchNote
      }, { where: { id: event.id } })
    }
    } catch (err) {
      console.error(`handleEvent(#${event.id}) error:`, err.message)
      await markEventFailed(event.id, err.message)
      await notifyFlowFailure({
        title: 'Webhook 事件处理失败',
        message: err.message,
        event
      })
    } finally {
      scheduleDashboardBroadcast()
    }
  }

  // ──────────────────────────────────────────────
  // 模板驱动 Agent 调度
  // ──────────────────────────────────────────────

  /**
   * 基于模板启动 OpenClaw Agent
   * - 使用模板的 instructions 作为 Agent 提示词
   * - 拼接事件上下文
   */
  async spawnAgentFromTemplate(tpl, event, ev, options = {}) {
    const agentCliName = sanitizeAgentName(tpl.name)
    const ts = Date.now()
    const iid = ev.iid || '0'

    let projectPath = ev.project_path || ''
    let projectName = ''
    let gitlabId = null
    if (event.project_id) {
      const proj = await Project.findByPk(event.project_id, { attributes: ['name', 'path_with_namespace', 'gitlab_id'] })
      if (proj) {
        gitlabId = proj.gitlab_id
        if (!projectPath) projectPath = proj.path_with_namespace
        projectName = proj.name || projectPath.split('/').pop() || ''
      }
    } else if (projectPath) {
      projectName = projectPath.split('/').pop() || ''
    }
    if (!projectPath) projectPath = `project#${event.project_id}`

    const gitlabToolCtx = projectPath && !projectPath.startsWith('project#')
      ? [
          '',
          '## GitLab 工具参数（系统已绑定，工具层自动纠正 project_id）',
          `- project_id: \`${projectPath}\`${gitlabId != null ? `（gitlab_id: ${gitlabId}）` : ''}`,
          ev.iid ? `- issue_iid: \`${ev.iid}\`` : '',
          '- 禁止使用项目短名或猜测其他命名空间下的同名项目'
        ].filter(Boolean)
      : []

    const sessionKey = `gitlab:${agentCliName}:${iid}_${ts}`

    // 从模板配置构建消息
    const instructions = tpl.agent_config?.instructions || `# ${tpl.name}\n\n请根据指令执行任务。`
    const tools = tpl.agent_config?.tools || []
    const toolHint = tools.length
      ? `\n\n## 可用工具\n\n${tools.map(t => `- \`${t}\``).join('\n')}`
      : ''

    const message = [
      `# ${tpl.name} — 事件通知`,
      '',
      `- **项目**: ${projectPath}`,
      `- **事件类型**: ${event.event_type}`,
      `- **操作**: ${ev.action}`,
      ev.iid ? `- **Issue/MR #**: ${ev.iid}` : '',
      ev.title ? `- **标题**: ${ev.title}` : '',
      `- **当前状态**: ${ev.state}`,
      `- **当前标签**: ${ev.labels}`,
      `- **触发用户**: ${ev.user}`,
      ev.comment ? `- **评论内容**: ${ev.comment}` : '',
      ev.milestoneAssigned ? '- **里程碑**: 已指派' : '',
      ...gitlabToolCtx,
      '',
      '---',
      '',
      instructions,
      toolHint
    ].filter(Boolean).join('\n')

    const dispatchNotification = buildAgentDispatchNotification({
      tpl,
      event,
      ev,
      projectPath,
      projectName,
      sessionKey,
      tools,
      executeOrder: options.executeOrder,
      chainFrom: options.chainFrom
    })

    const { isAgentRegisteredInOpenClaw } = await import('./template-deploy.js')
    if (!isAgentRegisteredInOpenClaw(agentCliName)) {
      throw new Error(
        `Agent「${tpl.name}」未在 OpenClaw 注册。请在 Agent 模板页点击「初始化到 OpenClaw」（需配置 OPENCLAW_DEFAULT_WORKSPACE）`
      )
    }

    return this._spawnOpenClaw(tpl.name, agentCliName, sessionKey, message, event, dispatchNotification, {
      projectPath: projectPath.startsWith('project#') ? null : projectPath,
      gitlabId,
      issueIid: ev.iid != null && ev.iid !== '' ? String(ev.iid) : null
    })
  }

  // ──────────────────────────────────────────────
  // OpenClaw CLI 执行
  // ──────────────────────────────────────────────

  /**
   * 通过 openclaw CLI 启动 agent
   * 捕获 JSON 输出，获取 OpenClaw 真实 sessionId
   * 返回 Promise，在子进程退出时 resolve，实现串行调度
   * 
   * @param {string} displayName - 展示名称（存 DB）
   * @param {string} cliName - CLI agent 名称（sanitized）
   * @param {string} sessionKey - OpenClaw session key
   * @param {string} message - 发给 agent 的消息
   * @param {object} event - WebhookEvent 实例
   */
  async _spawnOpenClaw(displayName, cliName, sessionKey, message, event, dispatchNotification = null, spawnContext = null) {
    const logFile = `/tmp/bcenter-agent-${cliName}-${event.id}-${Date.now()}.log`
    let session
    try {
      session = await AgentSession.create({
        event_id: event.id,
        project_id: event.project_id,
        agent_name: displayName,
        session_type: 'event',
        status: 'pending',
        log_file: logFile
      })
    } catch (createErr) {
      console.error(`_spawnOpenClaw create session error:`, createErr.message)
      await notifyFlowFailure({
        title: `Agent 会话创建失败: ${displayName}`,
        message: createErr.message,
        event
      })
      throw createErr
    }
    scheduleDashboardBroadcast()

    if (dispatchNotification) {
      try {
        const { broadcastNotification } = await import('./notification-ws.js')
        broadcastNotification({
          ...dispatchNotification,
          link: `/sessions/${session.id}`
        })
      } catch (_) { /* ignore notification errors */ }
    }

    try {
      await SessionMessage.create({
        session_id: session.id,
        role: 'system',
        content: `Pending ${displayName} agent...`,
        metadata: { agent_name: displayName, event_id: event.id }
      })
    } catch (msgErr) {
      console.warn(`_spawnOpenClaw session message error:`, msgErr.message)
    }

    // 返回 Promise，进程退出时 resolve，上层 await 实现串行
    return new Promise(async (resolve) => {
      try {
        await AgentSession.update({ status: 'active', started_at: new Date() }, { where: { id: session.id } })
        scheduleDashboardBroadcast()
        await SessionMessage.create({
          session_id: session.id,
          role: 'system',
          content: `Running ${displayName} agent...`,
          metadata: { agent_name: displayName }
        })

    syncGitlabToolsPlugin(cliName)

    // 移除 --local，使用 OpenClaw 云模式以节省本地内存
    const child = spawnOpenClaw([
      'agent', '--agent', cliName,
      '--session-key', sessionKey,
      '--message', message,
      '--json',
      '--timeout', '600'
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: buildGitlabSpawnEnv(spawnContext || {}),
          timeout: 600_000
        })

        let stdout = ''
        let stderr = ''

        child.stdout.on('data', chunk => { stdout += chunk.toString() })
        child.stderr.on('data', chunk => { stderr += chunk.toString() })

        child.on('error', async (err) => {
          try {
            await AgentSession.update({ status: 'failed', finished_at: new Date(), fail_reason: `启动错误: ${err.message}` }, { where: { id: session.id } })
            await SessionMessage.create({
              session_id: session.id,
              role: 'system',
              content: `${displayName} agent error: ${err.message}`
            })
            // 实时推送失败通知
            const { broadcastNotification } = await import('./notification-ws.js')
            broadcastNotification({
              type: 'error',
              title: `Agent 启动失败`,
              message: `${displayName}: ${err.message}`,
              link: `/sessions/${session.id}`
            })
            scheduleDashboardBroadcast()
          } catch (e) {
            console.error(`_spawnOpenClaw error handler:`, e.message)
          }
          resolve()
        })

        child.on('exit', async (code) => {
          try {
            const logDir = path.dirname(logFile)
            fs.mkdirSync(logDir, { recursive: true })
            fs.writeFileSync(logFile, stdout + '\n--- stderr ---\n' + stderr)

            const sessionMeta = parseOpenClawStdout(stdout)
            const openclawSessionId = sessionMeta?.sessionId || null
            const openclawSessionFile = sessionMeta?.sessionFile || null

            const updateData = { finished_at: new Date(), log_file: logFile }
            if (openclawSessionId) {
              updateData.openclaw_session_id = openclawSessionId
              updateData.openclaw_session_file = openclawSessionFile
            }

            if (code === 0) {
              updateData.status = 'completed'
              await AgentSession.update(updateData, { where: { id: session.id } })
              await SessionMessage.create({
                session_id: session.id, role: 'system',
                content: `${displayName} agent completed. Session: ${openclawSessionId || 'unknown'}`,
                metadata: { agent_name: displayName, log: logFile, openclaw_session_id: openclawSessionId, exit_code: code }
              })
            } else {
              const stderrLines = stderr.trim().split('\n').filter(Boolean)
              const failReason = stderrLines.length > 0
                ? `退出码 ${code}: ${stderrLines.slice(-3).join(' | ')}`
                : `Agent 退出码 ${code}`
              updateData.status = 'failed'
              updateData.fail_reason = failReason
              await AgentSession.update(updateData, { where: { id: session.id } })
              await SessionMessage.create({
                session_id: session.id, role: 'system', content: failReason,
                metadata: { agent_name: displayName, log: logFile, exit_code: code, stderr: stderr.trim().slice(0, 1000) }
              })
              // 实时推送失败通知
              const { broadcastNotification } = await import('./notification-ws.js')
              broadcastNotification({
                type: 'error',
                title: `Agent 执行失败`,
                message: `${displayName}: ${failReason}`,
                link: `/sessions/${session.id}`
              })
            }

            console.log(`Agent ${displayName} done (session #${session.id}, oc session: ${openclawSessionId || 'N/A'})`)
            scheduleDashboardBroadcast()
          } catch (err) {
            console.error(`_spawnOpenClaw exit handler error:`, err.message)
            try {
              await notifyFlowFailure({
                title: `Agent 结果处理失败: ${displayName}`,
                message: err.message,
                event,
                sessionId: session.id
              })
            } catch (_) { /* ignore */ }
          }
          resolve()
        })

        console.log(`Agent ${displayName} dispatched (session #${session.id})`)
      } catch (err) {
        console.error(`_spawnOpenClaw(${displayName}) error:`, err.message)
        try {
          await AgentSession.update({ status: 'failed', finished_at: new Date(), fail_reason: `调度异常: ${err.message}` }, { where: { id: session.id } })
          await SessionMessage.create({
            session_id: session.id, role: 'system',
            content: `${displayName} agent failed: ${err.message}`
          })
          await notifyFlowFailure({
            title: `Agent 调度异常: ${displayName}`,
            message: err.message,
            event,
            sessionId: session.id
          })
          scheduleDashboardBroadcast()
        } catch (innerErr) {
          console.error(`_spawnOpenClaw failure handler error:`, innerErr.message)
        }
        resolve()
      }
    })
  }

  // ──────────────────────────────────────────────
  // 工具方法 — GitLab API 调用
  // ──────────────────────────────────────────────

  async setStateApi(projectPath, iid, stateName) {
    const { default: config } = await import('../config.js')
    const tokenConfig = await AdminConfig.findOne({ where: { config_key: 'gitlab_token' } })
    const baseUrlConfig = await AdminConfig.findOne({ where: { config_key: 'gitlab_base_url' } })
    const token = tokenConfig?.config_value || ''
    const baseUrl = baseUrlConfig?.config_value || config.gitlab.baseUrl
    const projEnc = encodeURIComponent(projectPath)

    const issueRes = await fetch(`${baseUrl}/projects/${projEnc}/issues/${iid}`, {
      headers: { 'PRIVATE-TOKEN': token }
    })
    if (!issueRes.ok) return
    const issue = await issueRes.json()
    const existingLabels = issue.labels || []
    const stateLabel = existingLabels.find(l =>
      l.includes('::待办') || l.includes('::进行中') || l.includes('::待验收') || l.includes('::已完成') || l.includes('::已取消')
    )
    const prefix = stateLabel ? stateLabel.split('::')[0] + '::' : '状态::'
    const cleaned = existingLabels.filter(l => {
      const n = l.split('::').pop()
      return !['待办', '进行中', '待验收', '已完成', '已取消'].includes(n)
    })
    cleaned.push(`${prefix}${stateName}`)

    await fetch(`${baseUrl}/projects/${projEnc}/issues/${iid}`, {
      method: 'PUT',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: cleaned.join(',') })
    })
  }

  async cleanBotComments(projectPath, iid) {
    const { default: config } = await import('../config.js')
    const tokenConfig = await AdminConfig.findOne({ where: { config_key: 'gitlab_token' } })
    const baseUrlConfig = await AdminConfig.findOne({ where: { config_key: 'gitlab_base_url' } })
    const token = tokenConfig?.config_value || ''
    const baseUrl = baseUrlConfig?.config_value || config.gitlab.baseUrl
    const projEnc = encodeURIComponent(projectPath)

    const notesRes = await fetch(`${baseUrl}/projects/${projEnc}/issues/${iid}/notes?sort=asc&per_page=100`, {
      headers: { 'PRIVATE-TOKEN': token }
    })
    if (!notesRes.ok) return
    const notes = await notesRes.json()
    for (const note of notes) {
      if (note.system === false && note.author?.username === 'devops-robot') {
        await fetch(`${baseUrl}/projects/${projEnc}/issues/${iid}/notes/${note.id}`, {
          method: 'DELETE',
          headers: { 'PRIVATE-TOKEN': token }
        })
      }
    }
  }

  async addComment(projectPath, iid, body) {
    const { default: config } = await import('../config.js')
    const tokenConfig = await AdminConfig.findOne({ where: { config_key: 'gitlab_token' } })
    const baseUrlConfig = await AdminConfig.findOne({ where: { config_key: 'gitlab_base_url' } })
    const token = tokenConfig?.config_value || ''
    const baseUrl = baseUrlConfig?.config_value || config.gitlab.baseUrl
    const projEnc = encodeURIComponent(projectPath)

    await fetch(`${baseUrl}/projects/${projEnc}/issues/${iid}/notes`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    })
  }

  /**
   * 判断 chain 条件是否匹配当前事件
   * @param {string[]} when - 条件列表
   * @param {object} ev - 提取的事件信息
   */
  matchChainCondition(when, ev) {
    if (!when || when.length === 0) return false
    return when.some(cond => {
      switch (cond) {
        case 'issue': return ev.eventType === 'Issue Hook'
        case 'mr': return ev.eventType === 'Merge Request Hook'
        case 'milestone': return ev.milestoneAssigned
        case 'develop_comment': return ev.eventType === 'Note Hook' && ev.comment && /^(开始处理|开始|进行中)/.test(ev.comment.trim())
        case 'note': return ev.eventType === 'Note Hook'
        case 'push': return ev.eventType === 'Push Hook'
        default: return false
      }
    })
  }

  /**
   * 查找项目关联的下游 Agent 模板（manual 模式）
   * 支持两种来源：
   * 1. B端 AgentTemplate 记录
   * 2. 直接存在于 ~/.openclaw/agents/ 的原生 Agent（只读，不可在 B 端编辑）
   */
  async findDownstreamAgent(_projectId, agentName) {
    const { isAgentRegisteredInOpenClaw } = await import('./template-deploy.js')

    const tpl = await AgentTemplate.findOne({
      where: { is_active: 1, deployed: 1, trigger_mode: 'manual', name: agentName }
    })
    if (tpl) {
      if (!isAgentRegisteredInOpenClaw(agentName)) {
        console.warn(`Chain agent "${agentName}" 模板已标记部署，但 OpenClaw 未注册，请在 Agent 模板页重新初始化`)
        return null
      }
      return tpl
    }

    if (isAgentRegisteredInOpenClaw(agentName)) {
      console.log(`Using OpenClaw native agent: ${agentName}`)
      return {
        id: null,
        name: agentName,
        agent_config: { instructions: '', tools: [] },
        workspace_path: ''
      }
    }

    return null
  }

  /** @deprecated 已移除项目级 Agent 绑定，返回空列表 */
  async getProjectAgents(_projectId) {
    return []
  }
}

export default new AgentManager()
