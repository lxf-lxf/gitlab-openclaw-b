<template>
  <div class="notif-bell-wrapper" ref="wrapperRef">
    <button class="bell-btn" @click="togglePanel" :class="{ hasUnread: unreadCount > 0 }">
      <span class="bell-icon">🔔</span>
      <span class="bell-dot" v-if="unreadCount > 0">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>

    <transition name="panel-fade">
      <div v-if="showPanel" class="notif-panel">
        <div class="np-header">
          <span class="np-title">通知</span>
          <button class="np-clear" @click="clearAll" v-if="notifications.length > 0">清空</button>
        </div>
        <div class="np-list" ref="listRef">
          <div v-if="notifications.length === 0" class="np-empty">暂无通知</div>
          <div
            v-for="n in notifications"
            :key="n.id"
            class="np-item"
            :class="'nt-' + n.type"
          >
            <div class="np-item-header" @click="openDetail(n)">
              <span class="np-icon">{{ iconMap[n.type] || 'ℹ️' }}</span>
              <span class="np-title-text">{{ n.title }}</span>
              <span class="np-read-dot" v-if="!n.read"></span>
              <span class="np-time">{{ timeAgo(n.timestamp) }}</span>
            </div>
            <p class="np-msg" @click="openDetail(n)">{{ n.message }}</p>
            <div class="np-item-footer">
              <span class="np-view-link" @click="openDetail(n)">查看详情 →</span>
              <!-- 操作按钮 -->
              <div class="np-actions" v-if="n.actions?.length && !n.actioned" @click.stop>
                <button
                  v-for="act in n.actions"
                  :key="act"
                  class="apple-btn tiny"
                  :class="{ primary: act === '确定', 'action-dismiss': act === '取消' }"
                  @click="handleAction(n, act)"
                >{{ act }}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="np-footer" v-if="notifications.length > 0">
          <router-link to="/settings" class="np-link" @click="showPanel = false">通知设置 →</router-link>
        </div>
      </div>
    </transition>

    <!-- 通知详情弹窗（普通类型） -->
    <div v-if="detailNotif && detailNotif.type !== 'report'" class="modal-overlay" @click.self="closeDetail">
      <div class="modal-content card notif-detail-modal">
        <div class="modal-header">
          <h3>
            <span class="nd-icon">{{ iconMap[detailNotif.type] || 'ℹ️' }}</span>
            {{ detailNotif.title }}
          </h3>
          <button class="close-btn" @click="closeDetail">✕</button>
        </div>
        <div class="nd-meta">
          <span class="badge" :class="'nt-' + detailNotif.type">{{ typeLabel(detailNotif.type) }}</span>
          <span class="nd-time">{{ formatFullTime(detailNotif.timestamp) }}</span>
          <span v-if="detailNotif.read" class="nd-read">已读</span>
          <span v-if="detailNotif.actioned" class="nd-actioned">已操作: {{ detailNotif.actioned }}</span>
        </div>
        <div class="nd-body">
          <pre class="nd-message">{{ detailNotif.message }}</pre>
        </div>
        <div class="nd-footer">
          <button v-if="detailNotif.link" class="apple-btn primary" @click="goToLink(detailNotif)">
            跳转到相关页面 →
          </button>
          <div class="nd-actions" v-if="detailNotif.actions?.length && !detailNotif.actioned" @click.stop>
            <button
              v-for="act in detailNotif.actions"
              :key="act"
              class="apple-btn"
              :class="{ primary: act === '确定', 'action-dismiss': act === '取消' }"
              @click="handleAction(detailNotif, act)"
            >{{ act }}</button>
          </div>
          <button class="apple-btn" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>

    <!-- 报告弹窗（report 类型） -->
    <div v-if="detailNotif && detailNotif.type === 'report'" class="modal-overlay" @click.self="closeDetail">
      <div class="modal-content card report-detail-modal">
        <div class="modal-header">
          <div class="report-header-left">
            <h3>
              <span class="nd-icon">{{ iconMap[detailNotif.type] || '📊' }}</span>
              {{ detailNotif.title }}
            </h3>
            <div class="nd-meta" style="margin-bottom:0;border-bottom:none;padding-bottom:0;">
              <span class="badge nt-report">{{ typeLabel(detailNotif.type) }}</span>
              <span class="nd-time">{{ formatFullTime(detailNotif.timestamp) }}</span>
            </div>
          </div>
          <button class="close-btn" @click="closeDetail">✕</button>
        </div>
        <div class="report-body">
          <ReportViewer :sections="reportSections" :key="reportSections.length" />
        </div>
        <div class="nd-footer">
          <button class="apple-btn" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import api from '@/api'
