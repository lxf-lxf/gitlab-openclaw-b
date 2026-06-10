import Router from '@koa/router'
import fs from 'node:fs'
import { Op, Sequelize } from 'sequelize'
import AgentSession from '../db/models/agentSession.js'
import SessionMessage from '../db/models/sessionMessage.js'
import Project from '../db/models/project.js'
import WebhookEvent from '../db/models/webhookEvent.js'
import { eventDescription, eventSourceUrl, eventTitle } from '../utils/eventFormat.js'
import {
  recoverSessionFromLog,
  resolveOpenClawSessionFromStore,
  resolveOpenClawSessionById,
  resolveOpenClawSessionFromStoreByIid,
  resolveSessionReadableFile
} from '../utils/openclawSession.js'
import { detectSessionContentFormat, parseTrajectoryContent } from '../utils/openclawTrajectory.js'

const router = new Router()

function sanitizeAgentCliName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

async function ensureOpenClawSessionMeta(session) {
  const cliName = sanitizeAgentCliName(session.agent_name)
  if (session.openclaw_session_id) {
    const readable = resolveSessionReadableFile(cliName, {
      sessionId: session.openclaw_session_id,
      sessionFile: session.openclaw_session_file
    })
    if (readable?.path && fs.existsSync(readable.path)) {
      if (session.openclaw_session_file !== readable.path) {
        await session.update({
          openclaw_session_id: session.openclaw_session_id,
          openclaw_session_file: readable.path
        })
      }
      return session
    }
  }

  const sessionKey = session.openclaw_session_key || null
  let recovered = null

  if (session.log_file) {
    recovered = recoverSessionFromLog(session.log_file, { cliName, sessionKey })
  }

  if (!recovered?.sessionId && sessionKey) {
    recovered = resolveOpenClawSessionFromStore(cliName, sessionKey)
  }

  if (!recovered?.sessionId && session.event_id) {
    const event = await WebhookEvent.findByPk(session.event_id, { attributes: ['payload'] })
    const iid = event?.payload?.object_attributes?.iid
      ?? event?.payload?.issue?.iid
      ?? event?.payload?.merge_request?.iid
    if (iid != null) {
      const startedAtMs = session.started_at ? new Date(session.started_at).getTime() : 0
      recovered = resolveOpenClawSessionFromStoreByIid(cliName, String(iid), startedAtMs)
    }
  }

  if (!recovered?.sessionId && session.openclaw_session_id) {
    recovered = resolveOpenClawSessionById(cliName, session.openclaw_session_id)
  }

  if (!recovered?.sessionId) return session

  await session.update({
    openclaw_session_id: recovered.sessionId,
    openclaw_session_file: recovered.sessionFile || session.openclaw_session_file
  })
  return session
}

