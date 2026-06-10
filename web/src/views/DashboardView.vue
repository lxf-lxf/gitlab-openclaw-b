<template>
  <div class="page">
    <div class="page-header compact">
      <div>
        <h1>仪表盘</h1>
        <p>GitLab B 端中台概览</p>
      </div>
      <div class="header-extra">
        <div class="oc-mini">
          <span class="oc-dot" :class="openclawStatus.available ? 'on' : 'off'"></span>
          <span class="oc-label">OpenClaw</span>
          <span v-if="openclawStatus.version" class="oc-ver">{{ openclawStatus.version }}</span>
        </div>
      </div>
    </div>

    <!-- 首次使用提示 -->
    <div v-if="hasToken === false" class="card setup-card">
      <div class="setup-content">
        <div class="setup-icon">⚙️</div>
        <div class="setup-text">
          <h3>首次使用？先配置 GitLab Token</h3>
          <p>需要配置超级管理员 Token 才能同步项目列表和管理 Webhook</p>
        </div>
        <router-link to="/settings" class="apple-btn primary">去配置</router-link>
      </div>
    </div>

    <!-- 流程阻塞告警 -->
    <div v-if="!loading && hasFlowIssues" class="card flow-alert-card">
      <div class="flow-alert-head">
        <span class="flow-alert-title">⚠️ Agent 调度提示</span>
        <router-link to="/events?dispatch=skipped" class="col-link">查看相关事件</router-link>
      </div>
      <div class="flow-alert-body">
        <div v-for="(b, i) in flowBlockers" :key="'b'+i" class="flow-blocker-row" :class="'sev-' + b.severity">
          <span class="flow-blocker-msg">{{ b.message }}</span>
          <router-link v-if="b.link" :to="b.link" class="flow-blocker-action">{{ b.action }}</router-link>
        </div>
        <div v-if="recentSkippedEvents.length" class="skipped-events">
          <div class="unbound-head">最近未匹配触发规则的事件</div>
          <div v-for="e in recentSkippedEvents.slice(0, 5)" :key="e.id" class="skipped-row">
            <span class="badge mini-badge" :class="'type-' + getTypeClass(e.event_type)">{{ formatType(e.event_type) }}</span>
            <span class="skipped-proj">{{ e.project?.path_with_namespace || e.project?.name }}</span>
            <span v-if="e.source_id" class="skipped-src">#{{ e.source_id }}</span>
            <span class="badge mini-badge dispatch-warn">{{ e.dispatch_label }}</span>
            <span class="skipped-hint">{{ e.dispatch_hint }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 统计卡片行 -->
    <div v-if="!loading" class="stats-grid">
      <div class="card stat-card">
        <div class="sc-icon-wrap" style="background:rgba(0,113,227,0.08)"><span class="sc-icon">📦</span></div>
        <div class="sc-body"><span class="sc-label">项目总数</span><span class="sc-value">{{ stats.projects }}</span></div>
      </div>
      <div class="card stat-card">
        <div class="sc-icon-wrap" style="background:rgba(175,82,222,0.08)"><span class="sc-icon">📡</span></div>
        <div class="sc-body"><span class="sc-label">事件总数</span><span class="sc-value">{{ stats.events }}</span></div>
      </div>
      <div class="card stat-card">
        <div class="sc-icon-wrap" style="background:rgba(52,199,89,0.08)"><span class="sc-icon">🔗</span></div>
        <div class="sc-body"><span class="sc-label">已启用 Webhook</span><span class="sc-value">{{ stats.webhookEnabled }}</span></div>
      </div>
      <div class="card stat-card">
        <div class="sc-icon-wrap" style="background:rgba(255,149,0,0.08)"><span class="sc-icon">🤖</span></div>
        <div class="sc-body"><span class="sc-label">Agent 模板</span><span class="sc-value">{{ stats.templates }}</span></div>
      </div>
      <div class="card stat-card">
        <div class="sc-icon-wrap" style="background:rgba(52,199,89,0.08)"><span class="sc-icon">🚀</span></div>
        <div class="sc-body"><span class="sc-label">已部署 Agent</span><span class="sc-value">{{ stats.deployedAgent || 0 }}</span></div>
      </div>
      <div class="card stat-card">
        <div class="sc-icon-wrap" style="background:rgba(0,113,227,0.08)"><span class="sc-icon">⚡</span></div>
        <div class="sc-body"><span class="sc-label">执行中会话</span><span class="sc-value">{{ stats.activeSessions }}</span></div>
      </div>
    </div>
    <div v-else class="stats-grid">
      <div v-for="i in 6" :key="'sk'+i" class="card stat-card">
        <div class="skeleton-line" style="width:36px;height:36px;border-radius:10px;margin-bottom:6px;"></div>
        <div class="skeleton-line" style="width:50px;height:10px;"></div>
        <div class="skeleton-line" style="width:36px;height:20px;margin-top:4px;"></div>
      </div>
    </div>

    <!-- 主区域 -->
    <div class="main-area">
      <!-- 左侧卡片：流水线 + 最近事件 -->
      <div class="card">
        <div class="left-split">
          <div class="left-col">
            <div class="col-head">
              <span class="col-title">活跃流水线</span>
              <router-link to="/agents" class="col-link">更多</router-link>
            </div>
            <div v-if="loading" class="skeleton-line" style="width:100%;height:50px;"></div>
            <template v-else>
              <div v-if="activePipelines.length === 0" class="empty-small">暂无</div>
              <div v-else class="scroll-list">
                <div v-for="p in activePipelines" :key="p.project?.id || p.event?.id" class="pipe-item">
                  <div class="pipe-head">
                    <strong class="pipe-name">{{ p.project?.name || '-' }}</strong>
                    <span class="live-tag"><span class="live-dot"></span>执行中</span>
                  </div>
                  <div class="pipe-event" v-if="p.event">
                    <span class="badge mini-badge" :class="'type-' + getTypeClass(p.event.event_type)">{{ formatType(p.event.event_type) }}</span>
                    <span v-if="p.event.source_id" class="pipe-src">#{{ p.event.source_id }}</span>
                    <span class="pipe-title">{{ getIssueTitle(p.event) }}</span>
                  </div>
                  <div class="pipe-steps">
                    <span v-for="(s, i) in p.sessions" :key="s.id" class="pipe-step">
                      <span v-if="i > 0" class="pipe-arr">→</span>
                      <span class="pipe-sname">{{ agentLabel(s.agent_name) }}</span>
                      <span class="pipe-dot" :class="s.status"></span>
                    </span>
                  </div>
                  <div class="pipe-ts">{{ formatTime(p.event?.received_at) }}</div>
                </div>
              </div>
            </template>
          </div>
          <div class="left-col right-col">
            <div class="col-head">
              <span class="col-title">最近事件</span>
              <router-link to="/events" class="col-link">更多</router-link>
            </div>
            <div v-if="loading" class="skeleton-line" style="width:100%;height:50px;"></div>
            <template v-else>
              <div v-if="recentEvents.length === 0" class="empty-small">暂无</div>
              <div v-else class="scroll-list">
                <div v-for="e in recentEvents" :key="e.id" class="evt-item" @click="viewEvent(e)">
                  <span class="badge mini-badge" :class="'type-' + getTypeClass(e.event_type)">{{ formatType(e.event_type) }}</span>
                  <div class="evt-body">
                    <div class="evt-project" v-if="eventProject(e)" :title="eventProjectFull(e)">{{ eventProject(e) }}</div>
                    <div class="evt-desc">{{ eventDesc(e) }}</div>
                    <div class="evt-meta">
                      <span v-if="e.source_id">#{{ e.source_id }}</span>
                      <span>{{ formatTime(e.received_at) }}</span>
                    </div>
                  </div>
                  <span class="badge mini-badge" :class="e.dispatch_tone === 'success' ? 'status-completed' : (e.dispatch_tone === 'warning' ? 'dispatch-warn-badge' : 'status-' + e.status)">{{ e.dispatch_label || e.status }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 右侧卡片：图表 + 覆盖 -->
      <div class="card right-card">
        <div class="right-split">
          <div class="chart-area">
            <div class="chart-section">
              <div class="chart-head">事件类型分布</div>
              <div v-if="loading" class="skeleton-line" style="width:100%;height:40px;"></div>
              <template v-else>
                <div v-if="eventTypeDistribution.length === 0" class="empty-small">暂无</div>
                <div v-else class="tree-scroll">
                  <div v-for="d in eventTypeDistribution" :key="d.type" class="tree-row">
                    <span class="tree-dot" :style="{ background: typeColors[d.type] || '#666' }"></span>
                    <span class="tree-label">{{ eventTypeLabel(d.type) }}</span>
                    <div class="tree-track">
                      <div class="tree-fill" :style="{ width: treePercent(eventTypeDistribution, d.count), background: typeColors[d.type] || '#666' }"></div>
                    </div>
                    <span class="tree-num">{{ d.count }}</span>
                  </div>
                </div>
              </template>
            </div>
            <div class="chart-divider"></div>
            <div class="chart-section">
              <div class="chart-head">Agent 调用</div>
              <div v-if="loading" class="skeleton-line" style="width:100%;height:40px;"></div>
              <template v-else>
                <div v-if="agentCallStats.length === 0" class="empty-small">暂无</div>
                <div v-else class="tree-scroll">
                  <div v-for="a in agentCallStats" :key="a.agent_name" class="tree-row">
                    <span class="tree-dot" :style="{ background: agentColor(a.agent_name) }"></span>
                    <span class="tree-label">{{ a.agent_name }}</span>
                    <div class="tree-track">
                      <div class="tree-fill" :style="{ width: agentBarPercent(a.count), background: agentColor(a.agent_name) }"></div>
                    </div>
                    <span class="tree-num">{{ a.count }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div class="cov-area">
            <svg viewBox="0 0 72 72" class="cov-svg">
              <circle cx="36" cy="36" r="28" fill="none" stroke="var(--bg-secondary)" stroke-width="8" />
              <circle cx="36" cy="36" r="28" fill="none"
                :stroke="coverageColor" stroke-width="8"
                :stroke-dasharray="covCirc" :stroke-dashoffset="covOff"
                transform="rotate(-90, 36, 36)" stroke-linecap="round" />
            </svg>
            <div class="cov-text">
              <span class="cov-pct">{{ coveragePercent }}%</span>
              <span class="cov-lbl">Webhook 覆盖率</span>
              <div class="cov-detail">
                <span class="cov-d"><span class="c-dot g"></span>{{ agentCoveredProjects }} 已启用</span>
                <span class="cov-d"><span class="c-dot gr"></span>{{ stats.projects - agentCoveredProjects }} 未启用</span>
                <span class="cov-d total">共 {{ stats.projects }} 项目</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { subscribeAppWs } from '@/utils/appWs'
import { formatType, getTypeClass, eventDesc, getIssueTitle, formatTime, eventTypeLabel } from '@/utils/eventFormat'

const hasToken = ref<boolean | null>(null)
const loading = ref(true)
const stats = ref({ projects: 0, events: 0, activeSessions: 0, webhookEnabled: 0, templates: 0, deployedAgent: 0 })
const openclawStatus = ref({ available: false, version: null, error: null })
const activePipelines = ref<any[]>([])
const recentEvents = ref<any[]>([])
const eventTypeDistribution = ref<any[]>([])
const agentCallStats = ref<any[]>([])
const agentCoveredProjects = ref(0)
const flowBlockers = ref<any[]>([])
const recentSkippedEvents = ref<any[]>([])
const flowDiagnostics = ref<any>({ hasEventTemplates: true })
const selectedEvent = ref<any>(null)

const hasFlowIssues = computed(() =>
  !flowDiagnostics.value.hasEventTemplates || flowBlockers.value.length > 0 || recentSkippedEvents.value.length > 0
)

let unsubscribeWs: (() => void) | null = null

function applyDashboardData(data: any) {
  hasToken.value = data.stats ? (data.stats.projects > 0 || data.stats.events > 0) : null
  stats.value = data.stats || { projects: 0, events: 0, activeSessions: 0, webhookEnabled: 0, templates: 0, deployedAgent: 0 }
  openclawStatus.value = data.openclawStatus || { available: false, version: null, error: null }
  activePipelines.value = data.activePipelines || []
  recentEvents.value = data.recentEvents || []
  eventTypeDistribution.value = data.eventTypeDistribution || []
  agentCallStats.value = data.agentCallStats || []
  agentCoveredProjects.value = data.agentCoveredProjects || 0
  const fd = data.flowDiagnostics || {}
  flowDiagnostics.value = fd
  flowBlockers.value = fd.blockers || []
  recentSkippedEvents.value = fd.recentSkippedEvents || []
}

async function fetchDashboard(initial = false) {
  if (initial) loading.value = true
  try {
    const { data } = await api.getDashboard()
    applyDashboardData(data)
  } catch { /* ignore */ }
  if (initial) loading.value = false
}

onMounted(() => {
  fetchDashboard(true)
  unsubscribeWs = subscribeAppWs((msg) => {
    if (msg?.type === 'dashboard' && msg.dashboard) {
      applyDashboardData(msg.dashboard)
    }
  })
})
onUnmounted(() => { unsubscribeWs?.() })

function agentLabel(name: string) {
  const m: Record<string,string> = { 'webhook':'Webhook','supervisor-dev':'开发','supervisor':'开发' }
  for (const [k,v] of Object.entries(m)) { if ((name||'').includes(k)) return v }
  return name||'-'
}

function viewEvent(e: any) { selectedEvent.value = e }

function eventProject(e: any) {
  return e.project?.path_with_namespace || e.project?.name || ''
}

function eventProjectFull(e: any) {
  const path = e.project?.path_with_namespace
  const name = e.project?.name
  if (path && name && path !== name) return `${path} (${name})`
  return path || name || ''
}

function agentBarPercent(count: number) {
  const maxVal = Math.max(...agentCallStats.value.map(a => a.count), 1)
  return (count / maxVal * 100) + '%'
}
function agentColor(name: string) {
  const colors = ['#0071e3','#34c759','#ff9f0a','#ff3b30','#af52de','#5ac8fa','#ff9500','#5856d6']
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}
function treePercent(items: any[], count: number) {
  const maxVal = Math.max(...items.map((d: any) => d.count), 1)
  return (count / maxVal * 100) + '%'
}

const typeColors: Record<string, string> = {
  'Push Hook':'#ff9f0a','Issue Hook':'#0071e3','Merge Request Hook':'#34c759',
  'Note Hook':'#8e8e93','Pipeline Hook':'#af52de','Job Hook':'#5ac8fa',
  'Wiki Page Hook':'#5856d6','Tag Push Hook':'#ff9500'
}
const coveragePercent = computed(() => Math.round((agentCoveredProjects.value / (stats.value.projects || 1)) * 100))
const coverageColor = computed(() => {
  const p = coveragePercent.value; return p >= 60 ? '#34c759' : p >= 30 ? '#ff9f0a' : '#ff3b30'
})
const covCirc = computed(() => 2 * Math.PI * 28)
const covOff = computed(() => covCirc.value * (1 - coveragePercent.value / 100))
</script>

<style scoped>
.page-header.compact { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.page-header.compact h1 { font-size: 20px; }
.page-header.compact p { font-size: 13px; }
.header-extra { display: flex; align-items: center; gap: 6px; }
.oc-mini { display: flex; align-items: center; gap: 4px; font-size: 12px; }
.oc-dot { width: 7px; height: 7px; border-radius: 50%; }
.oc-dot.on { background: var(--accent-green); box-shadow: 0 0 3px rgba(52,199,89,0.4); }
.oc-dot.off { background: var(--text-tertiary); }
.oc-label { color: var(--text-secondary); }
.oc-ver { font-size: 10px; color: var(--text-tertiary); font-family: monospace; }

.setup-card { background: linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%); border: none; padding: 12px 16px; }

.flow-alert-card { margin-bottom: 10px; padding: 12px 14px; border: 1px solid rgba(255,149,0,0.25); background: rgba(255,149,0,0.05); }
.flow-alert-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.flow-alert-title { font-size: 13px; font-weight: 600; color: var(--accent-orange); }
.flow-blocker-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 6px 0; font-size: 12px; }
.flow-blocker-msg { color: var(--text-primary); flex: 1; }
.flow-blocker-action { color: var(--accent-blue); text-decoration: none; white-space: nowrap; font-size: 12px; }
.flow-blocker-action:hover { text-decoration: underline; }
.unbound-list, .skipped-events { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bg-tertiary); }
.unbound-head { font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.unbound-items { display: flex; flex-wrap: wrap; gap: 6px; }
.unbound-chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--bg-secondary); color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unbound-more { font-size: 11px; color: var(--text-tertiary); }
.skipped-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 4px 0; font-size: 11px; }
.skipped-proj { font-weight: 600; color: var(--accent-blue); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skipped-src { font-weight: 700; }
.skipped-hint { color: var(--text-tertiary); flex: 1; min-width: 120px; }
.badge.dispatch-warn, .badge.dispatch-warn-badge { background: rgba(255,149,0,0.12); color: var(--accent-orange); }

/* ── Stats grid: 3×2 with icon+data ── */
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
.stat-card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; }
.sc-icon-wrap {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.sc-icon { font-size: 18px; }
.sc-body { display: flex; flex-direction: column; min-width: 0; }
.sc-label { font-size: 12px; color: var(--text-secondary); }
.sc-value { font-size: 28px; font-weight: 700; color: var(--text-primary); letter-spacing: -1px; line-height: 1.2; }

/* ── Main area: left + right ── */
.main-area { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; min-height: 0; }

/* ── Left card: split two columns ── */
.left-split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; min-height: 360px; }
.left-col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.col-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.col-title { font-size: 13px; font-weight: 600; }
.col-link { font-size: 11px; color: var(--accent-blue); text-decoration: none; }
.scroll-list { flex: 1; overflow-y: auto; min-height: 0; padding-right: 4px; }
.scroll-list::-webkit-scrollbar { width: 4px; }
.scroll-list::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 2px; }
.empty-small { text-align: center; padding: 20px; color: var(--text-secondary); font-size: 12px; }