import ReportViewer from '@/components/ReportViewer.vue'
import { subscribeAppWs } from '@/utils/appWs'

const MAX_VISIBLE = 30
const notifications = ref<any[]>([])
const unreadCount = ref(0)
const showPanel = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
// Detail modal
const detailNotif = ref<any>(null)
// Report viewer
const reportSections = computed(() => detailNotif.value?.reportData || [])
let unsubscribeWs: (() => void) | null = null

const iconMap: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
  success: '✅',
  report: '📊'
}

function typeLabel(t: string) {
  return { info: '信息', warning: '警告', error: '错误', success: '成功', report: '日报' }[t] || t
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  return `${Math.floor(hr / 24)}天前`
}

function formatFullTime(ts: string) {
  return new Date(ts).toLocaleString('zh-CN')
}

function handleWsMessage(data: any) {
  if (data.type === 'history' && Array.isArray(data.notifications)) {
    const existingIds = new Set(notifications.value.map(n => n.id))
    for (const n of data.notifications.reverse()) {
      if (!existingIds.has(n.id)) {
        notifications.value.unshift(n)
        existingIds.add(n.id)
      }
    }
    if (notifications.value.length > MAX_VISIBLE) {
      notifications.value = notifications.value.slice(0, MAX_VISIBLE)
    }
  }
  if (data.type === 'notification') {
    notifications.value.unshift(data.notification)
    if (notifications.value.length > MAX_VISIBLE) {
      notifications.value = notifications.value.slice(0, MAX_VISIBLE)
    }
    if (!showPanel.value) {
      unreadCount.value++
    }
  }
}

function togglePanel() {
  showPanel.value = !showPanel.value
  if (showPanel.value) {
    unreadCount.value = 0
    nextTick(() => { if (listRef.value) listRef.value.scrollTop = 0 })
  }
}

function clearAll() {
  notifications.value = []
  unreadCount.value = 0
}

function openDetail(n: any) {
  detailNotif.value = n
  // 标记已读
  if (!n.read) {
    n.read = true
    api.markNotificationRead(n.id).catch(() => {})
  }
}

function closeDetail() {
  detailNotif.value = null
}

function goToLink(n: any) {
  if (n.link) {
    showPanel.value = false
    closeDetail()
    window.location.hash = '#/' + n.link.replace(/^\//, '')
  }
}

async function handleAction(n: any, action: string) {
  try {
    await api.notificationAction(n.id, action)
    n.actions = null
    n.actioned = action
    n.read = true
  } catch {}
}

function onDocumentClick(e: MouseEvent) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    showPanel.value = false
  }
}

onMounted(() => {
  unsubscribeWs = subscribeAppWs(handleWsMessage)
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  unsubscribeWs?.()
  document.removeEventListener('click', onDocumentClick)
})
</script>

