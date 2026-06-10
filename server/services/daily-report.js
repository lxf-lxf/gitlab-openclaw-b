import { Op } from 'sequelize'
import AdminConfig from '../db/models/adminConfig.js'
import DailyReport from '../db/models/dailyReport.js'
import config from '../config.js'
import { spawnAgentWithMessage } from '../utils/openclawCli.js'

let reportTimer = null
let running = false

const SYSTEM_AGENT_NAME = 'system-monitor'
const AGENT_TIMEOUT = 120_000 // 120s

// ──────────────────────────────────────────────
// 报告配置
// ──────────────────────────────────────────────

export async function getReportConfig() {
  try {
    const row = await AdminConfig.findOne({ where: { config_key: 'daily_report_config' } })
    if (row?.config_value) return JSON.parse(row.config_value)
  } catch (_) { /* ignore */ }
  return {
    enabled: true,
    sendAt: '09:00'
  }
}

export async function saveReportConfig(config) {
  await AdminConfig.upsert({ config_key: 'daily_report_config', config_value: JSON.stringify(config) })
}

export async function getTodayReport() {
  const today = new Date().toISOString().split('T')[0]
  return await DailyReport.findOne({ where: { report_date: today } })
}

export async function getReportByDate(reportDate) {
  return await DailyReport.findOne({ where: { report_date: reportDate } })
}

// ──────────────────────────────────────────────
// 数据采集
// ──────────────────────────────────────────────

/**
 * 采集昨天全量系统数据，供 Agent 分析
 */
async function collectRawData(dateStr) {
  const yesterdayStart = new Date(dateStr + 'T00:00:00')
  const yesterdayEnd = new Date(dateStr + 'T23:59:59')

  const { default: WebhookEvent } = await import('../db/models/webhookEvent.js')
  const { default: AgentSession } = await import('../db/models/agentSession.js')
  const { default: Project } = await import('../db/models/project.js')
  const { default: AgentTemplate } = await import('../db/models/agentTemplate.js')

  // ── 并发获取 ──
  const [
    eventCount, failedCount, successCount, agentSessionCount, activeSessionsNow,
    totalProjects, webhookEnabledCount, totalTemplates, deployedTemplates,
    eventTypeDist, agentCalls, failedSessions, recentEvents
  ] = await Promise.all([
    WebhookEvent.count({ where: { received_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } } }),
    AgentSession.count({ where: { status: 'failed', finished_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } } }),
    AgentSession.count({ where: { status: 'completed', finished_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } } }),
    AgentSession.count({ where: { started_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } } }),
    AgentSession.count({ where: { status: 'active' } }),
    Project.count(),
    Project.count({ where: { '$webhook_config.is_enabled$': 1 }, include: [{ association: 'webhook_config', required: false }] }),
    AgentTemplate.count(),
    AgentTemplate.count({ where: { deployed: 1 } }),
    WebhookEvent.findAll({
      attributes: ['event_type'],
      where: { received_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } },
      raw: true
    }),
    AgentSession.findAll({
      attributes: ['agent_name', 'status'],
      where: { started_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } },
      raw: true
    }),
    AgentSession.findAll({
      where: { status: 'failed', finished_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } },
      include: [{ model: Project, attributes: ['name', 'path_with_namespace'], required: false }],
      order: [['finished_at', 'DESC']],
      limit: 10,
      raw: true
    }),
    WebhookEvent.findAll({
      where: { received_at: { [Op.between]: [yesterdayStart, yesterdayEnd] } },
      include: [{ model: Project, attributes: ['name', 'path_with_namespace'], required: false }],
      order: [['received_at', 'DESC']],
      limit: 20,
      raw: true
    })
  ])

  // 事件类型分布
  const typeCount = {}
  for (const e of eventTypeDist) {
    typeCount[formatEventType(e.event_type)] = (typeCount[formatEventType(e.event_type)] || 0) + 1
  }

  // Agent 调用统计
  const agentCountMap = {}
  const agentFailMap = {}
  for (const s of agentCalls) {
    const name = s.agent_name || 'unknown'
    agentCountMap[name] = (agentCountMap[name] || 0) + 1
    if (s.status === 'failed') agentFailMap[name] = (agentFailMap[name] || 0) + 1
  }

  return {
    date: dateStr,
    overview: {
      events: eventCount,
      agentSessions: agentSessionCount,
      success: successCount,
      failed: failedCount,
      successRate: agentSessionCount > 0 ? Math.round((successCount / agentSessionCount) * 100) : 0,
      activeNow: activeSessionsNow,
      totalProjects,
      webhookEnabled: webhookEnabledCount,
      totalTemplates,
      deployedTemplates
    },
    eventTypeDistribution: typeCount,
    agentStats: Object.entries(agentCountMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, calls: count, failed: agentFailMap[name] || 0 })),
    failedSessionsDetail: failedSessions.map(s => ({
      agent: s.agent_name || 'unknown',
      project: s['project.name'] || s['project.path_with_namespace'] || 'unknown',
      reason: s.fail_reason || 'unknown',
      time: s.finished_at
    })),
    recentEvents: recentEvents.map(e => ({
      type: e.event_type,
      project: e['project.name'] || e['project.path_with_namespace'] || 'unknown',
      status: e.status,
      time: e.received_at,
      sourceId: e.source_id
    }))
  }
}

