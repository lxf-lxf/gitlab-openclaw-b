import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** gitlab-tools 插件源文件路径 */
const GITLAB_TOOLS_SRC = path.resolve(__dirname, '../plugins/gitlab-tools.js')
const GITLAB_TOOLS_MANIFEST = path.resolve(__dirname, '../plugins/openclaw.plugin.json')
const GITLAB_PLUGIN_ID = 'gitlab-tools'

/** 将 gitlab-tools 插件以 OpenClaw 可识别格式部署到 agentDir/plugins/<id>/ */
export function syncGitlabToolsPlugin(agentDir) {
  const pluginDir = path.join(agentDir, 'plugins', GITLAB_PLUGIN_ID)
  fs.mkdirSync(pluginDir, { recursive: true })

  // 复制插件代码
  if (fs.existsSync(GITLAB_TOOLS_SRC)) {
    fs.copyFileSync(GITLAB_TOOLS_SRC, path.join(pluginDir, 'gitlab-tools.js'))
  }
  // 复制插件清单
  if (fs.existsSync(GITLAB_TOOLS_MANIFEST)) {
    fs.copyFileSync(GITLAB_TOOLS_MANIFEST, path.join(pluginDir, 'openclaw.plugin.json'))
  }
  // 生成最小 package.json（OpenClaw 插件发现必需）
  const pkgPath = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'gitlab-tools',
      version: '1.0.0',
      main: 'gitlab-tools.js',
      private: true
    }, null, 2), 'utf-8')
  }
}

function sanitizeAgentId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

export function resolveOpenClawConfigPath() {
  const agentsDir = (config.openclaw.agentsDir || '').trim()
  if (agentsDir) {
    const candidate = path.join(path.dirname(agentsDir), 'openclaw.json')
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(os.homedir(), '.openclaw', 'openclaw.json')
}

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

/**
 * 解析跨平台 OpenClaw 调用方式
 */
export function resolveOpenClawInvocation(cliArgs = []) {
  const bin = configuredBin()
  const lower = bin.toLowerCase()

  if (lower.endsWith('.mjs') && fs.existsSync(bin)) {
    return { command: process.execPath, args: [bin, ...cliArgs] }
  }
  if (IS_WIN && lower.endsWith('.ps1')) {
    return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bin, ...cliArgs] }
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

/**
 * 跨平台 shell 安全引号：将字符串用单引号包裹，并对内部的单引号做转义
 *
 * Unix 单引号规则：' → '\''（结束当前单引号 + 转义引号 + 重新开始单引号）
 * PowerShell 单引号规则：' → ''（双写单引号）
 * 此处使用 Unix 规则，PowerShell 场景下被包裹在 "..." 内，.Command 参数本身不经过 cmd.exe
 */
function shQuote(val) {
  return `'${String(val).replace(/'/g, "'\\''")}'`
}

/**
 * 通过文件传递消息启动 OpenClaw Agent（跨平台 shell 安全版）
 *
 * 原理：将 message 写入文件，再通过 shell 命令替换读取为 --message 参数值。
 * 完全避免 shell 对换行符和特殊字符的转义问题。
 *
 * Linux/macOS (sh):    ... --message "$(cat /path/file)"
 * Windows (PowerShell): ... --message (Get-Content /path/file -Raw)
 *
 * @param {string} cliName - Agent CLI 名称（sanitized）
 * @param {string} sessionKey - 会话唯一 Key
 * @param {object} [options]
 * @param {string} [options.message] - 消息内容（与 msgFile 二选一）
 * @param {string} [options.msgFile] - 已存在的消息文件路径（与 message 二选一）
 * @param {string[]} [options.extraArgs] - 额外 CLI 参数，如 ['--json', '--timeout', '600']
 * @param {object} [options.spawnOptions] - 传给 spawn 的选项
 * @returns {{ child: ChildProcess, cleanup: () => void, msgFile: string }}
 */
export function spawnAgentWithMessage(cliName, sessionKey, options = {}) {
  const { message, extraArgs = [], spawnOptions = {} } = options
  let { msgFile } = options
  let tempDir = null

  // 没有 msgFile 则写入临时文件，调用方负责通过 cleanup 清理
  if (!msgFile) {
    if (!message) throw new Error('spawnAgentWithMessage: 必须提供 message 或 msgFile')
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcenter-msg-'))
    msgFile = path.join(tempDir, 'message.txt')
    fs.writeFileSync(msgFile, message, 'utf-8')
  }

  // 通过 resolveOpenClawInvocation 解析出正确的 command+args（处理 .mjs / .ps1）
  const allArgs = ['agent', '--agent', cliName, '--session-key', sessionKey, ...extraArgs]
  const { command, args } = resolveOpenClawInvocation(allArgs)
  const opts = defaultSpawnOptions(spawnOptions)

  // 安全引用所有动态值
  const qCmd = shQuote(command)
  const qArgs = args.map(shQuote).join(' ')
  const qFile = shQuote(msgFile)

  /** 如果创建了临时目录，调用此函数清理 */
  const cleanup = tempDir
    ? () => { try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {} }
    : () => {}

  if (IS_WIN) {
    // Windows：通过 PowerShell 的 Get-Content -Raw 一次性读取整个文件内容
    // 注意：& 后的命令放在双引号外，PowerShell 将 (Get-Content ... -Raw) 作为表达式求值
    const psCmd = `& ${qCmd} ${qArgs} --message (Get-Content ${qFile} -Raw)`
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], opts)
    return { child, cleanup, msgFile }
  }

  // Unix：通过 sh -c + $(cat) 读取文件，双引号确保多行文本作为一个参数
  const shCmd = `${qCmd} ${qArgs} --message "$(cat ${qFile})"`
  const child = spawn('sh', ['-c', shCmd], opts)
  return { child, cleanup, msgFile }
}

