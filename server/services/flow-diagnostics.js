import { Op } from 'sequelize'
import WebhookEvent from '../db/models/webhookEvent.js'
import WebhookConfig from '../db/models/webhookConfig.js'
import Project from '../db/models/project.js'
import { enrichEventDispatch } from '../utils/eventDispatch.js'
import { getDeployedEventTemplates } from './agent-binding.js'

/**
 * 仪表盘流程诊断（无项目绑定模式）
 */
export async function buildFlowDiagnostics() {
  const eventTemplates = await getDeployedEventTemplates()
  const hasEventTemplates = eventTemplates.length > 0
  const webhookEnabledCount = await WebhookConfig.count({ where: { is_enabled: 1 } })

  if (!hasEventTemplates) {
    return {
      blockers: [{
        type: 'no_event_template',
        severity: 'warning',
        message: '尚无已部署的「事件触发」Agent 模板，Webhook 事件不会自动调度',
        action: '前往 Agent 模板初始化',
        link: '/templates'
      }],
      hasEventTemplates: false,
      deployableTemplates: [],
      recentSkippedEvents: [],
      skipStats: { no_match: 0, total_recent: 0 },
      webhookEnabledCount,
      agentBoundProjectCount: webhookEnabledCount
    }
  }

  const recentSkipped = await WebhookEvent.findAll({
    where: {
      agent_handled: 0,
      status: { [Op.in]: ['completed', 'failed'] },
      dispatch_note: { [Op.like]: '%无模板匹配%' }
    },
    include: [{ model: Project, attributes: ['id', 'name', 'path_with_namespace'] }],
    order: [['received_at', 'DESC']],
    limit: 10
  })

  const skippedEvents = recentSkipped.map(e => {
    const enriched = enrichEventDispatch(e)
    enriched.dispatch_label = '触发规则不匹配'
    enriched.dispatch_code = 'no_trigger_match'
    enriched.dispatch_tone = 'muted'
    return enriched
  })

  const blockers = skippedEvents.length > 0
    ? [{
      type: 'trigger_mismatch_summary',
      severity: 'info',
      message: `最近 ${skippedEvents.length} 条事件未匹配任何模板触发规则`,
      action: '检查 Agent 模板触发配置',
      link: '/templates',
      count: skippedEvents.length
    }]
    : []

  return {
    blockers,
    hasEventTemplates: true,
    deployableTemplates: eventTemplates.map(t => ({
      id: t.id,
      name: t.name,
      triggers: t.agent_config?.triggers || [],
      event_types: t.agent_config?.event_types || []
    })),
    unboundWebhookProjects: [],
    unboundWebhookCount: 0,
    recentSkippedEvents: skippedEvents,
    skipStats: {
      no_match: skippedEvents.length,
      total_recent: skippedEvents.length
    },
    webhookEnabledCount,
    agentBoundProjectCount: webhookEnabledCount
  }
}
