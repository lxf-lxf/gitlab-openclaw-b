<template>
  <div class="page">
    <div class="page-header">
      <h1>系统设置</h1>
      <p>配置 GitLab 连接、Webhook、系统通知与系统监控</p>
    </div>

    <!-- 页面加载骨架 -->
    <div v-if="pageLoading" class="settings-grid">
      <div v-for="i in 3" :key="'sk'+i" class="card" style="padding:20px;">
        <div class="skeleton-line" style="width:120px;height:18px;margin-bottom:16px;"></div>
        <div class="skeleton-line" style="width:100%;height:36px;margin-bottom:10px;"></div>
        <div class="skeleton-line" style="width:100%;height:36px;margin-bottom:10px;"></div>
        <div class="skeleton-line" style="width:80px;height:32px;margin-top:12px;"></div>
      </div>
    </div>

    <div v-else class="settings-grid">
      <!-- GitLab 配置 -->
      <div class="card">
        <h3 class="card-title">GitLab 连接</h3>
        <div class="form-group">
          <label class="form-label">GitLab Token</label>
          <input v-model="form.gitlab_token.value" type="password" class="form-input" placeholder="输入 GitLab Personal Access Token" />
          <p class="form-hint">用于调用 GitLab API 的超级管理员 Token</p>
        </div>
        <div class="form-group">
          <label class="form-label">GitLab Base URL</label>
          <input v-model="form.gitlab_base_url.value" class="form-input" :placeholder="envDefaults.gitlab_base_url || 'GitLab API 基础 URL'" />
          <p class="form-hint">GitLab 实例 API 基础 URL</p>
        </div>
        <div class="form-group">
          <label class="form-label">Webhook 局域网回调地址</label>
          <input v-model="form.webhook_base_url.value" class="form-input" :placeholder="envDefaults.webhook_base_url || 'Webhook 回调根地址'" />
          <p class="form-hint">GitLab 能访问的本机局域网 IP + 端口，用于接收 Webhook 事件</p>
        </div>
        <div v-if="gitlabProfile.connected && gitlabProfile.user" class="gitlab-connected">
          <div class="gitlab-connected-info">
            <div class="gitlab-connected-name">{{ gitlabProfile.user.name }}</div>
            <div class="gitlab-connected-meta">@{{ gitlabProfile.user.username }}<span v-if="gitlabProfile.user.email"> · {{ gitlabProfile.user.email }}</span></div>
            <div class="gitlab-connected-url" v-if="gitlabProfile.baseUrl">{{ gitlabProfile.baseUrl }}</div>
          </div>
          <span class="ws-badge">已连接</span>
        </div>
        <div v-else-if="gitlabProfile.error" class="gitlab-error">
          <span class="ws-badge offline">连接失败</span>
          <span>{{ gitlabProfile.error }}</span>
        </div>

        <div class="card-actions">
          <button class="apple-btn primary" @click="saveConfigs" :disabled="saving">
            {{ saving ? '保存中...' : '保存配置' }}
          </button>
          <button class="apple-btn" @click="verifyGitLab" :disabled="verifying">
            {{ verifying ? '验证中...' : '验证连接' }}
          </button>
          <span v-if="saved" class="saved-msg">已保存</span>
        </div>
      </div>

      <!-- 系统通知配置 -->
      <div class="card">
        <h3 class="card-title">
          系统通知
          <span class="ws-badge" :class="wsConnected ? '' : 'offline'" v-if="wsTried">
            {{ wsConnected ? '已连接' : (wsReconnecting ? '重连中...' : '未连接') }}
          </span>
        </h3>
        <p class="form-hint">通过 WebSocket 实时推送系统通知到浏览器</p>

        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">启用系统通知</span>
            <span class="toggle-desc">开启后系统将周期性检查状态并推送提醒</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="notifConfig.enabled" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="notif-options" v-if="notifConfig.enabled">
          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Agent 失败通知</span>
              <span class="toggle-desc">Agent 执行失败时立即推送通知</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="notifConfig.notifyFailedSessions" />
              <span class="slider"></span>
            </label>
          </div>
          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">事件流量告警</span>
              <span class="toggle-desc">短时间内大量事件时推送告警</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="notifConfig.notifyEventVolume" />
              <span class="slider"></span>
            </label>
          </div>
          <div class="form-group" v-if="notifConfig.notifyEventVolume">
            <label class="form-label">事件阈值</label>
            <input v-model.number="notifConfig.eventVolumeThreshold" type="number" class="form-input thin" min="10" />
            <p class="form-hint">5 分钟内超过此数量即触发告警</p>
          </div>
          <div class="toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">OpenClaw 状态监控</span>
              <span class="toggle-desc">OpenClaw CLI 不可用时推送通知</span>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="notifConfig.notifyOpenClawStatus" />
              <span class="slider"></span>
            </label>
          </div>
          <div class="card-actions">
            <button class="apple-btn primary" @click="saveNotif" :disabled="notifSaving">
              {{ notifSaving ? '保存中...' : '保存通知配置' }}
            </button>
            <button class="apple-btn" @click="checkNow" :disabled="checking">
              {{ checking ? '检查中...' : '立即检查' }}
            </button>
            <span v-if="notifSaved" class="saved-msg">已保存</span>
          </div>
        </div>
      </div>

        <!-- 系统监控 Agent -->
      <div class="card">
        <h3 class="card-title">
          系统监控 Agent
          <span class="ws-badge" :class="saStatus.enabled ? '' : 'offline'" v-if="saLoaded">
            {{ saStatus.enabled ? '已激活' : '未启用' }}
          </span>
        </h3>
        <p class="form-hint">
          部署到 OpenClaw（小龙虾）的系统监控 Agent，自动检查系统状态并推送智能通知。
        </p>

        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">启用系统监控 Agent</span>
            <span class="toggle-desc">开启后系统 Agent 将定期检查并推送摘要通知（支持确定/取消操作）</span>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="saStatus.enabled" @change="toggleSA" />
            <span class="slider"></span>
          </label>
        </div>

        <!-- 未部署时：选择 Workspace -->
        <div v-if="!saStatus.enabled && saLoaded" class="sa-workspace-section">
          <div class="form-group">
            <label class="form-label">OpenClaw Workspace</label>
            <div class="workspace-input-row">
              <input v-model="saWorkspace" class="form-input" placeholder="输入 workspace 路径" list="ws-list" />
              <datalist id="ws-list">
                <option v-for="w in availableWorkspaces" :key="w" :value="w" />
              </datalist>
            </div>
            <p class="form-hint">选择或输入 OpenClaw 工作空间路径，将在该 workspace 下注册 Agent</p>
          </div>
          <div class="workspace-hint" v-if="availableWorkspaces.length">
            <span class="hint-label">已有 workspace：</span>
            <span v-for="w in availableWorkspaces" :key="w" class="ws-tag" @click="saWorkspace = w">{{ w.split('/').pop() }}</span>
          </div>
        </div>

        <!-- 已部署时：状态信息（可点击编辑） -->
        <div class="sa-status" v-if="saLoaded && saStatus.enabled" @click="openEditSA" title="点击编辑配置">
          <div class="sa-row" v-if="saStatus.workspace"><span class="sa-dot g"></span> <span class="sa-path-label">Workspace：</span><code class="sa-path">{{ saStatus.workspace }}</code></div>
          <div class="sa-row" v-if="saStatus.dir"><span class="sa-dot g"></span> <span class="sa-path-label">Agent 路径：</span><code class="sa-path">{{ saStatus.dir }}</code></div>
          <div class="sa-row" v-if="saStatus.dirExists"><span class="sa-dot g"></span> 配置目录已创建</div>
          <div class="sa-row" v-if="saStatus.registered"><span class="sa-dot g"></span> 已注册到 OpenClaw</div>
          <div class="sa-edit-hint">✏️ 点击编辑配置</div>
        </div>

        <div class="card-actions">
          <button class="apple-btn primary" @click="depInitSA" :disabled="saBusy || (!saStatus.enabled && !saWorkspace.trim())">
            {{ saBusy ? (deploying ? '部署中...' : '处理中...') : (saStatus.enabled ? '重新初始化' : '初始化到 OpenClaw') }}
          </button>
          <button class="apple-btn" @click="openEditSA" :disabled="saBusy">编辑配置</button>
          <button class="apple-btn danger" @click="removeSA" :disabled="saBusy || !saStatus.enabled">移除</button>
          <span v-if="saMsg" :class="saMsgOk ? 'saved-msg ok' : 'saved-msg err'">{{ saMsg }}</span>
        </div>
      </div>

      <!-- Agent 并发限制 -->
      <div class="card">
        <h3 class="card-title">Agent 并发限制</h3>
        <p class="form-hint">限制同时运行的 Agent 数量，防止系统过载。达到上限后新事件将跳过自动调度。</p>
        <div class="form-group">
          <label class="form-label">最大并发数</label>
          <div class="limit-input-row">
            <input
              v-model.number="maxConcurrent"
              type="number"
              class="form-input thin"
              min="1" max="100"
              :disabled="maxSaving"
            />
            <button class="apple-btn primary" @click="saveMaxConcurrent" :disabled="maxSaving">
              {{ maxSaving ? '保存中...' : '保存' }}
            </button>
            <span v-if="maxSaved" class="saved-msg">已保存</span>
          </div>
          <p class="form-hint">建议区间 1～50，默认 10。修改后立即生效。</p>
        </div>
      </div>

      <!-- 日报配置 -->
      <div class="card">
        <h3 class="card-title">
          日报配置
          <span class="ws-badge" :class="reportConfig.enabled ? '' : 'offline'" v-if="!pageLoading">
            {{ reportConfig.enabled ? '已开启' : '已关闭' }}
          </span>
        </h3>
        <p class="form-hint">系统每天定时生成日报并推送通知，展示前一天的整体运行概况。</p>

        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">启用日报</span>
            <span class="toggle-desc">开启后系统将按设定时间自动生成并推送日报</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="reportConfig.enabled" @change="saveReportConfigDebounced" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="report-options" v-if="reportConfig.enabled">
          <div class="form-group">
            <label class="form-label">发送时间</label>
            <div class="time-input-row">
              <input v-model="reportConfig.sendAt" type="time" class="form-input time-input" @change="saveReportConfigDebounced" />
            </div>
            <p class="form-hint">每天在此时间自动生成日报。系统监控 Agent 将从数据库读取前一天全量数据，生成完整的 AI 分析报告。</p>
          </div>

          <div class="section-header">报告内容</div>
          <p class="form-hint" style="margin-bottom:12px;">日报由系统监控 Agent 自动生成，包含总览、事件分析、Agent 表现、异常诊断和优化建议等完整内容。</p>

          <div class="card-actions">
            <button class="apple-btn primary" @click="triggerReportNow" :disabled="reportGenerating">
              {{ reportGenerating ? '生成中...' : '立即生成日报' }}
            </button>
            <span v-if="reportMsg" class="saved-msg" :class="reportMsgOk ? '' : 'err'">{{ reportMsg }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 系统监控 Agent 编辑弹窗 -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="closeEdit">
      <div class="modal-wide card">
        <div class="modal-wide-header">
          <h3>编辑系统监控 Agent</h3>
          <div class="modal-wide-actions">
            <button class="apple-btn" @click="closeEdit">取消</button>
            <button class="apple-btn primary" @click="saveEdit">保存</button>
          </div>
        </div>
        <div class="modal-wide-body">
          <div class="modal-left">
            <div class="form-group">
              <label class="form-label">Agent 名称</label>
              <input :value="saStatus.name" class="form-input" disabled />
              <p class="form-hint">系统监控 Agent 名称不可修改</p>
            </div>
            <div class="form-group">
              <label class="form-label">Model</label>
              <input v-model="saForm.model" class="form-input" :placeholder="envDefaults.default_model || 'AI 模型名称'" />
              <p class="form-hint">AI 模型名称</p>
            </div>
            <div class="form-group">
              <label class="form-label">Agent 路径</label>
              <code class="path-display">{{ saStatus.dir || '-' }}</code>
              <p class="form-hint">OpenClaw 本地的 Agent 配置文件目录</p>
            </div>
            <div class="form-group">
              <label class="form-label">版本</label>
              <input :value="'1.0.0'" class="form-input" disabled />
            </div>
          </div>
          <div class="modal-right">
            <div class="editor-section">
              <div class="editor-section-header">
                <div class="editor-section-title">Agent 指令</div>
                <div class="editor-section-actions">
                  <span class="editor-info">{{ saForm.instructions.split('\n').length }} 行 / {{ saForm.instructions.length }} 字符</span>
                </div>
              </div>
              <textarea v-model="saForm.instructions" class="code-editor" placeholder="# 在这里编写 Agent 指令…"></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, onUnmounted } from 'vue'
