import AgentTemplate from '../db/models/agentTemplate.js'
import WebhookConfig from '../db/models/webhookConfig.js'
import { templateMatchesEvent, normalizeTriggers } from '../utils/eventTriggerMatch.js'

export async function getDeployedEventTemplates() {
  return AgentTemplate.findAll({
    where: { is_active: 1, deployed: 1, trigger_mode: 'event' },
    order: [['id', 'ASC']]
  })
}

/** 项目是否已启用 Webhook（启用后才参与自动调度） */
export async function projectWebhookEnabled(projectId) {
  const cfg = await WebhookConfig.findOne({ where: { project_id: projectId } })
  return !!cfg?.is_enabled
}

/** 从全局已部署模板中筛选匹配当前事件的模板 */
export function filterTemplatesForEvent(templates, event, ev) {
  return templates.filter(t => templateMatchesEvent(t, event, ev))
}

export function getTemplateExecuteOrder(template) {
  return template?.agent_config?.execute_order ?? 0
}

export { normalizeTriggers, templateMatchesEvent }
