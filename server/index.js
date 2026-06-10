import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import serve from 'koa-static'
import { koaBody } from 'koa-body'
import { Op } from 'sequelize'
import fs from 'fs'
import http from 'node:http'
import path from 'path'
import { fileURLToPath } from 'node:url'
import config from './config.js'
import syncDatabase from './db/sync.js'
import { seedDefaults } from './db/seed.js'
import { AgentSession } from './db/models/index.js'
import { buildDashboardData } from './services/dashboard-data.js'

import adminRouter from './routes/admin.js'
import projectRouter from './routes/projects.js'
import eventRouter from './routes/events.js'
import agentRouter from './routes/agents.js'
import sessionRouter from './routes/sessions.js'
import templateRouter from './routes/templates.js'
import webhookRouter from './routes/webhook.js'
import { initRedis, startConsumer } from './services/event-queue.js'
import { attachWebSocket } from './services/notification-ws.js'
import { startNotifier } from './services/system-notifier.js'
import { startReportScheduler } from './services/daily-report.js'
const app = new Koa()
const apiRouter = new Router({ prefix: '/api' })

app.use(cors())
app.use(koaBody({ multipart: true }))

// Health endpoint
apiRouter.get('/health', ctx => {
  ctx.body = { status: 'ok', timestamp: new Date().toISOString() }
})

