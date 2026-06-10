import Router from '@koa/router'
import AdminConfig from '../db/models/adminConfig.js'
import { clearTokenCache } from '../services/gitlab-client.js'
import config from '../config.js'

const router = new Router()

router.get('/configs', async ctx => {
  try {
    const configs = await AdminConfig.findAll()
    const map = {}
    for (const c of configs) {
      map[c.config_key] = { value: c.config_value, description: c.description }
    }
    map._envDefaults = {
      gitlab_base_url: config.gitlab.baseUrl,
      webhook_base_url: config.webhook.baseUrl,
      default_model: config.openclaw.defaultModel
    }
    ctx.body = map
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

router.get('/gitlab-profile', async ctx => {
  try {
    const { getGitLabProfile } = await import('../services/gitlab-client.js')
    ctx.body = await getGitLabProfile()
  } catch (err) {
    ctx.status = 500
    ctx.body = { connected: false, error: err.message, user: null }
  }
})

router.put('/configs/:key', async ctx => {
  try {
    const { key } = ctx.params
    const { value } = ctx.request.body || {}
    if (value === undefined) {
      ctx.status = 400
      ctx.body = { error: 'value is required' }
      return
    }
    await AdminConfig.upsert({ config_key: key, config_value: String(value) })
    // 清除 GitLab Token 缓存
    if (key === 'gitlab_token' || key === 'gitlab_base_url') clearTokenCache()
    ctx.body = { success: true, key, value }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/admin/max-concurrent-agents - 获取最大并发 Agent 限制
router.get('/max-concurrent-agents', async ctx => {
  try {
    const cfg = await AdminConfig.findOne({ where: { config_key: 'max_concurrent_agents' } })
    ctx.body = { value: parseInt(cfg?.config_value || '10', 10) }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// PUT /api/admin/max-concurrent-agents - 设置最大并发 Agent 限制
router.put('/max-concurrent-agents', async ctx => {
  try {
    const { value } = ctx.request.body || {}
    const limit = Math.max(1, Math.min(100, parseInt(value || '10', 10)))
    await AdminConfig.upsert({ config_key: 'max_concurrent_agents', config_value: String(limit) })
    ctx.body = { success: true, value: limit }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

export default router

// POST /api/admin/deploy-system-agent - 部署系统监控 Agent
router.post('/deploy-system-agent', async ctx => {
  try {
    const { deploySystemAgent } = await import('../services/system-agent.js')
    const { workspace } = ctx.request.body || {}
    const result = await deploySystemAgent(workspace)
    ctx.body = result
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/admin/remove-system-agent - 移除系统监控 Agent
router.post('/remove-system-agent', async ctx => {
  try {
    const { removeSystemAgent } = await import('../services/system-agent.js')
    const result = await removeSystemAgent()
    ctx.body = result
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/admin/system-agent-status - 获取系统 Agent 状态
router.get('/system-agent-status', async ctx => {
  try {
    const { getSystemAgentStatus } = await import('../services/system-agent.js')
    ctx.body = await getSystemAgentStatus()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/admin/openclaw-workspaces - 获取 OpenClaw 现有 workspace 列表
router.get('/openclaw-workspaces', async ctx => {
  try {
    const { getOpenClawWorkspaces } = await import('../services/system-agent.js')
    ctx.body = await getOpenClawWorkspaces()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/admin/system-agent-config - 获取系统 Agent 配置（agent.json）
router.get('/system-agent-config', async ctx => {
  try {
    const { getSystemAgentConfig } = await import('../services/system-agent.js')
    ctx.body = await getSystemAgentConfig()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// PUT /api/admin/system-agent-config - 更新系统 Agent 配置（agent.json）
router.put('/system-agent-config', async ctx => {
  try {
    const { updateSystemAgentConfig } = await import('../services/system-agent.js')
    const body = ctx.request.body || {}
    const result = await updateSystemAgentConfig(body)
    ctx.body = result
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})
