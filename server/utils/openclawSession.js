import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import config from '../config.js'
import { readTrajectoryPointer } from './openclawTrajectory.js'

function sanitizeAgentId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

function resolveAgentSessionsDir(cliName) {
  const agentId = sanitizeAgentId(cliName)
  const agentsDir = (config.openclaw.agentsDir || path.join(os.homedir(), '.openclaw', 'agents')).trim()
  return path.join(agentsDir, agentId, 'sessions')
}

/**
 * 从 OpenClaw --json 输出中提取 sessionId / sessionFile。
 * 兼容：
 * - embedded: { result: { meta: { agentMeta } } } / { meta: { agentMeta } }
 * - gateway: 顶层 sessionKey + sessions.json 回填
 */
export function extractAgentSessionMeta(parsed) {
  if (!parsed || typeof parsed !== 'object') return null

  const agentMeta = parsed?.result?.meta?.agentMeta || parsed?.meta?.agentMeta
  if (agentMeta?.sessionId) {
    return {
      sessionId: agentMeta.sessionId,
      sessionFile: agentMeta.sessionFile || null,
      sessionKey: parsed.sessionKey || parsed.result?.sessionKey || null
    }
  }

  const sessionId =
    parsed?.result?.meta?.sessionId ||
    parsed?.meta?.sessionId ||
    parsed?.sessionId ||
    parsed?.result?.sessionId
  if (sessionId) {
    return {
      sessionId,
      sessionFile:
        parsed?.result?.meta?.sessionFile ||
        parsed?.meta?.sessionFile ||
        parsed?.sessionFile ||
        null,
      sessionKey: parsed.sessionKey || parsed.result?.sessionKey || null
    }
  }

  const sessionKey = parsed.sessionKey || parsed.result?.sessionKey
  if (sessionKey) {
    return { sessionId: null, sessionFile: null, sessionKey }
  }

  return null
}

function tryParseJsonObjects(raw) {
  const results = []
  const trimmed = (raw || '').trim()
  if (!trimmed) return results

  if (trimmed.startsWith('{')) {
    try {
      results.push(JSON.parse(trimmed))
    } catch (_) { /* ignore */ }
  }

  for (const line of trimmed.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      results.push(JSON.parse(t))
    } catch (_) { /* skip */ }
  }
  return results
}

export function parseOpenClawStdout(stdout) {
  const raw = (stdout || '').trim()
  if (!raw) return null

  for (const parsed of tryParseJsonObjects(raw)) {
    const found = extractAgentSessionMeta(parsed)
    if (found?.sessionId) return { sessionId: found.sessionId, sessionFile: found.sessionFile }
    if (found?.sessionKey) return { sessionKey: found.sessionKey }
  }

  const sessionIdMatch = raw.match(/"sessionId"\s*:\s*"([^"]+)"/)
  if (sessionIdMatch) {
    const sessionFileMatch = raw.match(/"sessionFile"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    const sessionKeyMatch = raw.match(/"sessionKey"\s*:\s*"([^"]+)"/)
    return {
      sessionId: sessionIdMatch[1],
      sessionFile: sessionFileMatch ? sessionFileMatch[1].replace(/\\\\/g, '\\') : null,
      sessionKey: sessionKeyMatch ? sessionKeyMatch[1] : null
    }
  }

  const sessionKeyMatch = raw.match(/"sessionKey"\s*:\s*"([^"]+)"/)
  if (sessionKeyMatch) {
    return { sessionKey: sessionKeyMatch[1] }
  }

  return null
}

