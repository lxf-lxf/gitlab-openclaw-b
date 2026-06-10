import fs from 'node:fs'
import path from 'node:path'

function isTrajectoryEvent(entry) {
  return entry?.traceSchema === 'openclaw-trajectory' &&
    entry.schemaVersion === 1 &&
    typeof entry.type === 'string'
}

function toolName(data) {
  return (data?.name || data?.toolName || 'tool').trim()
}

function formatToolOutput(data) {
  if (typeof data?.output === 'string' && data.output.trim()) return data.output.slice(0, 2000)
  if (data?.result != null) {
    try {
      return JSON.stringify(data.result, null, 2).slice(0, 2000)
    } catch {
      return String(data.result).slice(0, 2000)
    }
  }
  if (Array.isArray(data?.contentItems) && data.contentItems.length) {
    try {
      return JSON.stringify(data.contentItems, null, 2).slice(0, 2000)
    } catch {
      return ''
    }
  }
  return ''
}

/** 读取 *.trajectory-path.json 并返回 runtimeFile 绝对路径 */
export function readTrajectoryPointer(pointerPath) {
  if (!pointerPath || !fs.existsSync(pointerPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'))
    if (parsed?.traceSchema !== 'openclaw-trajectory-pointer') return null
    if (!parsed.sessionId || typeof parsed.runtimeFile !== 'string') return null
    const runtime = path.normalize(parsed.runtimeFile.trim())
    return fs.existsSync(runtime) ? runtime : null
  } catch {
    return null
  }
}

/** 将 trajectory.jsonl 转为 B 端消息列表（与 transcript jsonl 输出结构对齐） */
export function parseTrajectoryContent(content) {
  const messages = []
  const sessionMeta = {}
  let modelInfo = null
  let toolCallCount = 0
  let toolResultCount = 0
  const roles = {}
  let totalTokens = 0
  let hasTokens = false
  let msgIndex = 0

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isTrajectoryEvent(event)) continue

    if (event.type === 'session.started') {
      sessionMeta.id = event.sessionId
      sessionMeta.started_at = event.ts
      if (event.data?.cwd) sessionMeta.cwd = event.data.cwd
      continue
    }

    if (event.provider || event.modelId) {
      modelInfo = {
        provider: event.provider || modelInfo?.provider,
        modelId: event.modelId || modelInfo?.modelId,
        changed_at: event.ts
      }
    }

    const pushMsg = (role, payload) => {
      roles[role] = (roles[role] || 0) + 1
      messages.push({
        id: event.id || `traj-${msgIndex++}`,
        role,
        timestamp: event.ts,
        ...payload
      })
    }

    const data = event.data || {}

    switch (event.type) {
      case 'prompt.submitted': {
        const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : ''
        if (prompt) pushMsg('user', { text: prompt })
        break
      }
      case 'model.completed': {
        const texts = Array.isArray(data.assistantTexts) ? data.assistantTexts : []
        const usage = data.usage || null
        if (usage) {
          const input = usage.input || usage.promptTokens || 0
          const output = usage.output || usage.completionTokens || 0
          totalTokens += input + output
          hasTokens = true
        }
        if (texts.length) {
          for (const t of texts) {
            if (typeof t === 'string' && t.trim()) {
              pushMsg('assistant', { text: t, usage: usage || undefined })
            }
          }
        } else if (typeof data.finalPromptText === 'string' && data.finalPromptText.trim()) {
          pushMsg('assistant', {
            text: data.promptError ? `Error: ${data.promptError}` : '(model completed, no assistant text)',
            usage: usage || undefined
          })
        }
        if (event.provider || event.modelId) {
          modelInfo = {
            provider: event.provider,
            modelId: event.modelId,
            changed_at: event.ts
          }
        }
        break
      }
      case 'tool.call': {
        toolCallCount++
        pushMsg('tool', {
          text: '',
          toolCalls: [{
            id: data.toolCallId || data.itemId || `call-${msgIndex}`,
            name: toolName(data),
            arguments: data.arguments
          }]
        })
        break
      }
      case 'tool.result': {
        toolResultCount++
        const isError = data.isError === true || data.success === false
        pushMsg('toolResult', {
          text: formatToolOutput(data),
          toolResult: {
            toolName: toolName(data),
            text: formatToolOutput(data),
            isError
          }
        })
        break
      }
      case 'tool.timeout': {
        toolResultCount++
        pushMsg('toolResult', {
          text: `Tool timeout (${data.timeoutMs || '?'}ms)`,
          toolResult: {
            toolName: toolName(data),
            text: `Tool timeout (${data.timeoutMs || '?'}ms)`,
            isError: true
          }
        })
        break
      }
      case 'session.ended': {
        sessionMeta.ended_at = event.ts
        sessionMeta.status = data.status || 'ended'
        break
      }
      default:
        break
    }
  }

  return {
    messages,
    session_meta: Object.keys(sessionMeta).length > 0 ? sessionMeta : null,
    model: modelInfo,
    thinking_level: null,
    stats: {
      total_messages: messages.length,
      total_tool_calls: toolCallCount,
      total_tool_results: toolResultCount,
      roles,
      total_tokens: hasTokens ? totalTokens : null,
      format: 'trajectory'
    }
  }
}

export function isTrajectorySessionFile(filePath) {
  if (!filePath) return false
  const base = path.basename(filePath).toLowerCase()
  return base.endsWith('.trajectory.jsonl') || base.endsWith('.trajectory-path.json')
}

export function detectSessionContentFormat(content, filePath) {
  if (isTrajectorySessionFile(filePath)) return 'trajectory'
  const first = content.split(/\r?\n/u).map(l => l.trim()).find(Boolean)
  if (!first) return 'transcript'
  try {
    const parsed = JSON.parse(first)
    if (parsed?.traceSchema === 'openclaw-trajectory') return 'trajectory'
    if (parsed?.traceSchema === 'openclaw-trajectory-pointer') return 'pointer'
  } catch { /* ignore */ }
  return 'transcript'
}