/* ── Pipeline items ── */
.pipe-item { padding: 8px 10px; border: 1px solid var(--bg-tertiary); border-radius: var(--radius-sm); margin-bottom: 6px; }
.pipe-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.pipe-name { font-size: 12px; font-weight: 600; }
.live-tag { font-size: 10px; color: var(--accent-green); display: flex; align-items: center; gap: 3px; }
.live-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-green); animation: pulse 1.5s infinite; }
.pipe-event { display: flex; align-items: center; gap: 3px; font-size: 11px; margin-bottom: 4px; flex-wrap: wrap; }
.mini-badge { font-size: 9px !important; padding: 1px 5px !important; border-radius: 2px !important; }
.pipe-src { font-weight: 700; font-size: 11px; }
.pipe-title { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; font-size: 11px; }
.pipe-steps { display: flex; align-items: center; gap: 1px; flex-wrap: wrap; margin-bottom: 3px; }
.pipe-step { display: flex; align-items: center; gap: 2px; font-size: 11px; }
.pipe-arr { color: var(--accent-blue); font-size: 10px; }
.pipe-sname { color: var(--text-primary); }
.pipe-dot { width: 4px; height: 4px; border-radius: 50%; }
.pipe-dot.active { background: var(--accent-blue); animation: pulse 1.5s infinite; }
.pipe-dot.completed { background: var(--accent-green); }
.pipe-dot.failed { background: var(--accent-red); }
.pipe-ts { font-size: 10px; color: var(--text-tertiary); padding-top: 4px; border-top: 1px solid var(--bg-tertiary); }

