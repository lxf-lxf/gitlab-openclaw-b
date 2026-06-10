<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1>项目列表</h1>
        <p>管理 GitLab 项目及 Webhook 配置</p>
      </div>
      <div class="header-actions">
        <button
          class="apple-btn primary"
          :class="{ 'is-busy': syncing }"
          @click="syncProjects"
          :disabled="groupsLoading"
          :aria-busy="syncing"
        >
          {{ syncing ? '正在同步中' : '从 GitLab 同步' }}
        </button>
      </div>
    </div>

    <div class="split-layout">
      <!-- 左侧：分组项目列表 -->
      <div class="left-panel">
        <!-- 搜索栏 + Webhook 筛选 -->
        <div class="search-bar card">
          <div class="search-input-wrapper">
            <span class="search-icon">🔍</span>
            <input type="text" v-model="searchText" placeholder="搜索项目名称..." class="search-input" @input="onSearchDebounce" />
          </div>
          <div class="search-actions">
            <button
              class="filter-btn"
              :class="{ active: webhookOnly }"
              @click="webhookOnly = !webhookOnly"
              :title="webhookOnly ? '显示全部项目' : '仅显示已启用 Webhook 的项目'"
            >
              <span class="filter-dot" :class="webhookOnly ? 'g' : 'gr'"></span>
              仅 Webhook
            </button>
          </div>
        </div>

        <div v-if="groupsLoading" class="groups-list">
          <div v-for="i in 3" :key="'sk'+i" class="card" style="padding:12px;">
            <div class="skeleton-line" style="width:120px;height:16px;"></div>
            <div class="skeleton-line" style="width:220px;height:12px;margin-top:6px;"></div>
            <div class="skeleton-line" style="width:180px;height:12px;margin-top:4px;"></div>
          </div>
        </div>
        <div v-else-if="filteredGroups.length === 0" class="card" style="text-align:center;padding:48px;">
          <p v-if="searchText">没有匹配「{{ searchText }}」的项目</p>
          <p v-else-if="webhookOnly">当前筛选「仅 Webhook」下没有项目，请关闭筛选查看全部</p>
          <p v-else-if="groups.length > 0">分组内暂无可见项目，请检查筛选条件</p>
          <p v-else>暂无项目</p>
          <p style="color:var(--text-secondary);font-size:14px;margin-top:8px;" v-if="!searchText && !webhookOnly && groups.length === 0">点击上方按钮从 GitLab 同步项目列表</p>
        </div>
        <div v-else class="groups-list">
          <div v-for="g in filteredGroups" :key="g.namespace" class="card group-card">
            <!-- 分组头 -->
            <div class="group-header" @click="toggleGroup(g.namespace)">
              <div class="group-info">
                <span class="group-toggle">{{ expandedGroups[g.namespace] ? '▼' : '▶' }}</span>
                <span class="group-ns">{{ g.namespace }}</span>
                <span class="group-count">{{ g.webhookEnabled }}/{{ g.total }} 已启用</span>
              </div>
              <div class="group-actions" @click.stop>
                <button
                  class="apple-btn primary tiny"
                  @click="enableGroupHooks(g.namespace)"
                  :disabled="groupState(g.namespace).busy || g.webhookEnabled === g.total"
                >{{ groupState(g.namespace).busyEnable ? '开启中...' : '一键开启' }}</button>
                <button
                  class="apple-btn danger tiny"
                  @click="confirmDisable(g)"
                  :disabled="groupState(g.namespace).busy || g.webhookEnabled === 0"
                >{{ groupState(g.namespace).busyDisable ? '关闭中...' : '一键关闭' }}</button>
                <span v-if="groupState(g.namespace).msg" class="grp-msg" :class="groupState(g.namespace).msgType">{{ groupState(g.namespace).msg }}</span>
              </div>
            </div>
            <!-- 项目列表 -->
            <div v-if="expandedGroups[g.namespace]" class="group-projects">
              <div
                v-for="p in g.projects"
                :key="p.id"
                class="project-card"
                :class="{ selected: selectedProject?.id === p.id }"
                @click="selectProject(p)"
              >
                <div class="project-info">
                  <h3>{{ p.name }}</h3>
                  <p class="project-path">{{ p.path_with_namespace }}</p>
                </div>
                <div class="project-meta">
                  <span :class="p.webhook_config?.is_enabled ? 'dot g' : 'dot gr'"></span>
                  <span class="wh-status">{{ p.webhook_config?.is_enabled ? '已启用' : '未配置' }}</span>
                </div>
                <div class="project-actions" @click.stop>
                  <button v-if="!p.webhook_config?.is_enabled" class="apple-btn primary tiny" @click="enableHook(p.id)">启用</button>
                  <button v-else class="apple-btn tiny" @click="disableHook(p.id)">停用</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：关联事件 -->
      <div class="right-panel" v-if="selectedProject">
        <div class="card right-header">
          <div class="right-header-left">
            <h2>{{ selectedProject.name }}</h2>
            <span class="project-path">{{ selectedProject.path_with_namespace }}</span>
          </div>
          <button class="close-btn" @click="selectedProject = null">✕</button>
        </div>

        <div v-if="eventsLoading" class="events-list">
          <div v-for="i in 3" :key="'evsk'+i" class="card event-card" style="padding:16px;">
            <div class="skeleton-line" style="width:140px;height:14px;"></div>
            <div class="skeleton-line" style="width:200px;height:14px;margin-top:8px;"></div>
            <div class="skeleton-line" style="width:100px;height:12px;margin-top:8px;"></div>
          </div>
        </div>
        <div v-else-if="projectEvents.length === 0" class="card" style="text-align:center;padding:32px;">
          <p style="color:var(--text-secondary);">暂无关联事件</p>
        </div>
        <div v-else class="events-list">
          <div v-for="e in projectEvents" :key="e.id" class="card event-card" @click="viewEventDetail(e)">
            <div class="event-header">
              <span class="badge" :class="'type-' + getTypeClass(e.event_type)">{{ formatType(e.event_type) }}</span>
              <span v-if="e.source_id" class="source-num">#{{ e.source_id }}</span>
              <span class="event-action" v-if="e.event_action">{{ e.event_action }}</span>
              <span class="event-status">
                <span class="dot" :class="e.status"></span> {{ e.status }}
                <span v-if="e.dispatch_label" class="evt-dispatch" :class="'tone-' + (e.dispatch_tone || 'muted')">{{ e.dispatch_label }}</span>
              </span>
            </div>
            <div class="event-body" v-if="e.payload">
              <p class="event-title">{{ getIssueTitle(e) }}</p>
              <p class="event-detail" v-if="getIssueState(e) || getIssueLabels(e)">
                <span v-if="getIssueState(e)"><span class="label-hint">状态:</span> {{ getIssueState(e) }}</span>
                <span v-if="getIssueLabels(e)"><span class="label-hint">标签:</span> {{ getIssueLabels(e) }}</span>
              </p>
            </div>
            <div class="event-footer">
              <span class="event-time">{{ formatTime(e.received_at) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 未选择项目时的提示 -->
      <div class="right-panel" v-else>
        <div class="card empty-selection">
          <p>点击左侧项目查看关联事件</p>
        </div>
      </div>
    </div>

    <!-- Event Payload Modal -->
    <div v-if="viewEvent" class="modal-overlay" @click.self="viewEvent = null">
      <div class="modal-content card payload-modal">
        <div class="modal-header">
          <h3>事件 #{{ viewEvent.id }}</h3>
          <button class="close-btn" @click="viewEvent = null">✕</button>
        </div>
        <div class="event-meta-bar">
          <span class="badge" :class="'type-' + getTypeClass(viewEvent.event_type)">{{ viewEvent.event_type }}</span>
          <span class="badge" :class="'status-' + viewEvent.status">{{ viewEvent.status }}</span>
          <span v-if="viewEvent.source_id">来源: #{{ viewEvent.source_id }}</span>
        </div>
        <h4 class="section-label">Payload (GitLab 传入原始 JSON)</h4>
        <pre class="json-block">{{ JSON.stringify(viewEvent.payload, null, 2) }}</pre>
      </div>
    </div>

    <GitLabSyncModal
      :visible="showSyncModal"
      :syncing="syncing"
      :stopping="stoppingSync"
      :message="syncStatus?.message || '准备同步...'"
      :error="syncModalErr"
      :logs="displayLogs"
      :processed="syncStatus?.processed || 0"
      :total="syncStatus?.total || 0"
      :progress-percent="syncProgressPercent"
      :phase-label="syncPhaseLabel"
      :phase-class="syncPhaseClass"
      @close="closeSyncModal"
      @stop="stopSync"
    />

    <!-- 一键关闭二次确认弹窗 -->
    <div v-if="showConfirm" class="modal-overlay" @click.self="showConfirm = false">
      <div class="modal-content card confirm-modal">
        <div class="modal-header">
          <h3>确认关闭 Webhook</h3>
          <button class="close-btn" @click="showConfirm = false">✕</button>
        </div>
        <p class="confirm-text">
          确定要关闭分组 <strong>{{ pendingDisableGroup?.namespace }}</strong> 下所有项目的 Webhook 吗？
          <br/><span class="confirm-hint">将关闭 {{ pendingDisableGroup?.webhookEnabled }} 个已启用的 Webhook</span>
        </p>
        <div class="confirm-actions">
          <button class="apple-btn" @click="showConfirm = false">取消</button>
          <button class="apple-btn danger" @click="doDisable" :disabled="pendingDisableGroup && groupState(pendingDisableGroup.namespace).busy">
            {{ pendingDisableGroup && groupState(pendingDisableGroup.namespace).busyDisable ? '关闭中...' : '确认关闭' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api from '@/api'
import GitLabSyncModal from '@/components/GitLabSyncModal.vue'
import { formatType, getTypeClass, getIssueTitle, getIssueState, getIssueLabels, formatTime } from '@/utils/eventFormat'

const groups = ref<any[]>([])
const groupsLoading = ref(true)
const syncing = ref(false)
const stoppingSync = ref(false)
const showSyncModal = ref(false)
const syncStatus = ref<any>(null)
const syncResult = ref<any>(null)
const syncModalErr = ref('')
let syncPollTimer: ReturnType<typeof setInterval> | null = null
const searchText = ref('')
const webhookOnly = ref(false)
const expandedGroups = ref<Record<string, boolean>>({})
const selectedProject = ref<any>(null)
const projectEvents = ref<any[]>([])
const eventsLoading = ref(false)
const viewEvent = ref<any>(null)

// 二次确认弹窗
const showConfirm = ref(false)
const pendingDisableGroup = ref<any>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchDebounce() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(fetchData, 300)
}

const syncProgressPercent = computed(() => {
  const total = syncStatus.value?.total || 0
  const processed = syncStatus.value?.processed || 0
  if (!total || syncStatus.value?.phase === 'fetching') return null
  return Math.min(100, Math.round((processed / total) * 100))
})

const displayLogs = computed(() => syncStatus.value?.logs || [])

const syncPhaseLabel = computed(() => {
  if (syncModalErr.value) return '失败'
  if (stoppingSync.value || syncStatus.value?.message?.includes('停止')) return '停止中'
  if (syncing.value) return syncStatus.value?.phase === 'fetching' ? '拉取中' : '写入中'
  if (syncStatus.value?.phase === 'cancelled') return '已停止'
  if (syncResult.value) return '完成'
  return '就绪'
})

const syncPhaseClass = computed(() => {
  if (syncModalErr.value) return 'err'
  if (stoppingSync.value || syncStatus.value?.phase === 'cancelled') return 'warn'
  if (syncing.value) return 'run'
  if (syncResult.value) return 'ok'
  return 'idle'
})

onMounted(async () => {
  await fetchData()
  await refreshSyncStatus()
})

onUnmounted(stopSyncPolling)

function parseProjectGroupsResponse(data: any) {
  if (Array.isArray(data)) {
    return { groups: data, has_event_templates: false }
  }
  if (Array.isArray(data?.groups)) {
    return { groups: data.groups, has_event_templates: !!data.has_event_templates }
  }
  return { groups: [], has_event_templates: false }
}

async function fetchData() {
  groupsLoading.value = true
  try {
    const { data } = await api.getProjectGroups()
    const parsed = parseProjectGroupsResponse(data)
    groups.value = parsed.groups.map((g: any) => ({
      ...g,
      projects: g.projects || [],
      busy: false,
      busyEnable: false,
      busyDisable: false,
      msg: '',
      msgType: ''
    }))
  } catch {
    groups.value = []
  }
  groupsLoading.value = false
}

const filteredGroups = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  const whOnly = webhookOnly.value
  return groups.value.map(g => {
    let projects = g.projects || []
    if (kw) {
      projects = projects.filter((p: any) =>
        p.name.toLowerCase().includes(kw) || p.path_with_namespace.toLowerCase().includes(kw)
      )
    }
    if (whOnly) {
      projects = projects.filter((p: any) => p.webhook_config?.is_enabled)
    }
    const webhookEnabled = projects.filter((p: any) => p.webhook_config?.is_enabled).length
    return { ...g, projects, webhookEnabled, total: projects.length }
  }).filter(g => g.projects.length > 0)
})

function findGroup(namespace: string) {
  return groups.value.find(g => g.namespace === namespace)
}

function groupState(namespace: string) {
  return findGroup(namespace) || { busy: false, busyEnable: false, busyDisable: false, msg: '', msgType: '' }
}

function toggleGroup(ns: string) {
  expandedGroups.value[ns] = !expandedGroups.value[ns]
}

function statusToResult(data: any) {
  return {
    fetched: data.fetched,
    created: data.created,
    updated: data.updated,
    skipped: data.skipped,
    isAdmin: data.isAdmin,
    total: data.totalLocal,
    logs: data.logs || []
  }
}

function applySyncStatus(data: any) {
  syncStatus.value = data
  syncing.value = !!data?.running
  if (!data?.running) stoppingSync.value = false
  if (data?.phase === 'error' && data?.error) {
    syncModalErr.value = data.error
    syncResult.value = null
  } else if (!data?.running && (data?.phase === 'done' || data?.phase === 'cancelled')) {
    syncResult.value = statusToResult(data)
    syncModalErr.value = ''
  }
}

function stopSyncPolling() {
  if (syncPollTimer) {
    clearInterval(syncPollTimer)
    syncPollTimer = null
  }
}

function startSyncPolling() {
  stopSyncPolling()
  syncPollTimer = setInterval(async () => {
    if (!syncing.value) {
      stopSyncPolling()
      return
    }
    try {
      const { data } = await api.getProjectSyncStatus()
      applySyncStatus(data)
      if (!data?.running) {
        stopSyncPolling()
        if (data?.phase === 'done' || data?.phase === 'cancelled') await fetchData()
      }
    } catch { /* ignore poll errors */ }
  }, 1200)
}

async function refreshSyncStatus() {
  try {
    const { data } = await api.getProjectSyncStatus()
    applySyncStatus(data)
    if (data?.running) startSyncPolling()
  } catch { /* ignore */ }
}

function closeSyncModal() {
  showSyncModal.value = false
  if (!syncing.value) {
    syncResult.value = null
    syncModalErr.value = ''
  }
}

async function stopSync() {
  if (!syncing.value || stoppingSync.value) return
  stoppingSync.value = true
  try {
    const { data } = await api.stopProjectSync()
    applySyncStatus(data)
    if (!data?.running) {
      stoppingSync.value = false
      stopSyncPolling()
      if (data?.phase === 'done' || data?.phase === 'cancelled') await fetchData()
    } else {
      startSyncPolling()
    }
  } catch (err: any) {
    syncModalErr.value = err?.response?.data?.error || '停止同步失败'
    stoppingSync.value = false
  }
}

async function syncProjects() {
  showSyncModal.value = true

  if (syncing.value) {
    await refreshSyncStatus()
    startSyncPolling()
    return
  }

  syncResult.value = null
  syncModalErr.value = ''
  stoppingSync.value = false
  syncing.value = true
  try {
    const { data } = await api.syncProjects()
    applySyncStatus(data)
    startSyncPolling()
  } catch (err: any) {
    syncing.value = false
    syncModalErr.value = err?.response?.data?.error || '启动同步失败'
  }
}

async function enableHook(id: number) {
  await api.enableWebhook(id)
  await fetchData()
  if (selectedProject.value?.id === id) fetchEvents()
}

async function disableHook(id: number) {
  await api.disableWebhook(id)
  await fetchData()
  if (selectedProject.value?.id === id) fetchEvents()
}

async function enableGroupHooks(namespace: string) {
  const g = findGroup(namespace)
  if (!g || g.busy) return
  g.busy = true; g.busyEnable = true; g.msg = ''; g.msgType = ''
  let resultMsg = ''
  let resultType = 'ok'
  try {
    const { data } = await api.enableGroupWebhooks(namespace)
    const enabled = data?.enabled || 0
    resultMsg = `已开启 ${enabled} 个`
    resultType = 'ok'
    await fetchData()
  } catch (err: any) {
    resultMsg = err?.response?.data?.error || '操作失败'
    resultType = 'err'
  }
  const refreshed = findGroup(namespace)
  if (refreshed) {
    refreshed.busy = false
    refreshed.busyEnable = false
    refreshed.msg = resultMsg
    refreshed.msgType = resultType
  }
  setTimeout(() => { if (findGroup(namespace)) findGroup(namespace)!.msg = '' }, 3000)
}

function confirmDisable(g: any) {
  pendingDisableGroup.value = { namespace: g.namespace, webhookEnabled: g.webhookEnabled }
  showConfirm.value = true
}

async function disableGroupHooks(namespace: string) {
  const g = findGroup(namespace)
  if (!g || g.busy) return
  g.busy = true; g.busyDisable = true; g.msg = ''; g.msgType = ''
  let resultMsg = ''
  let resultType = 'ok'
  try {
    const { data } = await api.disableGroupWebhooks(namespace)
    const disabled = data?.disabled || 0
    resultMsg = disabled > 0 ? `已关闭 ${disabled} 个` : '该分组没有已启用的 Webhook'
    resultType = disabled > 0 ? 'ok' : 'err'
    await fetchData()
  } catch (err: any) {
    resultMsg = err?.response?.data?.error || '操作失败'
    resultType = 'err'
  }
  const refreshed = findGroup(namespace)
  if (refreshed) {
    refreshed.busy = false
    refreshed.busyDisable = false
    refreshed.msg = resultMsg
    refreshed.msgType = resultType
  }
  setTimeout(() => {
    if (findGroup(namespace)) findGroup(namespace)!.msg = ''
  }, 4000)
}

async function doDisable() {
  if (!pendingDisableGroup.value) return
  const namespace = pendingDisableGroup.value.namespace
  showConfirm.value = false
  pendingDisableGroup.value = null
  await disableGroupHooks(namespace)
}

async function selectProject(p: any) {
  selectedProject.value = p
  await fetchEvents()
}

async function fetchEvents() {
  if (!selectedProject.value) return
  eventsLoading.value = true
  try {
    const { data } = await api.getEvents({ project_id: selectedProject.value.id, pageSize: 20 })
    projectEvents.value = data.items || []
  } catch { projectEvents.value = [] }
  eventsLoading.value = false
}

function viewEventDetail(e: any) {
  viewEvent.value = e
}
</script>

<style scoped>
.header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.split-layout { display: flex; gap: 16px; align-items: flex-start; }
.left-panel { flex: 1; min-width: 0; max-width: 50%; }
.right-panel { flex: 1; min-width: 0; position: sticky; top: 16px; }

/* Search */
.search-bar { margin-bottom: 12px; padding: 10px 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.search-input-wrapper { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 150px; }
.search-icon { font-size: 14px; opacity: 0.5; }
.search-input { flex: 1; border: none; background: transparent; font-size: 14px; color: var(--text-primary); outline: none; font-family: var(--font-family); }
.search-input::placeholder { color: var(--text-tertiary); }
.search-actions { flex-shrink: 0; display: flex; align-items: center; }
.filter-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 500; padding: 4px 10px;
  border: 1px solid var(--bg-tertiary); border-radius: 14px;
  background: var(--bg-primary); color: var(--text-secondary);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.filter-btn:hover { border-color: var(--accent-blue); color: var(--accent-blue); }
.filter-btn.active { background: rgba(0,113,227,0.08); border-color: var(--accent-blue); color: var(--accent-blue); }
.filter-dot { width: 6px; height: 6px; border-radius: 50%; }
.filter-dot.g { background: var(--accent-green); }
.filter-dot.gr { background: var(--text-tertiary); }

/* Groups */
.groups-list { display: flex; flex-direction: column; gap: 8px; max-height: 72vh; overflow-y: auto; }
.group-card { padding: 0; }
.group-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; cursor: pointer; user-select: none;
  border-bottom: 1px solid var(--bg-tertiary);
}
.group-header:hover { background: var(--bg-secondary); }
.group-info { display: flex; align-items: center; gap: 8px; }
.group-toggle { font-size: 10px; color: var(--text-tertiary); width: 12px; }
.group-ns { font-size: 14px; font-weight: 600; }
.group-count { font-size: 11px; color: var(--text-tertiary); }
.group-warn { font-size: 10px; color: var(--accent-orange); font-weight: 600; }
.agent-miss-tag {
  font-size: 10px; color: var(--accent-orange); text-decoration: none;
  padding: 1px 6px; border-radius: 8px; background: rgba(255,149,0,0.1);
}
.agent-miss-tag:hover { background: rgba(255,149,0,0.18); }
.agent-ok-tag { font-size: 10px; color: var(--accent-green); padding: 1px 6px; border-radius: 8px; background: rgba(52,199,89,0.1); }
.group-actions { display: flex; align-items: center; gap: 4px; }
.group-actions .apple-btn.tiny { font-size: 10px; padding: 2px 7px; }
.grp-msg { font-size: 10px; }
.grp-msg.ok { color: var(--accent-green); }
.grp-msg.err { color: var(--accent-red); }
.group-projects { display: flex; flex-direction: column; }

.project-card {
  display: flex; align-items: center; padding: 8px 14px 8px 28px;
  cursor: pointer; transition: all 0.1s;
  border-bottom: 1px solid var(--bg-tertiary);
}
.project-card:last-child { border-bottom: none; }
.project-card:hover { background: var(--bg-secondary); }
.project-card.selected { background: rgba(0,113,227,0.04); }
.project-card.selected .project-info h3 { color: var(--accent-blue); }
.project-info { flex: 1; min-width: 0; }
.project-info h3 { font-size: 13px; font-weight: 500; margin: 0; }
.project-path { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-meta { display: flex; align-items: center; gap: 4px; margin-right: 8px; flex-shrink: 0; }
.project-meta .dot { width: 5px; height: 5px; border-radius: 50%; }
.dot.g { background: var(--accent-green); }
.dot.gr { background: var(--text-tertiary); }
.wh-status { font-size: 11px; color: var(--text-secondary); }
.project-actions { flex-shrink: 0; }
.project-actions .apple-btn.tiny { font-size: 11px; padding: 2px 8px; }

/* Right Panel */
.right-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; margin-bottom: 12px; }
.right-header-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.right-header-left h2 { font-size: 16px; font-weight: 600; }
.close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-secondary); }

