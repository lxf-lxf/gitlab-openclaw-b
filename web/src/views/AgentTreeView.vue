<template>
  <div class="page pipeline-page">
    <div class="page-header">
      <div>
        <h1>Agent Pipeline</h1>
        <p>最新 Hook 事件与 Agent 执行流程</p>
      </div>
      <button class="apple-btn ghost small" @click="fetchData" :disabled="loading">刷新</button>
    </div>

    <div v-if="loading && flows.length === 0" class="flow-list">
      <div v-for="i in 6" :key="'sk'+i" class="card flow-card skeleton-card">
        <div class="skeleton-line" style="width:100%;height:14px;"></div>
        <div class="skeleton-line" style="width:60%;height:32px;margin-top:8px;"></div>
      </div>
    </div>

    <div v-else-if="flows.length === 0" class="card empty-card">
      <div class="empty-icon">⚡</div>
      <p>暂无 Agent 执行记录</p>
    </div>

    <div v-else class="flow-list">
      <div v-for="flow in flows" :key="flow.id" class="card flow-card">
        <!-- 单行摘要 -->
        <div class="flow-summary">
          <span class="badge sm" :class="'type-' + getTypeClass(flow.event_type)">{{ formatType(flow.event_type) }}</span>
          <a v-if="flow.event_source_url" :href="flow.event_source_url" target="_blank" class="src-link" @click.stop>
            {{ flow.event_source_label || sourceLabel(flow) }}
          </a>
          <span v-else-if="flow.event_source_label || sourceLabel(flow)" class="src-text">
            {{ flow.event_source_label || sourceLabel(flow) }}
          </span>
          <span class="summary-desc" :title="flow.event_desc || eventDesc(flow)">{{ flow.event_desc || eventDesc(flow) }}</span>
          <span class="summary-proj">{{ flow.project?.name }}</span>
          <span class="summary-time">{{ formatTime(flow.received_at) }}</span>
          <span class="flow-status-badge" :class="'fs-' + flow.flow_status">{{ flowStatusLabel(flow.flow_status) }}</span>
        </div>

        <!-- 横向流程（紧凑单行） -->
        <div class="flow-track-wrap">
          <div class="flow-track">
            <div class="flow-node hook-node" :title="formatType(flow.event_type)">
              <span class="node-emoji">📡</span>
              <span class="node-label">Hook</span>
            </div>

            <template v-for="s in flow.sessions" :key="s.id">
              <div class="flow-arrow" :class="'arrow-' + s.status"><span>›</span></div>
              <button
                class="flow-node agent-node"
                :class="'node-' + s.status"
                :title="nodeTooltip(s)"
                @click="openSession(s.id)"
              >
                <span class="node-emoji">{{ agentIcon(s.agent_name) }}</span>
                <span class="node-label">{{ s.agent_name }}</span>
                <span class="dot" :class="s.status"></span>
                <span class="node-status">{{ statusLabel(s.status) }}</span>
              </button>
            </template>
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

    <SessionDetailModal
      :show="!!modalSessionId"
      :session-id="modalSessionId"
      @close="modalSessionId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import ApplePagination from '@/components/ApplePagination.vue'
import SessionDetailModal from '@/components/SessionDetailModal.vue'
import { formatType, getTypeClass, formatTime, eventDesc, sourceLabel } from '@/utils/eventFormat'

const flows = ref<any[]>([])
const loading = ref(true)
const page = ref(1)
const pageSize = ref(30)
const total = ref(0)
const totalPages = ref(0)
const modalSessionId = ref<number | null>(null)

async function fetchData() {
  loading.value = true
  try {
    const { data } = await api.getPipelineFlows({ page: page.value, pageSize: pageSize.value })
    flows.value = data.items || []
    total.value = data.total || 0
    totalPages.value = data.totalPages || 0
  } catch {
    flows.value = []
  }
  loading.value = false
}

function onPageChange(p: { page: number; pageSize: number }) {
  page.value = p.page
  fetchData()
}

function openSession(id: number) {
  modalSessionId.value = id
}

