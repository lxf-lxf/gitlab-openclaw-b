import Redis from 'ioredis'
import config from '../config.js'
import AgentManager from './agent-manager.js'
import WebhookEvent from '../db/models/webhookEvent.js'

const QUEUE_KEY = 'bcenter:event:queue'
const PROCESSING_KEY = 'bcenter:event:processing'
const POLL_INTERVAL = 1000 // 1s
const MAX_RETRIES = 3

let redis = null
let consumerTimer = null
let running = false

/**
 * 初始化 Redis 连接
 */
export function initRedis() {
  if (redis) return redis
  const { host, port, password, keyPrefix } = config.redis
  redis = new Redis({
    host,
    port,
    password,
    keyPrefix,
    retryStrategy: times => Math.min(times * 100, 3000),
    maxRetriesPerRequest: 3
  })
  redis.on('error', err => console.error('Redis error:', err.message))
  redis.on('connect', () => console.log(`Redis connected (${host}:${port})`))
  return redis
}

/**
 * 获取 Redis 客户端
 */
export function getRedis() {
  return redis
}

/**
 * 推送事件 ID 到队列
 */
export async function pushEvent(eventId) {
  if (!redis) {
    console.warn('Redis not initialized, processing event directly')
    return processEventDirect(eventId)
  }
  try {
    await redis.lpush(QUEUE_KEY, String(eventId))
    console.log(`Event #${eventId} pushed to queue`)
  } catch (err) {
    console.error(`pushEvent(${eventId}) error:`, err.message)
    // fallback: 直接处理
    processEventDirect(eventId)
  }
}

/**
 * 消费队列中的事件（轮询模式）
 */
export async function startConsumer() {
  if (running) return
  running = true
  if (!redis) {
    console.warn('Redis not available, consumer not started')
    running = false
    return
  }
  console.log('Event queue consumer started')

  const poll = async () => {
    while (running) {
      try {
        const eventId = await redis.rpop(QUEUE_KEY)
        if (eventId) {
          // 加锁避免重复消费
          const lockKey = `${PROCESSING_KEY}:${eventId}`
          const locked = await redis.setnx(lockKey, '1')
          if (locked) {
            await redis.expire(lockKey, 300) // 5 min TTL
            // 异步处理，不阻塞轮询
            processEventDirect(Number(eventId)).finally(async () => {
              await redis.del(lockKey)
            })
          }
        } else {
          // 队列为空，等待
          await sleep(POLL_INTERVAL)
        }
      } catch (err) {
        console.error('Queue consumer error:', err.message)
        await sleep(POLL_INTERVAL * 5)
      }
    }
  }
  consumerTimer = poll()
}

/**
 * 停止消费者
 */
export async function stopConsumer() {
  running = false
  if (consumerTimer) {
    clearTimeout(consumerTimer)
    consumerTimer = null
  }
}

// ── 事件处理 ──

async function processEventDirect(eventId) {
  let event = null
  try {
    const { Project } = await import('../db/models/index.js')
    event = await WebhookEvent.findByPk(eventId, {
      include: [{ model: Project, attributes: ['name', 'path_with_namespace'] }]
    })
    if (!event) {
      const { notifyFlowFailure } = await import('./webhook-flow-notify.js')
      await notifyFlowFailure({
        title: '事件处理失败',
        message: `事件 #${eventId} 不存在，无法调度 Agent`
      })
      return
    }
    await AgentManager.handleEvent(event)
  } catch (err) {
    console.error(`processEvent(${eventId}) error:`, err.message)
    try {
      const { markEventFailed, notifyFlowFailure } = await import('./webhook-flow-notify.js')
      await markEventFailed(eventId)
      await notifyFlowFailure({
        title: '事件处理异常',
        message: err.message,
        event
      })
    } catch (notifyErr) {
      console.warn(`processEvent(${eventId}) notify error:`, notifyErr.message)
    }
  } finally {
    const { scheduleDashboardBroadcast } = await import('./notification-ws.js')
    scheduleDashboardBroadcast()
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
