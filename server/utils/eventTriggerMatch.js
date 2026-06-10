/**
 * Agent 模板触发规则匹配
 *
 * agent_config.triggers 示例：
 * [
 *   { event_type: 'Issue Hook', actions: ['open', 'update'] },
 *   { event_type: 'Note Hook', noteable_types: ['Issue'], comment_match: '开始处理' },
 *   { event_type: 'Issue Hook', milestone_only: true }
 * ]
 *
 * 兼容旧版 agent_config.event_types（仅按事件类型匹配，不筛 action）
 */

export const EVENT_TRIGGER_CATALOG = [
  {
    event_type: 'Issue Hook',
    label: 'Issue 事件',
    actions: [
      { value: 'open', label: '新建 (open)' },
      { value: 'update', label: '更新 (update)' },
      { value: 'close', label: '关闭 (close)' },
      { value: 'reopen', label: '重新打开 (reopen)' }
    ],
    supports_milestone_only: true
  },
  {
    event_type: 'Merge Request Hook',
    label: 'MR 事件',
    actions: [
      { value: 'open', label: '新建 (open)' },
      { value: 'update', label: '更新 (update)' },
      { value: 'merge', label: '合并 (merge)' },
      { value: 'close', label: '关闭 (close)' },
      { value: 'reopen', label: '重新打开 (reopen)' },
      { value: 'approved', label: '审批 (approved)' },
      { value: 'unapproved', label: '取消审批 (unapproved)' }
    ]
  },
  {
    event_type: 'Note Hook',
    label: '评论 (Note)',
    noteable_types: [
      { value: 'Issue', label: 'Issue 评论' },
      { value: 'MergeRequest', label: 'MR 评论' }
    ],
    supports_comment_match: true
  },
  {
    event_type: 'Push Hook',
    label: 'Push 推送',
    actions: []
  },
  {
    event_type: 'Pipeline Hook',
    label: 'Pipeline',
    actions: [
      { value: 'success', label: '成功' },
      { value: 'failed', label: '失败' },
      { value: 'running', label: '运行中' },
      { value: 'pending', label: '等待' },
      { value: 'canceled', label: '取消' }
    ]
  },
  {
    event_type: 'Job Hook',
    label: 'Job',
    actions: [
      { value: 'success', label: '成功' },
      { value: 'failed', label: '失败' },
      { value: 'running', label: '运行中' }
    ]
  }
]

export function normalizeTriggers(agentConfig) {
  const cfg = agentConfig || {}
  if (Array.isArray(cfg.triggers) && cfg.triggers.length) {
    return cfg.triggers.map(t => ({
      event_type: t.event_type || '',
      actions: Array.isArray(t.actions) ? t.actions.filter(Boolean) : [],
      noteable_types: Array.isArray(t.noteable_types) ? t.noteable_types.filter(Boolean) : [],
      milestone_only: !!t.milestone_only,
      comment_match: (t.comment_match || '').trim()
    })).filter(t => t.event_type)
  }
  const types = cfg.event_types || []
  return types.map(event_type => ({ event_type, actions: [], noteable_types: [], milestone_only: false, comment_match: '' }))
}

function normalizeNoteableType(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s === 'Merge Request' || s === 'MergeRequest') return 'MergeRequest'
  if (s === 'Issue') return 'Issue'
  return s
}

function matchSingleTrigger(trigger, event, ev) {
  if (!trigger?.event_type || trigger.event_type !== event.event_type) return false

  if (trigger.milestone_only && !ev.milestoneAssigned) return false

  if (trigger.actions?.length) {
    const action = String(ev.action || event.event_action || '').toLowerCase()
    if (!trigger.actions.map(a => String(a).toLowerCase()).includes(action)) return false
  }

  if (trigger.noteable_types?.length) {
    const nt = normalizeNoteableType(ev.noteable_type)
    if (!trigger.noteable_types.includes(nt)) return false
  }

  if (trigger.comment_match) {
    const comment = String(ev.comment || '').trim()
    if (!comment || !comment.includes(trigger.comment_match)) return false
  }

  return true
}

/** 模板是否匹配该 Webhook 事件 */
export function templateMatchesEvent(template, event, ev) {
  const triggers = normalizeTriggers(template?.agent_config)
  if (!triggers.length) return false
  return triggers.some(t => matchSingleTrigger(t, event, ev))
}

export function formatTriggerSummary(agentConfig) {
  const triggers = normalizeTriggers(agentConfig)
  if (!triggers.length) return '未配置触发规则'

  return triggers.map(t => {
    const cat = EVENT_TRIGGER_CATALOG.find(c => c.event_type === t.event_type)
    const parts = [cat?.label || t.event_type]
    if (t.milestone_only) parts.push('仅里程碑变更')
    if (t.actions?.length) {
      const labels = t.actions.map(a => {
        const act = cat?.actions?.find(x => x.value === a)
        return act?.label || a
      })
      parts.push(labels.join('/'))
    }
    if (t.noteable_types?.length) {
      const labels = t.noteable_types.map(nt => {
        const item = cat?.noteable_types?.find(x => x.value === nt)
        return item?.label || nt
      })
      parts.push(labels.join('/'))
    }
    if (t.comment_match) parts.push(`评论含「${t.comment_match}」`)
    return parts.join(' · ')
  }).join('；')
}
