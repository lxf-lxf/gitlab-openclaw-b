import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Op } from 'sequelize'
import { broadcastNotification } from './notification-ws.js'
import AdminConfig from '../db/models/adminConfig.js'
import config from '../config.js'
import {
  spawnSyncOpenClaw,
  ensureWorkspaceDir,
  listOpenClawAgentsSync,
  isSpawnTimedOut,
  cliTimeoutMs
} from '../utils/openclawCli.js'
const OPENCLAW_AGENTS_DIR = config.openclaw.agentsDir
const SYSTEM_AGENT_NAME = 'system-monitor'
const AGENT_DIR = path.join(OPENCLAW_AGENTS_DIR, SYSTEM_AGENT_NAME, 'agent')

/**
 * 获取已配置的 workspace，从 AdminConfig 读取，没有则用 .env 默认
 */
async function getWorkspace() {
  const cfg = await AdminConfig.findOne({ where: { config_key: 'system_agent_workspace' } })
  return cfg?.config_value || config.openclaw.defaultWorkspace
}

/**
 * 获取 OpenClaw 中现有的所有 workspace 列表
 */
export async function getOpenClawWorkspaces() {
  const workspaces = new Set()
  try {
    const { agents } = listOpenClawAgentsSync()
    for (const a of agents) {
      if (a.workspace) workspaces.add(a.workspace)
    }
  } catch (_) { /* ignore */ }
  return Array.from(workspaces).sort()
}

const AGENTS_MD = `# System Monitor

系统监控 Agent — 自动汇总系统数据并推送智能通知。

## Behavior
- 每 5 分钟自动检查系统状态
- 汇总事件流量、Agent 执行情况、失败统计
- 生成摘要通知推送到 B 端页面
- 支持用户"确定/取消"交互确认
`

function buildAgentJson() {
  return JSON.stringify({
  name: SYSTEM_AGENT_NAME,
  version: '1.0.0',
  model: config.openclaw.defaultModel,
  instructions: `# System Monitor Agent

你是 B 端中台系统监控 Agent，职责包括：

## 1. 例行检查 (systemAgentCheck)
每 5 分钟自动检查系统状态：
- 汇总短期事件流量
- 检查 Agent 执行成功率
- 发现异常推送摘要通知

## 2. 日报生成 (dailyReport)
接收系统昨日全量数据，生成全面的日报分析：
- **分析**：从全局视角归纳昨日系统运行情况
- **趋势**：发现数据中的模式、趋势或异常
- **建议**：针对异常给出可执行的优化建议
- **格式要求**：
  - 先写一句「总览」概括
  - 用 \`##\` 分段：事件分析、Agent 表现、异常与风险、优化建议
  - 语言专业简洁，使用中文
  - 总字数控制在 800 字以内

请根据输入的事件内容、会话统计等数据，输出结构化的系统状态摘要。
`,
  tools: [],
  agent_type: 'custom'
}, null, 2)
}

/**
 * 初始化系统监控 Agent 到 OpenClaw
 * @param {string} [workspace] - 用户指定的 workspace 路径，不传则从配置或默认读取
 */
export async function deploySystemAgent(workspace) {
  // 确定 workspace
  let effectiveWorkspace = workspace
  if (!effectiveWorkspace) {
    effectiveWorkspace = await getWorkspace()
  }
  ensureWorkspaceDir(effectiveWorkspace)

  try {
    // 创建 agent 目录
    fs.mkdirSync(AGENT_DIR, { recursive: true })
    const pluginsDir = path.join(AGENT_DIR, 'plugins')
    fs.mkdirSync(pluginsDir, { recursive: true })

    // 复制 gitlab-tools 插件
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const GITLAB_TOOLS_SRC = path.resolve(__dirname, '../plugins/gitlab-tools.js')
    if (fs.existsSync(GITLAB_TOOLS_SRC)) {
      fs.copyFileSync(GITLAB_TOOLS_SRC, path.join(pluginsDir, 'gitlab-tools.js'))
      console.log(`gitlab-tools plugin copied to system agent`)
    }

    // 写入 AGENTS.md
    fs.writeFileSync(path.join(AGENT_DIR, 'AGENTS.md'), AGENTS_MD)

    // 写入 agent.json
    fs.writeFileSync(path.join(AGENT_DIR, 'agent.json'), buildAgentJson())

    console.log(`System agent files created at ${AGENT_DIR}`)

    // 注册到 OpenClaw
    const addResult = spawnSyncOpenClaw([
      'agents', 'add', SYSTEM_AGENT_NAME,
      '--agent-dir', AGENT_DIR,
      '--workspace', effectiveWorkspace,
      '--non-interactive'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: cliTimeoutMs(20000)
    })

    const addTimedOut = isSpawnTimedOut(addResult)
    const addFailed = addResult.error && !addTimedOut
    const addExitBad = addResult.status !== 0 && addResult.status !== null
    if (addTimedOut && fs.existsSync(AGENT_DIR)) {
      console.warn('System agent add timed out, agent 目录已存在，视为已注册')
    } else if (addFailed || addExitBad) {
      const errText = `${addResult.stderr || ''}${addResult.stdout || ''}`.slice(0, 200)
      console.warn('System agent add failed (may already exist):', errText)
    }

    // 保存配置
    await AdminConfig.upsert({ config_key: 'system_agent_enabled', config_value: '1' })
    await AdminConfig.upsert({ config_key: 'system_agent_workspace', config_value: effectiveWorkspace })

    return { success: true, dir: AGENT_DIR, workspace: effectiveWorkspace }
  } catch (err) {
    console.error('deploySystemAgent error:', err.message)
    throw err
  }
}

