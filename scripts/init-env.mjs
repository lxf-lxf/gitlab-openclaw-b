import fs from 'node:fs'
import path from 'node:path'
import { getPackageRoot } from './lib/package-root.mjs'
import { writeDeployScripts } from './deploy-scripts.mjs'
import { isDevSourceTree } from './lib/env-setup.mjs'

export function getInstallTargetDir() {
  return process.env.INIT_CWD?.trim() || process.cwd()
}

export function shouldSkipEnvInit() {
  if (process.env.BCENTER_SKIP_ENV_INIT === '1') return true
  const root = getPackageRoot()
  if (isDevSourceTree(root)) return true
  const target = getInstallTargetDir()
  const pkgJson = path.join(target, 'package.json')
  if (!fs.existsSync(pkgJson)) return false
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
    if (pkg.workspaces) return true
    if (pkg.name === 'gitlab-b-center') return true
  } catch { /* ignore */ }
  return false
}

function copyIfMissing(src, dest) {
  if (!fs.existsSync(src)) return false
  if (fs.existsSync(dest)) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return true
}

function copyAlways(src, dest) {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return true
}

export function initEnvFiles(options = {}) {
  const targetDir = options.targetDir ?? getInstallTargetDir()
  const root = getPackageRoot()
  const created = []
  const skipped = []
  const quiet = options.quiet ?? false

  const envExampleDest = path.join(targetDir, '.env.example')
  if (copyAlways(path.join(root, '.env.example'), envExampleDest)) {
    created.push(envExampleDest)
  }

  const envDest = path.join(targetDir, '.env')
  if (copyIfMissing(path.join(root, '.env.example'), envDest)) {
    created.push(envDest)
  } else {
    skipped.push(envDest)
  }

  const deployDest = path.join(targetDir, 'BCENTER-DEPLOY.md')
  const deploySrc = path.join(root, 'docs/DEPLOY-NPM.md')
  if (copyIfMissing(deploySrc, deployDest)) {
    created.push(deployDest)
  } else if (fs.existsSync(deploySrc) && !fs.existsSync(deployDest)) {
    copyAlways(deploySrc, deployDest)
    created.push(deployDest)
  } else {
    skipped.push(deployDest)
  }

  for (const p of writeDeployScripts(targetDir)) {
    created.push(p)
  }

  if (!quiet) {
    console.log(`[b-center] 初始化目录: ${targetDir}`)
    if (created.length) {
      console.log('  已生成/更新:')
      for (const f of created) console.log(`    - ${path.relative(targetDir, f) || f}`)
    }
    if (skipped.length) {
      console.log('  已存在（跳过）:')
      for (const f of skipped) console.log(`    - ${path.relative(targetDir, f) || f}`)
    }
    console.log('  后台: npx b-center start')
    console.log('  重启: npx b-center restart')
    console.log('  前台: npx b-center fg')
    console.log('  说明: BCENTER-DEPLOY.md')
  }

  return { targetDir, created, skipped }
}

export async function runInitCli() {
  const { targetDir, created } = initEnvFiles({ quiet: false })
  const envPath = path.join(targetDir, '.env')
  const { needsSetup } = await import('./lib/env-file.mjs')

  if (process.stdin.isTTY && (created.includes(envPath) || needsSetup(envPath))) {
    console.log('\n→ 进入首次配置向导...\n')
    const { runSetupWizard } = await import('./setup-wizard.mjs')
    await runSetupWizard({ configDir: targetDir })
  } else if (needsSetup(envPath)) {
    console.log('\n→ 请运行配置向导: npx b-center setup\n')
  }
}
