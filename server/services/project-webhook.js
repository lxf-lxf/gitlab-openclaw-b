import { Op } from 'sequelize'
import WebhookConfig from '../db/models/webhookConfig.js'
import { removeProjectWebhooks } from './gitlab-client.js'

export function pickWebhookConfig(configs) {
  if (!configs?.length) return null
  return [...configs].sort((a, b) => {
    if (Number(b.is_enabled) !== Number(a.is_enabled)) {
      return Number(b.is_enabled) - Number(a.is_enabled)
    }
    return b.id - a.id
  })[0]
}

/** 为项目列表附加唯一 webhook_config（避免 JOIN 产生重复行） */
export async function attachWebhookConfigs(projects) {
  if (!projects.length) return projects

  const configs = await WebhookConfig.findAll({
    where: { project_id: { [Op.in]: projects.map(p => p.id) } }
  })
  const byProject = new Map()
  for (const cfg of configs) {
    const list = byProject.get(cfg.project_id) || []
    list.push(cfg)
    byProject.set(cfg.project_id, list)
  }

  for (const project of projects) {
    const chosen = pickWebhookConfig(byProject.get(project.id))
    if (typeof project.setDataValue === 'function') {
      project.setDataValue('webhook_config', chosen)
    } else {
      project.webhook_config = chosen
    }
  }
  return projects
}

export async function upsertWebhookConfig(projectId, data) {
  const existing = await WebhookConfig.findOne({ where: { project_id: projectId } })
  if (existing) {
    await existing.update(data)
    return existing
  }
  return WebhookConfig.create({ project_id: projectId, ...data })
}

export async function tearDownProjectWebhook(project) {
  const configs = await WebhookConfig.findAll({ where: { project_id: project.id } })
  if (!configs.length) return { removed: false, reason: 'no_config' }

  try {
    for (const cfg of configs) {
      await removeProjectWebhooks(project.gitlab_id, {
        hookId: cfg.gitlab_hook_id,
        webhookUrl: cfg.webhook_url
      })
    }
    await removeProjectWebhooks(project.gitlab_id, {})
  } catch (err) {
    console.warn(`GitLab webhook remove failed for project ${project.id}: ${err.message}`)
  }

  const count = await WebhookConfig.destroy({ where: { project_id: project.id } })
  return { removed: true, count }
}

/** 每个 project_id 仅保留一条 webhook 配置（优先已启用、最新） */
export async function dedupeWebhookConfigs() {
  const all = await WebhookConfig.findAll({
    order: [['project_id', 'ASC'], ['is_enabled', 'DESC'], ['id', 'DESC']]
  })

  const keepIds = new Set()
  const removeIds = []
  for (const cfg of all) {
    if (keepIds.has(cfg.project_id)) {
      removeIds.push(cfg.id)
    } else {
      keepIds.add(cfg.project_id)
    }
  }

  if (!removeIds.length) return 0

  await WebhookConfig.destroy({ where: { id: removeIds } })
  console.log(`Removed ${removeIds.length} duplicate webhook_configs rows.`)
  return removeIds.length
}