// ──────────────────────────────────────────────
// Agent 调用
// ──────────────────────────────────────────────

/**
 * 调用 system-monitor agent 生成日报
 * 返回 agent 的文本响应，失败返回 null
 */
function callSystemAgent(rawData) {
  return new Promise(resolve => {
    const prompt = [
      '# System Monitor — 系统日报生成任务',
      '',
      '你是 B 端中台系统监控 Agent。请根据系统昨日的全量运行数据，**独立生成一份完整的日报**。',
      '这份日报是用户查看的全部内容，不依赖任何外部图表。',
      '',
      '## 📋 原始系统数据（昨日 ' + rawData.date + '）',
      '',
      '```json',
      JSON.stringify(rawData, null, 2),
      '```',
      '',
      '## 📝 生成要求',
      '',
      '1. **完整报告**: 生成一份独立的日报，包含所有必要信息',
      '2. **结构清晰**: 用 `##` 分段，例如：',
      '   - `## 总览` — 一两句话概括昨日系统运行状况',
      '   - `## 数据概览` — 关键数字汇总',
      '   - `## 事件分析` — 事件类型、分布、趋势',
      '   - `## Agent 表现` — 哪些 Agent 被调用、成功率、失败情况',
      '   - `## 异常与风险` — 需要关注的异常',
      '   - `## 优化建议` — 可执行的改进建议',
      '3. **数据驱动**: 把关键数字融入报告文字中，让用户阅读时自然获取信息',
      '4. **中文、专业、简洁**: 总字数 600~1000 字',
      '5. **不要重复标题**: 系统已经在报告顶部展示了标题，请不要再以 `#` 或 `##` 开头写"系统日报"或日期标题，直接从 `## 总览` 开始正文',
      '6. **不要写"根据提供的数据"这类话**, 直接书写报告正文'
    ].join('\n')

    // 通过文件传递消息，避免命令行换行/长度问题
    const sessionKey = `daily-report-${rawData.date}-${Date.now()}`
    const { child, cleanup } = spawnAgentWithMessage(
      SYSTEM_AGENT_NAME, sessionKey,
      {
        message: prompt,
        extraArgs: ['--json', '--timeout', '120'],
        spawnOptions: {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GITLAB_WEBHOOK_DISABLED: '1' },
          timeout: AGENT_TIMEOUT
        }
      })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })

    child.on('error', err => {
      cleanup()
      console.warn('Daily report: system agent call failed (error):', err.message.slice(0, 100))
      resolve(null)
    })

    child.on('exit', code => {
      cleanup()
      if (code !== 0) {
        console.warn(`Daily report: system agent exit code ${code}:`, stderr.trim().slice(0, 200))
        resolve(null)
        return
      }
      // 解析 JSON 输出，提取 payloads[0].text
      try {
        const trimmed = stdout.trim()
        const parsed = JSON.parse(trimmed)
        let text = parsed?.payloads?.[0]?.text
        if (text && text.trim()) {
          // 去掉 Agent 输出开头的 # 标题和分隔线（标题由 section.title 展示）
          // 匹配模式：可选标题行 + 可选空行 + 可选 --- 分隔线 + 可选空行
          text = text.trim().replace(/^(#+ .*\n?)?(\n)?(---+)?\n?/, '').trim()
          resolve(text)
        } else {
          console.warn('Daily report: agent returned empty text')
          resolve(null)
        }
      } catch (e) {
        console.warn('Daily report: failed to parse agent output:', e.message.slice(0, 100))
        resolve(null)
      }
    })
  })
}

// ──────────────────────────────────────────────
// 报告生成
// ──────────────────────────────────────────────