import api from '@/api'

// 页面加载状态
const pageLoading = ref(true)

const envDefaults = reactive({
  gitlab_base_url: '',
  webhook_base_url: '',
  default_model: ''
})
const form = reactive({
  gitlab_token: { value: '', description: '' },
  gitlab_base_url: { value: '', description: '' },
  webhook_base_url: { value: '', description: '' }
})
const saving = ref(false)
const saved = ref(false)
const verifying = ref(false)
const gitlabProfile = reactive<{
  connected: boolean
  error: string | null
  baseUrl: string | null
  user: { name: string; username: string; email?: string | null; avatar_url: string } | null
}>({
  connected: false,
  error: null,
  baseUrl: null,
  user: null
})

// 通知配置
const notifConfig = reactive({
  enabled: true,
  notifyFailedSessions: true,
  notifyEventVolume: true,
  eventVolumeThreshold: 50,
  notifyOpenClawStatus: true,
  notifyAgentErrors: true
})
const notifSaving = ref(false)
const notifSaved = ref(false)
const checking = ref(false)
const wsConnected = ref(false)
const wsTried = ref(false)
const wsReconnecting = ref(false)
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

// 系统监控 Agent
const saStatus = reactive({ enabled: false, dirExists: false, registered: false, name: 'system-monitor', dir: '', workspace: '' })
const saLoaded = ref(false)
const saBusy = ref(false)
const deploying = ref(false)
const saMsg = ref('')
const saMsgOk = ref(false)

