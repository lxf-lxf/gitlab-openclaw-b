type WsMessageHandler = (data: any) => void

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let subscriberCount = 0
const handlers = new Set<WsMessageHandler>()

function connect() {
  if (typeof window === 'undefined') return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${location.host}/api/ws`
  try {
    ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        handlers.forEach(handler => handler(data))
      } catch { /* ignore malformed payload */ }
    }
    ws.onclose = () => {
      ws = null
      scheduleReconnect()
    }
    ws.onerror = () => {
      ws?.close()
    }
  } catch {
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (subscriberCount <= 0) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 5000)
}

function ensureConnected() {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    connect()
  }
}

/**
 * 订阅全局 WebSocket 消息（与通知铃铛、仪表盘等共享同一连接）
 */
export function subscribeAppWs(handler: WsMessageHandler) {
  handlers.add(handler)
  subscriberCount++
  ensureConnected()
  return () => {
    handlers.delete(handler)
    subscriberCount = Math.max(0, subscriberCount - 1)
    if (subscriberCount === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ws?.close()
      ws = null
    }
  }
}
