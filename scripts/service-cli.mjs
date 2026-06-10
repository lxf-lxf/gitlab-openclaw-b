import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { getInstallTargetDir } from './init-env.mjs'
import { findListeningPids } from './lib/port-listeners.mjs'
import { getPackageRoot } from './lib/package-root.mjs'
import { getEnvPaths, needsSetup, resolveConfigDir } from './lib/env-file.mjs'

const META = {
  envFile: '.env',
  pidFile: '.b-center.pid',
  logFile: 'logs/b-center.log',
  defaultPort: 3000,
  label: 'gitlab-b-center'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function serverEntry() {
  return path.join(getPackageRoot(), 'server/index.js')
}

function resolveEnvPath() {
  const { envPath } = getEnvPaths(resolveConfigDir())
  return envPath
}

function loadDeployEnv(envPath) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
  return envPath
}

async function ensureConfiguredBeforeStart() {
  const envPath = resolveEnvPath()
  if (!fs.existsSync(envPath)) {
    console.error(`❌ 未找到 .env，请先运行: npx b-center setup`)
    process.exit(1)
  }
  if (needsSetup(envPath)) {
    if (process.stdin.isTTY) {
      console.log('→ 检测到首次启动，进入配置向导...\n')
      const { runSetupWizard } = await import('./setup-wizard.mjs')
      await runSetupWizard({ configDir: resolveConfigDir() })
      return resolveEnvPath()
    }
    console.error('❌ 尚未完成配置，请运行: npx b-center setup')
    process.exit(1)
  }
  return envPath
}

function resolvePort() {
  const raw = process.env.PORT?.trim()
  const n = raw ? Number(raw) : META.defaultPort
  return Number.isFinite(n) && n > 0 ? n : META.defaultPort
}

function readPid(pidFile) {
  if (!fs.existsSync(pidFile)) return null
  const n = Number(String(fs.readFileSync(pidFile, 'utf8')).trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killProcessTree(pid) {
  if (pid === process.pid) return
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } catch { /* gone */ }
    return
  }
  try { process.kill(pid, 'SIGTERM') } catch { return }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && isAlive(pid)) { /* wait */ }
  try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
}

function killPortListeners(port) {
  for (const pid of findListeningPids(port)) {
    killProcessTree(pid)
  }
}

async function waitPortFree(port, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (findListeningPids(port).length === 0) return true
    await sleep(250)
  }
  return findListeningPids(port).length === 0
}

function isServiceRunning(root) {
  const pid = readPid(path.join(root, META.pidFile))
  return pid != null && isAlive(pid)
}

async function cmdStop(root) {
  const pidFile = path.join(root, META.pidFile)
  loadDeployEnv(resolveEnvPath())
  const port = resolvePort()

  const pid = readPid(pidFile)
  if (pid != null && isAlive(pid)) {
    killProcessTree(pid)
    for (let i = 0; i < 20; i++) {
      if (!isAlive(pid)) break
      await sleep(250)
    }
  }

  killPortListeners(port)
  await waitPortFree(port, 8000)
  fs.rmSync(pidFile, { force: true })
  console.log(`[${META.label}] 已停止（端口 ${port}）`)
}

