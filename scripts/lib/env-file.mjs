import fs from 'node:fs'
import path from 'node:path'
import { getPackageRoot } from './package-root.mjs'
import { isDevSourceTree } from './env-setup.mjs'

const PLACEHOLDER_MARKERS = [
  '/path/to/workspace',
  'BCENTER_SETUP_DONE=0'
]

/** 配置目录：开发源码用包根目录，npm 安装用 INIT_CWD */
export function resolveConfigDir() {
  const root = getPackageRoot()
  const cwd = process.env.INIT_CWD?.trim() || process.cwd()

  if (isDevSourceTree(root)) {
    return root
  }
  if (fs.existsSync(path.join(cwd, '.env')) || fs.existsSync(path.join(cwd, '.env.example'))) {
    return cwd
  }
  return cwd
}

export function getEnvPaths(configDir = resolveConfigDir()) {
  return {
    configDir,
    envPath: path.join(configDir, '.env'),
    envExamplePath: path.join(configDir, '.env.example')
  }
}

export function parseEnvFile(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let val = trimmed.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    values[key] = val
  }
  return values
}

export function writeEnvFile(envPath, values, templatePath) {
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')

  const lines = template.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const idx = trimmed.indexOf('=')
    if (idx <= 0) return line
    const key = trimmed.slice(0, idx).trim()
    if (!(key in values)) return line
    const val = values[key] ?? ''
    return `${key}=${val}`
  })

  if (!('BCENTER_SETUP_DONE' in values)) {
    lines.push('BCENTER_SETUP_DONE=1')
  } else {
    const hasMarker = lines.some(l => l.startsWith('BCENTER_SETUP_DONE='))
    if (!hasMarker) lines.push(`BCENTER_SETUP_DONE=${values.BCENTER_SETUP_DONE || '1'}`)
  }

  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, lines.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n') + '\n', 'utf8')
}

export function needsSetup(envPath) {
  if (!fs.existsSync(envPath)) return true
  const content = fs.readFileSync(envPath, 'utf8')
  const values = parseEnvFile(envPath)
  if (values.BCENTER_SETUP_DONE === '1') return false
  if (PLACEHOLDER_MARKERS.some(m => content.includes(m))) return true
  // 已填写实质配置（无占位符）视为已完成
  if (values.DB_HOST && values.DB_NAME && values.BCENTER_SETUP_DONE === '0') {
    return true
  }
  if (values.DB_HOST && values.DB_NAME && !content.includes('/path/to/workspace')) {
    return false
  }
  return true
}
