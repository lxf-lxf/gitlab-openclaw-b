#!/usr/bin/env node
/**
 * 引导式交互配置 .env
 * 用法: npx b-center setup
 */
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { getPackageRoot } from './lib/package-root.mjs'
import {
  getEnvPaths, parseEnvFile, writeEnvFile, needsSetup, resolveConfigDir
} from './lib/env-file.mjs'

const FIELDS = [
  {
    section: '服务',
    items: [
      { key: 'PORT', label: '服务端口', default: '3000' },
      { key: 'NODE_ENV', label: '运行环境 (development/production)', default: 'production' }
    ]
  },
  {
    section: 'MySQL 数据库',
    items: [
      { key: 'DB_HOST', label: '数据库地址', default: '127.0.0.1' },
      { key: 'DB_PORT', label: '数据库端口', default: '3306' },
      { key: 'DB_USER', label: '数据库用户', default: 'root' },
      { key: 'DB_PASSWORD', label: '数据库密码', default: '', secret: true },
      { key: 'DB_NAME', label: '数据库名', default: 'gitlab_b_center' }
    ]
  },
  {
    section: 'Redis',
    items: [
      { key: 'REDIS_HOST', label: 'Redis 地址', default: '127.0.0.1' },
      { key: 'REDIS_PORT', label: 'Redis 端口', default: '6379' },
      { key: 'REDIS_PASSWORD', label: 'Redis 密码（无则回车）', default: '' },
      { key: 'REDIS_KEY_PREFIX', label: 'Redis 键前缀', default: 'bcenter:' }
    ]
  },
  {
    section: 'GitLab',
    items: [
      { key: 'GITLAB_BASE_URL', label: 'GitLab API 地址', default: 'https://gitlab.com/api/v4' },
      { key: 'WEBHOOK_BASE_URL', label: 'Webhook 回调根地址（GitLab 能访问的本机地址）', default: 'http://127.0.0.1:3000' }
    ]
  },
  {
    section: 'OpenClaw',
    items: [
      { key: 'OPENCLAW_BIN', label: 'OpenClaw CLI 路径', default: 'openclaw' },
      { key: 'OPENCLAW_AGENTS_DIR', label: 'Agent 目录（留空用默认）', default: '' },
      { key: 'OPENCLAW_DEFAULT_WORKSPACE', label: '默认工作空间路径', default: '' },
      { key: 'OPENCLAW_DEFAULT_MODEL', label: '默认 AI 模型', default: 'deepseek/deepseek-v4-flash' }
    ]
  }
]

async function ask(rl, item, current) {
  const def = current[item.key] ?? item.default ?? ''
  const secret = item.secret ? ' (输入可见)' : ''
  const hint = def !== '' ? ` [${item.secret ? '****' : def}]` : ''
  const answer = await rl.question(`  ${item.label}${secret}${hint}: `)
  if (item.secret && !answer.trim()) return def
  return answer.trim() || def
}

async function testDatabase(values) {
  try {
    const conn = await mysql.createConnection({
      host: values.DB_HOST,
      port: Number(values.DB_PORT) || 3306,
      user: values.DB_USER,
      password: values.DB_PASSWORD || undefined,
      database: values.DB_NAME,
      connectTimeout: 8000
    })
    await conn.ping()
    await conn.end()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function runSetupWizard(options = {}) {
  const force = options.force === true
  const configDir = options.configDir || resolveConfigDir()
  const packageRoot = getPackageRoot()

  if (!fs.existsSync(path.join(configDir, '.env.example'))) {
    const src = path.join(packageRoot, '.env.example')
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(configDir, '.env.example'))
    }
  }

  const { envPath, envExamplePath } = getEnvPaths(configDir)

  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath)
  }

  if (!force && !needsSetup(envPath)) {
    console.log(`\n✓ 配置已完成: ${envPath}`)
    console.log('  重新配置: npx b-center setup --force\n')
    return { envPath, skipped: true }
  }

  if (!process.stdin.isTTY && !options.forceInteractive) {
    console.log('\n非交互终端，请手动编辑 .env 或在本机执行: npx b-center setup\n')
    return { envPath, skipped: true }
  }

  const current = {
    ...parseEnvFile(envExamplePath),
    ...parseEnvFile(envPath)
  }

  const rl = readline.createInterface({ input, output })

  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║   GitLab B 端中台 — 首次配置向导             ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log(`\n配置文件: ${envPath}`)
  console.log('直接回车使用方括号中的默认值\n')

  const values = { ...current }

  for (const group of FIELDS) {
    console.log(`── ${group.section} ──`)
    for (const item of group.items) {
      values[item.key] = await ask(rl, item, values)
    }
    console.log('')
  }

  if (values.WEBHOOK_BASE_URL.match(/:\d+$/) && values.PORT !== '3000') {
    const suggested = values.WEBHOOK_BASE_URL.replace(/:\d+$/, `:${values.PORT}`)
    const fix = await rl.question(`  Webhook 地址是否改为 ${suggested}? [Y/n]: `)
    if (!fix.trim() || /^y(es)?$/i.test(fix)) {
      values.WEBHOOK_BASE_URL = suggested
    }
  }

  console.log('── 连接测试 ──')
  const test = await rl.question('  测试 MySQL 连接? [Y/n]: ')
  if (!test.trim() || /^y(es)?$/i.test(test)) {
    process.stdout.write('  正在连接...')
    const result = await testDatabase(values)
    console.log(result.ok ? ' ✓ 成功\n' : ` ✗ 失败: ${result.error}\n`)
  } else {
    console.log('')
  }

  values.BCENTER_SETUP_DONE = '1'
  writeEnvFile(envPath, values, envExamplePath)
  rl.close()

  console.log('╔══════════════════════════════════════════════╗')
  console.log('║   配置已保存                                 ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log(`\n  ${envPath}\n`)
  console.log('下一步:')
  console.log('  1. 启动: npx b-center start  或  npm start')
  console.log('  2. 浏览器: http://localhost:' + (values.PORT || '3000'))
  console.log('  3. 系统设置 → 填写 GitLab Token → 同步项目\n')

  return { envPath, values, skipped: false }
}