.empty-selection { display: flex; align-items: center; justify-content: center; min-height: 300px; text-align: center; color: var(--text-secondary); }

.events-list { display: flex; flex-direction: column; gap: 8px; max-height: 65vh; overflow-y: auto; }
.event-card { padding: 12px 14px; cursor: pointer; transition: all 0.15s; }
.event-card:hover { box-shadow: var(--shadow-md); }
.event-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
.event-header .badge { font-size: 11px; padding: 2px 8px; }
.source-num { font-weight: 700; font-size: 13px; }
.event-action { font-size: 12px; color: var(--text-secondary); }
.event-status { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.evt-dispatch { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.evt-dispatch.tone-warning { background: rgba(255,149,0,0.12); color: var(--accent-orange); }
.evt-dispatch.tone-success { background: rgba(52,199,89,0.12); color: var(--accent-green); }
.evt-dispatch.tone-error { background: rgba(255,59,48,0.1); color: var(--accent-red); }
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dot.active { background: var(--accent-blue); animation: pulse 1.5s infinite; }
.dot.completed { background: var(--accent-green); }
.dot.failed { background: var(--accent-red); }
.dot.pending { background: var(--text-tertiary); }
.event-title { font-size: 13px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-detail { font-size: 11px; color: var(--text-tertiary); display: flex; gap: 8px; }
.label-hint { opacity: 0.7; }
.event-footer { margin-top: 4px; }
.event-time { font-size: 11px; color: var(--text-tertiary); }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.badge.type-issue { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.badge.type-mr { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.badge.type-push { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.badge.type-note { background: rgba(142,142,147,0.1); color: var(--text-secondary); }
.badge.type-pipeline { background: rgba(90,200,250,0.12); color: #0a7cb5; }
.badge.type-job { background: rgba(175,82,222,0.1); color: #8b5cf6; }
.badge.type-wiki { background: rgba(88,86,214,0.12); color: #5856d6; }
.badge.type-tag { background: rgba(255,149,0,0.1); color: var(--accent-orange); }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center;
  z-index: 100; backdrop-filter: blur(2px);
}
.payload-modal { width: 680px; max-width: 90vw; max-height: 85vh; overflow-y: auto; padding: 24px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-header h3 { margin: 0; }
.event-meta-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--bg-tertiary); font-size: 13px; }
.section-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
.json-block { background: var(--bg-secondary); padding: 16px; border-radius: 8px; overflow: auto; font-size: 12px; line-height: 1.5; max-height: 350px; white-space: pre-wrap; word-break: break-word; }

.apple-btn.is-busy { cursor: pointer; }

/* Confirm Modal */
.confirm-modal { width: 400px; max-width: 90vw; padding: 24px; }
.confirm-text { font-size: 14px; color: var(--text-primary); line-height: 1.6; margin: 16px 0; }
.confirm-hint { font-size: 12px; color: var(--text-tertiary); }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

/* Skeleton */
.skeleton-line {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