// 最大并发 Agent 限制
const maxConcurrent = ref(10)
const maxSaving = ref(false)
const maxSaved = ref(false)

// 日报配置
const reportConfig = reactive({
  enabled: true,
  sendAt: '09:00'
})
const reportGenerating = ref(false)
const reportMsg = ref('')
const reportMsgOk = ref(false)
let reportSaveTimer: ReturnType<typeof setTimeout> | null = null

// Workspace 选择
const saWorkspace = ref('')
const availableWorkspaces = ref<string[]>([])

// 编辑配置弹窗
const showEditModal = ref(false)
const saForm = reactive({
  model: '',
  instructions: ''
})

onMounted(async () => {
  pageLoading.value = true
  // 并行加载所有配置
  await Promise.allSettled([
    (async () => {
      try {
        const { data } = await api.getConfigs()
        if (data._envDefaults) {
          envDefaults.gitlab_base_url = data._envDefaults.gitlab_base_url || ''
          envDefaults.webhook_base_url = data._envDefaults.webhook_base_url || ''
          envDefaults.default_model = data._envDefaults.default_model || ''
        }
        if (data.gitlab_token) form.gitlab_token.value = data.gitlab_token.value
        if (data.gitlab_base_url) form.gitlab_base_url.value = data.gitlab_base_url.value
        if (data.webhook_base_url) form.webhook_base_url.value = data.webhook_base_url.value
      } catch {}
    })(),
    loadGitLabProfile(),
    (async () => {
      try {
        const { data } = await api.getNotificationConfig()
        Object.assign(notifConfig, data)
      } catch {}
    })(),
    (async () => {
      try {
        await fetchSAStatus()
        // 如果有已保存的 workspace，填入输入框
        if (saStatus.workspace) saWorkspace.value = saStatus.workspace
      } catch {}
    })(),
    (async () => {
      try {
        const { data } = await api.getOpenClawWorkspaces()
        availableWorkspaces.value = data || []
      } catch {}
    })(),
    (async () => {
      try {
        const { data } = await api.getMaxConcurrentAgents()
        maxConcurrent.value = data?.value ?? 10
      } catch {}
    })(),
    (async () => {
      try {
        const { data } = await api.getReportConfig()
        if (data.enabled !== undefined) reportConfig.enabled = data.enabled
        if (data.sendAt) reportConfig.sendAt = data.sendAt
      } catch {}
    })(),
  ])
  pageLoading.value = false
  connectWS()
})

