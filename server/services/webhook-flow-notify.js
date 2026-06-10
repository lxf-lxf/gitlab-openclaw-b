import WebhookEvent from '../db/models/webhookEvent.js'
import Project from '../db/models/project.js'
import { broadcastNotification, scheduleDashboardBroadcast } from './notification-ws.js'

/**
 * 构建事件上下文摘要（用于通知正文）
 */
export async function buildEventContextLabel(event) {
  if (!event) return '未知事件'
  try {
    const proj = event.project || (event.project_id
      ? await Project.findByPk(event.project_id, { attributes: ['name', 'path_with_namespace'] })
      : null)
    const projectPath = proj?.path_with_namespace || proj?.name || `项目#${event.project_id}`
    const source = event.source_id ? ` #${event.source_id}` : ''
    return `${projectPath} · ${event.event_type || 'unknown'}${source} · 事件#${event.id}`
  } catch {
    return `事件#${event.id}`
  }
}

/**
 * Webhook → Agent 流程失败时推送浏览器通知
 */
export async function notifyFlowFailure({
  title = 'Webhook 处理失败',
  message,
  event = null,
  link = null,
  sessionId = null,
  type = 'error'
}) {
  if (!message) return
  try {
    const lines = []
    if (event) {
      lines.push(await buildEventContextLabel(event))
    }
    lines.push(String(message))
    await broadcastNotification({
      type,
      title,
      message: lines.join('\n'),
      link: link || (sessionId ? `/sessions/${sessionId}` : '/events')
    })
    scheduleDashboardBroadcast()
  } catch (err) {
    console.warn('notifyFlowFailure:', err.message)
  }
}

/**
 * 将 Webhook 事件标记为失败
 */
export async function markEventFailed(eventId, dispatchNote = 'Agent 调度或执行失败') {
  if (!eventId) return
  try {
    await WebhookEvent.update(
      { status: 'failed', agent_handled: 0, dispatch_note: dispatchNote },
      { where: { id: eventId } }
    )
  } catch (err) {
    console.warn(`markEventFailed(${eventId}):`, err.message)
  }
}
