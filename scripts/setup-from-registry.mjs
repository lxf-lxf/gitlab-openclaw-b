#!/usr/bin/env node
/**
 * 从 Verdaccio 一键初始化运行目录（对齐 init-bcenter-run-dir.sh）
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFlags, printHelp, ensureNodeVersion } from './lib/common.mjs'

const DEFAULT_REGISTRY = 'http://172.16.3.201:4873/'

const { flags, args } = parseFlags(process.argv.slice(2))

if (flags.has('--help') || flags.has('-h')) {
  printHelp('gitlab-b-center setup-from-registry', [
    ['用法:', ['npm run setup:from-registry -- --dir ./bcenter-run --version latest']],
    ['安装后:', [
      'cd bcenter-run',
      '编辑 .env / .env.example',
      'npx b-center start',
      'npm start  # 若 package.json 已配置'
    ]]
  ])
  process.exit(0)
}

function getArg(name, fallback = '') {
  const idx = args.indexOf(name)
  if (idx === -1 || !args[idx + 1]) return fallback
  return args[idx + 1]
}

const registry = (getArg('--registry') || process.env.NPM_REGISTRY || DEFAULT_REGISTRY).replace(/\/+$/, '/')
const version = getArg('--version', 'latest')
const installDir = path.resolve(getArg('--dir', path.join(process.cwd(), 'bcenter-run')))
const autoStart = flags.has('--start')

try {
  ensureNodeVersion(18)
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-bcenter-run-dir.sh')
  const env = {
    ...process.env,
    NPM_REGISTRY: registry,
    BCENTER_VERSION: version
  }
  const child = spawnSync('bash', [script, installDir], {
    stdio: 'inherit',
    env,
    cwd: process.cwd()
  })
  if (child.status !== 0) process.exit(child.status ?? 1)

  if (autoStart) {
    spawnSync('npx', ['b-center', 'start'], { cwd: installDir, stdio: 'inherit', shell: true })
  }
} catch (err) {
  console.error(`\n❌ Setup failed: ${err.message}`)
  process.exit(1)
}
