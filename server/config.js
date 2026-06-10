import dotenv from 'dotenv'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const envFile = process.env.DOTENV_CONFIG_PATH || path.join(projectRoot, '.env')
dotenv.config({ path: envFile })

function env(key) {
  const value = process.env[key]
  return value === undefined ? '' : String(value).trim()
}

function envInt(key, fallback) {
  const raw = env(key)
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

const homeDir = env('HOME') || os.homedir()
const openclawAgentsDir = env('OPENCLAW_AGENTS_DIR') || path.join(homeDir, '.openclaw', 'agents')

const config = {
  port: envInt('PORT', 3000),
  nodeEnv: env('NODE_ENV') || 'development',
  db: {
    host: env('DB_HOST'),
    port: envInt('DB_PORT', 3306),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME')
  },
  gitlab: {
    baseUrl: env('GITLAB_BASE_URL')
  },
  webhook: {
    baseUrl: env('WEBHOOK_BASE_URL')
  },
  redis: {
    host: env('REDIS_HOST'),
    port: envInt('REDIS_PORT', 6379),
    password: env('REDIS_PASSWORD'),
    db: Math.min(15, Math.max(0, envInt('REDIS_DB', 0))),
    keyPrefix: env('REDIS_KEY_PREFIX') || 'bcenter:'
  },
  openclaw: {
    bin: env('OPENCLAW_BIN'),
    agentsDir: openclawAgentsDir,
    defaultWorkspace: env('OPENCLAW_DEFAULT_WORKSPACE'),
    defaultModel: env('OPENCLAW_DEFAULT_MODEL')
  }
}

export default config
