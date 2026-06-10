/**
 * 事件格式化工具（后端版）
 * 统一生成所有 8 种 GitLab Webhook 事件的描述、来源信息
 */

/**
 * 生成丰富的事件描述
 * @param {object} event - WebhookEvent 实例（含 payload）
 * @returns {string}
 */
export function eventDescription(event) {
  if (!event?.payload) return event?.event_action || '-'
  const p = event.payload

  switch (event.event_type) {
    case 'Push Hook': {
      const ref = (p.ref || '').replace('refs/heads/', '')
      const commits = p.commits || []
      const totalCommits = p.total_commits_count || commits.length
      if (commits.length > 0) {
        const firstMsg = (commits[0]?.title || commits[0]?.message || '').slice(0, 60)
        const author = commits[0]?.author?.name || ''
        return `[${ref}] ${firstMsg}${totalCommits > 1 ? ` (+${totalCommits - 1})` : ''}${author ? ` · ${author}` : ''}`
      }
      return `推送至 ${ref}`
    }

    case 'Issue Hook': {
      const obj = p.object_attributes || {}
      const action = obj.action || event.event_action || ''
      const title = obj.title || p.title || ''
      const state = obj.state || ''
      const labels = (p.labels || obj.labels || []).map(l => l.title || l).join(', ')
      let desc = title ? title.slice(0, 80) : `Issue #${event.source_id}`
      if (action) desc += ` · ${action}`
      if (state) desc += ` · ${state}`
      return labels ? `${desc} [${labels.slice(0, 30)}]` : desc
    }

    case 'Merge Request Hook': {
      const obj = p.object_attributes || {}
      const action = obj.action || event.event_action || ''
      const title = obj.title || p.title || ''
      const state = obj.state || ''
      const sourceBranch = obj.source_branch || ''
      const targetBranch = obj.target_branch || ''
      let desc = title ? title.slice(0, 80) : `MR !${event.source_id}`
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
      const before = p.before || ''
      const after = p.after || ''
      const action = ref ? (before === '0000000000000000000000000000000000000000' ? '创建' : (after === '0000000000000000000000000000000000000000' ? '删除' : '更新')) : ''
      return `[Tag] ${ref}${action ? ` · ${action}` : ''}`
    }

    default:
      return event.event_action || '-'
  }
}

function projectBaseUrl(event) {
  const p = event?.payload
  return p?.project?.web_url || p?.repository?.homepage || ''
}

/**
 * 生成 GitLab 资源链接（覆盖全部 8 种事件类型）
 * @param {object} event
 * @returns {string|null}
 */
export function eventSourceUrl(event) {
  const baseUrl = projectBaseUrl(event)
  if (!event?.payload || !baseUrl) return null
  const p = event.payload

  switch (event.event_type) {
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
      return event.source_id ? `${baseUrl}/issues/${event.source_id}` : null
    case 'Merge Request Hook':
      return event.source_id ? `${baseUrl}/merge_requests/${event.source_id}` : null
    case 'Pipeline Hook':
      return event.source_id ? `${baseUrl}/-/pipelines/${event.source_id}` : null
    case 'Job Hook':
      return event.source_id ? `${baseUrl}/-/jobs/${event.source_id}` : null
    case 'Note Hook': {
      const obj = p.object_attributes || {}
      const isMr = obj.noteable_type === 'MergeRequest' || !!p.merge_request
      const id = event.source_id || p.issue?.iid || p.merge_request?.iid
      if (!id) return null
      return `${baseUrl}/-/${isMr ? 'merge_requests' : 'issues'}/${id}`
    }
    default:
      return event.source_id ? `${baseUrl}/issues/${event.source_id}` : null
  }
}

/**
 * 来源标签（覆盖全部 8 种事件类型）
 * @param {object} event
 * @returns {string}
 */
export function eventSourceLabel(event) {
  if (!event?.payload) return event?.source_id ? `#${event.source_id}` : ''

  const p = event.payload

  switch (event.event_type) {
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
      return event.source_id ? `MR !${event.source_id}` : 'MR'
    case 'Note Hook': {
      const obj = p.object_attributes || {}
      const isMr = obj.noteable_type === 'MergeRequest' || !!p.merge_request
      const id = event.source_id || p.issue?.iid || p.merge_request?.iid
      if (!id) return 'Note'
      return isMr ? `MR !${id}` : `Issue #${id}`
    }
    case 'Pipeline Hook':
      return event.source_id ? `Pipeline #${event.source_id}` : 'Pipeline'
    case 'Job Hook': {
      const name = p.build_name || ''
      if (event.source_id) {
        return name ? `Job #${event.source_id} · ${name}` : `Job #${event.source_id}`
      }
      return name || 'Job'
    }
    case 'Issue Hook':
      return event.source_id ? `Issue #${event.source_id}` : 'Issue'
    default:
      return event.source_id ? `#${event.source_id}` : ''
  }
}

/**
 * 格式化事件标题
 * @param {object} event
 * @returns {string}
 */
export function eventTitle(event) {
  if (!event?.payload) return ''
  const p = event.payload

  switch (event.event_type) {
    case 'Job Hook':
      return p.build_name ? `${p.build_name} (${p.build_stage || '-'})` : p.build_status || 'Job 事件'
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
