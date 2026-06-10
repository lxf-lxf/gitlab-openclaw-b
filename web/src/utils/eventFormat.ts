/**
 * 事件类型格式化工具
 * 统一处理所有 8 种 GitLab Webhook 事件的展示、描述、来源链接
 */

/** 8 种事件类型完整列表 */
export const ALL_EVENT_TYPES = [
  'Push Hook', 'Issue Hook', 'Merge Request Hook', 'Note Hook',
  'Pipeline Hook', 'Job Hook', 'Wiki Page Hook', 'Tag Push Hook'
]

/** 事件类型 → 短名映射 */
export function formatType(t: string): string {
  const map: Record<string, string> = {
    'Push Hook': 'Push', 'Issue Hook': 'Issue', 'Merge Request Hook': 'MR',
    'Note Hook': 'Note', 'Pipeline Hook': 'Pipeline', 'Job Hook': 'Job',
    'Wiki Page Hook': 'Wiki', 'Tag Push Hook': 'Tag'
  }
  return map[t] || t
}

/** 事件类型 → CSS 类名 */
export function getTypeClass(t: string): string {
  const map: Record<string, string> = {
    'Push Hook': 'push', 'Issue Hook': 'issue', 'Merge Request Hook': 'mr',
    'Note Hook': 'note', 'Pipeline Hook': 'pipeline', 'Job Hook': 'job',
    'Wiki Page Hook': 'wiki', 'Tag Push Hook': 'tag'
  }
  return map[t] || ''
}

/** 事件类型的中文友好名称 */
export function eventTypeLabel(t: string): string {
  const map: Record<string, string> = {
    'Push Hook': '代码推送', 'Issue Hook': 'Issue 事件', 'Merge Request Hook': '合并请求',
    'Note Hook': '评论事件', 'Pipeline Hook': '流水线', 'Job Hook': '构建任务',
    'Wiki Page Hook': 'Wiki 变动', 'Tag Push Hook': '标签推送'
  }
  return map[t] || t
}

function projectBaseUrl(e: any): string {
  const p = e?.payload
  return p?.project?.web_url || p?.repository?.homepage || ''
}

/**
 * 生成 GitLab 资源链接（覆盖全部 8 种事件类型）
 */
export function gitlabUrl(e: any): string {
  const url = sourceUrl(e)
  return url || '#'
}

/** 是否有可用链接 */
export function sourceUrl(e: any): string | null {
  if (e?.event_source_url) return e.event_source_url
  const baseUrl = projectBaseUrl(e)
  if (!e?.payload || !baseUrl) return null
  const p = e.payload

  switch (e.event_type) {
    case 'Push Hook': {
      const ref = (p.ref || '').replace('refs/heads/', '')
      return ref ? `${baseUrl}/-/commits/${encodeURIComponent(ref)}` : null
    }
    case 'Tag Push Hook': {
      const ref = (p.ref || '').replace('refs/tags/', '')
      return ref ? `${baseUrl}/-/tags/${encodeURIComponent(ref)}` : null
    }
    case 'Wiki Page Hook': {
      const slug = p.object_attributes?.slug || ''
      return slug ? `${baseUrl}/-/wikis/${encodeURIComponent(slug)}` : null
    }
    case 'Issue Hook':
      return e.source_id ? `${baseUrl}/issues/${e.source_id}` : null
    case 'Merge Request Hook':
      return e.source_id ? `${baseUrl}/merge_requests/${e.source_id}` : null
    case 'Pipeline Hook':
      return e.source_id ? `${baseUrl}/-/pipelines/${e.source_id}` : null
    case 'Job Hook':
      return e.source_id ? `${baseUrl}/-/jobs/${e.source_id}` : null
    case 'Note Hook': {
      const obj = p.object_attributes || {}
      const isMr = obj.noteable_type === 'MergeRequest' || !!p.merge_request
      const id = e.source_id || p.issue?.iid || p.merge_request?.iid
      if (!id) return null
      return `${baseUrl}/-/${isMr ? 'merge_requests' : 'issues'}/${id}`
    }
    default:
      return e.source_id ? `${baseUrl}/issues/${e.source_id}` : null
  }
}

