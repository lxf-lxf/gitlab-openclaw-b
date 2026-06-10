import { Op } from 'sequelize'
import sequelize from '../db/connection.js'
import { Project, WebhookEvent, AgentSession, WebhookConfig, AgentTemplate } from '../db/models/index.js'
import { eventDescription, eventSourceUrl, eventSourceLabel } from '../utils/eventFormat.js'
import { enrichEventDispatch } from '../utils/eventDispatch.js'
import { buildFlowDiagnostics } from './flow-diagnostics.js'

/**
 * 构建仪表盘 API 响应体（供 HTTP 与 WebSocket 推送复用）
 */
export async function buildDashboardData() {
  const [projectCount, eventCount] = await Promise.all([
    Project.count(),
    WebhookEvent.count()
  ])
  const agentCount = await AgentTemplate.count({ where: { is_active: 1 } })
  const deployedCount = await AgentTemplate.count({ where: { deployed: 1 } })
  const activeSessionCount = await AgentSession.count({ where: { status: 'active' } })
  const webhookEnabledCount = await WebhookConfig.count({ where: { is_enabled: 1 } })

  let openclawStatus = { available: false, version: null, error: null }
  try {
    const { getOpenClawVersion } = await import('../utils/openclawCli.js')
    openclawStatus.version = await getOpenClawVersion()
    if (openclawStatus.version) {
      openclawStatus.available = true
    } else {
      openclawStatus.error = 'openclaw CLI 不可用'
    }
  } catch (_) {
    openclawStatus.error = 'openclaw CLI 不可用'
  }

  const activeSessions = await AgentSession.findAll({
    where: { status: 'active' },
    include: [
      { model: WebhookEvent, include: [{ model: Project, attributes: ['name', 'path_with_namespace'] }] }
    ],
    order: [['started_at', 'DESC']],
    limit: 10
  })

  const recentEvents = await WebhookEvent.findAll({
    include: [{ model: Project, attributes: ['name', 'path_with_namespace'] }],
    order: [['received_at', 'DESC']],
    limit: 10
  })

  const pipelineMap = {}
  for (const s of activeSessions) {
    const ev = s.webhook_event
    if (!ev) continue
    const pid = ev.project_id
    if (!pipelineMap[pid]) {
      pipelineMap[pid] = {
        project: ev.project,
        event: {
          id: ev.id,
          event_type: ev.event_type,
          source_id: ev.source_id,
          received_at: ev.received_at,
          payload: ev.payload
        },
        sessions: []
      }
    }
    pipelineMap[pid].sessions.push({
      id: s.id,
      agent_name: s.agent_name,
      status: s.status,
      started_at: s.started_at
    })
  }

  const eventTypeDist = await WebhookEvent.findAll({
    attributes: ['event_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['event_type'],
    raw: true,
    order: [[sequelize.literal('count'), 'DESC']],
    limit: 8
  })

  const recentFailedSessions = await AgentSession.findAll({
    where: { status: 'failed' },
    include: [
      { model: Project, attributes: ['name'] },
      { model: WebhookEvent, attributes: ['event_type', 'source_id'], required: false }
    ],
    order: [['finished_at', 'DESC']],
    limit: 5
  })

  const agentCallStats = await AgentSession.findAll({
    attributes: ['agent_name', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['agent_name'],
    raw: true,
    order: [[sequelize.literal('count'), 'DESC']],
    limit: 8
  })

  const flowDiagnostics = await buildFlowDiagnostics()

  return {
    stats: {
      projects: projectCount,
      events: eventCount,
      activeSessions: activeSessionCount,
      webhookEnabled: webhookEnabledCount,
      templates: agentCount,
      deployedAgent: deployedCount
    },
    openclawStatus,
    activePipelines: Object.values(pipelineMap).slice(0, 5),
    recentEvents: recentEvents.map(e => enrichEventDispatch({
      id: e.id,
      event_type: e.event_type,
      event_action: e.event_action,
      source_id: e.source_id,
      status: e.status,
      agent_handled: e.agent_handled,
      dispatch_note: e.dispatch_note,
      received_at: e.received_at,
      project: e.project ? { name: e.project.name, path_with_namespace: e.project.path_with_namespace } : null,
      payload: e.payload,
      event_desc: eventDescription(e),
      event_source_url: eventSourceUrl(e),
      event_source_label: eventSourceLabel(e)
    })),
    eventTypeDistribution: eventTypeDist.map(r => ({
      type: r.event_type,
      count: parseInt(r.count, 10)
    })),
    recentFailedSessions: recentFailedSessions.map(s => ({
      id: s.id,
      agent_name: s.agent_name,
      status: s.status,
      started_at: s.started_at,
      finished_at: s.finished_at,
      project: s.project ? { name: s.project.name } : null,
      event: s.webhook_event ? { type: s.webhook_event.event_type, source_id: s.webhook_event.source_id } : null
    })),
    agentCallStats: agentCallStats.map(r => ({
      agent_name: r.agent_name,
      count: parseInt(r.count, 10)
    })),
    agentCoveredProjects: flowDiagnostics.agentBoundProjectCount,
    flowDiagnostics
  }
}
