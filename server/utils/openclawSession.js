import fs from 'node:fs'

/**
 * 从 OpenClaw --json 输出中提取 sessionId / sessionFile。
 * 兼容两种格式：
 * - 旧版: { meta: { agentMeta: { sessionId, sessionFile } } }
 * - 新版: { result: { meta: { agentMeta: { sessionId, sessionFile } } } }
 */
export function extractAgentSessionMeta(parsed) {
  const meta = parsed?.result?.meta?.agentMeta || parsed?.meta?.agentMeta
  if (!meta?.sessionId) return null
  return {
    sessionId: meta.sessionId,
    sessionFile: meta.sessionFile || null
  }
}

export function parseOpenClawStdout(stdout) {
  const raw = (stdout || '').trim()
  if (!raw) return null

  try {
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw)
      const found = extractAgentSessionMeta(parsed)
      if (found) return found
    }
  } catch (_) { /* fall through */ }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      const found = extractAgentSessionMeta(parsed)
      if (found) return found
    } catch (_) { /* skip line */ }
  }

  const sessionIdMatch = raw.match(/"sessionId"\s*:\s*"([^"]+)"/)
  if (sessionIdMatch) {
    const sessionFileMatch = raw.match(/"sessionFile"\s*:\s*"([^"]+)"/)
    return {
      sessionId: sessionIdMatch[1],
      sessionFile: sessionFileMatch ? sessionFileMatch[1] : null
    }
  }

  return null
}

export function recoverSessionFromLog(logFile) {
  if (!logFile || !fs.existsSync(logFile)) return null
  try {
    const content = fs.readFileSync(logFile, 'utf-8')
    const stdout = content.split('\n--- stderr ---\n')[0]
    return parseOpenClawStdout(stdout)
  } catch (_) {
    return null
  }
}