onUnmounted(() => {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (ws) ws.close()
})

async function fetchSAStatus() {
  try {
    const { data } = await api.getSystemAgentStatus()
    Object.assign(saStatus, data)
    saLoaded.value = true
  } catch {}
}

function connectWS() {
  wsTried.value = true
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${location.host}/api/ws`
  try {
    ws = new WebSocket(url)
    ws.onopen = () => { wsConnected.value = true; wsReconnecting.value = false }
    ws.onclose = () => {
      wsConnected.value = false
      wsReconnecting.value = true
      reconnectTimer = setTimeout(() => { wsReconnecting.value = false; connectWS() }, 5000)
    }
    ws.onerror = () => { wsConnected.value = false }
  } catch {
    wsConnected.value = false
    wsReconnecting.value = true
    reconnectTimer = setTimeout(() => { wsReconnecting.value = false; connectWS() }, 5000)
  }
}

async function loadGitLabProfile() {
  try {
    const { data } = await api.getGitLabProfile()
    gitlabProfile.connected = !!data.connected
    gitlabProfile.error = data.error || null
    gitlabProfile.baseUrl = data.baseUrl || null
    gitlabProfile.user = data.user || null
  } catch (err: any) {
    gitlabProfile.connected = false
    gitlabProfile.error = err?.response?.data?.error || '无法验证 GitLab 连接'
    gitlabProfile.user = null
  }
}

async function verifyGitLab() {
  verifying.value = true
  await loadGitLabProfile()
  if (gitlabProfile.connected) {
    window.dispatchEvent(new CustomEvent('gitlab-profile-changed'))
  }
  verifying.value = false
}

async function saveConfigs() {
  saving.value = true; saved.value = false
  try {
    await api.updateConfig('gitlab_token', form.gitlab_token.value)
    await api.updateConfig('gitlab_base_url', form.gitlab_base_url.value)
    await api.updateConfig('webhook_base_url', form.webhook_base_url.value)
    saved.value = true
    await loadGitLabProfile()
    window.dispatchEvent(new CustomEvent('gitlab-profile-changed'))
    setTimeout(() => { saved.value = false }, 3000)
  } catch {}
  saving.value = false
}

async function saveNotif() {
  notifSaving.value = true; notifSaved.value = false
  try {
    await api.saveNotificationConfig({ ...notifConfig })
    notifSaved.value = true
    setTimeout(() => { notifSaved.value = false }, 3000)
  } catch {}
  notifSaving.value = false
}

async function checkNow() {
  checking.value = true
  try {
    await api.triggerNotificationCheck()
  } catch {}
  checking.value = false
}

// 最大并发 Agent 限制
async function saveMaxConcurrent() {
  maxSaving.value = true
  maxSaved.value = false
  try {
    await api.setMaxConcurrentAgents(maxConcurrent.value)
    maxSaved.value = true
    setTimeout(() => { maxSaved.value = false }, 3000)
  } catch {}
  maxSaving.value = false
}

// 日报配置
function saveReportConfigDebounced() {
  if (reportSaveTimer) clearTimeout(reportSaveTimer)
  reportSaveTimer = setTimeout(async () => {
    try {
      await api.saveReportConfig({ ...reportConfig })
    } catch {}
  }, 500)
}

async function triggerReportNow() {
  reportGenerating.value = true
  reportMsg.value = ''
  try {
    const { data } = await api.triggerDailyReport()
    reportMsg.value = '日报已生成并推送通知'
    reportMsgOk.value = true
  } catch (err: any) {
    reportMsg.value = err?.response?.data?.error || '生成失败'
    reportMsgOk.value = false
  }
  reportGenerating.value = false
  setTimeout(() => { reportMsg.value = '' }, 4000)
}

// 系统监控 Agent
async function toggleSA(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    await depInitSA()
  } else {
    await removeSA()
  }
}

async function depInitSA() {
  saBusy.value = true; deploying.value = true; saMsg.value = ''
  try {
    // 传入用户选择的 workspace
    const payload: any = {}
    if (saWorkspace.value.trim()) payload.workspace = saWorkspace.value.trim()
    const { data } = await api.deploySystemAgent(payload)
    Object.assign(saStatus, { ...data, enabled: true })
    saLoaded.value = true
    if (data.workspace) saWorkspace.value = data.workspace
    saMsg.value = '初始化成功'
    saMsgOk.value = true
  } catch (err: any) {
    saMsg.value = err?.response?.data?.error || '初始化失败'
    saMsgOk.value = false
  }
  saBusy.value = false; deploying.value = false
  setTimeout(() => { saMsg.value = '' }, 3000)
}

async function removeSA() {
  saBusy.value = true; saMsg.value = ''
  try {
    await api.removeSystemAgent()
    Object.assign(saStatus, { enabled: false, dirExists: false, registered: false, workspace: '' })
    saMsg.value = '已移除'
    saMsgOk.value = true
  } catch (err: any) {
    saMsg.value = err?.response?.data?.error || '移除失败'
    saMsgOk.value = false
  }
  saBusy.value = false
  setTimeout(() => { saMsg.value = '' }, 3000)
}

// 编辑配置
async function openEditSA() {
  showEditModal.value = true
  saForm.model = ''
  saForm.instructions = ''
  try {
    const { data } = await api.getSystemAgentConfig()
    if (data?.error) {
      saForm.model = envDefaults.default_model
      saForm.instructions = `# System Monitor Agent\n\n${data.error}\n\n请先点击「初始化到 OpenClaw」后再编辑。`
      return
    }
    saForm.model = data.model || envDefaults.default_model
    saForm.instructions = data.instructions || ''
  } catch (err: any) {
    saForm.model = envDefaults.default_model
    saForm.instructions = `# System Monitor Agent\n\n配置未加载: ${err?.response?.data?.error || err?.message}`
  }
}

