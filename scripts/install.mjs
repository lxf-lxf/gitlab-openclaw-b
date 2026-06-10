#!/usr/bin/env node
/**
 * 跨平台一键安装 — 安装生产依赖、初始化 .env
 *
 * 用法:
 *   node scripts/install.mjs [--offline]
 *   ./bin/install
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, ensureNodeVersion, run, parseFlags, printHelp
} from './lib/common.mjs'
import { ensureEnvFiles, syncEnvToDir } from './lib/env-setup.mjs'

const { flags } = parseFlags(process.argv.slice(2))

if (flags.has('--help') || flags.has('-h')) {
  printHelp('gitlab-b-center install', [
    ['用法:', [
      'node scripts/install.mjs [options]',
      './bin/install        (Linux/macOS)',
      'bin\\install.cmd      (Windows)'
    ]],
    ['选项:', [
      '--offline    跳过 npm install（发布包已含 node_modules 时使用）',
      '--help, -h   显示帮助'
    ]]
  ])
  process.exit(0)
}

const offline = flags.has('--offline')

try {
  console.log('\n📥 Installing gitlab-b-center...\n')

  ensureNodeVersion(18)

  const { envExample, envPath, envCreated } = ensureEnvFiles(ROOT)
  console.log(`→ .env.example ready: ${envExample}`)
  if (envCreated) {
    console.log(`→ Created .env from .env.example — please edit before production use`)
  } else {
    console.log(`→ .env already exists: ${envPath}`)
  }

  // 若从安装根目录执行，同步 .env 模板到上级目录
  const parentDir = path.resolve(ROOT, '../..')
  if (!parentDir.includes('node_modules') && fs.existsSync(path.join(parentDir, 'package.json'))) {
    try {
      syncEnvToDir(parentDir, ROOT)
      console.log(`→ Synced .env.example to install dir: ${parentDir}`)
    } catch { /* ignore */ }
  }

  const hasModules = fs.existsSync(path.join(ROOT, 'node_modules'))
  if (offline) {
    if (!hasModules) {
      throw new Error('--offline specified but node_modules not found. Run without --offline or use --with-deps package.')
    }
    console.log('→ Offline mode: using bundled node_modules')
  } else {
    console.log('→ Installing production dependencies (npm ci --omit=dev)...')
    if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
      run('npm', ['ci', '--omit=dev'], { cwd: ROOT })
    } else {
      run('npm', ['install', '--omit=dev'], { cwd: ROOT })
    }
  }

  const hasFrontend = fs.existsSync(path.join(ROOT, 'dist/web/index.html'))
  if (!hasFrontend) {
    console.warn('→ Warning: dist/web not found. Run npm run build or use a full release package.')
  }

  console.log('\n✅ Install complete!\n')
  console.log('Next steps:')
  console.log('  1. Edit .env with your database / Redis / OpenClaw settings')
  console.log('  2. Start the service:')
  console.log('     npm start')
  console.log(process.platform === 'win32' ? '     bin\\start.cmd' : '     ./bin/start')
  console.log('')
} catch (err) {
  console.error(`\n❌ Install failed: ${err.message}`)
  process.exit(1)
}