/** 来源标签文字（覆盖全部 8 种事件类型） */
export function sourceLabel(e: any): string {
  if (e?.event_source_label) return e.event_source_label
  if (!e?.payload) return e?.source_id ? `#${e.source_id}` : ''

  const p = e.payload

  switch (e.event_type) {
    case 'Push Hook': {
      const ref = (p.ref || '').replace('refs/heads/', '')
      return ref ? `分支 ${ref}` : 'Push'
    }
    case 'Tag Push Hook': {
      const ref = (p.ref || '').replace('refs/tags/', '')
      return ref ? `标签 ${ref}` : 'Tag'
    }
    case 'Wiki Page Hook': {
      const obj = p.object_attributes || {}
      const name = obj.title || obj.slug || ''
      return name ? `Wiki · ${name}` : 'Wiki'
    }
    case 'Merge Request Hook':
      return e.source_id ? `MR !${e.source_id}` : 'MR'
    case 'Note Hook': {
      const obj = p.object_attributes || {}
      const isMr = obj.noteable_type === 'MergeRequest' || !!p.merge_request
      const id = e.source_id || p.issue?.iid || p.merge_request?.iid
      if (!id) return 'Note'
      return isMr ? `MR !${id}` : `Issue #${id}`
    }
    case 'Pipeline Hook':
      return e.source_id ? `Pipeline #${e.source_id}` : 'Pipeline'
    case 'Job Hook': {
      const name = p.build_name || ''
      if (e.source_id) return name ? `Job #${e.source_id} · ${name}` : `Job #${e.source_id}`
      return name || 'Job'
    }
    case 'Issue Hook':
      return e.source_id ? `Issue #${e.source_id}` : 'Issue'
    default:
      return e.source_id ? `#${e.source_id}` : ''
  }
}

/**
 * 生成丰富的事件描述
 * 覆盖全部 8 种事件类型
 */
export function eventDesc(e: any): string {
  if (!e?.payload) return e?.event_action || '-'
  const p = e.payload

  switch (e.event_type) {
    case 'Push Hook': {
      const ref = (p.ref || '').replace('refs/heads/', '')
      const commits = p.commits || []
      const totalCommits = p.total_commits_count || commits.length
      // Show first commit title + count, or just ref
      if (commits.length > 0) {
        const firstMsg = (commits[0]?.title || commits[0]?.message || '').slice(0, 60)
        const author = commits[0]?.author?.name || ''
        return `[${ref}] ${firstMsg}${totalCommits > 1 ? ` (+${totalCommits - 1})` : ''}${author ? ` · ${author}` : ''}`
      }
      return `推送至 ${ref}`
    }

    case 'Issue Hook': {
      const obj = p.object_attributes || {}
      const action = obj.action || e.event_action || ''
      const title = obj.title || p.title || ''
      const state = obj.state || ''
      const labels = (p.labels || obj.labels || []).map((l: any) => l.title || l).join(', ')
      let desc = title ? title.slice(0, 80) : `Issue #${e.source_id}`
      if (action) desc += ` · ${action}`
      if (state) desc += ` · ${state}`
      return labels ? `${desc} [${labels.slice(0, 30)}]` : desc
    }

    case 'Merge Request Hook': {
      const obj = p.object_attributes || {}
      const action = obj.action || e.event_action || ''
      const title = obj.title || p.title || ''
      const state = obj.state || ''
      const sourceBranch = obj.source_branch || ''
      const targetBranch = obj.target_branch || ''
      let desc = title ? title.slice(0, 80) : `MR !${e.source_id}`
      if (sourceBranch && targetBranch) desc += ` · ${sourceBranch} → ${targetBranch}`
      if (action) desc += ` · ${action}`
      if (state) desc += ` · ${state}`
      return desc
    }

    case 'Note Hook': {
      const obj = p.object_attributes || {}
      const noteText = (obj.note || obj.description || '').slice(0, 100)
      const noteableType = obj.noteable_type || (p.issue ? 'Issue' : p.merge_request ? 'Merge Request' : '')
      const author = p.user?.name || obj.author?.name || ''
      return `[${noteableType}] ${noteText}${author ? ` · ${author}` : ''}`
    }

    case 'Pipeline Hook': {
      const obj = p.object_attributes || {}
      const status = obj.status || p.build_status || ''
      const ref = obj.ref || p.ref || ''
      const source = obj.source || ''
      const duration = obj.duration || obj.queued_duration || ''
      const refClean = ref.replace('refs/heads/', '')
      let desc = status ? `状态: ${status}` : 'Pipeline'
      if (refClean) desc += ` · ${refClean}`
      if (source) desc += ` · ${source}`
      if (duration) desc += ` · ${Math.round(duration)}s`
      return desc
    }

    case 'Job Hook': {
      const name = p.build_name || ''
      const stage = p.build_stage || ''
      const status = p.build_status || ''
      const runner = p.runner?.description || ''
      let desc = name ? `${name}` : 'Job'
      if (stage) desc += ` (${stage})`
      if (status) desc += ` · ${status}`
      if (runner) desc += ` · runner: ${runner.slice(0, 20)}`
      return desc
    }

    case 'Wiki Page Hook': {
      const obj = p.object_attributes || {}
      const title = obj.title || ''
      const action = obj.action || ''
      const slug = obj.slug || ''
      return `[Wiki] ${title || slug}${action ? ` · ${action}` : ''}`
    }

    case 'Tag Push Hook': {
      const ref = (p.ref || '').replace('refs/tags/', '') || ''
      const action = ref ? (p.before === '0000000000000000000000000000000000000000' ? '创建' : (p.after === '0000000000000000000000000000000000000000' ? '删除' : '更新')) : ''
      return `[Tag] ${ref}${action ? ` · ${action}` : ''}`
    }

    default:
      return e.event_action || '-'
  }
}

