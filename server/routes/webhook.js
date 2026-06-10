import Router from '@koa/router'
import WebhookEvent from '../db/models/webhookEvent.js'
import Project from '../db/models/project.js'
import WebhookConfig from '../db/models/webhookConfig.js'
import { pushEvent } from '../services/event-queue.js'
import { scheduleDashboardBroadcast } from '../services/notification-ws.js'
import { notifyFlowFailure } from '../services/webhook-flow-notify.js'

const router = new Router()

// POST /api/webhook/receiver - GitLab 回调入口
router.post('/webhook/receiver', async ctx => {
  let savedEvent = null
  try {
    const eventType = ctx.headers['x-gitlab-event']
    const token = ctx.headers['x-gitlab-token']
    const body = ctx.request.body

    const projectId = body?.project?.id
    if (!projectId) {
      ctx.status = 400
      ctx.body = { error: 'Missing project id in payload' }
      return
    }

    const project = await Project.findOne({ where: { gitlab_id: projectId } })
    if (!project) {
      ctx.status = 404
      ctx.body = { error: 'Project not configured in B-center' }
      return
    }

    const webhookConfig = await WebhookConfig.findOne({ where: { project_id: project.id } })
    if (webhookConfig?.secret_token && token !== webhookConfig.secret_token) {
      ctx.status = 403
      ctx.body = { error: 'Invalid webhook secret token' }
      return
    }

    const eventInfo = parseEventInfo(eventType, body)

    savedEvent = await WebhookEvent.create({
      project_id: project.id,
      event_type: eventType || 'unknown',
      event_action: eventInfo.action,
      source_id: eventInfo.sourceId,
      payload: body,
      raw_headers: Object.fromEntries(
        Object.entries(ctx.headers).map(([k, v]) => [k, String(v)])
      ),
      status: 'pending'
    })
    savedEvent.project = project

    try {
      await pushEvent(savedEvent.id)
    } catch (queueErr) {
      console.error(`Event ${savedEvent.id} queue push error:`, queueErr.message)
      await notifyFlowFailure({
        title: '事件入队失败',
        message: queueErr.message,
        event: savedEvent
      })
    }

    scheduleDashboardBroadcast()

    ctx.status = 200
    ctx.body = { received: true, event_id: savedEvent.id }
  } catch (err) {
    console.error('webhook receiver error:', err.message)
    ctx.status = 500
    ctx.body = { error: err.message }
    try {
      await notifyFlowFailure({
        title: 'Webhook 接收失败',
        message: err.message,
        event: savedEvent
      })
      if (savedEvent?.id) {
        const { markEventFailed } = await import('../services/webhook-flow-notify.js')
        await markEventFailed(savedEvent.id)
      }
    } catch (_) { /* ignore notify errors */ }
  }
})

function parseEventInfo(eventType, body) {
  const info = { action: null, sourceId: null }
  if (!eventType) return info

  if (eventType === 'Push Hook') {
    info.action = 'push'
  } else if (eventType === 'Issue Hook') {
    info.action = body?.object_attributes?.action || 'unknown'
    info.sourceId = body?.object_attributes?.iid || body?.object_attributes?.id
  } else if (eventType === 'Merge Request Hook') {
    info.action = body?.object_attributes?.action || 'unknown'
    info.sourceId = body?.object_attributes?.iid
  } else if (eventType === 'Note Hook') {
    info.action = 'comment'
    info.sourceId = body?.issue?.iid || body?.merge_request?.iid
  } else if (eventType === 'Pipeline Hook') {
    info.action = body?.object_attributes?.status || 'unknown'
    info.sourceId = body?.object_attributes?.id
  } else if (eventType === 'Job Hook') {
    info.action = body?.build_status || 'unknown'
    info.sourceId = body?.build_id
  }
  return info
}

export default router
