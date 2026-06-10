import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import AgentTemplate from '../db/models/agentTemplate.js'
import config from '../config.js'
import {
  spawnSyncOpenClaw,
  ensureWorkspaceDir,
  listOpenClawAgentsSync,
  isSpawnTimedOut,
  cliTimeoutMs
} from '../utils/openclawCli.js'
import { ensureOpenClawConfigReadyForDeploy } from '../utils/openclawConfig.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OPENCLAW_AGENTS_DIR = config.openclaw.agentsDir
const GITLAB_TOOLS_SRC = path.resolve(__dirname, '../plugins/gitlab-tools.js')
const MODEL_ID = config.openclaw.defaultModel

function sanitizeAgentName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

export function resolveDeployWorkspace(template) {
  const fromTemplate = (template?.workspace_path || '').trim()
  if (fromTemplate) return fromTemplate
  const fromEnv = (config.openclaw.defaultWorkspace || '').trim()
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), 'workspace')
}

export function isAgentRegisteredInOpenClaw(agentName) {
  const id = sanitizeAgentName(agentName)
  const { agents } = listOpenClawAgentsSync({ timeout: cliTimeoutMs(25000) })
  return agents.some(a => a.id === id || a.name === id || a.name === agentName)
}

function collectChainAgentNames(template) {
  const chain = template?.agent_config?.chain || []
  return [...new Set(chain.map(l => l?.agent).filter(Boolean))]
}

/**
 * 将 B 端模板初始化到 OpenClaw（写入文件 + agents add 注册）
 */
export async function deployTemplateToOpenClaw(template, options = {}) {
  const agentName = sanitizeAgentName(template.name)
  const agentDir = path.join(OPENCLAW_AGENTS_DIR, agentName, 'agent')
  const pluginsDir = path.join(agentDir, 'plugins')
  const workspace = resolveDeployWorkspace(template)

  ensureWorkspaceDir(workspace)
  fs.mkdirSync(pluginsDir, { recursive: true })

  if (fs.existsSync(GITLAB_TOOLS_SRC)) {
    fs.copyFileSync(GITLAB_TOOLS_SRC, path.join(pluginsDir, 'gitlab-tools.js'))
  }

  fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({ providers: {} }, null, 2))

  const agentConfig = template.agent_config || {}
  const instructions = agentConfig.instructions || `# ${template.name}\n\n${template.description || ''}`
  const tools = (agentConfig.tools || []).length
    ? `\n## 可用工具\n\n${agentConfig.tools.map(t => `- \`${t}\``).join('\n')}`
    : ''
  const eventInfo = (agentConfig.event_types || []).length
    ? `\n## 触发事件\n\n${agentConfig.event_types.map(e => `- ${e}`).join('\n')}`
    : ''
  const agentsMd = `# ${template.name} — ${template.description || 'Agent'}\n\n${instructions}${tools}${eventInfo}\n`
  fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), agentsMd)

  const configReady = ensureOpenClawConfigReadyForDeploy()
  if (!configReady.ok) {
    throw new Error(configReady.message)
  }
  if (configReady.actions.length) {
    console.log(`[template-deploy] OpenClaw 配置已预处理: ${configReady.actions.join(', ')}`)
  }

  const ocArgs = [
    'agents', 'add', agentName,
    '--agent-dir', agentDir,
    '--workspace', workspace,
    '--non-interactive',
    '--json'
  ]
  if (MODEL_ID) {
    ocArgs.push('--model', MODEL_ID)
  }

  const result = spawnSyncOpenClaw(ocArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: cliTimeoutMs(60000)
  })

  const output = `${result.stderr || ''}${result.stdout || ''}`
  const timedOut = isSpawnTimedOut(result)
  const alreadyExists = /already exists/i.test(output)

  if (result.error && !timedOut && !alreadyExists) {
    throw new Error(`OpenClaw 注册失败: ${result.error.message}\n${output.slice(0, 400)}`)
  }
  if (!timedOut && result.status !== 0 && result.status !== null && !alreadyExists) {
    throw new Error(`OpenClaw 注册失败 (exit ${result.status}): ${output.slice(0, 500)}`)
  }

  if (!isAgentRegisteredInOpenClaw(agentName)) {
    if (timedOut && fs.existsSync(agentDir)) {
      console.warn(`Agent "${agentName}" add 超时，目录已写入但未在 CLI 列表中确认`)
    } else if (!options.allowUnverified) {
      throw new Error(
        `Agent "${agentName}" 文件已写入，但未在 OpenClaw 注册成功。请检查 OPENCLAW_DEFAULT_WORKSPACE 并执行: openclaw agents list`
      )
    }
  }

  await template.update({ deployed: 1 })

  return {
    agent_name: agentName,
    agent_dir: agentDir,
    workspace,
    registered: isAgentRegisteredInOpenClaw(agentName),
    gitlab_tools_loaded: fs.existsSync(path.join(pluginsDir, 'gitlab-tools.js')),
    message: `Agent "${template.name}" 已初始化到 OpenClaw（workspace: ${workspace}）`
  }
}

/** 部署 chain 中引用的 manual 模板（未部署时） */
export async function deployChainDependencies(template) {
  const names = collectChainAgentNames(template)
  const deployed = []
  const skipped = []
  const errors = []

  for (const name of names) {
    const dep = await AgentTemplate.findOne({ where: { name, is_active: 1 } })
    if (!dep) {
      if (isAgentRegisteredInOpenClaw(name)) {
        skipped.push({ name, reason: 'openclaw_native' })
      } else {
        errors.push({ name, error: `未找到模板「${name}」，请先在 Agent 模板页创建并初始化` })
      }
      continue
    }
    if (dep.deployed && isAgentRegisteredInOpenClaw(name)) {
      skipped.push({ name, reason: 'already_deployed' })
      continue
    }
    try {
      const r = await deployTemplateToOpenClaw(dep)
      deployed.push({ name, ...r })
    } catch (err) {
      errors.push({ name, error: err.message })
    }
  }

  return { deployed, skipped, errors }
}

export async function deployTemplateWithDependencies(template) {
  const main = await deployTemplateToOpenClaw(template)
  const chain = await deployChainDependencies(template)
  return { ...main, chain }
}
