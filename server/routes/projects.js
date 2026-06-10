import Router from '@koa/router'
import { scheduleDashboardBroadcast } from '../services/notification-ws.js'
import { Op } from 'sequelize'
import Project from '../db/models/project.js'
import WebhookConfig from '../db/models/webhookConfig.js'
import AdminConfig from '../db/models/adminConfig.js'
import { createWebhook } from '../services/gitlab-client.js'
import { attachWebhookConfigs, tearDownProjectWebhook, upsertWebhookConfig } from '../services/project-webhook.js'
import { getDeployedEventTemplates } from '../services/agent-binding.js'
import config from '../config.js'

const router = new Router()

function projectNamespace(path) {
  return path?.split('/').slice(0, -1).join('/') || '其他'
}

async function findProjectsInGroup(namespace) {
  const projects = await Project.findAll({ order: [['path_with_namespace', 'ASC']] })
  await attachWebhookConfigs(projects)
  if (namespace === '其他') {
    return projects.filter(p => !p.path_with_namespace?.includes('/'))
  }
  return projects.filter(p => projectNamespace(p.path_with_namespace) === namespace)
}

// GET /api/projects - 分页 + 搜索
router.get('/', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize || '20')))
    const keyword = (ctx.query.keyword || '').trim()

    const where = {}
    if (keyword) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { path_with_namespace: { [Op.like]: `%${keyword}%` } }
      ]
    }

    const { rows, count } = await Project.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize,
      distinct: true
    })
    await attachWebhookConfigs(rows)

    ctx.body = {
      items: rows,
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

// GET /api/projects/sync/status - 同步进度（刷新页面后可恢复）
router.get('/sync/status', async ctx => {
  try {
    const { getGitlabSyncStatus } = await import('../services/gitlab-sync.js')
    ctx.body = getGitlabSyncStatus()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/projects/sync/stop - 停止进行中的同步
router.post('/sync/stop', async ctx => {
  try {
    const { stopGitlabSync } = await import('../services/gitlab-sync.js')
    ctx.body = stopGitlabSync()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/projects/sync - 后台启动 GitLab 全量同步
router.post('/sync', async ctx => {
  try {
    const { startGitlabSync } = await import('../services/gitlab-sync.js')
    ctx.body = startGitlabSync()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/projects/groups - 按 namespace 分组获取项目
router.get('/groups', async ctx => {
  try {
    const projects = await Project.findAll({ order: [['path_with_namespace', 'ASC']] })
    await attachWebhookConfigs(projects)

    const eventTemplates = await getDeployedEventTemplates()
    const hasEventTemplates = eventTemplates.length > 0

    const groups = {}
    for (const p of projects) {
      const ns = projectNamespace(p.path_with_namespace)
      if (!groups[ns]) {
        groups[ns] = { namespace: ns, projects: [], webhookEnabled: 0, total: 0 }
      }
      const plain = p.toJSON ? p.toJSON() : { ...p }
      groups[ns].projects.push(plain)
      groups[ns].total++
      if (p.webhook_config?.is_enabled) groups[ns].webhookEnabled++
    }

    const sorted = Object.values(groups).sort((a, b) => a.namespace.localeCompare(b.namespace))

    // ?meta=1 返回包装对象；默认仍返回数组，兼容旧前端
    if (ctx.query.meta === '1') {
      ctx.body = { has_event_templates: hasEventTemplates, groups: sorted }
    } else {
      ctx.body = sorted
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/projects/groups/:namespace/webhook/enable-all - 一键启用分组 Webhook
router.post('/groups/:namespace/webhook/enable-all', async ctx => {
  try {
    const namespace = decodeURIComponent(ctx.params.namespace)
    const projects = await findProjectsInGroup(namespace)

    const baseUrlConfig = await AdminConfig.findOne({ where: { config_key: 'webhook_base_url' } })
    const webhookBaseUrl = baseUrlConfig?.config_value || config.webhook.baseUrl
    const webhookUrl = `${webhookBaseUrl}/api/webhook/receiver`

    let enabled = 0
    let skipped = 0
    for (const project of projects) {
      if (project.webhook_config?.is_enabled) {
        skipped++
        continue
      }
      try {
        const secretToken = Math.random().toString(36).substring(2, 15)
        const gitlabHook = await createWebhook(project.gitlab_id, webhookUrl, secretToken)
        await upsertWebhookConfig(project.id, {
          gitlab_hook_id: gitlabHook.id,
          webhook_url: webhookUrl,
          secret_token: secretToken,
          is_enabled: 1,
          push_events: 1, issues_events: 1, merge_requests_events: 1,
          note_events: 1, tag_push_events: 1, pipeline_events: 1,
          wiki_page_events: 1, job_events: 1, deployment_events: 1,
          releases_events: 1,
          last_sync_at: new Date()
        })
        enabled++
      } catch (err) {
        console.warn(`Group webhook: project ${project.id} error: ${err.message}`)
      }
    }

    scheduleDashboardBroadcast()
    ctx.body = { success: true, enabled, skipped, total: projects.length }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/projects/groups/:namespace/webhook/disable-all - 一键关闭分组 Webhook
router.post('/groups/:namespace/webhook/disable-all', async ctx => {
  try {
    const namespace = decodeURIComponent(ctx.params.namespace)
    const projects = await findProjectsInGroup(namespace)

    let disabled = 0
    let skipped = 0
    for (const project of projects) {
      if (!project.webhook_config?.is_enabled) {
        skipped++
        continue
      }
      try {
        const result = await tearDownProjectWebhook(project)
        if (result.removed) disabled++
      } catch (err) {
        console.warn(`Group webhook disable: project ${project.id} error: ${err.message}`)
      }
    }

    scheduleDashboardBroadcast()
    ctx.body = { success: true, disabled, skipped, total: projects.length }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// DELETE /api/projects/:id
router.delete('/:id', async ctx => {
  try {
    await Project.destroy({ where: { id: ctx.params.id } })
    ctx.body = { success: true }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/projects/:id/webhook
router.get('/:id/webhook', async ctx => {
  try {
    const config = await WebhookConfig.findOne({ where: { project_id: ctx.params.id } })
    ctx.body = config || { is_enabled: false, webhook_url: null }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/projects/:id/webhook/enable - 一键配置 Webhook（使用局域网 IP + 接收所有事件）
router.post('/:id/webhook/enable', async ctx => {
  try {
    const project = await Project.findByPk(ctx.params.id)
    if (!project) { ctx.status = 404; ctx.body = { error: 'Project not found' }; return }

    // 从配置读取局域网 Webhook 回调地址
    const baseUrlConfig = await AdminConfig.findOne({ where: { config_key: 'webhook_base_url' } })
    const webhookBaseUrl = baseUrlConfig?.config_value || config.webhook.baseUrl
    const webhookUrl = `${webhookBaseUrl}/api/webhook/receiver`
    const secretToken = Math.random().toString(36).substring(2, 15)

    // 在 GitLab 上创建 webhook（接收所有事件）
    const gitlabHook = await createWebhook(project.gitlab_id, webhookUrl, secretToken)

    const config = await upsertWebhookConfig(project.id, {
      gitlab_hook_id: gitlabHook.id,
      webhook_url: webhookUrl,
      secret_token: secretToken,
      is_enabled: 1,
      push_events: 1,
      issues_events: 1,
      merge_requests_events: 1,
      note_events: 1,
      tag_push_events: 1,
      pipeline_events: 1,
      wiki_page_events: 1,
      job_events: 1,
      deployment_events: 1,
      releases_events: 1,
      last_sync_at: new Date()
    })

    scheduleDashboardBroadcast()
    ctx.body = { success: true, hook_id: gitlabHook.id, config }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/projects/:id/webhook/disable
router.post('/:id/webhook/disable', async ctx => {
  try {
    const project = await Project.findByPk(ctx.params.id)
    if (!project) { ctx.status = 404; ctx.body = { error: 'Project not found' }; return }

    const result = await tearDownProjectWebhook(project)
    if (!result.removed) {
      ctx.body = { success: true, removed: false }
      return
    }
    scheduleDashboardBroadcast()
    ctx.body = { success: true, removed: result.removed }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

export default router
