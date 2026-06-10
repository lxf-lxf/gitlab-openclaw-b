#!/usr/bin/env node
/**
 * 发布到 Verdaccio 私服（默认）或 HTTP 上传压缩包
 *
 * 默认: npm publish → http://172.16.3.201:4873/
 * HTTP: npm run upload -- --http -- UPLOAD_URL=...
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ROOT, parseFlags, printHelp
} from './lib/common.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REGISTRY = 'http://172.16.3.201:4873/'

const { flags, args } = parseFlags(process.argv.slice(2))

if (flags.has('--help') || flags.has('-h')) {
  printHelp('gitlab-b-center upload', [
    ['用法（Verdaccio，默认）:', [
      'npm run upload',
      'npm run publish:verdaccio'
    ]],
    ['用法（HTTP 压缩包上传）:', [
      'npm run upload -- --http',
      'UPLOAD_URL=https://files.example.com/ npm run upload -- --http'
    ]],
    ['Verdaccio 环境变量:', [
      `NPM_REGISTRY / VERDACCIO_REGISTRY  默认 ${DEFAULT_REGISTRY}`,
      '首次: npm login --registry http://172.16.3.201:4873/'
    ]],
    ['HTTP 环境变量:', [
      'UPLOAD_URL     上传地址',
      'UPLOAD_TOKEN   可选 Bearer Token'
    ]]
  ])
  process.exit(0)
}

if (flags.has('--http')) {
  try {
    const { default: httpUpload } = await import('./upload-http.mjs')
    await httpUpload(args)
    process.exit(0)
  } catch (err) {
    console.error(`\n❌ Upload failed: ${err.message}`)
    process.exit(1)
  }
}

// 默认走 Verdaccio publish
const publishScript = path.join(__dirname, 'publish.mjs')
const result = spawnSync(process.execPath, [publishScript], { stdio: 'inherit' })
process.exit(result.status ?? 1)
