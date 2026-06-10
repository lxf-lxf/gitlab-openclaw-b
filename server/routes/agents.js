import Router from '@koa/router'
import { Op, Sequelize } from 'sequelize'
import AgentTemplate from '../db/models/agentTemplate.js'
import Project from '../db/models/project.js'
import WebhookConfig from '../db/models/webhookConfig.js'
import { AgentSession, WebhookEvent } from '../db/models/index.js'
import sequelize from '../db/connection.js'
import { eventDescription, eventSourceUrl, eventSourceLabel } from '../utils/eventFormat.js'

function computeFlowStatus(sessions) {
  if (!sessions?.length) return 'idle'
  if (sessions.some(s => s.status === 'active')) return 'running'
  if (sessions.some(s => s.status === 'failed')) return 'failed'
  if (sessions.every(s => s.status === 'completed')) return 'completed'
  return 'pending'
}

const router = new Router()

// GET /api/projects/:projectId/agents - 获取项目关联的 Agent 列表
router.get('/projects/:projectId/agents', async ctx => {
  try {
    const project = await Project.findByPk(ctx.params.projectId, {
      include: [{ model: WebhookConfig }]
    })
    if (!project) { ctx.status = 404; ctx.body = { error: 'Project not found' }; return }

    const { getDeployedEventTemplates } = await import('../services/agent-binding.js')
    const templates = await getDeployedEventTemplates()

    ctx.body = {
      project: { id: project.id, name: project.name, path_with_namespace: project.path_with_namespace },
      webhook: project.webhook_config || null,
      mode: 'global',
      agents: templates.map(t => ({
        template_id: t.id,
        is_active: 1,
        execute_order: t.agent_config?.execute_order || 0,
        template: t
      }))
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/projects/:projectId/pipeline - 获取项目的 Pipeline 执行记录
router.get('/projects/:projectId/pipeline', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(ctx.query.pageSize || '20')))

    const { rows, count } = await WebhookEvent.findAndCountAll({
      where: { project_id: ctx.params.projectId },
      include: [{ model: AgentSession }],
      order: [['received_at', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    })

    ctx.body = {
      items: rows.map(e => ({
        id: e.id,
        event_type: e.event_type,
        event_action: e.event_action,
        source_id: e.source_id,
        status: e.status,
        received_at: e.received_at,
        sessions: (e.agent_sessions || []).map(s => ({
          id: s.id,
          agent_name: s.agent_name,
          status: s.status,
          started_at: s.started_at,
          finished_at: s.finished_at
        }))
      })),
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

// GET /api/agents - 全局已部署事件 Agent 模板列表
router.get('/agents', async ctx => {
  try {
    const { getDeployedEventTemplates } = await import('../services/agent-binding.js')
    const templates = await getDeployedEventTemplates()
    ctx.body = {
      items: templates.map(t => ({
        id: t.id,
        template: t,
        is_active: t.is_active,
        execute_order: t.agent_config?.execute_order || 0,
        mode: 'global'
      })),
      total: templates.length,
      page: 1,
      pageSize: templates.length,
      totalPages: 1
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/pipeline/flows - 最新 Hook 事件及 Agent 执行流程（按最近活动时间排序）
router.get('/pipeline/flows', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(30, Math.max(1, parseInt(ctx.query.pageSize || '20')))
    const offset = (page - 1) * pageSize

    const [eventIdRows] = await sequelize.query(`
      SELECT event_id, MAX(COALESCE(started_at, createdAt)) AS latest_at
      FROM agent_sessions
      GROUP BY event_id
      ORDER BY latest_at DESC
      LIMIT :limit OFFSET :offset
    `, { replacements: { limit: pageSize, offset } })

    const [[countRow]] = await sequelize.query(`
      SELECT COUNT(DISTINCT event_id) AS cnt FROM agent_sessions
    `)
    const total = Number(countRow?.cnt || 0)

    const eventIds = eventIdRows.map(r => r.event_id)
    if (!eventIds.length) {
      ctx.body = { items: [], total: 0, page, pageSize, totalPages: 0 }
      return
    }

    const events = await WebhookEvent.findAll({
      where: { id: eventIds },
      include: [
        { model: Project, attributes: ['id', 'name', 'path_with_namespace'] },
        { model: AgentSession, separate: true, order: [['started_at', 'ASC'], ['id', 'ASC']] }
      ]
    })

    const orderMap = Object.fromEntries(eventIds.map((id, i) => [id, i]))
    const items = events
      .sort((a, b) => orderMap[a.id] - orderMap[b.id])
      .map(e => {
        const sessions = e.agent_sessions || []
        return {
          id: e.id,
          event_type: e.event_type,
          event_action: e.event_action,
          source_id: e.source_id,
          status: e.status,
          received_at: e.received_at,
          agent_handled: e.agent_handled,
          event_desc: eventDescription(e),
          event_source_url: eventSourceUrl(e),
          event_source_label: eventSourceLabel(e),
          project: e.project,
          flow_status: computeFlowStatus(sessions),
          sessions: sessions.map(s => ({
            id: s.id,
            agent_name: s.agent_name,
            status: s.status,
            started_at: s.started_at,
            finished_at: s.finished_at,
            fail_reason: s.fail_reason
          }))
        }
      })

    ctx.body = {
      items,
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

export default router
