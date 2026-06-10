#!/usr/bin/env node
/**
 * 生成 Linux / Windows 离线发布包（参考 cursor-acp-gateway/scripts/package-release.mjs）
 * 用法: npm run pack
 * 可选: RELEASE_TARGETS=linux-amd64,win-amd64  SKIP_BUILD=1
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, readVersion, run, parseFlags, printHelp } from './lib/common.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templatesDir = path.join(__dirname, 'release-templates')
const version = process.env.RELEASE_VERSION || readVersion()

const TARGETS = {
  'linux-amd64': { id: 'linux-amd64', npmOs: 'linux', npmCpu: 'x64', archive: 'tar.gz' },
  'win-amd64': { id: 'win-amd64', npmOs: 'win32', npmCpu: 'x64', archive: 'zip' }
}

const { flags } = parseFlags(process.argv.slice(2))

if (flags.has('--help') || flags.has('-h')) {
  printHelp('gitlab-b-center pack', [
    ['用法:', ['npm run pack', 'RELEASE_TARGETS=linux-amd64 npm run pack']],
    ['选项:', [
      'RELEASE_TARGETS  默认 linux-amd64,win-amd64',
      'SKIP_BUILD=1     跳过 npm run build',
      '--with-deps      同 RELEASE 内 npm install（默认会执行）'
    ]],
    ['npm 私服部署:', [
      'bash scripts/publish-private-npm.sh',
      'bash scripts/init-bcenter-run-dir.sh ./bcenter-run'
    ]]
  ])
  process.exit(0)
}

const targetIds = (process.env.RELEASE_TARGETS || 'linux-amd64,win-amd64')
  .split(',').map(s => s.trim()).filter(Boolean)

function chmodExec(p) {
  fs.chmodSync(p, 0o755)
}

function copyExec(src, dest) {
  fs.copyFileSync(src, dest)
  chmodExec(dest)
}

function ensureBuild() {
  if (process.env.SKIP_BUILD === '1' || process.env.skip_build) return
  console.log('==> 构建前端')
  run('npm', ['run', 'build'])
  if (!fs.existsSync(path.join(ROOT, 'dist/web/index.html'))) {
    throw new Error('dist/web/index.html 缺失')
  }
}

function assembleApp(releaseRoot) {
  const appDir = path.join(releaseRoot, 'app')
  mkdir(appDir)
  for (const dir of ['server', 'dist', 'scripts', 'bin']) {
    cp(path.join(ROOT, dir), path.join(appDir, dir))
  }
  for (const f of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f))
  }
}

function mkdir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function cp(src, dest) {
  fs.cpSync(src, dest, { recursive: true })
}

function writePlatformScripts(releaseRoot, platform) {
  mkdir(path.join(releaseRoot, 'bin'))
  if (platform === 'linux') {
    mkdir(path.join(releaseRoot, 'bin/lib'))
    copyExec(path.join(templatesDir, 'lib/release-env.sh'), path.join(releaseRoot, 'bin/lib/release-env.sh'))
    for (const name of ['install.sh', 'start-b-center.sh']) {
      copyExec(path.join(templatesDir, name), path.join(releaseRoot, 'bin', name))
    }
    return
  }
  for (const name of ['install.cmd', 'start-b-center.cmd']) {
    fs.copyFileSync(path.join(templatesDir, name), path.join(releaseRoot, 'bin', name))
  }
}

function installAppDeps(releaseRoot, target) {
  console.log(`==> [${target.id}] npm install --omit=dev`)
  const appDir = path.join(releaseRoot, 'app')
  fs.rmSync(path.join(appDir, 'node_modules'), { recursive: true, force: true })
  const r = spawnSync('npm', [
    'install', '--omit=dev', '--no-package-lock',
    `--os=${target.npmOs}`, `--cpu=${target.npmCpu}`
  ], {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_platform: target.npmOs,
      npm_config_arch: target.npmCpu
    },
    shell: process.platform === 'win32'
  })
  if (r.status !== 0) throw new Error(`npm install failed for ${target.id}`)
}

function archiveLinux(name) {
  const out = path.join(ROOT, 'release', `${name}.tar.gz`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.rmSync(out, { force: true })
  const args = ['-czf', out, '-C', path.join(ROOT, 'release'), name]
  const r = spawnSync('tar', process.platform === 'darwin' ? ['--no-xattrs', ...args] : args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('tar failed')
  return out
}

function archiveWindows(name) {
  const out = path.join(ROOT, 'release', `${name}.zip`)
  fs.rmSync(out, { force: true })
  if (process.platform === 'win32') {
    spawnSync('tar', ['-a', '-cf', out, '-C', path.join(ROOT, 'release'), name], { stdio: 'inherit', shell: true })
  } else {
    const r = spawnSync('zip', ['-r', '-q', out, name], { cwd: path.join(ROOT, 'release'), stdio: 'inherit' })
    if (r.status !== 0) throw new Error('zip 命令失败')
  }
  return out
}

try {
  ensureBuild()
  fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true })
  const artifacts = []

  for (const id of targetIds) {
    const target = TARGETS[id]
    if (!target) throw new Error(`未知目标: ${id}`)

    const releaseName = `gitlab-b-center-${version}-${target.id}`
    const releaseRoot = path.join(ROOT, 'release', releaseName)
    console.log(`\n========== ${target.id} ==========`)
    fs.rmSync(releaseRoot, { recursive: true, force: true })
    mkdir(path.join(releaseRoot, 'config'))
    mkdir(path.join(releaseRoot, 'data'))

    assembleApp(releaseRoot)
    fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(releaseRoot, 'config/env.example'))
    installAppDeps(releaseRoot, target)

    const isLinux = target.id.startsWith('linux')
    writePlatformScripts(releaseRoot, isLinux ? 'linux' : 'win')

    const readmeName = isLinux ? 'README-DEPLOY-linux.txt' : 'README-DEPLOY-windows.txt'
    const readme = fs.readFileSync(path.join(templatesDir, readmeName), 'utf8').replaceAll('{{VERSION}}', version)
    fs.writeFileSync(path.join(releaseRoot, 'README-DEPLOY.txt'), readme)

    fs.writeFileSync(path.join(releaseRoot, 'VERSION.txt'),
      `version=${version}\ntarget=${target.id}\nbuiltAt=${new Date().toISOString()}\n`)

    const out = target.archive === 'zip' ? archiveWindows(releaseName) : archiveLinux(releaseName)
    const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1)
    artifacts.push({ target: target.id, path: out, sizeMb })
  }

  console.log('\n========================================')
  console.log('发布包已生成（部署: install + start）:')
  for (const a of artifacts) {
    console.log(`  [${a.target}] ${a.path} (${a.sizeMb} MB)`)
  }
  console.log('\nVerdaccio 发布: bash scripts/publish-private-npm.sh')
} catch (err) {
  console.error(`\n❌ Pack failed: ${err.message}`)
  process.exit(1)
}