<style scoped>
.notif-bell-wrapper {
  position: fixed;
  top: 16px;
  right: 24px;
  z-index: 100;
}
.bell-btn {
  position: relative;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-secondary);
  border: none; border-radius: 50%;
  cursor: pointer;
  transition: background 0.2s;
  font-size: 16px;
}
.bell-btn:hover { background: var(--bg-tertiary); }
.bell-btn.hasUnread { background: rgba(0,113,227,0.08); }
.bell-dot {
  position: absolute;
  top: -2px; right: -2px;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  background: var(--accent-red);
  color: white;
  font-size: 9px;
  font-weight: 600;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.notif-panel {
  position: absolute;
  top: 44px;
  right: 0;
  width: 380px;
  max-height: 520px;
  background: var(--bg-primary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.np-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.np-title { font-size: 15px; font-weight: 600; }
.np-clear {
  background: none; border: none;
  font-size: 12px; color: var(--text-tertiary);
  cursor: pointer;
}
.np-clear:hover { color: var(--accent-red); }
.np-list { flex: 1; overflow-y: auto; max-height: 380px; }
.np-empty { padding: 40px 16px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.np-item {
  padding: 10px 16px 6px;
  transition: background 0.15s;
  border-bottom: 1px solid var(--bg-tertiary);
}
.np-item:last-child { border-bottom: none; }
.np-item:hover { background: var(--bg-secondary); }
.np-item.nt-error { border-left: 3px solid var(--accent-red); }
.np-item.nt-warning { border-left: 3px solid var(--accent-orange); }
.np-item.nt-info { border-left: 3px solid var(--accent-blue); }
.np-item.nt-success { border-left: 3px solid var(--accent-green); }
.np-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
  cursor: pointer;
}
.np-icon { font-size: 12px; flex-shrink: 0; }
.np-title-text { font-size: 13px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-read-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent-blue); flex-shrink: 0;
}
.np-time { font-size: 10px; color: var(--text-tertiary); flex-shrink: 0; }
.np-msg {
  margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  cursor: pointer;
}
.np-item-footer {
  display: flex; align-items: center; gap: 8px; margin-top: 4px;
}
.np-view-link {
  font-size: 10px; color: var(--accent-blue); cursor: pointer;
  opacity: 0.7; white-space: nowrap;
}
.np-view-link:hover { opacity: 1; }
.np-actions {
  display: flex; gap: 6px; margin-left: auto;
}
.apple-btn.tiny { padding: 2px 10px; font-size: 10px; }
.action-dismiss { background: transparent; border: 1px solid var(--bg-tertiary); color: var(--text-secondary); }
.np-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--bg-tertiary);
  text-align: center;
}
.np-link { font-size: 12px; color: var(--text-tertiary); text-decoration: none; }
.np-link:hover { color: var(--accent-blue); }
.panel-fade-enter-active, .panel-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.panel-fade-enter-from, .panel-fade-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── Modal ── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(2px);
}
.notif-detail-modal {
  width: 520px; max-width: 90vw; max-height: 80vh;
  display: flex; flex-direction: column; padding: 24px;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
}
.modal-header h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px; }
.close-btn {
  background: var(--bg-tertiary); border: none;
  font-size: 16px; cursor: pointer; color: var(--text-secondary);
  padding: 4px 10px; border-radius: 6px;
  transition: all 0.15s;
  line-height: 1;
}
.close-btn:hover { background: var(--text-tertiary); color: var(--text-primary); }
.nd-icon { font-size: 20px; }
.nd-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.nd-meta .badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
.nd-meta .badge.nt-info { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.nd-meta .badge.nt-warning { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.nd-meta .badge.nt-error { background: rgba(255,59,48,0.1); color: var(--accent-red); }
.nd-meta .badge.nt-success { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.nd-time { font-size: 12px; color: var(--text-tertiary); }
.nd-read, .nd-actioned { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.nd-read { background: rgba(142,142,147,0.1); color: var(--text-secondary); }
.nd-actioned { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.nd-body { flex: 1; overflow-y: auto; margin-bottom: 16px; }
.nd-message {
  margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-primary);
  white-space: pre-wrap; word-break: break-word; font-family: inherit;
}
.nd-footer {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding-top: 12px; border-top: 1px solid var(--bg-tertiary);
}
.nd-actions { display: flex; gap: 6px; }

/* Override for action-dismiss button */
.action-dismiss { background: transparent !important; border: 1px solid var(--bg-tertiary) !important; color: var(--text-secondary) !important; }

/* ── Report Modal ── */
.report-detail-modal {
  width: 640px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 24px;
}
.report-header-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.report-body {
  flex: 1;
  overflow-y: auto;
  margin: 16px 0;
  padding-right: 4px;
}
.report-body::-webkit-scrollbar {
  width: 4px;
}
.report-body::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 2px;
}
.badge.nt-report {
  background: rgba(90, 200, 250, 0.15);
  color: #0071e3;
}
</style>
