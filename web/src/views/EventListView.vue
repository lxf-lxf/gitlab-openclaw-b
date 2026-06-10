<template>
  <div class="page">
    <div class="page-header">
      <div v-if="!currentProject">
        <h1>事件管理</h1>
        <p>Webhook 事件列表（仅查看）</p>
      </div>
      <div v-else>
        <router-link to="/projects" style="color:var(--accent-blue);text-decoration:none;font-size:14px;">← 项目列表</router-link>
        <h1 style="margin-top:8px;">{{ currentProject }}</h1>
        <p>项目关联的 Webhook 事件</p>
      </div>
    </div>

    <div class="card filter-card">
      <div class="filter-bar">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input type="text" v-model="searchText" placeholder="搜索事件内容..." class="search-input" @input="onSearchInput" />
        </div>
        <select v-model="filter.event_type" @change="store.setFilter({ event_type: filter.event_type })" class="filter-select">
          <option value="">全部类型</option>
          <option v-for="t in allEventTypes" :key="t" :value="t">{{ formatType(t) }}</option>
        </select>
        <select v-model="filter.status" @change="store.setFilter({ status: filter.status })" class="filter-select">
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
        </select>
        <select v-model="filter.dispatch" @change="store.setFilter({ dispatch: filter.dispatch })" class="filter-select">
          <option value="">全部调度</option>
          <option value="skipped">未匹配规则</option>
          <option value="dispatched">已调度</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="event-table-wrapper card" style="padding:0;">
      <table class="data-table">
        <thead>
          <tr>
            <th>类型</th><th>描述</th><th>来源</th><th>项目</th><th>状态</th><th>Agent 调度</th><th>时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in 5" :key="'sk'+i">
            <td><div class="skeleton-line" style="width:50px;height:18px;"></div></td>
            <td><div class="skeleton-line" style="width:120px;height:18px;"></div></td>
            <td><div class="skeleton-line" style="width:40px;height:18px;"></div></td>
            <td><div class="skeleton-line" style="width:80px;height:18px;"></div></td>
            <td><div class="skeleton-line" style="width:50px;height:18px;"></div></td>
            <td><div class="skeleton-line" style="width:100px;height:18px;"></div></td>
            <td><div class="skeleton-line" style="width:40px;height:18px;"></div></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="events.length === 0" class="empty-state">
      <p>{{ keyword ? '没有匹配的事件' : '暂无事件' }}</p>
    </div>
    <div v-else class="event-table-wrapper card" style="padding:0;">
      <table class="data-table">
        <thead>
          <tr>
            <th>类型</th><th>描述</th><th>来源</th><th>项目</th><th>状态</th><th>Agent 调度</th><th>时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td>
              <span class="badge" :class="'type-' + getTypeClass(e.event_type)">{{ formatType(e.event_type) }}</span>
            </td>
            <td class="event-desc-cell">
              <div class="event-desc">{{ eventDesc(e) }}</div>
            </td>
            <td>
              <span v-if="sourceUrl(e)" class="source-link" @click.stop>
                <a :href="sourceUrl(e)!" target="_blank" class="source-anchor" @click.stop>{{ sourceLabel(e) }} ↗</a>
              </span>
              <span v-else-if="sourceLabel(e)" class="badge">{{ sourceLabel(e) }}</span>
              <span v-else class="text-muted">-</span>
            </td>
            <td>{{ e.project?.name || '-' }}</td>
            <td><span class="badge" :class="'status-' + e.status">{{ e.status }}</span></td>
            <td class="dispatch-cell">
              <span class="badge dispatch-badge" :class="dispatchBadgeClass(e.dispatch_tone)" :title="e.dispatch_hint">{{ e.dispatch_label || '-' }}</span>
              <div v-if="e.dispatch_code === 'no_trigger_match' && e.dispatch_hint" class="dispatch-hint">{{ e.dispatch_hint }}</div>
            </td>
            <td class="text-muted nowrap">{{ formatTime(e.received_at) }}</td>
            <td>
              <button class="apple-btn ghost small" @click="viewPayload(e)">查看</button>
              <button v-if="e.dispatch_code === 'no_trigger_match'" class="apple-btn ghost small" @click="retryEvent(e.id)">重试</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ApplePagination v-if="totalPages > 1" :page="page" :pageSize="pageSize" :total="total" :totalPages="totalPages" @change="onPageChange" />

    <!-- 左右分栏详情弹窗 -->
    <div v-if="viewEvent" class="modal-overlay" @click.self="viewEvent = null">
      <div class="modal-content card payload-modal">
        <div class="modal-header">
          <h3>事件详情 #{{ viewEvent.id }}</h3>
          <button class="close-btn" @click="viewEvent = null">✕</button>
        </div>
        <div class="event-meta-bar">
          <span class="badge" :class="'type-' + getTypeClass(viewEvent.event_type)">{{ viewEvent.event_type }}</span>
          <span class="badge" :class="'status-' + viewEvent.status">{{ viewEvent.status }}</span>
          <span v-if="sourceUrl(viewEvent)">
            来源: <a :href="sourceUrl(viewEvent)!" target="_blank" class="source-anchor">{{ sourceLabel(viewEvent) }} ↗</a>
          </span>
          <span v-else-if="sourceLabel(viewEvent)">来源: {{ sourceLabel(viewEvent) }}</span>
          <span v-if="viewEvent.event_action">动作: {{ viewEvent.event_action }}</span>
          <span v-if="viewEvent.project?.name">{{ viewEvent.project.name }}</span>
        </div>
        <div v-if="viewEvent.dispatch_label" class="dispatch-detail card-inline">
          <span class="badge dispatch-badge" :class="dispatchBadgeClass(viewEvent.dispatch_tone)">{{ viewEvent.dispatch_label }}</span>
          <p class="dispatch-detail-text">{{ viewEvent.dispatch_hint }}</p>
          <router-link v-if="viewEvent.dispatch_link" :to="viewEvent.dispatch_link" class="dispatch-link">去处理 →</router-link>
        </div>
        <div class="split-detail">
          <div class="split-left">
            <h4 class="section-label">请求头 (Headers)</h4>
            <pre class="json-block">{{ formatHeaders(viewEvent.raw_headers) }}</pre>
          </div>
          <div class="split-divider"></div>
          <div class="split-right">
            <h4 class="section-label">入参 (Payload)</h4>
            <pre class="json-block">{{ JSON.stringify(viewEvent.payload, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useEventStore } from '@/stores/events'
import ApplePagination from '@/components/ApplePagination.vue'
import { ALL_EVENT_TYPES, formatType, getTypeClass, eventDesc, sourceUrl, sourceLabel, formatTime, formatHeaders } from '@/utils/eventFormat'
import { dispatchBadgeClass } from '@/utils/eventDispatch'

const route = useRoute()
const store = useEventStore()

const events = computed(() => store.list)
const loading = computed(() => store.loading)
const page = computed(() => store.page)
const pageSize = computed(() => store.pageSize)
const total = computed(() => store.total)
const totalPages = computed(() => store.totalPages)
const keyword = computed(() => store.keyword)

const filter = reactive({ event_type: '', status: '', dispatch: '' })
const searchText = ref('')
const viewEvent = ref<any>(null)
const currentProject = ref('')

const allEventTypes = ALL_EVENT_TYPES

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setKeyword(searchText.value.trim()), 300)
}

