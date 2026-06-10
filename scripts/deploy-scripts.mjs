import fs from 'node:fs'
import path from 'node:path'
import { getPackageRoot } from './lib/package-root.mjs'

const WRAPPER = `#!/usr/bin/env bash
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/b-center-service.sh" "$@"
`

/** 写入/更新部署目录启停脚本（可重复执行以升级脚本） */
export function writeDeployScripts(targetDir) {
  const templatesDir = path.join(getPackageRoot(), 'scripts/script-templates')
  const serviceTpl = path.join(templatesDir, 'b-center-service.sh')
  if (!fs.existsSync(serviceTpl)) {
    throw new Error(`缺少脚本模板: ${serviceTpl}`)
  }

  const written = []
  const copyExecutable = (name, content) => {
    const dest = path.join(targetDir, name)
    fs.writeFileSync(dest, content, { mode: 0o755 })
    written.push(dest)
  }

  copyExecutable('b-center-service.sh', fs.readFileSync(serviceTpl, 'utf8'))
  copyExecutable('start-b-center.sh', WRAPPER)

  fs.mkdirSync(path.join(targetDir, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'data'), { recursive: true })

  return written
}
