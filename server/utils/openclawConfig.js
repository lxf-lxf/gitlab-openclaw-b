import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSyncOpenClaw, cliTimeoutMs } from './openclawCli.js'

const CHANNEL_META_KEYS = new Set(['modelByChannel', 'defaults', 'routing'])

function parseJsonFromCliOutput(raw) {
  const text = (raw || '').trim()
  if (!text) return null

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch { /* try earlier line */ }
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch { /* ignore */ }
  }
  return null
}

function defaultConfigPath() {
  const fromEnv = (process.env.OPENCLAW_CONFIG_PATH || '').trim()
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.openclaw', 'openclaw.json')
}

/** 解析 OpenClaw 主配置文件路径（跨平台） */
export function getOpenClawConfigPathSync() {
  const result = spawnSyncOpenClaw(['config', 'file'], {
    encoding: 'utf-8',
    timeout: cliTimeoutMs(20000),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const lines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.includes('openclaw.json') || /^[~A-Za-z]:[\\/]/.test(line) || line.startsWith('/')) {
      return line.replace(/^~/, os.homedir())
    }
  }
  return defaultConfigPath()
}

/** @returns {{ valid: boolean, path: string, issues?: Array<{path?: string, message?: string}> }} */
export function validateOpenClawConfigSync() {
  const result = spawnSyncOpenClaw(['config', 'validate', '--json'], {
    encoding: 'utf-8',
    timeout: cliTimeoutMs(30000),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const parsed = parseJsonFromCliOutput(output)
  if (parsed && typeof parsed.valid === 'boolean') {
    return {
      valid: parsed.valid,
      path: parsed.path || getOpenClawConfigPathSync(),
      issues: Array.isArray(parsed.issues) ? parsed.issues : []
    }
  }

  return {
    valid: result.status === 0,
    path: getOpenClawConfigPathSync(),
    issues: []
  }
}

function extractUnknownChannelIds(issues = []) {
  const ids = new Set()
  for (const issue of issues) {
    const msg = String(issue?.message || '')
    const pathKey = String(issue?.path || '')
    const fromMsg = msg.match(/unknown channel id:\s*([^\s]+)/i)
    if (fromMsg?.[1]) ids.add(fromMsg[1])
    if (pathKey.startsWith('channels.') && msg.includes('unknown channel id')) {
      ids.add(pathKey.slice('channels.'.length))
    }
  }
  return [...ids]
}

function backupConfigFile(configPath) {
  if (!fs.existsSync(configPath)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${configPath}.bcenter-backup.${stamp}`
  fs.copyFileSync(configPath, backupPath)
  return backupPath
}

function removeStaleChannelsFromConfigObject(config, channelIds) {
  const stale = new Set(channelIds.map(id => id.toLowerCase()))
  const next = structuredClone(config)

  const channels = next.channels
  if (channels && typeof channels === 'object') {
    for (const key of Object.keys(channels)) {
      if (CHANNEL_META_KEYS.has(key)) continue
      if (stale.has(key.toLowerCase())) delete channels[key]
    }
    const modelByChannel = channels.modelByChannel
    if (modelByChannel && typeof modelByChannel === 'object') {
      for (const providerId of Object.keys(modelByChannel)) {
        const providerMap = modelByChannel[providerId]
        if (!providerMap || typeof providerMap !== 'object') continue
        for (const channelId of Object.keys(providerMap)) {
          if (stale.has(channelId.toLowerCase())) delete providerMap[channelId]
        }
        if (Object.keys(providerMap).length === 0) delete modelByChannel[providerId]
      }
      if (Object.keys(modelByChannel).length === 0) delete channels.modelByChannel
    }
  }

  const entries = next.plugins?.entries
  if (entries && typeof entries === 'object') {
    for (const pluginId of Object.keys(entries)) {
      if (stale.has(pluginId.toLowerCase())) delete entries[pluginId]
    }
  }

  const heartbeat = next.agents?.defaults?.heartbeat
  if (heartbeat?.target && stale.has(String(heartbeat.target).toLowerCase())) {
    delete heartbeat.target
  }

  const agentList = Array.isArray(next.agents?.list) ? next.agents.list : []
  for (const agent of agentList) {
    const hb = agent?.heartbeat
    if (hb?.target && stale.has(String(hb.target).toLowerCase())) {
      delete hb.target
    }
  }

  return next
}

function repairConfigFileDirect(configPath, channelIds) {
  if (!channelIds.length || !fs.existsSync(configPath)) {
    return { repaired: false, removed: [], backupPath: null }
  }

  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return { repaired: false, removed: channelIds, backupPath: null, error: '配置文件不是标准 JSON，无法自动修复' }
  }

  const backupPath = backupConfigFile(configPath)
  const next = removeStaleChannelsFromConfigObject(config, channelIds)
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  return { repaired: true, removed: channelIds, backupPath }
}

function runDoctorFixSync() {
  const result = spawnSyncOpenClaw(['doctor', '--fix', '--non-interactive', '--yes'], {
    encoding: 'utf-8',
    timeout: cliTimeoutMs(120000),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  }
}

function unsetConfigPathSync(dotPath) {
  const result = spawnSyncOpenClaw(['config', 'unset', dotPath], {
    encoding: 'utf-8',
    timeout: cliTimeoutMs(30000),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  }
}

/**
 * 部署 Agent 前修复 openclaw.json（移除未安装插件的 channel 等脏配置）
 * @returns {{ ok: boolean, actions: string[], path: string, issues?: object[] }}
 */
export function ensureOpenClawConfigReadyForDeploy() {
  const configPath = getOpenClawConfigPathSync()
  const actions = []

  if (!fs.existsSync(configPath)) {
    return { ok: true, actions: ['config-missing-skip'], path: configPath }
  }

  let validation = validateOpenClawConfigSync()
  if (validation.valid) {
    return { ok: true, actions, path: configPath }
  }

  const doctor = runDoctorFixSync()
  if (doctor.ok) actions.push('doctor-fix')
  validation = validateOpenClawConfigSync()
  if (validation.valid) {
    return { ok: true, actions, path: configPath }
  }

  const staleChannelIds = extractUnknownChannelIds(validation.issues)
  if (staleChannelIds.length) {
    for (const channelId of staleChannelIds) {
      unsetConfigPathSync(`channels.${channelId}`)
      unsetConfigPathSync(`plugins.entries.${channelId}`)
    }
    actions.push(`unset-channels:${staleChannelIds.join(',')}`)
    validation = validateOpenClawConfigSync()
  }

  if (!validation.valid && staleChannelIds.length) {
    const direct = repairConfigFileDirect(configPath, staleChannelIds)
    if (direct.repaired) {
      actions.push(`direct-repair:${staleChannelIds.join(',')}`)
      if (direct.backupPath) actions.push(`backup:${direct.backupPath}`)
      validation = validateOpenClawConfigSync()
    } else if (direct.error) {
      actions.push(`direct-repair-failed:${direct.error}`)
    }
  }

  if (validation.valid) {
    return { ok: true, actions, path: configPath }
  }

  const issueLines = (validation.issues || [])
    .slice(0, 5)
    .map(i => `${i.path || '(root)'}: ${i.message || ''}`)
    .join('; ')

  return {
    ok: false,
    actions,
    path: configPath,
    issues: validation.issues,
    message: issueLines
      ? `OpenClaw 配置校验未通过，无法注册 Agent：${issueLines}`
      : 'OpenClaw 配置校验未通过，无法注册 Agent。请在本机执行 openclaw config validate 查看详情。'
  }
}