/**
 * @deprecated 请使用 spawnAgentWithMessage(cliName, sessionKey, { msgFile, extraArgs, spawnOptions })
 */
export function spawnAgentFromMsgFile(cliName, sessionKey, msgFile, extraArgs = [], spawnOptions = {}) {
  const result = spawnAgentWithMessage(cliName, sessionKey, { msgFile, extraArgs, spawnOptions })
  return result.child
}

function readVersionFromPackage() {
  // 从常见位置查找 openclaw 的 package.json 读取版本号（CLI 超时降级用）
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(__dirname, '..', 'node_modules', 'openclaw', 'dist', 'openclaw.mjs'),
  ]
  const mjs = candidates.find(c => fs.existsSync(c))
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

/** Agent 状态目录：~/.openclaw/agents/<id>/agent */
export function resolveAgentDir(agentName) {
  const id = sanitizeAgentId(agentName)
  const agentsDir = (config.openclaw.agentsDir || path.join(os.homedir(), '.openclaw', 'agents')).trim()
  return path.join(agentsDir, id, 'agent')
}

/**
 * 运行时 workspace：默认 agentDir（与 AGENTS.md 同目录）。
 * 模板显式配置 workspace_path 时用于代码仓库等独立目录。
 */
export function resolveAgentRuntimeWorkspace(template, cliName) {
  const agentDir = resolveAgentDir(cliName)
  const fromTemplate = (template?.workspace_path || '').trim()
  if (fromTemplate) return fromTemplate
  return agentDir
}

/** 将 agentDir 中的 AGENTS.md 同步到 workspace（OpenClaw 从 workspace 加载指令） */
export function syncAgentWorkspaceFiles(agentDir, workspace) {
  const src = path.join(agentDir, 'AGENTS.md')
  if (!fs.existsSync(src)) return false
  ensureWorkspaceDir(workspace)
  const dst = path.join(workspace, 'AGENTS.md')
  if (path.resolve(agentDir) === path.resolve(workspace)) return true
  try {
    fs.copyFileSync(src, dst)
    return true
  } catch (err) {
    console.warn(`syncAgentWorkspaceFiles failed (${dst}):`, err.message)
    return false
  }
}

