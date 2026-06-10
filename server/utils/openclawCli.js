import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import config from '../config.js'

const IS_WIN = process.platform === 'win32'

function configuredBin() {
  const bin = (config.openclaw.bin || 'openclaw').trim()
  return bin || 'openclaw'
}

/** 可通过 OPENCLAW_CLI_TIMEOUT_MS 覆盖；Windows 默认更长 */
export function cliTimeoutMs(fallback = 10000) {
  const raw = process.env.OPENCLAW_CLI_TIMEOUT_MS
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return IS_WIN ? Math.max(fallback, 30000) : fallback
}

function defaultSpawnOptions(extra = {}) {
  const opts = { ...extra }
  if (IS_WIN && opts.windowsHide === undefined) {
    opts.windowsHide = true
  }
  return opts
}

/** 从 Windows npm 全局 .cmd 解析 openclaw.mjs */
function findOpenClawMjsNear(binPath) {
  const dir = path.dirname(binPath)
  const candidates = [
    path.join(dir, 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(dir, '..', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(dir, '..', '..', 'node_modules', 'openclaw', 'openclaw.mjs')
  ]
  for (const mjs of candidates) {
    if (fs.existsSync(mjs)) return mjs
  }
  return null
}

export function resolveOpenClawMjsPath() {
  const { args } = resolveOpenClawInvocation([])
  const mjs = args[0]
  if (mjs && mjs.toLowerCase().endsWith('openclaw.mjs') && fs.existsSync(mjs)) {
    return mjs
  }
  return null
}

/**
 * 解析跨平台 OpenClaw 调用方式
 * Windows 上 .cmd/.bat 不能直接 spawn（EINVAL），改为 node openclaw.mjs
 * @returns {{ command: string, args: string[] }}
 */
export function resolveOpenClawInvocation(cliArgs = []) {
  const bin = configuredBin()
  const lower = bin.toLowerCase()

  if (IS_WIN) {
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      const mjs = findOpenClawMjsNear(bin)
      if (mjs) {
        return { command: process.execPath, args: [mjs, ...cliArgs] }
      }
      return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', bin, ...cliArgs] }
    }
    if (lower.endsWith('.ps1')) {
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bin, ...cliArgs]
      }
    }
    if (lower.endsWith('.mjs') && fs.existsSync(bin)) {
      return { command: process.execPath, args: [bin, ...cliArgs] }
    }
    if (!path.isAbsolute(bin)) {
      const mjs = findOpenClawMjsNear(path.join(process.env.APPDATA || '', 'npm', `${bin}.cmd`))
      if (mjs) {
        return { command: process.execPath, args: [mjs, ...cliArgs] }
      }
    }
  }

  return { command: bin, args: cliArgs }
}

export function spawnOpenClaw(cliArgs, options = {}) {
  const { command, args } = resolveOpenClawInvocation(cliArgs)
  return spawn(command, args, defaultSpawnOptions(options))
}

export function spawnSyncOpenClaw(cliArgs, options = {}) {
  const { command, args } = resolveOpenClawInvocation(cliArgs)
  const opts = defaultSpawnOptions(options)
  if (opts.timeout === undefined) {
    opts.timeout = cliTimeoutMs(15000)
  }
  return spawnSync(command, args, opts)
}

function readVersionFromPackage() {
  const mjs = resolveOpenClawMjsPath()
  if (!mjs) return null
  const pkgPath = path.join(path.dirname(mjs), 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.version ? `OpenClaw ${pkg.version}` : null
  } catch {
    return null
  }
}

function parseSpawnOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}`.trim()
}

export function getOpenClawVersionSync(timeoutMs) {
  const timeout = timeoutMs ?? cliTimeoutMs(8000)
  try {
    const result = spawnSyncOpenClaw(['--version'], {
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (!result.error && result.status === 0) {
      const out = parseSpawnOutput(result)
      if (out) return out
    }
    if (result.error?.code === 'ETIMEDOUT') {
      const fallback = readVersionFromPackage()
      if (fallback) {
        console.warn('[openclawCli] --version 超时，使用 package.json 版本:', fallback)
        return fallback
      }
    }
    return null
  } catch {
    return readVersionFromPackage()
  }
}

export function getOpenClawVersion(timeoutMs) {
  const timeout = timeoutMs ?? cliTimeoutMs(8000)
  return new Promise(resolve => {
    let settled = false
    const done = (val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(val)
    }

    const child = spawnOpenClaw(['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      const fallback = readVersionFromPackage()
      if (fallback) {
        console.warn('[openclawCli] --version 超时，使用 package.json 版本:', fallback)
        done(fallback)
      } else {
        done(null)
      }
    }, timeout)

    child.stdout?.on('data', chunk => { out += chunk.toString() })
    child.stderr?.on('data', chunk => { out += chunk.toString() })
    child.on('error', () => done(readVersionFromPackage()))
    child.on('exit', code => {
      if (code === 0 && out.trim()) {
        done(out.trim())
      } else {
        done(readVersionFromPackage())
      }
    })
  })
}

export function isOpenClawAvailableSync() {
  return !!getOpenClawVersionSync()
}

/** 从 agents 目录扫描已部署 Agent（CLI 超时时的降级方案） */
export function listAgentsFromFilesystem(agentsDir = config.openclaw.agentsDir) {
  const agents = []
  if (!agentsDir || !fs.existsSync(agentsDir)) return agents

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const agentDir = path.join(agentsDir, name, 'agent')
    if (!fs.existsSync(agentDir)) continue

    let workspace = null
    const jsonPath = path.join(agentDir, 'agent.json')
    if (fs.existsSync(jsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        workspace = meta.workspace || null
      } catch { /* ignore */ }
    }
    agents.push({ name, id: name, workspace })
  }
  return agents
}

/**
 * 列出 OpenClaw Agent：优先 CLI，超时/失败时降级读文件系统
 * @returns {{ agents: object[], source: 'cli'|'filesystem' }}
 */
export function listOpenClawAgentsSync(options = {}) {
  const timeout = options.timeout ?? cliTimeoutMs(20000)
  const result = spawnSyncOpenClaw(['agents', 'list', '--json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout
  })

  if (!result.error && result.status === 0) {
    const raw = parseSpawnOutput(result)
    if (raw) {
      try {
        const agents = JSON.parse(raw)
        if (Array.isArray(agents)) {
          return { agents, source: 'cli' }
        }
      } catch { /* fall through */ }
    }
  }

  if (result.error?.code === 'ETIMEDOUT') {
    console.warn('[openclawCli] agents list 超时，降级读取 agents 目录')
  }

  return {
    agents: listAgentsFromFilesystem(),
    source: 'filesystem'
  }
}

export function isSpawnTimedOut(result) {
  return result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM'
}

/** 确保 OpenClaw workspace 目录存在（Windows 路径兼容） */
export function ensureWorkspaceDir(workspace) {
  const dir = (workspace || '').trim()
  if (!dir) return false
  fs.mkdirSync(dir, { recursive: true })
  return true
}