onMounted(() => {
  const projectId = route.query.project_id as string
  const projectName = route.query.project_name as string
  const dispatch = route.query.dispatch as string
  if (dispatch) {
    filter.dispatch = dispatch
    store.setFilter({ dispatch })
  }
  if (projectId) {
    currentProject.value = projectName || `项目 #${projectId}`
    store.setFilter({ project_id: projectId })
  } else if (!dispatch) {
    store.fetchEvents()
  }
})

function onPageChange(p: { page: number; pageSize: number }) {
  store.setPage(p.page)
}

function viewPayload(e: any) {
  viewEvent.value = e
}

async function retryEvent(id: number) {
  await store.retryEvent(id)
}

</script>

<style scoped>
.filter-card { margin-bottom: 16px; }
.filter-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.filter-select {
  font-family: var(--font-family); font-size: 13px; padding: 6px 12px;
  border: none; border-radius: var(--radius-sm); background: var(--bg-secondary);
  color: var(--text-primary); cursor: pointer;
}
.filter-select:focus { outline: none; background: var(--bg-tertiary); }
.search-input-wrapper { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px; }
.search-icon { font-size: 14px; opacity: 0.5; }
.search-input { flex: 1; border: none; background: transparent; font-size: 14px; color: var(--text-primary); outline: none; font-family: var(--font-family); }
.search-input::placeholder { color: var(--text-tertiary); }
.text-muted { color: var(--text-secondary); font-size: 13px; }
.nowrap { white-space: nowrap; }

/* Skeleton */
.skeleton-line {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.dispatch-cell { max-width: 200px; min-width: 120px; }
.dispatch-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; line-height: 1.35; }
.dispatch-badge.dispatch-ok { background: rgba(52,199,89,0.12); color: var(--accent-green); }
.dispatch-badge.dispatch-warn { background: rgba(255,149,0,0.12); color: var(--accent-orange); }
.dispatch-badge.dispatch-err { background: rgba(255,59,48,0.1); color: var(--accent-red); }
.dispatch-badge.dispatch-info { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.dispatch-badge.dispatch-muted { background: rgba(142,142,147,0.12); color: var(--text-secondary); }
.dispatch-detail { margin-bottom: 16px; padding: 12px 14px; background: var(--bg-secondary); border-radius: 8px; }
.dispatch-detail-text { margin: 8px 0 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.dispatch-link { font-size: 13px; color: var(--accent-blue); text-decoration: none; }
.dispatch-link:hover { text-decoration: underline; }

.event-desc-cell { max-width: 220px; min-width: 150px; }
.event-desc { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }

.source-link { display: inline-block; }
.source-anchor { font-size: 13px; font-weight: 700; color: var(--accent-blue); text-decoration: none; padding: 2px 8px; border-radius: 4px; }
.source-anchor:hover { background: rgba(0,113,227,0.08); text-decoration: underline; }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center;
  z-index: 100; backdrop-filter: blur(2px);
}
.payload-modal { width: 900px; max-width: 92vw; max-height: 85vh; padding: 24px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-header h3 { margin: 0; }
.close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-secondary); }
.event-meta-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--bg-tertiary); font-size: 13px; }
.section-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.3px; }

/* Left-right split */
.split-detail { display: flex; gap: 16px; min-height: 300px; }
.split-left { flex: 1; min-width: 0; }
.split-right { flex: 1; min-width: 0; }
.split-divider { width: 1px; background: var(--bg-tertiary); flex-shrink: 0; }
.json-block {
  background: var(--bg-secondary); padding: 16px; border-radius: 8px;
  overflow: auto; font-size: 12px; line-height: 1.5; max-height: 55vh;
  white-space: pre-wrap; word-break: break-word; margin: 0;
}
</style>
