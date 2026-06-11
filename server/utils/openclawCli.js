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

/** OpenClaw 全局扩展目录：~/.openclaw/extensions/ */
const OPENCLAW_EXTENSIONS_DIR = path.join(os.homedir(), '.openclaw', 'extensions')

/** 长消息包装脚本路径（绕过 Windows 命令行长度限制） */
const AGENT_RUNNER_PATH = path.resolve(__dirname, 'openclaw-agent-runner.mjs')

/** gitlab-tools 插件标准 package.json */
const GITLAB_TOOLS_PACKAGE_JSON = {
  name: 'gitlab-tools',
  version: '1.0.0',
  type: 'module',
  main: 'gitlab-tools.js',
  private: true,
  openclaw: {
    extensions: ['./gitlab-tools.js']
  }
}

/**
 * 将 gitlab-tools 插件同步到目标目录，并修复 package.json
 * @param {string} targetDir - 目标目录（agent plugins 或 extensions）
 */
function syncGitlabToolsTo(targetDir) {
  const pluginDir = path.join(targetDir, GITLAB_PLUGIN_ID)
  fs.mkdirSync(pluginDir, { recursive: true })

  // 复制插件代码
  if (fs.existsSync(GITLAB_TOOLS_SRC)) {
    fs.copyFileSync(GITLAB_TOOLS_SRC, path.join(pluginDir, 'gitlab-tools.js'))
  }
  // 复制插件清单
  if (fs.existsSync(GITLAB_TOOLS_MANIFEST)) {
    fs.copyFileSync(GITLAB_TOOLS_MANIFEST, path.join(pluginDir, 'openclaw.plugin.json'))
  }
  // 覆写 package.json（含 type: module + openclaw.extensions，Gateway 发现必需）
  fs.writeFileSync(path.join(pluginDir, 'package.json'),
    JSON.stringify(GITLAB_TOOLS_PACKAGE_JSON, null, 2) + '\n', 'utf-8')
}

/** 将 gitlab-tools 插件以 OpenClaw 可识别格式部署到 agentDir/plugins/<id>/ 和 ~/.openclaw/extensions/ */
export function syncGitlabToolsPlugin(agentDir) {
  // 写入 agent 内部 plugins 目录（旧版兼容）
  syncGitlabToolsTo(path.join(agentDir, 'plugins'))

  // 写入全局扩展目录（Gateway 扫描目录）
  syncGitlabToolsTo(OPENCLAW_EXTENSIONS_DIR)
}

/** 仅同步 gitlab-tools 插件到全局扩展目录（~/.openclaw/extensions/），供 B 端启动时调用 */
export function syncGitlabToolsExtensions() {
  syncGitlabToolsTo(OPENCLAW_EXTENSIONS_DIR)
}

/**
 * 确保 openclaw.json 中 gitlab-tools 插件配置存在且正确
 *
 * 写入 plugins.entries.gitlab-tools.enabled = true
 * 以及 gitlabBaseUrl / gitlabToken 配置
 */