// GET /api/sessions/grouped - 按 Issue/MR 聚合，按流程顺序展示
router.get('/grouped', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(ctx.query.pageSize || '20')))

    // 只返回有关联 agent session 的事件
    const sessionEventIds = await AgentSession.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('event_id')), 'event_id']],
      raw: true
    })
    const eventIds = sessionEventIds.map(r => r.event_id).filter(Boolean)

    const { rows: events, count } = await WebhookEvent.findAndCountAll({
      where: { id: { [Op.in]: eventIds } },
      include: [
        { model: Project, attributes: ['id', 'name', 'path_with_namespace'] },
        { model: AgentSession, order: [['started_at', 'ASC']], separate: true }
      ],
      order: [['received_at', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    })

    const items = events.map(event => {
      const sessions = (event.agent_sessions || []).map(s => ({
        id: s.id,
        agent_name: s.agent_name,
        status: s.status,
        started_at: s.started_at,
        finished_at: s.finished_at,
        openclaw_session_id: s.openclaw_session_id
      }))

      // 按 pipeline 顺序排序
      const pipelineOrder = ['webhook', 'milestone', 'supervisor']
      sessions.sort((a, b) => {
        const ai = pipelineOrder.indexOf(a.agent_name)
        const bi = pipelineOrder.indexOf(b.agent_name)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return 0
      })

      // 计算整体状态
      const allCompleted = sessions.every(s => s.status === 'completed')
      const anyFailed = sessions.some(s => s.status === 'failed')
      const anyActive = sessions.some(s => s.status === 'active' || s.status === 'pending')
      const overallStatus = allCompleted ? 'completed' : anyFailed ? 'failed' : anyActive ? 'running' : event.status

      return {
        event_id: event.id,
        project: event.project ? { id: event.project.id, name: event.project.name, path_with_namespace: event.project.path_with_namespace } : null,
        event_type: event.event_type,
        event_action: event.event_action,
        source_id: event.source_id,
        received_at: event.received_at,
        status: overallStatus,
        sessions
      }
    })

    ctx.body = { items, total: count, page, pageSize, totalPages: Math.ceil(count / pageSize) }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

router.get('/project-grouped', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(20, Math.max(1, parseInt(ctx.query.pageSize || '10')))
    const keyword = (ctx.query.keyword || '').trim()
    const statusFilter = (ctx.query.status || '').trim()

    // 获取所有有 agent session 的事件
    const sessionWhere = {}
    if (statusFilter) {
      sessionWhere.status = statusFilter
    }
    const sessionEventIds = await AgentSession.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('event_id')), 'event_id']],
      where: sessionWhere,
      raw: true
    })
    const eventIds = sessionEventIds.map(r => r.event_id).filter(Boolean)

    if (eventIds.length === 0) {
      ctx.body = { items: [], total: 0, page, pageSize, totalPages: 0 }
      return
    }

    // 获取事件及其包含的项目信息
    const eventWhere = { id: { [Op.in]: eventIds } }
    if (keyword) {
      // 通过项目名或事件类型搜索
      const matchingProjects = await Project.findAll({
        where: { name: { [Op.like]: `%${keyword}%` } },
        attributes: ['id'],
        raw: true
      })
      const projectIds = matchingProjects.map(p => p.id)
      eventWhere[Op.and] = {
        [Op.or]: [
          { event_type: { [Op.like]: `%${keyword}%` } },
          ...(projectIds.length ? [{ project_id: { [Op.in]: projectIds } }] : [])
        ]
      }
    }

    const events = await WebhookEvent.findAll({
      where: eventWhere,
      include: [
        { model: Project, attributes: ['id', 'name', 'path_with_namespace'] },
        { model: AgentSession, order: [['started_at', 'ASC']], separate: true, where: statusFilter ? { status: statusFilter } : undefined }
      ],
      order: [['received_at', 'DESC']]
    })

    // 按项目分组（同之前逻辑...）
    const projectMap = {}
    for (const event of events) {
      const pid = event.project_id
      if (!projectMap[pid]) {
        projectMap[pid] = {
          project: event.project ? { id: event.project.id, name: event.project.name, path_with_namespace: event.project.path_with_namespace } : null,
          events: []
        }
      }

      const sessions = (event.agent_sessions || []).map(s => ({
        id: s.id,
        agent_name: s.agent_name,
        status: s.status,
        session_type: s.session_type,
        started_at: s.started_at,
        finished_at: s.finished_at,
        openclaw_session_id: s.openclaw_session_id,
        duration: s.started_at && s.finished_at
          ? Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000)
          : null
      }))

      const allCompleted = sessions.every(s => s.status === 'completed')
      const anyFailed = sessions.some(s => s.status === 'failed')
      const anyActive = sessions.some(s => s.status === 'active' || s.status === 'pending')
      const overallStatus = allCompleted ? 'completed' : anyFailed ? 'failed' : anyActive ? 'running' : event.status

      projectMap[pid].events.push({
        event_id: event.id,
        event_type: event.event_type,
        event_action: event.event_action,
        source_id: event.source_id,
        received_at: event.received_at,
        title: getEventTitle(event),
        status: overallStatus,
        sessions
      })
    }

    // 按最近活动排序
    const items = Object.values(projectMap)
    items.sort((a, b) => {
      const aLatest = Math.max(...a.events.map(e => new Date(e.received_at).getTime()))
      const bLatest = Math.max(...b.events.map(e => new Date(e.received_at).getTime()))
      return bLatest - aLatest
    })

    // 分页
    const total = items.length
    const paged = items.slice((page - 1) * pageSize, page * pageSize)

    ctx.body = {
      items: paged,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

function getEventTitle(event) {
  if (!event?.payload) return ''
  const p = event.payload
  const obj = p.object_attributes || {}
  const noteable = p.issue || p.merge_request || {}
  return obj.title || noteable.title || p.title || ''
}

// GET /api/sessions - 分页 + 搜索
router.get('/', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize || '20')))
    const keyword = (ctx.query.keyword || '').trim()

    const where = {}
    if (ctx.query.status) where.status = ctx.query.status
    if (ctx.query.project_id) where.project_id = ctx.query.project_id
    if (keyword) {
      where[Op.or] = [
        { agent_name: { [Op.like]: `%${keyword}%` } }
      ]
    }

    const { rows, count } = await AgentSession.findAndCountAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'name', 'path_with_namespace'] },
        { model: WebhookEvent, attributes: ['id', 'event_type', 'event_action', 'source_id', 'received_at', 'status', 'payload'] }
      ],
      order: [['id', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    })

    ctx.body = {
      items: rows.map(s => {
        const payload = s.webhook_event?.payload || {}
        const obj = payload.object_attributes || {}
        const noteable = payload.issue || payload.merge_request || {}
        let eventTitle = obj.title || noteable.title || payload.title || ''

        return {
          id: s.id,
          agent_name: s.agent_name,
          session_type: s.session_type,
          status: s.status,
          started_at: s.started_at,
          finished_at: s.finished_at,
          log_file: s.log_file,
          openclaw_session_id: s.openclaw_session_id,
          openclaw_session_file: s.openclaw_session_file,
          fail_reason: s.fail_reason,
          project: s.project,
          webhook_event: {
            ...s.webhook_event?.toJSON ? s.webhook_event.toJSON() : s.webhook_event,
            event_desc: s.webhook_event ? eventDescription(s.webhook_event) : undefined,
            event_source_url: s.webhook_event ? eventSourceUrl(s.webhook_event) : undefined,
            event_title: eventTitle
          },
          event_title: eventTitle
        }
      }),
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/sessions/:id
router.get('/:id', async ctx => {
  try {
    let session = await AgentSession.findByPk(ctx.params.id, {
      include: [
        { model: Project, attributes: ['id', 'name', 'path_with_namespace'] },
        { model: WebhookEvent },
        { model: SessionMessage, order: [['created_at', 'ASC']] }
      ]
    })
    if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return }
    session = await ensureOpenClawSessionMeta(session)
    ctx.body = session
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/sessions/:id/openclaw-messages - 读取 OpenClaw 真实会话消息（完整数据）
router.get('/:id/openclaw-messages', async ctx => {
  try {
    let session = await AgentSession.findByPk(ctx.params.id)
    if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return }
    session = await ensureOpenClawSessionMeta(session)
    if (!session.openclaw_session_id && !session.openclaw_session_file) {
      ctx.body = {
        messages: [],
        session_id: null,
        session_meta: null,
        model: null,
        thinking_level: null,
        stats: null,
        error: '此会话没有关联 OpenClaw 数据'
      }
      return
    }

    const cliName = sanitizeAgentCliName(session.agent_name)
    const readable = resolveSessionReadableFile(cliName, {
      sessionId: session.openclaw_session_id,
      sessionFile: session.openclaw_session_file
    })
    const filePath = readable?.path || session.openclaw_session_file
    if (!filePath || !fs.existsSync(filePath)) {
      ctx.body = { messages: [], session_id: session.openclaw_session_id, file: filePath, error: 'File not found' }
      return
    }

    if (session.openclaw_session_file !== filePath) {
      await session.update({ openclaw_session_file: filePath })
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const contentFormat = detectSessionContentFormat(content, filePath)

    if (contentFormat === 'trajectory') {
      const parsed = parseTrajectoryContent(content)
      ctx.body = {
        session_id: session.openclaw_session_id,
        file: filePath,
        format: 'trajectory',
        ...parsed
      }
      return
    }

    const messages = []
    const sessionMeta = {}
    let modelInfo = null
    let thinkingLevel = null
    let toolCallCount = 0
    let toolResultCount = 0
    const roles = {}
    let totalTokens = 0
    let hasTokens = false

    const lines = content.split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)

        // Session metadata
        if (entry.type === 'session') {
          sessionMeta.id = entry.id
          sessionMeta.version = entry.version
          sessionMeta.cwd = entry.cwd
          sessionMeta.started_at = entry.timestamp
          continue
        }

        // Model change
        if (entry.type === 'model_change') {
          modelInfo = {
            provider: entry.provider,
            modelId: entry.modelId,
            changed_at: entry.timestamp
          }
          continue
        }

        // Thinking level
        if (entry.type === 'thinking_level_change') {
          thinkingLevel = {
            level: entry.thinkingLevel,
            changed_at: entry.timestamp
          }
          continue
        }

        // Custom event (model-snapshot)
        if (entry.type === 'custom' && entry.customType === 'model-snapshot') {
          if (!modelInfo) {
            modelInfo = {
              provider: entry.data?.provider,
              modelId: entry.data?.modelId,
              modelApi: entry.data?.modelApi,
              changed_at: entry.data?.timestamp
            }
          }
          continue
        }

        // Message
        if (entry.type === 'message') {
          const msg = entry.message
          const role = msg.role
          roles[role] = (roles[role] || 0) + 1

          const textBlocks = []
          const thinkingBlocks = []
          const toolCalls = []
          let toolResult = null

          for (const c of (msg.content || [])) {
            if (c.type === 'text') {
              textBlocks.push(c.text)
            } else if (c.type === 'thinking') {
              thinkingBlocks.push(c.thinking)
            } else if (c.type === 'toolCall') {
              toolCalls.push({
                id: c.id,
                name: c.name,
                arguments: c.arguments
              })
              toolCallCount++
            } else if (c.type === 'toolResult') {
              toolResult = {
                toolName: c.toolName,
                text: c.text ? c.text.slice(0, 2000) : null,
                isError: c.isError
              }
              toolResultCount++
            }
          }

          // For toolResult role, extract tool name from content
          if (role === 'toolResult' && toolResult === null && textBlocks.length > 0) {
            try {
              const parsed = JSON.parse(textBlocks[0])
              toolResult = {
                toolName: parsed.tool || 'unknown',
                text: JSON.stringify(parsed, null, 2).slice(0, 2000),
                isError: !!parsed.error
              }
            } catch (_) {
              // non-JSON tool result
            }
          }

          if (msg.usage) {
            const input = msg.usage.input || msg.usage.promptTokens || 0
            const output = msg.usage.output || msg.usage.completionTokens || 0
            totalTokens += input + output
            hasTokens = true
          }

          messages.push({
            id: entry.id,
            role,
            text: textBlocks.join('\n'),
            thinking: thinkingBlocks.join('\n') || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            toolResult: toolResult,
            timestamp: entry.timestamp || msg.timestamp,
            usage: msg.usage || undefined
          })
        }
      } catch (e) {
        // skip malformed lines
      }
    }

    ctx.body = {
      session_id: session.openclaw_session_id,
      file: filePath,
      session_meta: Object.keys(sessionMeta).length > 0 ? sessionMeta : null,
      model: modelInfo,
      thinking_level: thinkingLevel,
      stats: {
        total_messages: messages.length,
        total_tool_calls: toolCallCount,
        total_tool_results: toolResultCount,
        roles,
        total_tokens: hasTokens ? totalTokens : null
      },
      messages
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/sessions/:id/message
router.post('/:id/message', async ctx => {
  try {
    const { content } = ctx.request.body || {}
    if (!content) { ctx.status = 400; ctx.body = { error: 'content is required' }; return }

    const message = await SessionMessage.create({
      session_id: ctx.params.id,
      role: 'user',
      content
    })
    ctx.body = message
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

export default router
