#!/usr/bin/env node
/**
 * 跨平台一键启动 — 生产模式启动后端（同时托管前端静态资源）
 *
 * 用法:
 *   npm start
 *   node scripts/start.mjs
 *   ./bin/start
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, ensureNodeVersion, parseFlags, printHelp
} from './lib/common.mjs'
import { resolveEnvPath } from './lib/env-setup.mjs'

const { flags } = parseFlags(process.argv.slice(2))

if (flags.has('--help') || flags.has('-h')) {
  printHelp('gitlab-b-center start', [
    ['用法:', [
      'npm start',
      'node scripts/start.mjs',
      './bin/start        (Linux/macOS)',
      'bin\\start.cmd      (Windows)'
    ]],
    ['说明:', [
      '生产模式启动 Node.js 服务，API 与前端同端口',
      '自动读取包目录或安装根目录下的 .env'
    ]]
  ])
  process.exit(0)
}

const serverEntry = path.join(ROOT, 'server/index.js')

function hasDependencies() {
  if (fs.existsSync(path.join(ROOT, 'node_modules', 'koa'))) return true
  // npm 安装后依赖可能提升到 node_modules/gitlab-b-center/../
  if (fs.existsSync(path.join(ROOT, '..', 'koa'))) return true
  return false
}

try {
  ensureNodeVersion(18)

  const envFile = resolveEnvPath(ROOT)
  if (!envFile) {
    console.error('❌ .env not found. Run install first:')
    console.error('   npm run install:app')
    console.error(process.platform === 'win32' ? '   bin\\install.cmd' : '   ./bin/install')
    process.exit(1)
  }

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server entry not found: ${serverEntry}`)
  }

  if (!hasDependencies()) {
    console.error('❌ Dependencies not found. Run install first:')
    console.error('   npm run install:app')
    process.exit(1)
  }

  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
    DOTENV_CONFIG_PATH: envFile
  }

  console.log('\n🚀 Starting gitlab-b-center (production)...')
  console.log(`   Config: ${envFile}\n`)

  const child = spawn(process.execPath, [serverEntry], {
    cwd: ROOT,
    env,
    stdio: 'inherit'
  })

  const shutdown = (signal) => {
    console.log(`\n→ Received ${signal}, shutting down...`)
    child.kill(signal)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`\n→ Process stopped (${signal})`)
      process.exit(0)
    }
    process.exit(code ?? 1)
  })
} catch (err) {
  console.error(`\n❌ Start failed: ${err.message}`)
  process.exit(1)
}