function nodeTooltip(s: any) {
  const parts = [s.agent_name, statusLabel(s.status), formatTime(s.started_at)]
  if (s.fail_reason) parts.push(s.fail_reason)
  return parts.join(' · ')
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  fetchData()
  timer = setInterval(fetchData, 10000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function agentIcon(name: string) {
  if ((name || '').includes('supervisor')) return '🤖'
  if ((name || '').includes('webhook')) return '📡'
  return '⚙️'
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    active: '执行中', completed: '已完成', pending: '等待中', failed: '失败'
  }
  return map[s] || s
}

function flowStatusLabel(s: string) {
  const map: Record<string, string> = {
    running: '执行中', completed: '已完成', failed: '失败', pending: '等待中', idle: '空闲'
  }
  return map[s] || s
}
</script>

<style scoped>
.pipeline-page { display: flex; flex-direction: column; height: calc(100vh - 80px); overflow: hidden; }
.page-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 12px; flex-shrink: 0;
}
.page-header p { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); }

.flow-list {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
  padding-right: 2px;
}
.flow-list::-webkit-scrollbar { width: 5px; }
.flow-list::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 3px; }

.flow-card { padding: 8px 12px; flex-shrink: 0; }

.empty-card { text-align: center; padding: 48px; flex: 1; }
.empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.5; }

/* 单行摘要 */
.flow-summary {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; margin-bottom: 6px;
  min-height: 22px; overflow: hidden;
}
.badge.sm { font-size: 10px; padding: 1px 7px; flex-shrink: 0; }
.src-link, .src-text { font-weight: 600; color: var(--accent-blue); text-decoration: none; flex-shrink: 0; }
.src-link:hover { text-decoration: underline; }
.summary-desc {
  flex: 1; min-width: 0; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.summary-proj { color: var(--text-tertiary); flex-shrink: 0; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary-time { color: var(--text-tertiary); flex-shrink: 0; font-size: 11px; }
.flow-status-badge {
  font-size: 10px; font-weight: 600; padding: 1px 8px; border-radius: 10px; flex-shrink: 0;
}
.fs-running { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.fs-completed { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.fs-failed { background: rgba(255,59,48,0.1); color: var(--accent-red); }
.fs-pending, .fs-idle { background: var(--bg-secondary); color: var(--text-secondary); }

/* 横向紧凑流程 */
.flow-track-wrap { overflow-x: auto; }
.flow-track {
  display: flex; align-items: center; gap: 0; min-width: min-content; height: 34px;
}

.flow-node {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 10px;
  border-radius: 6px; border: 1px solid var(--bg-tertiary);
  background: var(--bg-primary); flex-shrink: 0;
  font-size: 12px; cursor: default;
}
.agent-node {
  cursor: pointer; transition: border-color 0.12s, background 0.12s;
  border: 1px solid var(--bg-tertiary); font-family: inherit;
}
.agent-node:hover { border-color: var(--accent-blue); background: rgba(0,113,227,0.04); }
.hook-node { background: var(--bg-secondary); }
.node-active { border-color: var(--accent-blue); background: rgba(0,113,227,0.06); }
.node-completed { border-color: rgba(52,199,89,0.4); }
.node-failed { border-color: rgba(255,59,48,0.4); background: rgba(255,59,48,0.04); }

.node-emoji { font-size: 14px; line-height: 1; }
.node-label { font-weight: 500; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-status { font-size: 11px; color: var(--text-secondary); }

.flow-arrow {
  display: flex; align-items: center; padding: 0 3px;
  color: var(--text-tertiary); font-size: 16px; line-height: 1; flex-shrink: 0;
}
.arrow-active { color: var(--accent-blue); }
.arrow-completed { color: var(--accent-green); }
.arrow-failed { color: var(--accent-red); }

.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot.active { background: var(--accent-blue); animation: pulse 1.5s infinite; }
.dot.completed { background: var(--accent-green); }
.dot.failed { background: var(--accent-red); }
.dot.pending { background: var(--text-tertiary); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.badge.type-issue { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.badge.type-mr { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.badge.type-push { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.badge.type-note { background: rgba(142,142,147,0.1); color: var(--text-secondary); }
.badge.type-pipeline { background: rgba(90,200,250,0.12); color: #0a7cb5; }
.badge.type-job { background: rgba(175,82,222,0.1); color: #8b5cf6; }
.badge.type-wiki { background: rgba(88,86,214,0.12); color: #5856d6; }
.badge.type-tag { background: rgba(255,149,0,0.1); color: var(--accent-orange); }

.skeleton-card { min-height: 52px; }
.skeleton-line {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
