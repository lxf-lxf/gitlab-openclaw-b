<template>
  <div class="page">
    <div class="page-header">
      <h1>会话消息</h1>
      <p>最新的 Agent 会话记录</p>
    </div>

    <!-- 搜索栏 -->
    <div class="card filter-card">
      <div class="filter-bar">
        <div class="search-wrapper">
          <span class="s-icon">🔍</span>
          <input v-model="searchText" placeholder="搜索项目名、Agent 名..." class="search-input" @input="onSearchDebounce" />
        </div>
        <select v-model="filterStatus" @change="fetchData" class="filter-select">
          <option value="">全部状态</option>
          <option value="completed">已完成</option>
          <option value="active">执行中</option>
          <option value="failed">失败</option>
        </select>
      </div>
    </div>

    <!-- 加载骨架 -->
    <div v-if="loading" class="session-list">
      <div v-for="i in 4" :key="'sk'+i" class="card skeleton-card">
        <div class="skeleton-line" style="width:100%;height:52px;"></div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="sessions.length === 0" class="card" style="text-align:center;padding:48px;">
      <p>暂无会话记录</p>
    </div>

    <!-- 扁平记录列表 -->
    <div v-else class="session-list">
      <div v-for="s in sessions" :key="s.id" class="card session-card">
        <!-- 第一行：项目 + Agent 徽章 + 状态徽章 -->
        <div class="sc-top-row">
          <div class="sc-project-wrap">
            <span class="sc-project-icon">📁</span>
            <span class="sc-project-name">{{ s.project?.name || '-' }}</span>
            <span class="sc-project-path">{{ s.project?.path_with_namespace }}</span>
          </div>
          <div class="sc-top-right">
            <span class="agent-badge" :class="'agt-' + getAgentClass(s.agent_name)">{{ s.agent_name || 'Agent' }}</span>
            <span class="status-badge" :class="'st-' + s.status">
              <span class="sb-dot" :class="s.status"></span>
              {{ statusLabel(s.status) }}
            </span>
          </div>
        </div>

        <!-- 第二行：事件信息 + 时间 -->
        <div class="sc-mid-row">
          <div class="sc-events">
            <span class="badge mini" :class="'type-' + getTypeClass(s.webhook_event?.event_type)">{{ formatType(s.webhook_event?.event_type) }}</span>
            <span v-if="s.webhook_event?.source_id" class="sc-source">#{{ s.webhook_event.source_id }}</span>
            <span v-if="s.webhook_event?.event_action" class="sc-action">{{ s.webhook_event.event_action }}</span>
            <span v-if="s.event_title" class="sc-title">{{ s.event_title }}</span>
          </div>
          <div class="sc-times">
            <span class="sc-time">{{ formatTime(s.started_at) }}</span>
            <span v-if="s.finished_at" class="sc-dur">· 耗时 {{ calcDuration(s.started_at, s.finished_at) }}</span>
          </div>
        </div>

        <!-- 失败原因 -->
        <div v-if="s.status === 'failed' && s.fail_reason" class="sc-fail-reason">
          <span class="fr-icon">⚠️</span>
          <span class="fr-text">{{ s.fail_reason }}</span>
        </div>

        <!-- 底部：OC ID + 操作 -->
        <div class="sc-footer">
          <span v-if="s.openclaw_session_id" class="sc-oc">🦞 OC {{ s.openclaw_session_id.slice(0, 8) }}…</span>
          <span v-else class="sc-oc-placeholder"></span>
          <div class="sc-actions">
            <router-link v-if="s.status !== 'active'" :to="'/sessions/' + s.id" class="sc-link">查看详情 →</router-link>
            <span v-else class="sc-active-label">执行中…</span>
          </div>
        </div>
      </div>
    </div>

    <ApplePagination
      v-if="totalPages > 1"
      :page="page"
      :pageSize="pageSize"
      :total="total"
      :totalPages="totalPages"
      @change="onPageChange"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'
import ApplePagination from '@/components/ApplePagination.vue'
import { formatType, getTypeClass, formatTime } from '@/utils/eventFormat'

const sessions = ref<any[]>([])
const loading = ref(true)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const totalPages = ref(0)
const searchText = ref('')
const filterStatus = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | null = null
function onSearchDebounce() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { page.value = 1; fetchData() }, 300)
}

async function fetchData() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (searchText.value.trim()) params.keyword = searchText.value.trim()
    if (filterStatus.value) params.status = filterStatus.value
    const { data } = await api.getSessions(params)
    sessions.value = data.items || []
    total.value = data.total || 0
    totalPages.value = data.totalPages || 0
  } catch { sessions.value = [] }
  loading.value = false
}

onMounted(fetchData)

function onPageChange(p: { page: number }) {
  page.value = p.page
  fetchData()
}