/**
 * 移除系统监控 Agent
 */
export async function removeSystemAgent() {
  try {
    // 从 OpenClaw 移除（delete 用 --force 跳过确认）
    spawnSyncOpenClaw([
      'agents', 'delete', SYSTEM_AGENT_NAME,
      '--force'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: cliTimeoutMs(15000)
    })

    // 删除目录
    const baseDir = path.join(OPENCLAW_AGENTS_DIR, SYSTEM_AGENT_NAME)
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true })
    }

    await AdminConfig.upsert({
      config_key: 'system_agent_enabled',
      config_value: '0'
    })

    return { success: true }
  } catch (err) {
    console.error('removeSystemAgent error:', err.message)
    throw err
  }
}

/**
 * 获取系统 Agent 状态
 */
export async function getSystemAgentStatus() {
  const config = await AdminConfig.findOne({ where: { config_key: 'system_agent_enabled' } })
  const enabled = config?.config_value === '1'
  const dirExists = fs.existsSync(AGENT_DIR)

  let registered = false
  let listSource = null
  try {
    const { agents, source } = listOpenClawAgentsSync()
    listSource = source
    registered = agents.some(a =>
      a.name === SYSTEM_AGENT_NAME || a.id === SYSTEM_AGENT_NAME
    )
  } catch (_) { /* ignore */ }

  if (!registered && dirExists) {
    registered = true
    listSource = listSource || 'filesystem'
  }

  return {
    enabled,
    dirExists,
    registered,
    listSource,
    name: SYSTEM_AGENT_NAME,
    dir: AGENT_DIR,
    workspace: await getWorkspace()
  }
}

/**
 * 读取系统 Agent 配置（agent.json）
 */
export async function getSystemAgentConfig() {
  const jsonPath = path.join(AGENT_DIR, 'agent.json')
  if (!fs.existsSync(jsonPath)) {
    return { error: 'agent.json not found' }
  }
  const raw = fs.readFileSync(jsonPath, 'utf-8')
  return JSON.parse(raw)
}

/**
 * 更新系统 Agent 配置（agent.json 中的 instructions / model / tools）
 */
export async function updateSystemAgentConfig(data) {
  const jsonPath = path.join(AGENT_DIR, 'agent.json')
  if (!fs.existsSync(jsonPath)) {
    throw new Error('agent.json not found, deploy the agent first')
  }
  const current = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

  // 只允许更新安全字段
  if (data.instructions !== undefined) current.instructions = data.instructions
  if (data.model !== undefined) current.model = data.model
  if (data.tools !== undefined) current.tools = data.tools

  fs.writeFileSync(jsonPath, JSON.stringify(current, null, 2))

  // agent.json 会被 OpenClaw 自动读取，无需额外 CLI 同步

  return { success: true, config: current }
}

/**
 * 系统 Agent 定期执行检查 — 由 system-notifier 周期调用
 * 汇总系统状态推送摘要通知
 */
export async function systemAgentCheck() {
  const config = await AdminConfig.findOne({ where: { config_key: 'system_agent_enabled' } })
  if (config?.config_value !== '1') return

  try {
    const { default: WebhookEvent } = await import('../db/models/webhookEvent.js')
    const { default: AgentSession } = await import('../db/models/agentSession.js')
    const { default: Project } = await import('../db/models/project.js')

    // 最近 5 分钟数据
    const since = new Date(Date.now() - 5 * 60 * 1000)

    const [eventCount, failedCount, activeSessions, totalProjects] = await Promise.all([
      WebhookEvent.count({ where: { received_at: { [Op.gte]: since } } }),
      AgentSession.count({ where: { status: 'failed', finished_at: { [Op.gte]: since } } }),
      AgentSession.count({ where: { status: 'active' } }),
      Project.count()
    ])

    // 生成摘要
    const summary = []
    if (eventCount > 0) summary.push(`📊 最近 5 分钟收到 ${eventCount} 个事件`)
    if (failedCount > 0) summary.push(`❌ ${failedCount} 个 Agent 执行失败`)
    if (activeSessions > 0) summary.push(`⚡ ${activeSessions} 个 Agent 正在执行中`)

    if (summary.length > 0) {
      await broadcastNotification({
        type: 'info',
        title: `系统状态摘要 (${new Date().toLocaleTimeString('zh-CN')})`,
        message: summary.join(' | '),
        actions: ['确定', '取消']
      })
    }
  } catch (err) {
    console.error('systemAgentCheck error:', err.message)
  }
}