function collectTranscriptCandidates(cliName, entry) {
  const sessionsDir = resolveAgentSessionsDir(cliName)
  const candidates = []
  if (entry.sessionFile) {
    const sf = entry.sessionFile.trim()
    candidates.push(sf)
    if (!path.isAbsolute(sf)) {
      candidates.push(path.join(sessionsDir, sf))
      candidates.push(path.join(sessionsDir, path.basename(sf.replace(/\\/g, '/'))))
    }
    candidates.push(sf.replace(/\//g, path.sep))
  }
  candidates.push(path.join(sessionsDir, `${entry.sessionId}.jsonl`))
  return [...new Set(candidates.map(c => path.normalize(c)))]
}

function collectTrajectoryPointerCandidates(cliName, entry, transcriptCandidates) {
  const sessionsDir = resolveAgentSessionsDir(cliName)
  const pointers = new Set([
    path.join(sessionsDir, `${entry.sessionId}.trajectory-path.json`)
  ])
  for (const tc of transcriptCandidates) {
    if (tc.endsWith('.jsonl')) pointers.add(`${tc.slice(0, -6)}.trajectory-path.json`)
    else pointers.add(`${tc}.trajectory-path.json`)
  }
  return [...pointers]
}

function collectTrajectoryRuntimeCandidates(cliName, entry, transcriptCandidates) {
  const sessionsDir = resolveAgentSessionsDir(cliName)
  const runtimes = new Set([
    path.join(sessionsDir, `${entry.sessionId}.trajectory.jsonl`)
  ])
  for (const tc of transcriptCandidates) {
    if (tc.endsWith('.jsonl')) runtimes.add(`${tc.slice(0, -6)}.trajectory.jsonl`)
    else runtimes.add(`${tc}.trajectory.jsonl`)
  }
  return [...runtimes.map(p => path.normalize(p))]
}

/** 经典 transcript：<sessionId>.jsonl */
export function resolveSessionTranscriptFile(cliName, entry) {
  if (!entry?.sessionId) return null
  const candidates = collectTranscriptCandidates(cliName, entry)
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[candidates.length - 1] || null
}

/**
 * 可读会话文件：优先 transcript jsonl，否则 trajectory-path.json → runtimeFile / *.trajectory.jsonl
 * @returns {{ path: string, format: 'transcript'|'trajectory' } | null}
 */
export function resolveSessionReadableFile(cliName, entry) {
  if (!entry?.sessionId) return null

  const transcriptCandidates = collectTranscriptCandidates(cliName, entry)
  for (const c of transcriptCandidates) {
    if (fs.existsSync(c)) return { path: c, format: 'transcript' }
  }

  for (const pointer of collectTrajectoryPointerCandidates(cliName, entry, transcriptCandidates)) {
    const runtime = readTrajectoryPointer(pointer)
    if (runtime) return { path: runtime, format: 'trajectory' }
  }

  for (const runtime of collectTrajectoryRuntimeCandidates(cliName, entry, transcriptCandidates)) {
    if (fs.existsSync(runtime)) return { path: runtime, format: 'trajectory' }
  }

  const fallback = transcriptCandidates[transcriptCandidates.length - 1]
  if (fallback) return { path: fallback, format: 'transcript' }
  return null
}

function buildStoreKeyCandidates(sessionKey, cliName) {
  const agentId = sanitizeAgentId(cliName)
  const key = (sessionKey || '').trim()
  if (!key) return []
  const set = new Set([
    key,
    `agent:${agentId}:${key}`,
    key.toLowerCase(),
    `agent:${agentId}:${key.toLowerCase()}`
  ])
  return [...set]
}

function findStoreEntry(store, sessionKey, cliName) {
  if (!store || typeof store !== 'object') return null

  for (const candidate of buildStoreKeyCandidates(sessionKey, cliName)) {
    const entry = store[candidate]
    if (entry?.sessionId) return { key: candidate, entry }
  }

  const needle = (sessionKey || '').trim().toLowerCase()
  if (needle) {
    for (const [key, entry] of Object.entries(store)) {
      if (!entry?.sessionId) continue
      const k = key.toLowerCase()
      if (k === needle || k.endsWith(`:${needle}`) || k.includes(needle)) {
        return { key, entry }
      }
    }
  }

  return null
}

/** 从 ~/.openclaw/agents/<id>/sessions/sessions.json 按 sessionKey 解析 */
export function resolveOpenClawSessionFromStore(cliName, sessionKey) {
  const storePath = path.join(resolveAgentSessionsDir(cliName), 'sessions.json')
  if (!fs.existsSync(storePath)) return null

  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
    const found = findStoreEntry(store, sessionKey, cliName)
    if (!found) return null

    const readable = resolveSessionReadableFile(cliName, found.entry)
    return {
      sessionId: found.entry.sessionId,
      sessionFile: readable?.path || resolveSessionTranscriptFile(cliName, found.entry),
      sessionKey: found.key
    }
  } catch (err) {
    console.warn(`resolveOpenClawSessionFromStore(${cliName}) failed:`, err.message)
    return null
  }
}

/** 旧会话无 session_key 时，按 gitlab:<agent>:<iid>_ 前缀在 store 中匹配 */
export function resolveOpenClawSessionFromStoreByIid(cliName, issueIid, startedAtMs) {
  const storePath = path.join(resolveAgentSessionsDir(cliName), 'sessions.json')
  if (!issueIid || !fs.existsSync(storePath)) return null

  const agentId = sanitizeAgentId(cliName)
  const marker = `gitlab:${agentId}:${issueIid}_`
  let best = null
  let bestDelta = Number.POSITIVE_INFINITY

  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
    for (const [key, entry] of Object.entries(store)) {
      if (!entry?.sessionId) continue
      const k = key.toLowerCase()
      if (!k.includes(marker)) continue
      const updatedAt = Number(entry.updatedAt) || 0
      const delta = startedAtMs ? Math.abs(updatedAt - startedAtMs) : 0
      if (delta < bestDelta) {
        bestDelta = delta
        best = { key, entry }
      }
    }
    if (!best) return null
    const readable = resolveSessionReadableFile(cliName, best.entry)
    return {
      sessionId: best.entry.sessionId,
      sessionFile: readable?.path || resolveSessionTranscriptFile(cliName, best.entry),
      sessionKey: best.key
    }
  } catch (_) {
    return null
  }
}

