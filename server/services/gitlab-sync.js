import Project from '../db/models/project.js'
import { scheduleDashboardBroadcast } from './notification-ws.js'

const LOG_MAX = 200
/** 仅批量刷新进度计数，避免每个项目都改 message */
const PROGRESS_FLUSH_EVERY = 30

function createIdleState() {
  return {
    running: false,
    phase: 'idle',
    message: '',
    fetched: 0,
    processed: 0,
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    isAdmin: false,
    logs: [],
    error: null,
    totalLocal: null,
    startedAt: null,
    finishedAt: null
  }
}

let state = createIdleState()
let stopRequested = false

function appendLog(text, kind = 'info') {
  state.logs.push({
    at: new Date().toISOString(),
    text,
    kind
  })
  if (state.logs.length > LOG_MAX) {
    state.logs.splice(0, state.logs.length - LOG_MAX)
  }
}

export function getGitlabSyncStatus() {
  return {
    running: state.running,
    phase: state.phase,
    message: state.message,
    fetched: state.fetched,
    processed: state.processed,
    total: state.total,
    created: state.created,
    updated: state.updated,
    skipped: state.skipped,
    isAdmin: state.isAdmin,
    logs: state.logs,
    logCount: state.logs.length,
    error: state.error,
    totalLocal: state.totalLocal,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt
  }
}

export function stopGitlabSync() {
  if (!state.running) {
    return { stopped: false, ...getGitlabSyncStatus() }
  }
  stopRequested = true
  appendLog('>> 收到停止请求，将在当前步骤结束后中止...', 'info')
  state.message = '正在停止同步...'
  return { stopped: true, ...getGitlabSyncStatus() }
}

export function startGitlabSync() {
  if (state.running) {
    return { started: false, alreadyRunning: true, ...getGitlabSyncStatus() }
  }

  stopRequested = false
  state = {
    ...createIdleState(),
    running: true,
    phase: 'fetching',
    message: '正在从 GitLab 拉取项目列表...',
    startedAt: new Date().toISOString()
  }
  appendLog('>> 开始同步：连接 GitLab API...', 'info')

  runGitlabSync().catch(err => {
    console.error('GitLab sync background error:', err.message)
    state.running = false
    state.phase = 'error'
    state.error = err.message
    state.message = '同步失败'
    appendLog(`!! 同步失败: ${err.message}`, 'error')
    state.finishedAt = new Date().toISOString()
  })

  return { started: true, alreadyRunning: false, ...getGitlabSyncStatus() }
}

async function finishCancelled() {
  state.totalLocal = await Project.count()
  state.running = false
  state.phase = 'cancelled'
  state.message = '同步已停止'
  state.finishedAt = new Date().toISOString()
  appendLog(
    `>> 已停止：已处理 ${state.processed}/${state.total}，新增 ${state.created}，更新 ${state.updated}`,
    'cancelled'
  )
  scheduleDashboardBroadcast()
}

async function runGitlabSync() {
  const { listProjectsForSync } = await import('./gitlab-client.js')

  // GitLab 拉取阶段不做额外状态写入，避免干扰网络请求
  const { projects: raw, isAdmin, fetched } = await listProjectsForSync()

  if (stopRequested) {
    state.fetched = fetched
    state.isAdmin = isAdmin
    state.total = raw.length
    appendLog(`>> GitLab 已拉取 ${fetched} 个项目，写入已取消`, 'cancelled')
    await finishCancelled()
    return
  }

  state.fetched = fetched
  state.isAdmin = isAdmin
  state.total = raw.length
  state.phase = 'writing'
  state.processed = 0
  state.message = raw.length
    ? `正在写入本地数据库 (0/${raw.length})...`
    : 'GitLab 未返回项目'
  appendLog(
    `>> GitLab 拉取完成：${fetched} 个项目${isAdmin ? '（管理员全量）' : ''}`,
    'info'
  )

  for (let i = 0; i < raw.length; i++) {
    if (stopRequested) {
      state.processed = i
      await finishCancelled()
      return
    }

    const gp = raw[i]
    try {
      const payload = {
        name: gp.name,
        path_with_namespace: gp.path_with_namespace,
        web_url: gp.web_url,
        visibility: gp.visibility || 'private'
      }
      const [project, isNew] = await Project.findOrCreate({
        where: { gitlab_id: gp.id },
        defaults: payload
      })
      if (isNew) {
        state.created++
        appendLog(`[+] ${gp.path_with_namespace}`, 'created')
      } else {
        await project.update(payload)
        state.updated++
        appendLog(`[~] ${gp.path_with_namespace}`, 'updated')
      }
    } catch (e) {
      state.skipped++
      appendLog(`[!] 跳过 ${gp.path_with_namespace || gp.id}: ${e.message}`, 'skip')
    }

    const n = i + 1
    if (n % PROGRESS_FLUSH_EVERY === 0 || n === raw.length) {
      state.processed = n
      state.message = `正在写入本地数据库 (${n}/${raw.length})...`
    }
  }

  state.totalLocal = await Project.count()
  state.running = false
  state.phase = 'done'
  state.message = '同步完成'
  state.finishedAt = new Date().toISOString()
  appendLog(
    `>> 完成：新增 ${state.created}，更新 ${state.updated}，跳过 ${state.skipped}，本地共 ${state.totalLocal} 个`,
    'done'
  )

  scheduleDashboardBroadcast()
}
