#!/usr/bin/env node
/**
 * 发布到 Verdaccio 私服（默认 172.16.3.201:4873）
 *
 * 用法:
 *   npm run publish:verdaccio
 *   NPM_REGISTRY=http://172.16.3.201:4873/ npm run publish:verdaccio
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT, readVersion, run, parseFlags, printHelp
} from './lib/common.mjs'

const DEFAULT_REGISTRY = 'http://172.16.3.201:4873/'

const { flags } = parseFlags(process.argv.slice(2))

if (flags.has('--help') || flags.has('-h')) {
  printHelp('gitlab-b-center publish (Verdaccio)', [
    ['用法:', [
      'npm run publish:verdaccio',
      'node scripts/publish.mjs'
    ]],
    ['环境变量:', [
      `NPM_REGISTRY / VERDACCIO_REGISTRY  默认 ${DEFAULT_REGISTRY}`,
      '首次发布前执行: npm login --registry http://172.16.3.201:4873/'
    ]],
    ['目标机安装:', [
      'npm install gitlab-b-center@<version> --registry http://172.16.3.201:4873/',
      '或: npm run setup:from-registry'
    ]]
  ])
  process.exit(0)
}

const registry = (
  process.env.NPM_REGISTRY ||
  process.env.VERDACCIO_REGISTRY ||
  DEFAULT_REGISTRY
).replace(/\/+$/, '/') 

try {
  const version = readVersion()
  console.log(`\n📤 Publishing gitlab-b-center@${version} to Verdaccio...`)
  console.log(`   Registry: ${registry}\n`)

  console.log('→ Building frontend...')
  run('npm', ['run', 'build'])

  const indexHtml = path.join(ROOT, 'dist/web/index.html')
  if (!fs.existsSync(indexHtml)) {
    throw new Error('Build failed: dist/web/index.html not found')
  }

  console.log('→ Publishing to Verdaccio (npm publish)...')
  run('npm', ['publish', '--registry', registry])

  console.log('\n✅ Published successfully!\n')
  console.log('Target machine one-click setup:')
  console.log(`  npm run setup:from-registry -- --version ${version}`)
  console.log('  cd gitlab-b-center-app && vim .env && npm start')
  console.log('')
} catch (err) {
  console.error(`\n❌ Publish failed: ${err.message}`)
  if (/ENEEDAUTH|401|403/.test(err.message)) {
    console.error('\nTip: run npm login first:')
    console.error(`  npm login --registry ${registry}`)
  }
  process.exit(1)
}
