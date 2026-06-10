import Router from '@koa/router'
import { Op } from 'sequelize'
import { WebhookEvent, Project, AgentSession, SessionMessage } from '../db/models/index.js'
import { eventDescription, eventSourceUrl, eventSourceLabel, eventTitle } from '../utils/eventFormat.js'
import { enrichEventDispatch } from '../utils/eventDispatch.js'

const router = new Router()

function enrichEvent(e) {
  const base = {
    ...e.toJSON ? e.toJSON() : e,
    event_desc: eventDescription(e),
    event_source_url: eventSourceUrl(e),
    event_source_label: eventSourceLabel(e),
    event_title: eventTitle(e)
  }
  return enrichEventDispatch(base)
}

// GET /api/events - 分页 + 搜索
router.get('/', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize || '20')))
    const keyword = (ctx.query.keyword || '').trim()

    const where = {}
    if (ctx.query.project_id) where.project_id = ctx.query.project_id
    if (ctx.query.event_type) where.event_type = ctx.query.event_type
    if (ctx.query.status) where.status = ctx.query.status
    if (ctx.query.dispatch === 'skipped') {
      where.agent_handled = 0
      where.status = { [Op.in]: ['completed', 'failed'] }
      where[Op.or] = [
        { dispatch_note: { [Op.like]: '%无模板匹配%' } },
        { dispatch_note: { [Op.like]: '%无已部署%' } },
        { dispatch_note: { [Op.like]: '%未启用 Webhook%' } }
      ]
    } else if (ctx.query.dispatch === 'dispatched') {
      where.agent_handled = 1
    }
    if (keyword) {
      const conditions = [
        { event_action: { [Op.like]: `%${keyword}%` } }
      ]
      const numId = parseInt(keyword)
      if (!isNaN(numId)) {
        conditions.push({ source_id: numId })
      }
      where[Op.or] = conditions
    }

    const { rows, count } = await WebhookEvent.findAndCountAll({
      where,
      include: [{ model: Project, attributes: ['name', 'path_with_namespace'] }],
      order: [['received_at', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    })

    ctx.body = {
      items: rows.map(enrichEvent),
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

// GET /api/events/:id
router.get('/:id', async ctx => {
  try {
    const event = await WebhookEvent.findByPk(ctx.params.id, {
      include: [{ model: Project }]
    })
    if (!event) { ctx.status = 404; ctx.body = { error: 'Event not found' }; return }
    ctx.body = event
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/events/:id/retry
router.post('/:id/retry', async ctx => {
  try {
    const event = await WebhookEvent.findByPk(ctx.params.id)
    if (!event) { ctx.status = 404; ctx.body = { error: 'Event not found' }; return }

    await event.update({ status: 'pending', agent_handled: 0, dispatch_note: null })

    // 通过队列重新处理
    const { pushEvent } = await import('../services/event-queue.js')
    pushEvent(event.id).catch(err => {
      console.error(`Retry event ${event.id} error:`, err.message)
    })

    ctx.body = { success: true }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// DELETE /api/events/:id
router.delete('/:id', async ctx => {
  try {
    // 先删除关联的 session 消息
    const sessions = await AgentSession.findAll({ where: { event_id: ctx.params.id } })
    for (const s of sessions) {
      await SessionMessage.destroy({ where: { session_id: s.id } })
    }
    await AgentSession.destroy({ where: { event_id: ctx.params.id } })
    await WebhookEvent.destroy({ where: { id: ctx.params.id } })
    ctx.body = { success: true }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

export default router