export function syncGitlabPluginOpenClawConfig(gitlabBaseUrl, gitlabToken) {
  const cfgPath = resolveOpenClawConfigPath()
  if (!fs.existsSync(cfgPath)) return false

  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    cfg.plugins = cfg.plugins || {}
    cfg.plugins.entries = cfg.plugins.entries || {}

    const entry = cfg.plugins.entries['gitlab-tools'] || {}
    entry.enabled = true
    entry.config = entry.config || {}

    // 只覆写空值（已有值不覆盖，避免覆盖用户手动修改）
    if (gitlabBaseUrl && !entry.config.gitlabBaseUrl) {
      entry.config.gitlabBaseUrl = gitlabBaseUrl
    }
    if (gitlabToken && !entry.config.gitlabToken) {
      entry.config.gitlabToken = gitlabToken
    }

    cfg.plugins.entries['gitlab-tools'] = entry
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8')
    return true
  } catch (err) {
    console.warn(`[openclawCli] syncGitlabPluginOpenClawConfig 失败: ${err.message}`)
    return false
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
 * Windows 上查找 openclaw.mjs 的绝对路径
 *
 * 策略：
 * 1. bin 本身是 .mjs → 直接返回
 * 2. bin 是绝对路径的 .cmd/.bat → 同级 node_modules 或解析 CMD 内容提取 mjs 路径
 * 3. 用 where 命令在 PATH 中定位实际二进制 → 推导 mjs 或解析 CMD 内容
 * 4. 常见包管理器全局安装目录（npm、pnpm）
 * 5. 当前工作目录 node_modules
 *
 * 返回 null 表示未找到，由调用方降级。
 */
function resolveWin32MjsPath(bin) {
  if (!IS_WIN) return null

  const lower = bin.toLowerCase()

  // 1. bin 本身已是 .mjs
  if (lower.endsWith('.mjs') && fs.existsSync(bin)) return bin

  // 2. bin 是绝对路径的 .cmd/.bat
  if (path.isAbsolute(bin) && fs.existsSync(bin)) {
    const dir = path.dirname(bin)
    const mjs = path.join(dir, 'node_modules', 'openclaw', 'openclaw.mjs')
    if (fs.existsSync(mjs)) return mjs

    // pnpm 等包管理器的 .CMD 包装器内嵌 mjs 绝对路径，解析提取
    try {
      const cmdContent = fs.readFileSync(bin, 'utf-8')
      const match = cmdContent.match(/node\s+"%~dp0\\([^"]+\\openclaw\.mjs)"/i)
      if (match) {
        const mjsFromCmd = path.join(dir, match[1].replace(/\\/g, path.sep))
        if (fs.existsSync(mjsFromCmd)) return mjsFromCmd
      }
    } catch { /* ignore, fall through */ }
  }

  // 3. 用 where 命令定位实际二进制（精准可靠）
  try {
    const where = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'where', bin], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 5000
    })
    if (where.status === 0 && where.stdout) {
      const actualPath = where.stdout.trim().split(/\r?\n/)[0]?.trim()
      if (actualPath && fs.existsSync(actualPath)) {
        const dir = path.dirname(actualPath)
        const mjs = path.join(dir, 'node_modules', 'openclaw', 'openclaw.mjs')
        if (fs.existsSync(mjs)) return mjs

        // .cmd/.bat 包装器解析内嵌 mjs 路径
        const actualLower = actualPath.toLowerCase()
        if (actualLower.endsWith('.cmd') || actualLower.endsWith('.bat')) {
          try {
            const cmdContent = fs.readFileSync(actualPath, 'utf-8')
            const match = cmdContent.match(/node\s+"%~dp0\\([^"]+\\openclaw\.mjs)"/i)
            if (match) {
              const mjsFromCmd = path.join(dir, match[1].replace(/\\/g, path.sep))
              if (fs.existsSync(mjsFromCmd)) return mjsFromCmd
            }
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore, fall through */ }

  // 4. 常见包管理器全局安装目录（npm、pnpm）
  const npmDirs = []
  if (process.env.APPDATA) npmDirs.push(path.join(process.env.APPDATA, 'npm'))
  if (process.env.LOCALAPPDATA) {
    npmDirs.push(path.join(process.env.LOCALAPPDATA, 'npm'))
    npmDirs.push(path.join(process.env.LOCALAPPDATA, 'pnpm'))  // pnpm 全局目录
  }
  for (const npmDir of npmDirs) {
    const mjs = path.join(npmDir, 'node_modules', 'openclaw', 'openclaw.mjs')
    if (fs.existsSync(mjs)) return mjs

    // pnpm 全局目录结构: global/5/.pnpm/openclaw@<version>/node_modules/openclaw/openclaw.mjs
    try {
      const globalDir = path.join(npmDir, 'global')
      if (fs.existsSync(globalDir)) {
        for (const ver of fs.readdirSync(globalDir)) {
          const pnpmStore = path.join(globalDir, ver, '.pnpm')
          if (!fs.existsSync(pnpmStore)) continue
          for (const entry of fs.readdirSync(pnpmStore)) {
            if (!entry.startsWith('openclaw@')) continue
            const candidate = path.join(pnpmStore, entry, 'node_modules', 'openclaw', 'openclaw.mjs')
            if (fs.existsSync(candidate)) return candidate
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 5. 当前工作目录下的 node_modules
  const localMjs = path.join(process.cwd(), 'node_modules', 'openclaw', 'openclaw.mjs')
  if (fs.existsSync(localMjs)) return localMjs

  return null
}

/**
 * 查找 openclaw.mjs 的绝对路径（跨平台）
 * @returns {string|null} mjs 路径，未找到返回 null
 */
function resolveOpenClawMjsPath() {
  const bin = configuredBin()
  const lower = bin.toLowerCase()
  if (lower.endsWith('.mjs') && fs.existsSync(bin)) return bin
  if (IS_WIN) return resolveWin32MjsPath(bin)
  return null
}

/**
 * 解析跨平台 OpenClaw 调用方式
 *
 * Windows 上的关键优化：找到 openclaw.mjs 后用 node.exe 直接执行，
 * 绕过 cmd.exe 的 8K 命令行长度限制，避免长消息被截断。
 */
export function resolveOpenClawInvocation(cliArgs = []) {
  const bin = configuredBin()
  const lower = bin.toLowerCase()

  if (IS_WIN && lower.endsWith('.ps1')) {
    return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bin, ...cliArgs] }
  }

  // 优先：找到 .mjs 文件直接跑，绕过 cmd.exe 的 8K 命令行限制
  const mjs = resolveOpenClawMjsPath()
  if (mjs) {
    return { command: process.execPath, args: [mjs, ...cliArgs] }
  }

  if (IS_WIN) {
    console.warn(`[openclawCli] Windows 未找到 openclaw.mjs（bin=${bin}），回退到 cmd.exe 可能导致长消息截断`)
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
 * 通过文件传递消息启动 OpenClaw Agent（跨平台）
 *
 * 原理：将 message 写入临时文件后，通过以下方式传递：
 * - Unix: 读取文件内容，通过 spawn args 直接作为 --message 参数值传入
 * - Windows: 使用包装脚本 openclaw-agent-runner.mjs 从文件读取消息，
 *   通过 process.argv 注入并 import(openclaw.mjs) 执行
 *
 * Windows 上始终走包装脚本（消息通过文件传递，完全不经过命令行参数），
 * 彻底避免 CreateProcess 命令行编码/转义问题导致的乱码。
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

  // 没有 msgFile 则写入临时文件，调用方通过 cleanup() 清理
  if (!msgFile) {
    if (!message) throw new Error('spawnAgentWithMessage: 必须提供 message 或 msgFile')
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcenter-msg-'))
    msgFile = path.join(tempDir, 'message.txt')
    fs.writeFileSync(msgFile, message, 'utf-8')
  }

  /** 如果创建了临时目录，调用此函数清理 */
  const cleanup = tempDir
    ? () => { try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {} }
    : () => {}

  // ── Windows：始终走包装脚本，消息通过文件传递，避免命令行编码问题 ──
  if (IS_WIN) {
    const mjsPath = resolveOpenClawMjsPath()
    if (mjsPath && fs.existsSync(AGENT_RUNNER_PATH)) {
      const runnerArgs = [
        '--message-file', msgFile,
        '--',
        mjsPath,
        'agent', '--agent', cliName, '--session-key', sessionKey,
        '--message', '__OPENCLAW_MSG_PLACEHOLDER__',
        ...extraArgs
      ]
      const child = spawn(process.execPath, [AGENT_RUNNER_PATH, ...runnerArgs], defaultSpawnOptions(spawnOptions))
      return { child, cleanup, msgFile }
    }
    // 降级：未找到 mjs 或 runner，回退到命令行传参（可能截断或乱码）
    console.warn(`[openclawCli] Windows 缺少包装脚本或 mjs，消息含中文时可能出现乱码`)
    const msgContent = fs.readFileSync(msgFile, 'utf-8')
    const allArgs = ['agent', '--agent', cliName, '--session-key', sessionKey, '--message', msgContent, ...extraArgs]
    const child = spawnOpenClaw(allArgs, spawnOptions)
    return { child, cleanup, msgFile }
  }

  // ── Unix：直接读取文件内容，通过 spawn args 传递（无 shell，无编码问题） ──
  const msgContent = fs.readFileSync(msgFile, 'utf-8')
  const allArgs = ['agent', '--agent', cliName, '--session-key', sessionKey, '--message', msgContent, ...extraArgs]
  const child = spawnOpenClaw(allArgs, spawnOptions)
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
 *
 * @param {string} cliName - Agent CLI 名称
 * @param {object|null} template - Agent 模板（可选）
 * @param {object} [gitlabConfig] - GitLab 连接配置（从 DB 读取）
 * @param {string} [gitlabConfig.gitlabBaseUrl] - GitLab 实例 URL
 * @param {string} [gitlabConfig.gitlabToken] - GitLab Token
 */
export function prepareAgentRuntime(cliName, template = null, gitlabConfig = null) {
  const agentDir = resolveAgentDir(cliName)
  const workspace = resolveAgentRuntimeWorkspace(template, cliName)
  ensureWorkspaceDir(agentDir)
  ensureWorkspaceDir(workspace)

  // 同步 gitlab-tools 插件到 agent plugins/ 和 ~/.openclaw/extensions/
  syncGitlabToolsPlugin(agentDir)

  // 同步 GitLab 连接配置到 openclaw.json
  if (gitlabConfig?.gitlabBaseUrl || gitlabConfig?.gitlabToken) {
    syncGitlabPluginOpenClawConfig(gitlabConfig.gitlabBaseUrl, gitlabConfig.gitlabToken)
  }

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