/**
 * 获取事件标题（用于卡片展示）
 */
export function getIssueTitle(event: any): string {
  if (!event?.payload) return '-'
  const p = event.payload

  switch (event.event_type) {
    case 'Job Hook': {
      return p.build_name ? `${p.build_name} (${p.build_stage || '-'})` : p.build_status || 'Job 事件'
    }
    case 'Pipeline Hook': {
      const ref = p.object_attributes?.ref || p.ref || ''
      const status = p.object_attributes?.status || p.build_status || ''
      return ref ? `Pipeline: ${ref.replace('refs/heads/', '')} ${status ? '· ' + status : ''}` : 'Pipeline 事件'
    }
    case 'Push Hook': {
      const ref = (p.ref || '').replace('refs/heads/', '')
      const commits = p.commits || []
      if (commits.length > 0) return commits[0]?.title || `推送 ${ref}`
      return ref ? `推送 ${ref}` : 'Push 事件'
    }
    case 'Tag Push Hook': {
      const ref = (p.ref || '').replace('refs/tags/', '')
      return ref ? `标签 ${ref}` : 'Tag 事件'
    }
    case 'Wiki Page Hook': {
      const obj = p.object_attributes || {}
      return obj.title || obj.slug || 'Wiki 事件'
    }
    case 'Note Hook': {
      const obj = p.object_attributes || {}
      const noteableType = obj.noteable_type || (p.issue ? 'Issue' : p.merge_request ? 'MR' : '')
      const preview = (obj.note || '').slice(0, 50)
      return `${noteableType ? `[${noteableType}] ` : ''}${preview || '评论事件'}`
    }
    default: {
      const obj = p.object_attributes || {}
      const noteable = p.issue || p.merge_request || {}
      return obj.title || noteable.title || p.title || `#${event.source_id || ''}`
    }
  }
}

/**
 * 获取事件关联的状态信息
 */
export function getIssueState(event: any): string {
  if (!event?.payload) return ''
  const p = event.payload
  switch (event.event_type) {
    case 'Job Hook': return p.build_status || ''
    case 'Pipeline Hook': return p.object_attributes?.status || p.build_status || ''
    case 'Tag Push Hook': return (p.ref || '').replace('refs/tags/', '') ? 'tag' : ''
    case 'Wiki Page Hook': return p.object_attributes?.action || ''
    default: {
      const obj = p.object_attributes || {}
      const noteable = p.issue || p.merge_request || {}
      return obj.state || noteable.state || ''
    }
  }
}

/**
 * 获取事件关联的标签/分支信息
 */
export function getIssueLabels(event: any): string {
  if (!event?.payload) return ''
  const p = event.payload
  if (['Job Hook', 'Pipeline Hook'].includes(event.event_type)) {
    const ref = p.ref || p.object_attributes?.ref || ''
    return ref ? ref.replace('refs/heads/', '') : ''
  }
  if (event.event_type === 'Tag Push Hook') {
    return (p.ref || '').replace('refs/tags/', '')
  }
  const obj = p.object_attributes || {}
  const rawLabels = p.labels || obj.labels || []
  if (!Array.isArray(rawLabels)) return ''
  return rawLabels.map((l: any) => l.title || l).join(', ')
}

/** 格式化时间 */
export function formatTime(t: string): string {
  if (!t) return '-'
  return new Date(t).toLocaleString('zh-CN')
}

/** 格式化请求头 */
export function formatHeaders(headers: any): string {
  if (!headers) return '{}'
  try {
    return typeof headers === 'string' ? headers : JSON.stringify(headers, null, 2)
  } catch { return String(headers) }
}
