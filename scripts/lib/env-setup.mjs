import fs from 'node:fs'
import path from 'node:path'

/**
 * 确保目录下存在 .env.example，并按需从示例生成 .env
 * @returns {{ envExample: string, envPath: string, envCreated: boolean }}
 */
export function ensureEnvFiles(targetDir) {
  const envExample = path.join(targetDir, '.env.example')
  const envPath = path.join(targetDir, '.env')

  if (!fs.existsSync(envExample)) {
    throw new Error(`.env.example not found in ${targetDir}`)
  }

  let envCreated = false
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(envExample, envPath)
    envCreated = true
  }

  return { envExample, envPath, envCreated }
}

/** 将包内 .env 模板同步到安装目录（便于用户编辑） */
export function syncEnvToDir(installDir, packageRoot) {
  fs.mkdirSync(installDir, { recursive: true })

  const srcExample = path.join(packageRoot, '.env.example')
  const destExample = path.join(installDir, '.env.example')
  const destEnv = path.join(installDir, '.env')

  if (!fs.existsSync(srcExample)) {
    throw new Error(`.env.example missing in package: ${packageRoot}`)
  }

  fs.copyFileSync(srcExample, destExample)

  let envCreated = false
  if (!fs.existsSync(destEnv)) {
    fs.copyFileSync(srcExample, destEnv)
    envCreated = true
  }

  return { envExample: destExample, envPath: destEnv, envCreated }
}

/** 解析 .env 路径：包目录 → 上级安装目录 */
export function resolveEnvPath(packageRoot) {
  const candidates = [
    path.join(packageRoot, '.env'),
    path.join(packageRoot, '..', '..', '.env')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 是否为开发源码目录（含 web/src） */
export function isDevSourceTree(root) {
  return fs.existsSync(path.join(root, 'web', 'src'))
}
