import Router from '@koa/router'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AgentTemplate from '../db/models/agentTemplate.js'
import config from '../config.js'
import { spawnSyncOpenClaw, ensureWorkspaceDir, cliTimeoutMs, isSpawnTimedOut } from '../utils/openclawCli.js'

const router = new Router()
const OPENCLAW_AGENTS_DIR = config.openclaw.agentsDir
const MODEL_ID = config.openclaw.defaultModel

// gitlab-tools 插件源码路径（内置于 B 端项目中）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GITLAB_TOOLS_SRC = path.resolve(__dirname, '../plugins/gitlab-tools.js')

function sanitizeAgentName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

function validateName(name) {
  return /^[a-z][a-z0-9-]*$/.test(name)
}

// GET /api/templates/trigger-catalog - 触发规则元数据（供前端配置）
router.get('/trigger-catalog', async ctx => {
  try {
    const { EVENT_TRIGGER_CATALOG } = await import('../utils/eventTriggerMatch.js')
    ctx.body = EVENT_TRIGGER_CATALOG
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/templates - 模板列表
router.get('/', async ctx => {
  try {
    const templates = await AgentTemplate.findAll({ order: [['id', 'DESC']] })
    ctx.body = templates
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// GET /api/templates/:id
router.get('/:id', async ctx => {
  try {
    const template = await AgentTemplate.findByPk(ctx.params.id)
    if (!template) { ctx.status = 404; ctx.body = { error: 'Template not found' }; return }
    ctx.body = template
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/templates - 创建模板
router.post('/', async ctx => {
  try {
    const body = ctx.request.body || {}
    const name = (body.name || '').trim()
    if (!validateName(name)) {
      ctx.status = 400
      ctx.body = { error: '模板名称仅支持英文小写字母、数字和连字符（如：webhook-status-flow）' }
      return
    }
    const template = await AgentTemplate.create({
      name: name,
      description: body.description || '',
      trigger_mode: body.trigger_mode || 'manual',
      agent_config: body.agent_config || {},
      workspace_path: body.workspace_path || '',
      is_active: body.is_active !== false ? 1 : 0
    })
    ctx.body = template
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// PUT /api/templates/:id - 更新模板
router.put('/:id', async ctx => {
  try {
    const body = ctx.request.body || {}
    if (body.name !== undefined) {
      const name = (body.name || '').trim()
      if (!validateName(name)) {
        ctx.status = 400
        ctx.body = { error: '模板名称仅支持英文小写字母、数字和连字符（如：webhook-status-flow）' }
        return
      }
      body.name = name
    }
    await AgentTemplate.update(body, { where: { id: ctx.params.id } })
    const template = await AgentTemplate.findByPk(ctx.params.id)
    ctx.body = template
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// DELETE /api/templates/:id - 删除模板
router.delete('/:id', async ctx => {
  try {
    const template = await AgentTemplate.findByPk(ctx.params.id)
    if (!template) { ctx.status = 404; ctx.body = { error: 'Template not found' }; return }

    const agentName = sanitizeAgentName(template.name)
    const agentDir = path.join(OPENCLAW_AGENTS_DIR, agentName)

    // 可选：删除 OpenClaw 本地配置
    const removeOpenClaw = ctx.query.removeOpenClaw === 'true'
    let openclawRemoved = false
    if (removeOpenClaw && fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true })
      openclawRemoved = true
      // 尝试从 OpenClaw 注册中移除
      try {
        spawnSyncOpenClaw(['agents', 'remove', '--agent-dir', path.join(agentDir, 'agent'), '--non-interactive'], {
          stdio: 'pipe', encoding: 'utf-8', timeout: cliTimeoutMs(15000)
        })
      } catch (_) { /* ignore removal errors */ }
    }

    await AgentTemplate.destroy({ where: { id: ctx.params.id } })
    ctx.body = { success: true, openclaw_removed: openclawRemoved, agent_dir: agentDir }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/templates/deploy-all - 初始化全部未部署模板（须在 /:id 之前注册）
router.post('/deploy-all', async ctx => {
  try {
    const { deployTemplateWithDependencies } = await import('../services/template-deploy.js')
    const pending = await AgentTemplate.findAll({
      where: { is_active: 1, deployed: 0 },
      order: [['id', 'ASC']]
    })
    const results = []
    for (const t of pending) {
      try {
        const r = await deployTemplateWithDependencies(t)
        results.push({ id: t.id, name: t.name, success: true, ...r })
      } catch (err) {
        results.push({ id: t.id, name: t.name, success: false, error: err.message })
      }
    }
    const { scheduleDashboardBroadcast } = await import('../services/notification-ws.js')
    scheduleDashboardBroadcast()
    ctx.body = { success: true, results }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// POST /api/templates/:id/deploy - 初始化模板到 OpenClaw（含 chain 依赖）
router.post('/:id/deploy', async ctx => {
  try {
    const template = await AgentTemplate.findByPk(ctx.params.id)
    if (!template) { ctx.status = 404; ctx.body = { error: 'Template not found' }; return }

    const { deployTemplateWithDependencies } = await import('../services/template-deploy.js')
    const result = await deployTemplateWithDependencies(template)

    const { scheduleDashboardBroadcast } = await import('../services/notification-ws.js')
    scheduleDashboardBroadcast()

    let message = result.message
    if (result.chain?.deployed?.length) {
      message += `；已同步初始化依赖: ${result.chain.deployed.map(d => d.name).join('、')}`
    }
    if (result.chain?.errors?.length) {
      message += `；依赖初始化失败: ${result.chain.errors.map(e => e.name).join('、')}`
    }

    ctx.body = {
      success: true,
      ...result,
      message
    }
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

export default router