function statusLabel(s: string) {
  return ({ completed: '已完成', active: '执行中', pending: '等待中', failed: '失败' })[s] || s
}
function getAgentClass(name: string) {
  const colors = ['blue','green','orange','purple','teal','pink']
  let hash = 0; for (let i = 0; i < (name||'').length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i)
  return colors[Math.abs(hash) % colors.length]
}
function formatTime(t: string) { return t ? new Date(t).toLocaleString('zh-CN') : '-' }
function calcDuration(s: string, e: string) {
  if (!s || !e) return ''
  const ms = new Date(e).getTime() - new Date(s).getTime()
  if (ms < 1000) return ms + 'ms'
  if (ms < 60000) return Math.round(ms / 1000) + 's'
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's'
}
</script>

<style scoped>
.filter-card { margin-bottom: 12px; }
.filter-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.search-wrapper { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 180px; }
.s-icon { font-size: 14px; opacity: 0.5; }
.search-input { flex: 1; border: none; background: transparent; font-size: 14px; color: var(--text-primary); outline: none; font-family: var(--font-family); }
.search-input::placeholder { color: var(--text-tertiary); }
.filter-select {
  font-family: var(--font-family); font-size: 13px; padding: 6px 12px;
  border: none; border-radius: var(--radius-sm); background: var(--bg-secondary);
  color: var(--text-primary); cursor: pointer;
}
.filter-select:focus { outline: none; background: var(--bg-tertiary); }

.session-list { display: flex; flex-direction: column; gap: 8px; }

/* Session Card — compact */
.session-card { padding: 12px 14px; }

/* Top row: project + agent badge + status badge */
.sc-top-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
}
.sc-project-wrap {
  display: flex; align-items: center; gap: 5px; min-width: 0; flex: 1;
}
.sc-project-icon { font-size: 13px; flex-shrink: 0; }
.sc-project-name { font-size: 14px; font-weight: 600; white-space: nowrap; }
.sc-project-path { font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sc-top-right {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}

/* Agent badge — colored pill */
.agent-badge {
  font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 10px;
  white-space: nowrap;
}
.agt-blue   { background: rgba(0,113,227,0.12); color: var(--accent-blue); }
.agt-green  { background: rgba(52,199,89,0.12); color: var(--accent-green); }
.agt-orange { background: rgba(255,149,0,0.12); color: var(--accent-orange); }
.agt-purple { background: rgba(175,82,222,0.12); color: #8b5cf6; }
.agt-teal   { background: rgba(90,200,250,0.12); color: #0a7cb5; }
.agt-pink   { background: rgba(255,45,85,0.10); color: #e91e63; }

/* Status badge */
.status-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 10px;
}
.st-completed { background: rgba(52,199,89,0.12); color: var(--accent-green); }
.st-active    { background: rgba(0,113,227,0.12); color: var(--accent-blue); }
.st-failed    { background: rgba(255,59,48,0.10); color: var(--accent-red); }
.st-pending   { background: var(--bg-secondary); color: var(--text-secondary); }
.sb-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.sb-dot.completed { background: var(--accent-green); }
.sb-dot.active    { background: var(--accent-blue); animation: pulse 1.5s infinite; }
.sb-dot.failed    { background: var(--accent-red); }
.sb-dot.pending   { background: var(--text-tertiary); }

/* Mid row: event info + time */
.sc-mid-row {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 6px; gap: 8px;
}
.sc-events { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
.badge.mini { font-size: 10px !important; padding: 1px 7px !important; border-radius: 3px; }
.sc-source { font-weight: 700; font-size: 12px; color: var(--text-primary); }
.sc-action { font-size: 11px; color: var(--text-secondary); }
.sc-title { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.sc-times { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; white-space: nowrap; }
.sc-dur { color: var(--accent-blue); }

/* Footer: OC ID + link */
.sc-footer {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--bg-tertiary);
}
.sc-oc { font-size: 10px; font-family: monospace; padding: 1px 6px; background: var(--bg-secondary); border-radius: 4px; color: var(--text-tertiary); }
.sc-oc-placeholder { flex: 1; }
.sc-actions { flex-shrink: 0; }
.sc-link { font-size: 12px; color: var(--accent-blue); text-decoration: none; font-weight: 500; }
.sc-link:hover { text-decoration: underline; }
.sc-active-label { font-size: 12px; color: var(--accent-blue); }

/* Failed reason */
.sc-fail-reason {
  display: flex; align-items: flex-start; gap: 5px; padding: 5px 0 0;
  font-size: 11px; color: var(--accent-red); line-height: 1.4;
}
.fr-icon { flex-shrink: 0; font-size: 11px; margin-top: 1px; }
.fr-text { word-break: break-all; }

/* Badge colors for event type */
.badge.type-issue    { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.badge.type-mr       { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.badge.type-push     { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.badge.type-note     { background: rgba(142,142,147,0.1); color: var(--text-secondary); }
.badge.type-pipeline { background: rgba(90,200,250,0.12); color: #0a7cb5; }
.badge.type-job      { background: rgba(175,82,222,0.1); color: #8b5cf6; }
.badge.type-wiki     { background: rgba(88,86,214,0.12); color: #5856d6; }
.badge.type-tag      { background: rgba(255,149,0,0.1); color: var(--accent-orange); }

@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

/* Skeleton */
.skeleton-card { padding: 12px 14px; }
.skeleton-line {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%; animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
