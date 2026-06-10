<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="session-modal card">
      <div class="modal-header">
        <div class="modal-title">
          <h3>{{ session?.agent_name || '会话详情' }}</h3>
          <span v-if="session" class="badge" :class="'status-' + session.status">{{ statusLabel(session.status) }}</span>
        </div>
        <button class="close-btn" @click="close">✕</button>
      </div>

      <div v-if="loading" class="modal-loading">加载中...</div>
      <div v-else-if="session" class="modal-body">
        <div class="chat-side">
          <div class="chat-bar">
            <span>{{ session.project?.name }}</span>
            <span class="sep">·</span>
            <span>{{ formatTime(session.started_at) }}</span>
            <span class="sep">·</span>
            <span>{{ messages.length }} 条</span>
          </div>
          <div v-if="ocLoading" class="chat-scroll loading-hint">加载消息...</div>
          <div v-else-if="ocError" class="chat-scroll error-hint">{{ ocError }}</div>
          <div v-else class="chat-scroll" ref="chatRef">
            <div v-if="!messages.length" class="empty-hint">暂无消息</div>
            <div v-for="(msg, i) in messages" :key="msg.id || i" class="msg-row" :class="msg.role === 'user' ? 'row-user' : ''">
              <div class="msg-bubble" :class="msg.role === 'user' ? 'bub-user' : 'bub-agent'">
                <div class="bub-label">{{ roleLabel(msg.role) }}</div>
                <div v-if="msg.text" class="bub-text">{{ (msg.text || '').slice(0, 500) }}{{ (msg.text || '').length > 500 ? '…' : '' }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="info-side">
          <div class="info-block">
            <div class="ib-title">会话</div>
            <div class="ib-row"><span>ID</span><code>#{{ session.id }}</code></div>
            <div class="ib-row"><span>项目</span><span>{{ session.project?.path_with_namespace }}</span></div>
            <div class="ib-row" v-if="session.finished_at"><span>耗时</span><span>{{ calcDuration(session.started_at, session.finished_at) }}</span></div>
            <div class="ib-row" v-if="session.openclaw_session_id"><span>OC ID</span><code class="small">{{ session.openclaw_session_id }}</code></div>
          </div>
          <div class="info-block fail-block" v-if="session.status === 'failed' && session.fail_reason">
            <div class="ib-title fail">失败原因</div>
            <pre class="fail-text">{{ session.fail_reason }}</pre>
          </div>
          <div class="info-block" v-if="session.webhook_event">
            <div class="ib-title">关联事件</div>
            <div class="ib-row"><span>类型</span><span>{{ formatType(session.webhook_event.event_type) }}</span></div>
            <div class="ib-row" v-if="session.webhook_event.event_desc"><span>描述</span><span class="desc">{{ session.webhook_event.event_desc }}</span></div>
          </div>
          <router-link :to="`/sessions/${session.id}`" class="full-link" @click="close">打开完整详情 →</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import api from '@/api'
import { formatType, formatTime } from '@/utils/eventFormat'

const props = defineProps<{ show: boolean; sessionId: number | null }>()
const emit = defineEmits<{ close: [] }>()

const session = ref<any>(null)
const messages = ref<any[]>([])
const loading = ref(false)
const ocLoading = ref(false)
const ocError = ref('')
const chatRef = ref<HTMLElement | null>(null)

watch(() => [props.show, props.sessionId], async ([show, id]) => {
  if (!show || !id) return
  await loadSession(Number(id))
}, { immediate: true })

async function loadSession(id: number) {
  loading.value = true
  ocError.value = ''
  messages.value = []
  session.value = null
  try {
    const { data } = await api.getSession(id)
    session.value = data
  } catch {
    ocError.value = '加载会话失败'
    loading.value = false
    return
  }
  loading.value = false
  await loadMessages(id)
}

async function loadMessages(id: number) {
  ocLoading.value = true
  ocError.value = ''
  try {
    const { data } = await api.getOpenClawSessionMessages(id)
    messages.value = data.messages || []
    if (!messages.value.length && data.error) ocError.value = data.error
    await nextTick()
    if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight
  } catch (err: any) {
    ocError.value = err?.response?.data?.error || '加载消息失败'
  }
  ocLoading.value = false
}

function close() { emit('close') }

function roleLabel(r: string) {
  const m: Record<string, string> = { assistant: 'Agent', user: '用户', tool: '工具', toolResult: '工具结果', system: '系统' }
  return m[r] || r || '消息'
}
function statusLabel(s: string) {
  const m: Record<string, string> = { active: '执行中', completed: '已完成', pending: '等待中', failed: '失败' }
  return m[s] || s
}
function calcDuration(s: string, e: string) {
  if (!s || !e) return ''
  const ms = new Date(e).getTime() - new Date(s).getTime()
  if (ms < 60000) return Math.round(ms / 1000) + 's'
  return Math.floor(ms / 60000) + 'm'
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(2px);
}
.session-modal {
  width: 920px; max-width: 94vw; max-height: 82vh;
  display: flex; flex-direction: column; padding: 0; overflow: hidden;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; border-bottom: 1px solid var(--bg-tertiary); flex-shrink: 0;
}
.modal-title { display: flex; align-items: center; gap: 8px; }
.modal-title h3 { margin: 0; font-size: 16px; }
.close-btn {
  background: none; border: none; font-size: 18px; cursor: pointer;
  color: var(--text-secondary); padding: 4px 8px; border-radius: 4px;
}
.close-btn:hover { background: var(--bg-secondary); }
.modal-loading { padding: 40px; text-align: center; color: var(--text-secondary); }
.modal-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

.chat-side { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--bg-tertiary); }
.chat-bar {
  padding: 8px 14px; font-size: 12px; color: var(--text-secondary);
  border-bottom: 1px solid var(--bg-tertiary); flex-shrink: 0;
}
.sep { opacity: 0.4; margin: 0 4px; }
.chat-scroll {
  flex: 1; overflow-y: auto; padding: 12px 14px; min-height: 280px; max-height: calc(82vh - 120px);
}
.loading-hint, .error-hint, .empty-hint {
  padding: 40px 16px; text-align: center; font-size: 13px; color: var(--text-secondary);
}
.error-hint { color: var(--accent-red); }