function closeEdit() {
  showEditModal.value = false
}

async function saveEdit() {
  try {
    await api.updateSystemAgentConfig({
      model: saForm.model,
      instructions: saForm.instructions
    })
    saMsg.value = '配置已保存'
    saMsgOk.value = true
    closeEdit()
  } catch (err: any) {
    saMsg.value = err?.response?.data?.error || '保存失败'
    saMsgOk.value = false
  }
  setTimeout(() => { saMsg.value = '' }, 3000)
}
</script>

<style scoped>
.settings-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: start; }

.form-group { margin-bottom: 16px; }
.form-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.form-input {
  width: 100%; font-family: var(--font-family); font-size: 13px;
  padding: 8px 12px; border: none; border-radius: var(--radius-sm);
  background: var(--bg-secondary); color: var(--text-primary);
  outline: none; transition: background 0.2s; box-sizing: border-box;
}
.form-input:focus { background: var(--bg-tertiary); }
.form-input.thin { width: 100px; }
.form-hint { font-size: 11px; color: var(--text-secondary); margin-top: 3px; }
.limit-input-row { display: flex; align-items: center; gap: 8px; }
.limit-input-row .form-input.thin { width: 80px; text-align: center; }

.card-title { font-size: 15px; font-weight: 600; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-actions { display: flex; gap: 8px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
.saved-msg { font-size: 12px; color: var(--accent-green); }
.saved-msg.err { color: var(--accent-red); }

.gitlab-connected {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px;
  background: rgba(52,199,89,0.06);
  border-radius: var(--radius-sm);
  border: 1px solid rgba(52,199,89,0.15);
}
.gitlab-connected-info { flex: 1; min-width: 0; }
.gitlab-connected-name { font-size: 14px; font-weight: 600; }
.gitlab-connected-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.gitlab-connected-url { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; word-break: break-all; }
.gitlab-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(255,59,48,0.06);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--accent-red);
}

