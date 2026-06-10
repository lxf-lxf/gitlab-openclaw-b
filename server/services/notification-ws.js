import { WebSocketServer } from 'ws'
import SystemNotification from '../db/models/systemNotification.js'

const MAX_HISTORY = 50
const DASHBOARD_DEBOUNCE_MS = 600
let wss = null
let dashboardTimer = null

/**
 * 附加 WebSocket 服务到 HTTP Server
 */
export function attachWebSocket(server) {
  if (wss) return wss

  wss = new WebSocketServer({ server, path: '/api/ws' })

  wss.on('connection', async (ws, req) => {
    console.log(`WS client connected (${req.socket.remoteAddress})`)

    // 推送数据库中的未读历史
    try {
      const history = await SystemNotification.findAll({
        order: [['created_at', 'DESC']],
        limit: MAX_HISTORY
      })
      if (history.length > 0) {
        ws.send(JSON.stringify({
          type: 'history',
          notifications: history.map(n => formatNotif(n))
        }))
      }
    } catch (err) {
      console.warn('Failed to load notification history:', err.message)
    }

    ws.on('close', () => {
      console.log('WS client disconnected')
    })

    ws.on('error', (err) => {
      console.error('WS error:', err.message)
    })
  })

  console.log('WebSocket server attached at /api/ws')
  return wss
}

function formatNotif(row) {
  return {
    id: row.id,
    type: row.type || 'info',
    title: row.title,
    message: row.message,
    timestamp: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    link: row.link,
    actions: row.actions,
    actionable: !!row.actions?.length,
    read: !!row.read,
    actioned: row.actioned,
    reportData: row.reportData || null,
    reportId: row.reportId || null
  }
}

/**
 * 推送通知到所有连接客户端并存入数据库
 */
export async function broadcastNotification(notif) {
  if (!wss) return

  // 存入数据库
  let dbRow = null
  try {
    dbRow = await SystemNotification.create({
      type: notif.type || 'info',
      title: notif.title || '',
      message: notif.message || '',
      link: notif.link || null,
      actions: notif.actions || null,
      actionable: !!notif.actions?.length,
      reportData: notif.reportData || null,
      reportId: notif.reportId || null
    })
  } catch (err) {
    console.warn('Failed to save notification to DB:', err.message)
  }

  const notification = formatNotif(dbRow || {
    id: Date.now(),
    ...notif,
    type: notif.type || 'info',
    title: notif.title || '',
    message: notif.message || ''
  })

  // 广播
  const payload = JSON.stringify({ type: 'notification', notification })
  const clientCount = broadcast(payload)
  console.log(`Notification broadcast: "${notification.title}" → ${clientCount} clients`)
}

/**
 * 广播原始消息到所有客户端
 */
function broadcast(data) {
  if (!wss) return 0
  let count = 0
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data)
      count++
    }
  })
  return count
}

/**
 * 防抖调度仪表盘数据推送（合并短时间内的多次变更）
 */
export function scheduleDashboardBroadcast() {
  if (!wss) return
  if (dashboardTimer) clearTimeout(dashboardTimer)
  dashboardTimer = setTimeout(() => {
    dashboardTimer = null
    broadcastDashboardUpdate().catch(err => {
      console.warn('Dashboard broadcast failed:', err.message)
    })
  }, DASHBOARD_DEBOUNCE_MS)
}

/**
 * 立即推送最新仪表盘数据到所有 WebSocket 客户端
 */
export async function broadcastDashboardUpdate() {
  if (!wss) return 0
  const { buildDashboardData } = await import('./dashboard-data.js')
  const dashboard = await buildDashboardData()
  const payload = JSON.stringify({ type: 'dashboard', dashboard })
  const count = broadcast(payload)
  if (count > 0) {
    console.log(`Dashboard broadcast → ${count} clients`)
  }
  return count
}

/**
 * 获取 WebSocket 实例
 */
export function getWSS() {
  return wss
}

/**
 * 获取数据库中的最近通知
 */
export async function getHistory(limit = MAX_HISTORY) {
  try {
    const rows = await SystemNotification.findAll({
      order: [['created_at', 'DESC']],
      limit
    })
    return rows.map(formatNotif)
  } catch {
    return []
  }
}