/**
 * 调度前确保 OpenClaw 注册信息与 workspace 文件就绪
 */
export function prepareAgentRuntime(cliName, template = null) {
  const agentDir = resolveAgentDir(cliName)
  const workspace = resolveAgentRuntimeWorkspace(template, cliName)
  ensureWorkspaceDir(agentDir)
  ensureWorkspaceDir(workspace)
  syncGitlabToolsPlugin(agentDir)
  syncAgentWorkspaceFiles(agentDir, workspace)
  const synced = syncOpenClawAgentRegistry(cliName, { workspace, agentDir })
  if (synced) {
    console.log(`[agent-runtime] ${cliName} workspace=${workspace}`)
  }
  return { agentDir, workspace }
}

export function getRegisteredAgentWorkspace(agentName) {
  const id = sanitizeAgentId(agentName)
  if (!id) return null

  const { agents } = listOpenClawAgentsSync({ timeout: cliTimeoutMs(15000) })
  const fromCli = agents.find(a => a.id === id || a.name === id)
  if (fromCli?.workspace?.trim()) return fromCli.workspace.trim()

  try {
    const cfgPath = resolveOpenClawConfigPath()
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
      const entry = (cfg.agents?.list || []).find(a => a.id === id)
      if (entry?.workspace?.trim()) return entry.workspace.trim()
    }
  } catch { /* ignore */ }

  const agentsDir = (config.openclaw.agentsDir || '').trim()
  if (agentsDir) {
    const agentJsonPath = path.join(agentsDir, id, 'agent', 'agent.json')
    if (fs.existsSync(agentJsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'))
        if (meta.workspace?.trim()) return meta.workspace.trim()
      } catch { /* ignore */ }
    }
  }

  return null
}

/** Agent 执行日志目录（跨平台，避免 Windows 上 /tmp 不可写） */
export function resolveAgentLogDir() {
  const fromEnv = (process.env.BCENTER_AGENT_LOG_DIR || '').trim()
  if (fromEnv) return fromEnv
  return path.join(os.tmpdir(), 'gitlab-b-center', 'agent-logs')
}

/** 生成单次 Agent 运行的日志文件路径 */
export function buildAgentLogFile(cliName, eventId) {
  const dir = resolveAgentLogDir()
  const safeName = sanitizeAgentId(cliName) || 'agent'
  return path.join(dir, `bcenter-agent-${safeName}-${eventId}-${Date.now()}.log`)
}

/** 写入 Agent stdout/stderr 日志；失败不抛错，返回是否成功 */
export function writeAgentLogFile(logFile, stdout, stderr) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.writeFileSync(logFile, `${stdout}\n--- stderr ---\n${stderr}`, 'utf-8')
    return true
  } catch (err) {
    console.warn(`Agent log write failed (${logFile}):`, err.message)
    return false
  }
}

/** 确保 OpenClaw workspace 目录存在（Windows 路径兼容） */
export function ensureWorkspaceDir(workspace) {
  const dir = (workspace || '').trim()
  if (!dir) return false
  fs.mkdirSync(dir, { recursive: true })
  return true
}

/**
 * 同步 openclaw.json 中已注册 Agent 的 workspace / agentDir
 * 用于重新初始化时修正仍指向 OPENCLAW_DEFAULT_WORKSPACE 的旧配置
 */
export function syncOpenClawAgentRegistry(agentName, { workspace, agentDir }) {
  const id = sanitizeAgentId(agentName)
  if (!id) return false

  const cfgPath = resolveOpenClawConfigPath()
  if (!fs.existsSync(cfgPath)) return false

  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    const list = Array.isArray(cfg.agents?.list) ? cfg.agents.list : []
    const idx = list.findIndex(a => a.id === id || a.name === id)
    if (idx < 0) return false

    if (workspace) list[idx].workspace = workspace
    if (agentDir) list[idx].agentDir = agentDir
    cfg.agents = { ...cfg.agents, list }
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8')
    return true
  } catch (err) {
    console.warn(`syncOpenClawAgentRegistry(${id}) failed:`, err.message)
    return false
  }
}
