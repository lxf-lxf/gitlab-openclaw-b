export type TriggerRule = {
  event_type: string
  actions: string[]
  noteable_types: string[]
  milestone_only: boolean
  comment_match: string
}

export type TriggerCatalogItem = {
  event_type: string
  label: string
  actions?: { value: string; label: string }[]
  noteable_types?: { value: string; label: string }[]
  supports_milestone_only?: boolean
  supports_comment_match?: boolean
}

export function emptyTriggerRule(): TriggerRule {
  return {
    event_type: 'Issue Hook',
    actions: [],
    noteable_types: [],
    milestone_only: false,
    comment_match: ''
  }
}

export function normalizeTriggersFromConfig(cfg: any): TriggerRule[] {
  if (Array.isArray(cfg?.triggers) && cfg.triggers.length) {
    return cfg.triggers.map((t: any) => ({
      event_type: t.event_type || '',
      actions: Array.isArray(t.actions) ? [...t.actions] : [],
      noteable_types: Array.isArray(t.noteable_types) ? [...t.noteable_types] : [],
      milestone_only: !!t.milestone_only,
      comment_match: (t.comment_match || '').trim()
    })).filter((t: TriggerRule) => t.event_type)
  }
  const types: string[] = cfg?.event_types || []
  return types.map(event_type => ({ ...emptyTriggerRule(), event_type }))
}

export function formatTriggerRule(rule: TriggerRule, catalog: TriggerCatalogItem[]): string {
  const cat = catalog.find(c => c.event_type === rule.event_type)
  const parts = [cat?.label || rule.event_type]
  if (rule.milestone_only) parts.push('仅里程碑')
  if (rule.actions?.length) {
    const labels = rule.actions.map(a => cat?.actions?.find(x => x.value === a)?.label || a)
    parts.push(labels.join('/'))
  }
  if (rule.noteable_types?.length) {
    const labels = rule.noteable_types.map(nt => cat?.noteable_types?.find(x => x.value === nt)?.label || nt)
    parts.push(labels.join('/'))
  }
  if (rule.comment_match) parts.push(`评论含「${rule.comment_match}」`)
  return parts.join(' · ')
}

export function triggersToEventTypes(triggers: TriggerRule[]): string[] {
  return [...new Set(triggers.map(t => t.event_type).filter(Boolean))]
}