/** 按 sessionId 在 store 中查找（stdout 只有 sessionId 无 sessionFile 时） */
export function resolveOpenClawSessionById(cliName, sessionId) {
  const storePath = path.join(resolveAgentSessionsDir(cliName), 'sessions.json')
  if (!sessionId || !fs.existsSync(storePath)) return null

  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
    for (const [key, entry] of Object.entries(store)) {
      if (entry?.sessionId === sessionId) {
        const readable = resolveSessionReadableFile(cliName, entry)
        return {
          sessionId,
          sessionFile: readable?.path || resolveSessionTranscriptFile(cliName, entry),
          sessionKey: key
        }
      }
    }
  } catch (_) { /* ignore */ }
  return null
}

/**
 * 综合解析：stdout → session store → 补全 sessionFile
 */
export function resolveOpenClawSessionMeta({ stdout, cliName, sessionKey }) {
  const fromStdout = parseOpenClawStdout(stdout)

  if (fromStdout?.sessionId) {
    const entry = { sessionId: fromStdout.sessionId, sessionFile: fromStdout.sessionFile }
    let readable = resolveSessionReadableFile(cliName, entry)
    if (!readable?.path || !fs.existsSync(readable.path)) {
      const byId = resolveOpenClawSessionById(cliName, fromStdout.sessionId)
      if (byId?.sessionFile) readable = { path: byId.sessionFile, format: 'trajectory' }
    }
    const sessionFile = readable?.path ? path.normalize(readable.path) : null
    return {
      sessionId: fromStdout.sessionId,
      sessionFile,
      sessionKey: fromStdout.sessionKey || sessionKey || null
    }
  }

  const lookupKey = fromStdout?.sessionKey || sessionKey
  if (lookupKey && cliName) {
    const fromStore = resolveOpenClawSessionFromStore(cliName, lookupKey)
    if (fromStore?.sessionId) return fromStore
  }

  return null
}

export function recoverSessionFromLog(logFile, { cliName, sessionKey } = {}) {
  if (!logFile || !fs.existsSync(logFile)) return null
  try {
    const content = fs.readFileSync(logFile, 'utf-8')
    const stdout = content.split('\n--- stderr ---\n')[0]
    return resolveOpenClawSessionMeta({ stdout, cliName, sessionKey })
  } catch (_) {
    return null
  }
}
