import axios from 'axios'
import config from '../config.js'
import AdminConfig from '../db/models/adminConfig.js'

let cachedToken = null
let cachedBaseUrl = null

export async function getToken() {
  if (cachedToken) return cachedToken
  try {
    const record = await AdminConfig.findOne({ where: { config_key: 'gitlab_token' } })
    cachedToken = record?.config_value || ''
  } catch {
    cachedToken = ''
  }
  return cachedToken
}

async function getBaseUrl() {
  if (cachedBaseUrl) return cachedBaseUrl
  try {
    const record = await AdminConfig.findOne({ where: { config_key: 'gitlab_base_url' } })
    cachedBaseUrl = record?.config_value || config.gitlab.baseUrl
  } catch {
    cachedBaseUrl = config.gitlab.baseUrl
  }
  return cachedBaseUrl
}

export function clearTokenCache() {
  cachedToken = null
  cachedBaseUrl = null
}

export async function getGitLabUser() {
  return await gitlabApi('GET', '/user')
}

/** 获取 GitLab 连接状态与当前 Token 对应账号信息 */
export async function getGitLabProfile() {
  const token = await getToken()
  const baseUrl = await getBaseUrl()

  if (!token) {
    return { connected: false, error: '未配置 GitLab Token', baseUrl: baseUrl || null, user: null }
  }
  if (!baseUrl) {
    return { connected: false, error: '未配置 GitLab Base URL', baseUrl: null, user: null }
  }

  try {
    const user = await getGitLabUser()
    const webBase = baseUrl.replace(/\/api\/v4\/?$/, '')
    return {
      connected: true,
      error: null,
      baseUrl,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email || null,
        avatar_url: user.avatar_url,
        web_url: user.web_url || `${webBase}/${user.username}`,
        state: user.state || null
      }
    }
  } catch (err) {
    const status = err.response?.status
    const msg = err.response?.data?.message || err.message
    let error = msg
    if (status === 401) error = 'Token 无效或已过期'
    else if (status === 403) error = 'Token 权限不足'
    return { connected: false, error, baseUrl, user: null }
  }
}

export async function gitlabApi(method, endpoint, data = null) {
  const token = await getToken()
  const baseUrl = await getBaseUrl()
  const url = `${baseUrl}${endpoint}`
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await axios({ method, url, headers, data, timeout: 15000 })
  return res.data
}

/**
 * 分页拉取 GitLab 项目（解决只拉第一页导致同步不全）
 * @param {object} [options]
 * @param {boolean|null} [options.membership] - false=实例全部（管理员），true=仅成员项目
 * @param {boolean} [options.includeArchived]
 * @param {number} [options.perPage]
 * @param {number} [options.maxPages]
 */
export async function listAllProjects(options = {}) {
  const {
    membership = null,
    includeArchived = true,
    perPage = 100,
    maxPages = 100
  } = options

  const projects = []
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      simple: 'true',
      order_by: 'id',
      sort: 'asc'
    })
    if (membership !== null) params.set('membership', String(membership))
    if (includeArchived) params.set('include_archived', 'true')

    const data = await gitlabApi('GET', `/projects?${params}`)
    if (!Array.isArray(data) || data.length === 0) break
    projects.push(...data)
    if (data.length < perPage) break
  }
  return projects
}

/** 按当前 Token 身份同步项目：管理员拉全实例，普通用户拉可访问成员项目 */
export async function listProjectsForSync() {
  let membership = null
  let isAdmin = false
  try {
    const user = await getGitLabUser()
    isAdmin = !!user.is_admin
    if (isAdmin) membership = false
  } catch { /* 使用 GitLab 默认过滤 */ }

  const projects = await listAllProjects({ membership, includeArchived: true })
  return { projects, isAdmin, fetched: projects.length }
}

/** @deprecated 使用 listAllProjects */
export async function listProjects(maxPages = 10) {
  return listAllProjects({ maxPages })
}

export async function getProject(projectId) {
  return await gitlabApi('GET', `/projects/${encodeURIComponent(projectId)}`)
}

export async function createWebhook(projectId, webhookUrl, secretToken) {
  return await gitlabApi('POST', `/projects/${encodeURIComponent(projectId)}/hooks`, {
    url: webhookUrl,
    token: secretToken,
    push_events: true,
    issues_events: true,
    confidential_issues_events: true,
    merge_requests_events: true,
    note_events: true,
    confidential_note_events: true,
    tag_push_events: true,
    pipeline_events: true,
    wiki_page_events: true,
    job_events: true,
    deployment_events: true,
    releases_events: true,
    feature_flag_events: true,
    enable_ssl_verification: false
  })
}

export async function deleteWebhook(projectId, hookId) {
  return await gitlabApi('DELETE', `/projects/${encodeURIComponent(projectId)}/hooks/${hookId}`)
}

export async function listWebhooks(projectId) {
  return await gitlabApi('GET', `/projects/${encodeURIComponent(projectId)}/hooks`)
}

function normalizeWebhookUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

/** 删除 GitLab 项目上的 B-Center Webhook（按 hookId 或回调 URL 匹配） */
export async function removeProjectWebhooks(projectGitlabId, { hookId, webhookUrl } = {}) {
  const deleted = []

  if (hookId) {
    try {
      await deleteWebhook(projectGitlabId, hookId)
      deleted.push(hookId)
    } catch (err) {
      if (err.response?.status !== 404) throw err
    }
    return deleted
  }

  const hooks = await listWebhooks(projectGitlabId)
  const targetUrl = webhookUrl ? normalizeWebhookUrl(webhookUrl) : null
  for (const hook of hooks) {
    const hookUrl = normalizeWebhookUrl(hook.url)
    const match = targetUrl
      ? hookUrl === targetUrl
      : hookUrl.includes('/api/webhook/receiver')
    if (!match) continue
    try {
      await deleteWebhook(projectGitlabId, hook.id)
      deleted.push(hook.id)
    } catch (err) {
      if (err.response?.status !== 404) throw err
    }
  }
  return deleted
}
