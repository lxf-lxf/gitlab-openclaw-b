/** 根据事件字段生成调度状态（供 API / 前端展示） */
export function resolveDispatchView(event) {
  const raw = event?.toJSON ? event.toJSON() : event
  const note = raw?.dispatch_note || ''
  const status = raw?.status || 'pending'
  const handled = !!raw?.agent_handled

  if (status === 'pending') {
    return { code: 'pending', label: '待处理', hint: '事件已入库，等待调度', tone: 'muted' }
  }
  if (status === 'processing') {
    return { code: 'processing', label: '处理中', hint: '正在匹配 Agent 并调度', tone: 'info' }
  }
  if (status === 'failed') {
    return {
      code: 'failed',
      label: '调度失败',
      hint: note || 'Agent 执行或调度过程出错',
      tone: 'error',
      link: '/events'
    }
  }

  if (handled) {
    return {
      code: 'dispatched',
      label: '已调度',
      hint: note || '已启动 Agent 处理',
      tone: 'success'
    }
  }

  if (note.includes('无已部署') || note.includes('无模板匹配') || note.includes('触发规则')) {
    return {
      code: 'no_trigger_match',
      label: '规则不匹配',
      hint: note,
      tone: 'muted',
      link: '/templates'
    }
  }
  if (note.includes('未启用 Webhook')) {
    return { code: 'webhook_disabled', label: 'Webhook 未启用', hint: note, tone: 'muted' }
  }
  if (note.includes('不监听') || note.includes('事件类型')) {
    return { code: 'no_event_type_match', label: '类型不匹配', hint: note, tone: 'muted' }
  }
  if (note.includes('并发') || note.includes('上限')) {
    return { code: 'concurrency_limit', label: '并发已满', hint: note, tone: 'muted' }
  }
  if (note.includes('Bot') || note.includes('bot')) {
    return {
      code: 'bot_skipped',
      label: '已忽略',
      hint: note,
      tone: 'muted'
    }
  }
  if (note) {
    return { code: 'skipped', label: '未调度', hint: note, tone: 'muted' }
  }

  return {
    code: 'skipped_unknown',
    label: '—',
    hint: '未启动 Agent',
    tone: 'muted'
  }
}

export function enrichEventDispatch(event) {
  const raw = event?.toJSON ? event.toJSON() : { ...event }
  const dispatch = resolveDispatchView(raw)
  return {
    ...raw,
    dispatch_code: dispatch.code,
    dispatch_label: dispatch.label,
    dispatch_hint: dispatch.hint,
    dispatch_tone: dispatch.tone,
    dispatch_link: dispatch.link || null
  }
}