/* ── Event items ── */
.evt-item { display: flex; align-items: flex-start; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--bg-tertiary); cursor: pointer; min-height: 36px; }
.evt-item:last-child { border-bottom: none; }
.evt-item:hover { background: var(--bg-secondary); margin: 0 -6px; padding: 6px 8px; border-radius: var(--radius-sm); }
.evt-body { flex: 1; min-width: 0; }
.evt-project { font-size: 11px; font-weight: 600; color: var(--accent-blue); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
.evt-desc { font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.35; }
.evt-item .badge:last-child { flex-shrink: 0; }
.evt-meta { display: flex; gap: 6px; font-size: 10px; color: var(--text-tertiary); }

/* ── Right card: charts + coverage ── */
.right-card { padding: 14px 16px; display: flex; flex-direction: column; }
.right-split { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.chart-area { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.chart-section { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.chart-head { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
.chart-divider { height: 1px; background: var(--bg-tertiary); margin: 4px 0; }

/* Tree bars - scrollable */
.tree-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.tree-scroll::-webkit-scrollbar { width: 4px; }
.tree-scroll::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 2px; }
.tree-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.tree-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.tree-label { font-size: 11px; color: var(--text-secondary); min-width: 40px; white-space: nowrap; }
.tree-track { flex: 1; height: 12px; background: var(--bg-secondary); border-radius: 6px; overflow: hidden; }
.tree-fill { height: 100%; border-radius: 6px; transition: width 0.4s ease; }
.tree-num { font-size: 11px; font-weight: 600; color: var(--text-primary); min-width: 22px; text-align: right; }

/* ── Coverage inline ── */
.cov-area { display: flex; align-items: center; gap: 12px; padding-top: 8px; border-top: 1px solid var(--bg-tertiary); }
.cov-svg { width: 52px; height: 52px; flex-shrink: 0; }
.cov-text { display: flex; flex-direction: column; gap: 1px; }
.cov-pct { font-size: 18px; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
.cov-lbl { font-size: 10px; color: var(--text-tertiary); }
.cov-detail { display: flex; gap: 8px; margin-top: 2px; flex-wrap: wrap; }
.cov-d { font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 3px; }
.cov-d.total { color: var(--text-tertiary); }
.c-dot { width: 5px; height: 5px; border-radius: 50%; }
.c-dot.g { background: var(--accent-green); }
.c-dot.gr { background: var(--bg-tertiary); }

/* ── Skeleton ── */
.skeleton-line { background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

/* ── Badges ── */
.badge.type-issue { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.badge.type-mr { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.badge.type-push { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.badge.type-note { background: rgba(142,142,147,0.1); color: var(--text-secondary); }
.badge.type-pipeline { background: rgba(142,142,147,0.15); color: var(--text-secondary); }
.badge.type-job { background: rgba(142,142,147,0.15); color: var(--text-secondary); }
.badge.type-wiki { background: rgba(88,86,214,0.12); color: #5856d6; }
.badge.type-tag { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.badge.status-active { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.badge.status-completed { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.badge.status-failed { background: rgba(255,59,48,0.1); color: var(--accent-red); }

@media (max-width: 960px) {
  .main-area { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
