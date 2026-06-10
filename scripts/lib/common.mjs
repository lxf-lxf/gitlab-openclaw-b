import { spawnSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform, arch } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '../..')

export function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  return pkg.version || '0.0.0'
}

export function platformTag() {
  const os = platform()
  const cpu = arch()
  if (os === 'darwin') return `darwin-${cpu}`
  if (os === 'win32') return `win32-${cpu}`
  return `linux-${cpu}`
}

export function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}`)
  }
  return result
}

export function runCapture(cmd, args = []) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${result.stderr || ''}`)
  }
  return (result.stdout || '').trim()
}

export function ensureNodeVersion(minMajor = 18) {
  const version = process.versions.node
  const major = parseInt(version.split('.')[0], 10)
  if (!Number.isFinite(major) || major < minMajor) {
    throw new Error(`Node.js >= ${minMajor} required, current: ${version}`)
  }
}

export function copyDir(src, dest, options = {}) {
  const { exclude = [] } = options
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(from, to, options)
    } else {
      fs.copyFileSync(from, to)
    }
  }
}

export function parseFlags(argv) {
  const flags = new Set()
  const args = []
  for (const item of argv) {
    if (item.startsWith('--')) flags.add(item)
    else args.push(item)
  }
  return { flags, args }
}

export function printHelp(title, sections) {
  console.log(`\n${title}\n`)
  for (const [heading, lines] of sections) {
    console.log(heading)
    for (const line of lines) console.log(`  ${line}`)
    console.log('')
  }
}

export function createArchive(sourceDir, outputFile) {
  const parent = path.dirname(sourceDir)
  const base = path.basename(sourceDir)
  fs.mkdirSync(path.dirname(outputFile), { recursive: true })

  if (process.platform === 'win32') {
    const zipPath = outputFile.endsWith('.zip') ? outputFile : `${outputFile}.zip`
    execSync(`tar -a -cf "${zipPath}" -C "${parent}" "${base}"`, { stdio: 'inherit', shell: true })
    return zipPath
  }

  const tarPath = outputFile.endsWith('.tar.gz') ? outputFile : `${outputFile}.tar.gz`
  execSync(`tar -czf "${tarPath}" -C "${parent}" "${base}"`, { stdio: 'inherit', shell: true })
  return tarPath
}