/* Toggle switch row */
.toggle-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0; border-bottom: 1px solid var(--bg-tertiary);
}
.toggle-row:last-of-type { border-bottom: none; }
.toggle-info { flex: 1; min-width: 0; }
.toggle-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 1px; }
.toggle-desc { font-size: 11px; color: var(--text-tertiary); }

/* Toggle switch */
.switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bg-tertiary); border-radius: 20px; transition: 0.3s;
}
.slider::before {
  content: ''; position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px;
  background: white; border-radius: 50%; transition: 0.3s;
}
input:checked + .slider { background: var(--accent-blue); }
input:checked + .slider::before { transform: translateX(16px); }

/* WS / SA status badge */
.ws-badge {
  display: inline-block; font-size: 10px; font-weight: 500; padding: 1px 6px;
  border-radius: 8px; vertical-align: middle;
  background: rgba(52,199,89,0.1); color: var(--accent-green);
}
.ws-badge.offline { background: rgba(255,59,48,0.1); color: var(--accent-red); }
.notif-options { margin-top: 4px; }

/* 系统监控 Agent */
.sa-status { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; cursor: pointer; padding: 6px 8px; border-radius: var(--radius-sm); transition: background 0.15s; }
.sa-status:hover { background: var(--bg-secondary); }
.sa-row { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); }
.sa-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.sa-dot.g { background: var(--accent-green); }
.sa-dot.r { background: var(--text-tertiary); }
.sa-path { font-size: 11px; font-family: monospace; color: var(--accent-blue); background: rgba(0,113,227,0.06); padding: 1px 6px; border-radius: 3px; word-break: break-all; }
.sa-path-label { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
.sa-edit-hint { font-size: 10px; color: var(--text-tertiary); margin-top: 2px; opacity: 0.7; }
.ok { color: var(--accent-green); }
.err { color: var(--accent-red); }

/* Workspace 选择区域 */
.sa-workspace-section { margin-top: 8px; padding: 10px 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); }
.workspace-input-row { display: flex; align-items: center; gap: 8px; }
.workspace-input-row .form-input { font-size: 12px; padding: 6px 10px; }
.workspace-hint { margin-top: 6px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.hint-label { font-size: 10px; color: var(--text-tertiary); }
.ws-tag {
  font-size: 10px; padding: 1px 8px; border-radius: 8px; cursor: pointer;
  background: rgba(0,113,227,0.08); color: var(--accent-blue); transition: background 0.15s;
}
.ws-tag:hover { background: rgba(0,113,227,0.16); }

/* Skeleton */
.skeleton-line {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* Modal for system agent edit */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(2px);
}
.modal-wide {
  width: 960px; max-width: 95vw; max-height: 90vh;
  display: flex; flex-direction: column; padding: 0; overflow: hidden;
}
.modal-wide-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px 0; flex-shrink: 0;
}
.modal-wide-header h3 { margin: 0; font-size: 18px; }
.modal-wide-actions { display: flex; gap: 8px; }
.modal-wide-body {
  display: flex; gap: 20px; padding: 20px 24px 24px;
  flex: 1; min-height: 0; overflow: hidden;
}
.modal-left { width: 320px; flex-shrink: 0; overflow-y: auto; }
.modal-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.editor-section { flex: 1; display: flex; flex-direction: column; }
.editor-section-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px; flex-wrap: wrap; gap: 4px;
}
.editor-section-title { font-size: 14px; font-weight: 600; }
.editor-section-actions { display: flex; align-items: center; gap: 8px; }
.editor-info { font-size: 11px; color: var(--text-tertiary); }
.code-editor {
  flex: 1; min-height: 300px; resize: none;
  padding: 14px 16px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px; line-height: 1.65;
  border: 1px solid var(--bg-tertiary); border-radius: var(--radius-sm);
  background: #1a1b1e; color: #e4e4e7;
  outline: none; box-sizing: border-box; tab-size: 2;
}
.code-editor:focus { border-color: var(--accent-blue); }
.path-display {
  display: block; font-size: 11px; font-family: monospace; color: var(--accent-blue);
  background: rgba(0,113,227,0.06); padding: 8px 12px; border-radius: var(--radius-sm);
  word-break: break-all; line-height: 1.5;
}

/* 日报配置 */
.report-options { margin-top: 8px; }
.time-input-row { display: flex; align-items: center; gap: 8px; }
.time-input { width: 140px; font-family: var(--font-family); font-size: 14px; text-align: center; padding: 6px 10px; }
.section-header {
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
  margin: 12px 0 6px; padding-bottom: 4px;
  border-bottom: 1px solid var(--bg-tertiary);
}

@media (max-width: 1000px) {
  .settings-grid { grid-template-columns: 1fr; }
}
</style>