// Dashboard stats
apiRouter.get('/dashboard', async ctx => {
  try {
    ctx.body = await buildDashboardData()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

// Debug: test GitLab connection
apiRouter.get('/debug/gitlab-test', async ctx => {
  try {
    const { gitlabApi } = await import('./services/gitlab-client.js')
    const data = await gitlabApi('GET', '/projects?per_page=2&simple=true')
    ctx.body = { success: true, count: data.length, first: data[0]?.name }
  } catch (err) {
    ctx.body = { success: false, error: err.message }
  }
})

// GET /api/openclaw-agents - 读取 ~/.openclaw/agents/ 下已有的 Agent（只读）
const OPENCLAW_AGENTS_DIR = config.openclaw.agentsDir
apiRouter.get('/openclaw-agents', async ctx => {
  try {
    if (!fs.existsSync(OPENCLAW_AGENTS_DIR)) { ctx.body = []; return }
    const entries = fs.readdirSync(OPENCLAW_AGENTS_DIR, { withFileTypes: true })
    const agents = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const agentName = entry.name
      const agentsMdPath = path.join(OPENCLAW_AGENTS_DIR, agentName, 'agent', 'AGENTS.md')
      let description = ''
      if (fs.existsSync(agentsMdPath)) {
        const content = fs.readFileSync(agentsMdPath, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())
        const titleLine = lines.find(l => l.startsWith('# '))
        description = titleLine ? titleLine.replace(/^#\s*/, '').trim() : lines[0]?.slice(0, 100) || ''
      }
      agents.push({ name: agentName, description, source: 'openclaw', readonly: true })
    }
    agents.sort((a, b) => a.name.localeCompare(b.name))
    ctx.body = agents
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// GET /api/notification-config - 获取系统通知配置
apiRouter.get('/notification-config', async ctx => {
  try {
    const { getNotifConfig } = await import('./services/system-notifier.js')
    ctx.body = await getNotifConfig()
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// PUT /api/notification-config - 保存系统通知配置
apiRouter.put('/notification-config', async ctx => {
  try {
    const { saveNotifConfig } = await import('./services/system-notifier.js')
    await saveNotifConfig(ctx.request.body || {})
    ctx.body = { success: true }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// POST /api/notification-config/check - 手动触发一次检查
apiRouter.post('/notification-config/check', async ctx => {
  try {
    const { triggerFullCheck } = await import('./services/system-notifier.js')
    const result = await triggerFullCheck()
    ctx.body = result
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// POST /api/notifications/:id/action - 通知操作（确定/取消）
apiRouter.post('/notifications/:id/action', async ctx => {
  try {
    const { action } = ctx.request.body || {}
    const notifId = parseInt(ctx.params.id, 10)
    const { SystemNotification } = await import('./db/models/index.js')
    const notif = await SystemNotification.findByPk(notifId)
    if (notif) {
      await notif.update({ actioned: action || 'acknowledged', read: 1 })
    }
    console.log(`Notification #${notifId} action: ${action || 'acknowledged'}`)
    ctx.body = { success: true, action }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// GET /api/notifications - 通知列表（分页）
apiRouter.get('/notifications', async ctx => {
  try {
    const page = Math.max(1, parseInt(ctx.query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(ctx.query.pageSize || '20')))
    const { SystemNotification } = await import('./db/models/index.js')
    const { rows, count } = await SystemNotification.findAndCountAll({
      order: [['created_at', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    })
    ctx.body = {
      items: rows.map(notif => ({
        id: notif.id,
        type: notif.type || 'info',
        title: notif.title,
        message: notif.message,
        link: notif.link,
        actions: notif.actions,
        actionable: !!notif.actions?.length,
        read: !!notif.read,
        actioned: notif.actioned,
        reportData: notif.reportData || null,
        reportId: notif.reportId || null,
        created_at: notif.created_at
      })),
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// GET /api/notifications/:id - 通知详情
apiRouter.get('/notifications/:id', async ctx => {
  try {
    const { SystemNotification } = await import('./db/models/index.js')
    const notif = await SystemNotification.findByPk(ctx.params.id)
    if (!notif) { ctx.status = 404; ctx.body = { error: 'Not found' }; return }
    ctx.body = {
      id: notif.id,
      type: notif.type || 'info',
      title: notif.title,
      message: notif.message,
      link: notif.link,
      actions: notif.actions,
      actionable: !!notif.actions?.length,
      read: !!notif.read,
      actioned: notif.actioned,
      reportData: notif.reportData || null,
      reportId: notif.reportId || null,
      created_at: notif.created_at
    }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// GET /api/daily-report/config - 日报配置
apiRouter.get('/daily-report/config', async ctx => {
  try {
    const { getReportConfig } = await import('./services/daily-report.js')
    ctx.body = await getReportConfig()
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// PUT /api/daily-report/config - 保存日报配置
apiRouter.put('/daily-report/config', async ctx => {
  try {
    const { saveReportConfig } = await import('./services/daily-report.js')
    await saveReportConfig(ctx.request.body || {})
    ctx.body = { success: true }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// POST /api/daily-report/trigger - 手动触发日报生成并推送
apiRouter.post('/daily-report/trigger', async ctx => {
  try {
    const { triggerDailyReport } = await import('./services/daily-report.js')
    const report = await triggerDailyReport()
    ctx.body = { success: true, report }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// GET /api/daily-report/:date - 获取指定日期报告（如 2026-06-09）
apiRouter.get('/daily-report/:date', async ctx => {
  try {
    const { getReportByDate } = await import('./services/daily-report.js')
    const report = await getReportByDate(ctx.params.date)
    if (!report) { ctx.status = 404; ctx.body = { error: 'Report not found' }; return }
    ctx.body = report
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// PUT /api/notifications/:id/read - 标记已读
apiRouter.put('/notifications/:id/read', async ctx => {
  try {
    const { SystemNotification } = await import('./db/models/index.js')
    const notif = await SystemNotification.findByPk(ctx.params.id)
    if (notif) {
      await notif.update({ read: 1 })
    }
    ctx.body = { success: true }
  } catch (err) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
})

// Mount sub-routers under /api prefix
// Admin: /api/admin/*
apiRouter.use('/admin', adminRouter.routes(), adminRouter.allowedMethods())
// Projects: /api/projects/*
apiRouter.use('/projects', projectRouter.routes(), projectRouter.allowedMethods())
// Events: /api/events/*
apiRouter.use('/events', eventRouter.routes(), eventRouter.allowedMethods())
// Sessions: /api/sessions/*
apiRouter.use('/sessions', sessionRouter.routes(), sessionRouter.allowedMethods())
// Agents: /api/projects/:projectId/agents and /api/agents/*
apiRouter.use('', agentRouter.routes(), agentRouter.allowedMethods())
// Templates: /api/templates/*
apiRouter.use('/templates', templateRouter.routes(), templateRouter.allowedMethods())
// Webhook: /api/webhook/*
apiRouter.use('', webhookRouter.routes(), webhookRouter.allowedMethods())

app.use(apiRouter.routes())
app.use(apiRouter.allowedMethods())

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIST = path.resolve(__dirname, '../dist/web')
const VITE_DEV_URL = process.env.VITE_DEV_URL || 'http://localhost:5173'
const useViteDevProxy = config.nodeEnv === 'development' && process.env.USE_DIST !== '1'

function proxyToVite(ctx, origin) {
  return new Promise((resolve) => {
    const target = new URL(ctx.url || '/', origin)
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: ctx.method,
        headers: { ...ctx.headers, host: target.host }
      },
      (proxyRes) => {
        ctx.status = proxyRes.statusCode || 200
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value !== undefined) ctx.set(key, value)
        }
        ctx.body = proxyRes
        resolve()
      }
    )
    proxyReq.on('error', () => {
      ctx.status = 502
      ctx.type = 'text/html; charset=utf-8'
      ctx.body = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
<h2>前端开发服务未启动</h2>
<p>请运行 <code>npm run dev</code>，或直接访问 <a href="${origin}">${origin}</a></p>
</body></html>`
      resolve()
    })
    ctx.req.pipe(proxyReq)
  })
}

function mountDevViteProxy() {
  app.use(async (ctx, next) => {
    if (ctx.path.startsWith('/api')) return next()
    await proxyToVite(ctx, VITE_DEV_URL)
  })
  console.log(`Development: UI proxied to ${VITE_DEV_URL} (set USE_DIST=1 to serve dist/web)`)
}

function mountFrontend() {
  if (useViteDevProxy) {
    mountDevViteProxy()
    return
  }

  const indexHtml = path.join(WEB_DIST, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    if (config.nodeEnv === 'development') {
      console.warn(`No build at ${WEB_DIST}; run "npm run build" or "npm run dev" for the web UI`)
    }
    return
  }

  app.use(serve(WEB_DIST, { index: 'index.html' }))
  app.use(async (ctx, next) => {
    await next()
    if (ctx.status !== 404 || ctx.method !== 'GET') return
    if (ctx.path.startsWith('/api')) return
    ctx.type = 'html'
    ctx.body = fs.createReadStream(indexHtml)
    ctx.status = 200
  })
  console.log(`Frontend static files mounted from ${WEB_DIST}`)
}

mountFrontend()

const PORT = config.port

async function start() {
  try {
    await syncDatabase()
    await seedDefaults()
    console.log('Database initialized successfully.')
  } catch (err) {
    console.warn('Database not available, starting without DB:', err.message)
  }

  // 恢复卡在 active 状态的会话（上次进程重启导致 exit 回调丢失）
  try {
    const stuckSessions = await AgentSession.findAll({
      where: { status: 'active' }
    })
    for (const s of stuckSessions) {
      const elapsed = (Date.now() - new Date(s.started_at || Date.now()).getTime()) / 1000 / 60
      if (elapsed > 5) {
        await s.update({ status: 'failed', finished_at: new Date() })
        console.log(`Recovery: session #${s.id} (${s.agent_name}) failed after ${Math.round(elapsed)} min stuck`)
      }
    }
    if (stuckSessions.length > 0) {
      console.log(`Session recovery: ${stuckSessions.length} stuck sessions processed`)
    }
  } catch (err) {
    console.warn('Session recovery failed:', err.message)
  }

  // 从日志回填缺失的 OpenClaw 会话 ID
  try {
    const { recoverSessionFromLog } = await import('./utils/openclawSession.js')
    const missing = await AgentSession.findAll({
      where: {
        [Op.or]: [
          { openclaw_session_id: null },
          { openclaw_session_id: '' }
        ],
        log_file: { [Op.ne]: null }
      },
      limit: 200
    })
    let recovered = 0
    for (const s of missing) {
      const meta = recoverSessionFromLog(s.log_file)
      if (!meta?.sessionId) continue
      await s.update({
        openclaw_session_id: meta.sessionId,
        openclaw_session_file: meta.sessionFile
      })
      recovered++
    }
    if (recovered > 0) {
      console.log(`Startup: recovered OpenClaw session meta for ${recovered} session(s)`)
    }
  } catch (err) {
    console.warn('Startup session meta recovery failed:', err.message)
  }

  // 定期清理超时会话（每 2 分钟检查一次）
  setInterval(async () => {
    try {
      const timeout = new Date(Date.now() - 10 * 60 * 1000) // 10 分钟超时
      const hanged = await AgentSession.findAll({
        where: {
          status: 'active',
          started_at: { [Op.lt]: timeout }
        }
      })
      for (const s of hanged) {
        await s.update({ status: 'failed', finished_at: new Date() })
        console.log(`Cleanup: session #${s.id} (${s.agent_name}) failed after timeout`)
      }
    } catch (_) { /* ignore cleanup errors */ }
  }, 120_000)

  const server = app.listen(PORT, () => {
    const hasFrontend = useViteDevProxy || fs.existsSync(path.join(WEB_DIST, 'index.html'))
    console.log(`Server running on http://localhost:${PORT}`)
    if (useViteDevProxy) {
      console.log(`Open http://localhost:${PORT} for web UI (proxied to Vite dev server)`)
    } else if (hasFrontend) {
      console.log(`Open http://localhost:${PORT} for web UI (API + frontend on same port)`)
    }
  })

  // 附加 WebSocket 服务到 HTTP Server
  try {
    attachWebSocket(server)
  } catch (err) {
    console.warn('WebSocket attachment failed:', err.message)
  }

  // 启动系统通知服务
  try {
    await startNotifier()
  } catch (err) {
    console.warn('System notifier failed to start:', err.message)
  }

  // 启动日报调度器
  try {
    await startReportScheduler()
  } catch (err) {
    console.warn('Daily report scheduler failed to start:', err.message)
  }

  // 初始化 Redis 并启动事件队列消费者
  try {
    initRedis()
    await startConsumer()
  } catch (err) {
    console.warn('Redis not available, events will be processed inline:', err.message)
  }
}

start().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

export { app, apiRouter }