.msg-row { display: flex; margin-bottom: 10px; }
.row-user { justify-content: flex-end; }
.msg-bubble { max-width: 85%; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
.bub-agent { background: var(--bg-secondary); border: 1px solid var(--bg-tertiary); }
.bub-user { background: #0071e3; color: white; }
.bub-label { font-size: 10px; font-weight: 600; opacity: 0.6; margin-bottom: 2px; }
.bub-text { white-space: pre-wrap; word-break: break-word; }

.info-side {
  width: 260px; flex-shrink: 0; overflow-y: auto; padding: 12px;
  display: flex; flex-direction: column; gap: 10px;
}
.info-block {
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--bg-tertiary); background: var(--bg-primary);
}
.ib-title { font-size: 10px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px; }
.ib-title.fail { color: var(--accent-red); }
.ib-row { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; font-size: 12px; }
.ib-row span:first-child { font-size: 10px; color: var(--text-tertiary); }
.ib-row code { font-family: monospace; font-size: 11px; background: var(--bg-secondary); padding: 1px 5px; border-radius: 3px; }
.ib-row code.small { word-break: break-all; }
.ib-row .desc { line-height: 1.4; color: var(--text-secondary); }
.fail-block { background: rgba(255,59,48,0.04); border-color: rgba(255,59,48,0.15); }
.fail-text { margin: 0; font-size: 11px; color: var(--accent-red); white-space: pre-wrap; word-break: break-word; }
.full-link { font-size: 12px; color: var(--accent-blue); text-decoration: none; margin-top: auto; }
.full-link:hover { text-decoration: underline; }
</style>