async function generateDailyReport() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const dateStr = yesterday.toISOString().split('T')[0]

  const existing = await DailyReport.findOne({ where: { report_date: dateStr } })
  if (existing) return existing

  // ── 1. 采集原始数据（仅收集，不做聚合渲染） ──
  const rawData = await collectRawData(dateStr)

  // ── 2. 调用系统监控 Agent 生成完整的日报 ──
  const o = rawData.overview
  let agentReport = null
  const systemAgentEnabled = await isSystemAgentEnabled()

  if (systemAgentEnabled) {
    console.log('Daily report: calling system monitor agent for full report...')
    agentReport = await callSystemAgent(rawData)
  }

  // ── 3. 构建报告 ──
  let sections = []
  let summary = ''

  if (agentReport) {
    // 整份报告都是 Agent 生成的（section title 为空，因为弹窗 header 已展示标题）
    sections = [{
      type: 'agent_text',
      title: '',
      content: agentReport
    }]
    // 摘要取 Agent 报告的前两行
    summary = agentReport.split('\n').filter(l => l.trim()).slice(0, 2).join('；').replace(/[*#]/g, '').trim()
    if (!summary) summary = 'AI 日报已生成'
  } else {
    // Agent 不可用，最小降级
    const reason = systemAgentEnabled ? 'Agent 调用失败' : '系统监控 Agent 未部署'
    console.warn(`Daily report: ${reason}, using fallback summary`)

    const parts = []
    if (o.events > 0) parts.push(`昨日共 ${o.events} 个事件`)
    if (o.agentSessions > 0) parts.push(`${o.agentSessions} 次 Agent 调用，${o.successRate}% 成功`)
    if (o.failed > 0) parts.push(`${o.failed} 个失败`)
    if (parts.length === 0) parts.push('昨日无活动数据')

    sections = [{
      type: 'text',
      title: '📊 系统日报 · ' + formatDate(dateStr),
      content: parts.join('\n') + '\n\n' + reason + '，请部署系统监控 Agent 以获取 AI 分析报告。'
    }]
    summary = parts.join('；')
  }

  const title = `📊 系统日报 · ${formatDate(dateStr)}`

  const report = await DailyReport.create({
    report_date: dateStr,
    title,
    sections,
    summary
  })

  console.log(`Daily report generated: ${title} (agent=${!!agentReport})`)
  return report
}

// ──────────────────────────────────────────────
// 报告推送
// ──────────────────────────────────────────────

async function pushReportNotification(report) {
  const { broadcastNotification } = await import('./notification-ws.js')
  broadcastNotification({
    type: 'report',
    title: report.title,
    message: report.summary,
    reportData: report.sections,
    reportId: report.id,
    link: null
  })

  await report.update({ sent: 1, sent_at: new Date() })
  console.log(`Daily report notification pushed: ${report.title}`)
}

// ──────────────────────────────────────────────
// 调度器
// ──────────────────────────────────────────────

export async function startReportScheduler() {
  if (running) return
  running = true
  console.log('Daily report scheduler started')

  const poll = async () => {
    while (running) {
      try {
        const cfg = await getReportConfig()
        if (!cfg.enabled) { await sleep(60000); continue }

        const now = new Date()
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        const targetTime = cfg.sendAt || '09:00'

        if (timeStr === targetTime) {
          const todayReport = await getTodayReport()
          if (!todayReport || !todayReport.sent) {
            const report = await generateDailyReport()
            await pushReportNotification(report)
          }
          await sleep(61000)
          continue
        }
      } catch (err) {
        console.error('Daily report scheduler error:', err.message)
      }
      await sleep(30000)
    }
  }

  reportTimer = poll()
}

export async function stopReportScheduler() {
  running = false
  if (reportTimer) { clearTimeout(reportTimer); reportTimer = null }
}

export async function triggerDailyReport() {
  const report = await generateDailyReport()
  await pushReportNotification(report)
  return report
}

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

async function isSystemAgentEnabled() {
  try {
    const cfg = await AdminConfig.findOne({ where: { config_key: 'system_agent_enabled' } })
    return cfg?.config_value === '1'
  } catch { return false }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatEventType(type) {
  const map = {
    'Push Hook': 'Push', 'Issue Hook': 'Issue', 'Merge Request Hook': 'MR',
    'Note Hook': 'Note', 'Pipeline Hook': 'Pipeline', 'Job Hook': 'Job',
    'Tag Push Hook': 'Tag', 'Wiki Page Hook': 'Wiki'
  }
  return map[type] || type
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
