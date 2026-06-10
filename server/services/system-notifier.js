import { Op } from 'sequelize'
import { broadcastNotification } from './notification-ws.js'
import { getOpenClawVersion } from '../utils/openclawCli.js'
import AdminConfig from '../db/models/adminConfig.js'

let notifierTimer = null
let running = false

// 上次通知的去重缓存（避免重复推送相同内容）
const dedupCache = new Map()
const DEDUP_TTL = 5 * 60 * 1000 // 5 分钟

function isDedup(key) {
  const now = Date.now()
  if (dedupCache.has(key)) {
    const ts = dedupCache.get(key)
    if (now - ts < DEDUP_TTL) return true
  }
  dedupCache.set(key, now)
  // 清理过期
  for (const [k, v] of dedupCache) {
    if (now - v > DEDUP_TTL * 2) dedupCache.delete(k)
  }
  return false
}

/**
 * 获取系统通知配置
 */
export async function getNotifConfig() {
  try {
    const row = await AdminConfig.findOne({ where: { config_key: 'system_notification_config' } })
    if (row?.config_value) {
      return JSON.parse(row.config_value)
    }
  } catch (_) { /* ignore */ }
  return {
    enabled: true,
    checkInterval: 120,       // 检查间隔（秒）
    notifyFailedSessions: true,
    notifyEventVolume: true,
    eventVolumeThreshold: 50, // 多少事件视为高频率
    notifyOpenClawStatus: true,
    notifyAgentErrors: true
  }
}

/**
 * 保存系统通知配置
 */
export async function saveNotifConfig(config) {
  await AdminConfig.upsert({
    config_key: 'system_notification_config',
    config_value: JSON.stringify(config)
  })
}

/**
 * 启动系统通知服务
 */
export async function startNotifier() {
  if (running) return
  running = true
  console.log('System notifier started')

  // 发送一条启动通知，让用户确认通知系统正常工作
  await broadcastNotification({
    type: 'success',
    title: '系统通知已启动',
    message: 'B 端系统通知服务已就绪，将周期性检查系统状态并推送提醒。'
  })

  const poll = async () => {
    while (running) {
      try {
        const cfg = await getNotifConfig()
        if (cfg.enabled) {
          await checkFailedSessions(cfg)
          await checkEventVolume(cfg)
          await checkOpenClawStatus(cfg)
          // 系统 Agent 检查 - 每 5 分钟最多一次
          try {
            const { systemAgentCheck } = await import('./system-agent.js')
            const lastCheckKey = 'system_agent_last_check'
            const now = Date.now()
            let lastCheck = 0
            try {
              const cfgRow = await AdminConfig.findOne({ where: { config_key: lastCheckKey } })
              if (cfgRow) lastCheck = parseInt(cfgRow.config_value, 10) || (now + 120_000) // 启动后至少等 2 分钟
            } catch {}
            if (now - lastCheck > 5 * 60 * 1000) {
              await systemAgentCheck()
              await AdminConfig.upsert({ config_key: lastCheckKey, config_value: String(now) })
            }
          } catch (_) { /* ignore */ }
        }
      } catch (err) {
        console.error('Notifier check error:', err.message)
      }
      await sleep(30000) // 固定 30 秒检查一次
    }
  }
  notifierTimer = poll()
}

/**
 * 停止通知服务
 */
export async function stopNotifier() {
  running = false
  if (notifierTimer) {
    clearTimeout(notifierTimer)
    notifierTimer = null
  }
}

/**
 * 手动触发一次全面检查并推送通知
 */
export async function triggerFullCheck() {
  const cfg = await getNotifConfig()
  if (!cfg.enabled) return { triggered: false, reason: 'disabled' }
  await checkFailedSessions(cfg)
  await checkEventVolume(cfg)
  await checkOpenClawStatus(cfg)
  return { triggered: true }
}

// ── 检查项 ──

async function checkFailedSessions(cfg) {
  if (!cfg.notifyFailedSessions) return

  const { default: AgentSession } = await import('../db/models/agentSession.js')
  const { default: Project } = await import('../db/models/project.js')
  const { default: WebhookEvent } = await import('../db/models/webhookEvent.js')

  const recent = await AgentSession.findAll({
    where: {
      status: 'failed',
      finished_at: { [Op.gte]: new Date(Date.now() - 5 * 60 * 1000) } // 最近 5 分钟
    },
    include: [
      { model: Project, attributes: ['name'] },
      { model: WebhookEvent, attributes: ['event_type', 'source_id'], required: false }
    ],
    limit: 5,
    order: [['finished_at', 'DESC']]
  })

  for (const s of recent) {
    const key = `failed:${s.id}`
    if (isDedup(key)) continue
    await broadcastNotification({
      type: 'error',
      title: `Agent 执行失败`,
      message: `${s.agent_name} | ${s.project?.name || '未知项目'} | ${s.fail_reason || '无详细原因'}`,
      link: `/sessions/${s.id}`
    })
  }
}

async function checkEventVolume(cfg) {
  if (!cfg.notifyEventVolume) return

  const { default: WebhookEvent } = await import('../db/models/webhookEvent.js')

  const threshold = cfg.eventVolumeThreshold || 50
  const count = await WebhookEvent.count({
    where: { received_at: { [Op.gte]: new Date(Date.now() - 5 * 60 * 1000) } }
  })

  if (count >= threshold) {
    const key = `volume:${Math.floor(Date.now() / 300000)}`
    if (isDedup(key)) return
    await broadcastNotification({
      type: 'warning',
      title: `事件流量过高`,
      message: `最近 5 分钟内收到 ${count} 个事件（阈值 ${threshold}）`,
      link: '/events'
    })
  }
}

async function checkOpenClawStatus(cfg) {
  if (!cfg.notifyOpenClawStatus) return

  try {
    const version = await getOpenClawVersion()
    if (!version) {
      const key = 'openclaw:down'
      if (isDedup(key)) return
      await broadcastNotification({
        type: 'error',
        title: 'OpenClaw 不可用',
        message: 'openclaw CLI 无法访问，Agent 调度可能受到影响',
        link: '/settings'
      })
    }
  } catch (_) {
    const key = 'openclaw:down'
    if (isDedup(key)) return
    await broadcastNotification({
      type: 'error',
      title: 'OpenClaw 不可用',
      message: 'openclaw CLI 检查失败，Agent 调度可能受到影响',
      link: '/settings'
    })
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
