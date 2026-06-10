export type DispatchTone = 'success' | 'warning' | 'error' | 'info' | 'muted'

export function dispatchBadgeClass(tone?: string) {
  if (tone === 'success') return 'dispatch-ok'
  if (tone === 'warning') return 'dispatch-warn'
  if (tone === 'error') return 'dispatch-err'
  if (tone === 'info') return 'dispatch-info'
  return 'dispatch-muted'
}
