<template>
  <Teleport to="body">
    <div v-if="visible" class="gitlab-sync-overlay" @click.self="$emit('close')">
      <div class="gitlab-sync-modal card" role="dialog" aria-modal="true" aria-labelledby="gitlab-sync-title">
        <div class="gitlab-sync-head">
          <div class="gitlab-sync-title-wrap">
            <h3 id="gitlab-sync-title">GitLab 同步</h3>
            <span class="gitlab-sync-pill" :class="phaseClass">{{ phaseLabel }}</span>
          </div>
          <button
            type="button"
            class="gitlab-sync-close"
            aria-label="关闭"
            title="关闭"
            @click="$emit('close')"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <p v-if="error" class="gitlab-sync-summary err">{{ error }}</p>
        <p v-else class="gitlab-sync-summary">
          {{ message }}
          <template v-if="progressPercent !== null">
            · {{ processed }}/{{ total }}（{{ progressPercent }}%）
          </template>
        </p>

        <div v-if="progressPercent !== null" class="gitlab-sync-bar-wrap">
          <div class="gitlab-sync-bar" :style="{ width: progressPercent + '%' }"></div>
        </div>

        <div ref="logRef" class="gitlab-sync-log">
          <div v-if="syncing && !logs.length" class="gitlab-sync-log-line kind-info">
            <span class="gitlab-sync-log-ts">--:--:--</span>
            <span class="gitlab-sync-log-text">等待同步日志...</span>
          </div>
          <div
            v-for="(line, idx) in logs"
            :key="`${line.at}-${idx}`"
            class="gitlab-sync-log-line"
            :class="'kind-' + (line.kind || 'info')"
          >
            <span class="gitlab-sync-log-ts">{{ formatLogTime(line.at) }}</span>
            <span class="gitlab-sync-log-text">{{ line.text }}</span>
          </div>
        </div>

        <div class="gitlab-sync-footer">
          <button
            v-if="syncing"
            type="button"
            class="apple-btn danger"
            :disabled="stopping"
            @click="$emit('stop')"
          >
            {{ stopping ? '停止中...' : '停止同步' }}
          </button>
          <span v-else class="gitlab-sync-footer-spacer"></span>
          <button type="button" class="apple-btn" @click="$emit('close')">
            {{ syncing ? '隐藏' : '关闭' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

export type SyncLogLine = { at?: string; text: string; kind?: string }

const props = defineProps<{
  visible: boolean
  syncing: boolean
  stopping: boolean
  message: string
  error: string
  logs: SyncLogLine[]
  processed: number
  total: number
  progressPercent: number | null
  phaseLabel: string
  phaseClass: string
}>()

defineEmits<{ close: []; stop: [] }>()

const logRef = ref<HTMLElement | null>(null)

function formatLogTime(at?: string) {
  if (!at) return '--:--:--'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function scrollToBottom() {
  const el = logRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(() => props.logs, () => {
  if (!props.visible) return
  nextTick(scrollToBottom)
}, { deep: true })

watch(() => props.visible, (open) => {
  if (open) nextTick(scrollToBottom)
})
</script>

<!-- 全局样式：Teleport 到 body 后 scoped 样式常不生效 -->
<style>
.gitlab-sync-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.gitlab-sync-modal {
  width: 640px;
  max-width: 94vw;
  padding: 20px 22px 18px;
  box-shadow: var(--shadow-lg);
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
}
.gitlab-sync-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.gitlab-sync-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.gitlab-sync-title-wrap h3 {
  margin: 0;
  font-size: 17px;
  color: var(--text-primary);
}
.gitlab-sync-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
}
.gitlab-sync-close:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
.gitlab-sync-close:active {
  transform: scale(0.92);
}
.gitlab-sync-close:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
}
.gitlab-sync-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}
.gitlab-sync-pill.run { background: rgba(0, 113, 227, 0.12); color: var(--accent-blue); }
.gitlab-sync-pill.ok { background: rgba(52, 199, 89, 0.12); color: var(--accent-green); }
.gitlab-sync-pill.err { background: rgba(255, 59, 48, 0.1); color: var(--accent-red); }
.gitlab-sync-pill.warn { background: rgba(255, 149, 0, 0.12); color: var(--accent-orange); }
.gitlab-sync-pill.idle { background: var(--bg-secondary); color: var(--text-tertiary); }
.gitlab-sync-summary {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 10px;
}
.gitlab-sync-summary.err { color: var(--accent-red); }
.gitlab-sync-bar-wrap {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-tertiary);
  overflow: hidden;
  margin-bottom: 10px;
}
.gitlab-sync-bar {
  height: 100%;
  border-radius: 2px;
  background: var(--accent-blue);
  transition: width 0.25s ease;
}
.gitlab-sync-log {
  height: 360px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 8px;
  border: 1px solid #2a2a2e;
  background: #1c1c1e;
  padding: 10px 12px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.55;
}
.gitlab-sync-log-line {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 1px 0;
  white-space: nowrap;
}
.gitlab-sync-log-ts {
  flex-shrink: 0;
  color: #6e6e73;
  min-width: 62px;
}
.gitlab-sync-log-text {
  color: #d1d1d6;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gitlab-sync-log-line.kind-created .gitlab-sync-log-text { color: #30d158; }
.gitlab-sync-log-line.kind-updated .gitlab-sync-log-text { color: #64d2ff; }
.gitlab-sync-log-line.kind-skip .gitlab-sync-log-text { color: #ff9f0a; }
.gitlab-sync-log-line.kind-error .gitlab-sync-log-text { color: #ff453a; }
.gitlab-sync-log-line.kind-done .gitlab-sync-log-text { color: #30d158; font-weight: 600; }
.gitlab-sync-log-line.kind-cancelled .gitlab-sync-log-text { color: #ff9f0a; font-weight: 600; }
.gitlab-sync-log-line.kind-info .gitlab-sync-log-text { color: #98989d; }
.gitlab-sync-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.gitlab-sync-footer-spacer {
  flex: 1;
}
</style>