async function cmdStart(root, fg = false) {
  const pidFile = path.join(root, META.pidFile)
  const logFile = path.join(root, META.logFile)
  const envPath = await ensureConfiguredBeforeStart()
  loadDeployEnv(envPath)

  const port = resolvePort()

  if (isServiceRunning(root)) {
    console.log(`[${META.label}] 已在运行 PID=${readPid(pidFile)}`)
    return
  }

  const listeners = findListeningPids(port)
  if (listeners.length > 0) {
    console.log(`[${META.label}] 端口 ${port} 被占用 (PID ${listeners.join(', ')})，正在释放…`)
    killPortListeners(port)
    if (!(await waitPortFree(port, 8000))) {
      console.error(`[${META.label}] 端口 ${port} 仍被占用，请先 npx b-center stop`)
      process.exit(1)
    }
  }

  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })

  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    DOTENV_CONFIG_PATH: envPath,
    INIT_CWD: root
  }

  const entry = serverEntry()

  if (fg) {
    console.log(`[${META.label}] 前台运行 http://0.0.0.0:${port}/ （Ctrl+C 退出）`)
    const child = spawn(process.execPath, [entry], {
      cwd: getPackageRoot(),
      env: childEnv,
      stdio: 'inherit'
    })
    child.on('exit', code => process.exit(code ?? 0))
    return
  }

  const logFd = fs.openSync(logFile, 'a')
  const child = spawn(process.execPath, [entry], {
    cwd: getPackageRoot(),
    env: childEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  })
  child.unref()
  fs.closeSync(logFd)

  const childPid = child.pid
  if (childPid == null) {
    console.error(`[${META.label}] 启动失败：未获得子进程 PID`)
    process.exit(1)
  }

  fs.writeFileSync(pidFile, String(childPid))
  await sleep(800)

  if (!isAlive(childPid)) {
    fs.rmSync(pidFile, { force: true })
    console.error(`[${META.label}] 启动失败，请查看 ${logFile}`)
    process.exit(1)
  }

  console.log(`[${META.label}] 已后台启动 PID=${childPid}`)
  console.log(`  访问: http://0.0.0.0:${port}/`)
  console.log(`  日志: ${logFile}`)
}

async function cmdStatus(root) {
  const pidFile = path.join(root, META.pidFile)
  loadDeployEnv(resolveEnvPath())
  const port = resolvePort()
  const pid = readPid(pidFile)

  if (pid != null && isAlive(pid)) {
    console.log(`[${META.label}] 运行中 PID=${pid}  端口=${port}  日志=${path.join(root, META.logFile)}`)
    return 0
  }
  fs.rmSync(pidFile, { force: true })
  const listeners = findListeningPids(port)
  if (listeners.length > 0) {
    console.log(`[${META.label}] PID 无效，但端口 ${port} 仍被占用 (PID ${listeners.join(', ')})`)
    console.log('  建议: npx b-center stop')
    return 2
  }
  console.log(`[${META.label}] 未运行`)
  return 1
}

function printUsage() {
  console.log(`用法: npx b-center <command>

  setup     引导式交互配置 .env（首次安装推荐）
  init      生成 .env / .env.example / 启停脚本
  start     后台启动（默认，首次自动进入 setup）
  stop      停止（按 PID + 释放端口）
  restart   先 stop 再 start
  status    查看状态
  fg        前台启动
  run       内部：直接启动服务
  help      显示本帮助

Windows / Linux / macOS 均可用 npx；Linux 也可 ./start-b-center.sh start`)
}

export async function runServiceCli(action) {
  const root = getInstallTargetDir()
  const cmd = action.toLowerCase()

  switch (cmd) {
    case 'start':
      await cmdStart(root, false)
      break
    case 'fg':
    case 'foreground':
      await cmdStart(root, true)
      break
    case 'stop':
      await cmdStop(root)
      break
    case 'restart':
      await cmdStop(root)
      await cmdStart(root, false)
      break
    case 'status': {
      const code = await cmdStatus(root)
      process.exitCode = code
      break
    }
    case 'help':
    case '-h':
    case '--help':
      printUsage()
      break
    default:
      console.error(`未知命令: ${action}`)
      printUsage()
      process.exit(1)
  }
}

export async function runServer() {
  const envPath = await ensureConfiguredBeforeStart()
  process.env.DOTENV_CONFIG_PATH = envPath
  process.env.NODE_ENV = process.env.NODE_ENV || 'production'
  const { pathToFileURL } = await import('node:url')
  await import(pathToFileURL(path.join(getPackageRoot(), 'server/index.js')).href)
}
