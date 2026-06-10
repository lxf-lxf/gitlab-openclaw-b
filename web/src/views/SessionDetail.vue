<template>
  <div class="session-detail-page">
    <div class="sd-header">
      <router-link to="/sessions" style="color:var(--accent-blue);text-decoration:none;font-size:14px;">← 返回会话列表</router-link>
      <div class="sd-title-row">
        <h1>会话详情</h1>
        <span class="badge" :class="'status-' + (session?.status || '')" v-if="session">{{ statusLabel(session.status) }}</span>
      </div>
    </div>

    <div class="sd-body">
      <!-- 左侧：聊天对话框 -->
      <div class="chat-panel">
        <div class="chat-info-bar">
          <template v-if="session">
            <span class="ci-agent">{{ session.agent_name || '-' }}</span>
            <span class="ci-sep">·</span>
            <span class="ci-project">{{ session.project?.name || '-' }}</span>
            <span class="ci-sep">·</span>
            <span class="ci-time">{{ formatTime(session.started_at) }}</span>
            <span class="ci-sep">·</span>
            <span class="ci-count">{{ allMessages.length }} 条</span>
          </template>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="chat-messages-scroll">
          <div class="skeleton-bubble"></div>
          <div class="skeleton-bubble" style="width:60%;"></div>
          <div class="skeleton-bubble" style="width:45%;"></div>
        </div>
        <div v-else-if="ocLoading" class="chat-messages-scroll">
          <div class="skeleton-bubble"></div>
          <div class="skeleton-bubble" style="width:55%;"></div>
        </div>
        <div v-else-if="ocError" class="chat-messages-scroll">
          <div class="chat-error">{{ ocError }}</div>
        </div>

        <!-- Messages -->
        <template v-else-if="allMessages.length > 0">
          <div class="chat-messages-scroll" ref="chatRef">
            <div v-for="(msg, i) in allMessages" :key="msg.id || i" class="msg-row" :class="msgRowClass(msg.role)">
              <!-- Avatar -->
              <div class="msg-avatar" v-if="msg.role !== 'user'">
                <span class="av-ai" v-if="msg.role === 'assistant' || msg.role === 'system'">AI</span>
                <span class="av-tool" v-else-if="msg.role === 'tool' || msg.role === 'toolResult'">T</span>
                <span class="av-unknown" v-else>?</span>
              </div>
              <div class="msg-avatar" v-else>
                <span class="av-user">U</span>
              </div>

              <!-- Bubble -->
              <div class="msg-bubble" :class="msgBubbleClass(msg.role)" @click="toggleMsg(i)">
                <!-- Header label -->
                <div class="bub-label" :class="'lbl-' + msg.role">{{ roleLabel(msg.role) }}</div>

                <!-- Tool call bubble -- separate style for tool calls -->
                <template v-if="msg.toolCalls?.length">
                  <div v-for="(tc, ti) in msg.toolCalls" :key="ti" class="tool-call-block" @click.stop>
                    <div class="tcb-header">
                      <span class="tcb-icon">🔧</span>
                      <code class="tcb-name">{{ tc.name }}</code>
                    </div>
                    <pre class="tcb-args">{{ JSON.stringify(tc.arguments, null, 2) }}</pre>
                  </div>
                </template>

                <!-- Tool result bubble -- orange left border style -->
                <template v-if="msg.toolResult">
                  <div class="tool-result-card" @click.stop>
                    <div class="trc-header">
                      <span class="trc-icon">📎</span>
                      <span class="trc-name">{{ msg.toolResult.toolName }}</span>
                      <span :class="msg.toolResult.isError ? 'trc-err' : 'trc-ok'">{{ msg.toolResult.isError ? '失败' : '成功' }}</span>
                    </div>
                    <pre v-if="msg.toolResult.text" class="trc-text">{{ msg.toolResult.text }}</pre>
                  </div>
                </template>

                <!-- Thinking -->
                <template v-if="msg.thinking">
                  <div class="thinking-toggle" @click.stop="toggleThinking(i)">
                    {{ expandedThinking[i] ? '▼' : '▶' }} 思考过程
                  </div>
                  <pre v-if="expandedThinking[i]" class="thinking-text">{{ msg.thinking }}</pre>
                </template>

                <!-- Regular text -->
                <div v-if="msg.text && msg.role !== 'tool' && msg.role !== 'toolResult'" class="bub-text" :class="{ collapsed: !expandedMessages[i] }" @click="toggleMsg(i)">
                  {{ expandedMessages[i] ? msg.text : previewText(msg) }}
                </div>

                <!-- Footer -->
                <div class="bub-footer" v-if="msg.usage">
                  <span>输入 {{ msg.usage.input || 0 }} · 输出 {{ msg.usage.output || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="chat-messages-scroll">
          <div class="chat-empty">暂无消息</div>
        </div>
      </div>

      <!-- 右侧：信息面板 -->
      <div class="info-panel">
        <div class="info-section">
          <div class="i-title">会话信息</div>
          <div v-if="loading" class="i-skeleton">
            <div class="i-line" style="width:100px;"></div>
            <div class="i-line" style="width:80px;"></div>
          </div>
          <template v-else-if="session">
            <div class="i-grid">
              <div class="i-row"><span class="i-key">会话 ID</span><code class="i-val-code">{{ session.id }}</code></div>
              <div class="i-row" v-if="session.template_id"><span class="i-key">模板</span><span>#{{ session.template_id }}</span></div>
              <div class="i-row"><span class="i-key">Agent</span><span>{{ session.agent_name }}</span></div>
              <div class="i-row"><span class="i-key">项目</span><span>{{ session.project?.name || '-' }}</span></div>
              <div class="i-row"><span class="i-key">项目路径</span><code class="i-val-code small">{{ session.project?.path_with_namespace || '-' }}</code></div>
              <div class="i-row"><span class="i-key">状态</span><span class="badge" :class="'status-' + session.status">{{ statusLabel(session.status) }}</span></div>
              <div class="i-row"><span class="i-key">启动</span><span class="i-light">{{ formatTime(session.started_at) }}</span></div>
              <div class="i-row" v-if="session.finished_at"><span class="i-key">结束</span><span class="i-light">{{ formatTime(session.finished_at) }}</span></div>
              <div class="i-row" v-if="session.finished_at"><span class="i-key">耗时</span><span class="i-accent">{{ calcDuration(session.started_at, session.finished_at) }}</span></div>
            </div>
          </template>
        </div>

        <!-- 失败原因醒目展示 -->
        <div class="info-section" v-if="session?.status === 'failed' && session?.fail_reason">
          <div class="i-title fail-title">失败原因</div>
          <div class="fail-reason-card">
            <span class="fail-icon">⚠️</span>
            <pre class="fail-text">{{ session.fail_reason }}</pre>
          </div>
        </div>

        <div class="info-section" v-if="session?.webhook_event">
          <div class="i-title">关联事件</div>
          <div class="i-grid">
            <div class="i-row"><span class="i-key">事件 ID</span><code class="i-val-code">{{ session.webhook_event.id }}</code></div>
            <div class="i-row"><span class="i-key">类型</span><span class="badge" :class="'type-' + getTypeClassUtil(session.webhook_event.event_type)">{{ formatType(session.webhook_event.event_type) }}</span></div>
            <div class="i-row" v-if="session.webhook_event.event_action"><span class="i-key">动作</span><span>{{ session.webhook_event.event_action }}</span></div>
            <div class="i-row" v-if="session.webhook_event.source_id"><span class="i-key">来源</span><code class="i-val-code">#{{ session.webhook_event.source_id }}</code></div>
            <div class="i-row"><span class="i-key">接收</span><span class="i-light">{{ formatTime(session.webhook_event.received_at) }}</span></div>
            <div class="i-row"><span class="i-key">状态</span><span class="badge" :class="'status-' + session.webhook_event.status">{{ session.webhook_event.status }}</span></div>
          </div>
        </div>

        <div class="info-section" v-if="!loading && ocMeta">
          <div class="i-title">OpenClaw</div>
          <div class="i-grid">
            <div class="i-row"><span class="i-key">OC ID</span><code class="i-val-code small">{{ ocMeta.session_id || session?.openclaw_session_id || '-' }}</code></div>
            <div class="i-row" v-if="ocModel"><span class="i-key">模型</span><span>{{ ocModel.provider }} / {{ ocModel.modelId }}</span></div>
            <div class="i-row" v-if="ocThinking"><span class="i-key">思考</span><span :class="'think-lvl ' + ocThinking.level">{{ ocThinking.level === 'high' ? '深度' : '标准' }}</span></div>
            <div class="i-row" v-if="ocStats"><span class="i-key">消息</span><span>{{ ocStats.total_messages }} 条</span></div>
            <div class="i-row" v-if="ocStats?.total_tool_calls"><span class="i-key">工具</span><span>{{ ocStats.total_tool_calls }} 次</span></div>
            <div class="i-row" v-if="ocStats?.total_tokens"><span class="i-key">Tokens</span><span>{{ ocStats.total_tokens }}</span></div>
            <div class="i-row" v-if="ocMeta.cwd"><span class="i-key">目录</span><code class="i-val-code small">{{ ocMeta.cwd }}</code></div>
            <div class="i-row" v-if="ocMeta.version"><span class="i-key">版本</span><span>v{{ ocMeta.version }}</span></div>
          </div>
          <div class="i-roles" v-if="ocStats?.roles">
            <span v-for="(count, role) in ocStats.roles" :key="role" class="role-chip" :class="role">
              <span class="r-dot" :class="role"></span> {{ roleLabel(role) }} × {{ count }}
            </span>
          </div>
        </div>
        <div class="info-section" v-else-if="ocLoading && !loading">
          <div class="i-title">OpenClaw</div>
          <div class="i-skeleton"><div class="i-line" style="width:120px;"></div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/stores/sessions'
import api from '@/api'
import { formatType, getTypeClass as getTypeClassUtil, formatTime, eventDesc, sourceUrl, sourceLabel } from '@/utils/eventFormat'

const route = useRoute()
const store = useSessionStore()
const session = computed(() => store.current)
const loading = computed(() => store.loading)
const chatRef = ref<HTMLElement | null>(null)

const ocMessages = ref<any[]>([])
const ocMeta = ref<any>(null)
const ocModel = ref<any>(null)
const ocThinking = ref<any>(null)
const ocStats = ref<any>(null)
const ocLoading = ref(false)
const ocError = ref('')
const expandedMessages = ref<Record<number, boolean>>({})
const expandedThinking = ref<Record<number, boolean>>({})

// All messages, no filter, no pagination
const allMessages = computed(() => ocMessages.value)

function scrollToBottom() {
  nextTick(() => {
    if (chatRef.value) {
      chatRef.value.scrollTop = chatRef.value.scrollHeight
    }
  })
}

onMounted(async () => {
  await store.fetchSession(Number(route.params.id))
  await fetchOcData()
  scrollToBottom()
})

async function fetchOcData() {
  ocLoading.value = true
  ocError.value = ''
  try {
    const { data } = await api.getOpenClawSessionMessages(Number(route.params.id))
    if (data.session_id && session.value) {
      session.value.openclaw_session_id = data.session_id
    }
    ocMessages.value = data.messages || []
    ocMeta.value = data.session_meta || { session_id: data.session_id }
    ocModel.value = data.model || null
    ocThinking.value = data.thinking_level || null
    ocStats.value = data.stats || null
    if (!data.session_id && !data.messages?.length) {
      ocError.value = data.error || '此会话没有关联 OpenClaw 数据'
    } else if (!data.messages?.length && data.error) {
      ocError.value = data.error
    }
    scrollToBottom()
  } catch (err: any) {
    ocError.value = err?.response?.data?.error || '加载失败'
  }
  ocLoading.value = false
}

function toggleMsg(idx: number) { expandedMessages.value[idx] = !expandedMessages.value[idx] }
function toggleThinking(idx: number) { expandedThinking.value[idx] = !expandedThinking.value[idx] }

function msgRowClass(role: string) {
  if (role === 'user') return 'row-user'
  if (role === 'tool' || role === 'toolResult') return 'row-tool'
  return 'row-agent'
}

function msgBubbleClass(role: string) {
  if (role === 'tool' || role === 'toolResult') return 'bub-tool'
  if (role === 'user') return 'bub-user'
  return 'bub-agent'
}

function previewText(msg: any) {
  return (msg.text || '').slice(0, 150) || '(空)'
}

function roleLabel(r: string) {
  const labels: Record<string, string> = { assistant: 'Agent', user: '用户', tool: '工具', toolResult: '工具结果', system: '系统', unknown: '消息' }
  return labels[r] || r || '消息'
}
function statusLabel(s: string) {
  const labels: Record<string, string> = { active: '执行中', completed: '已完成', pending: '等待中', failed: '失败', unknown: '未知' }
  return labels[s] || s || '未知'
}
function calcDuration(s: string, e: string) {
  if (!s || !e) return ''
  const ms = new Date(e).getTime() - new Date(s).getTime()
  if (ms < 1000) return ms + 'ms'
  if (ms < 60000) return Math.round(ms / 1000) + 's'
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's'
}
function formatTime(t: string) { return t ? new Date(t).toLocaleString('zh-CN') : '' }
</script>

<style scoped>
/* ── Full-height page ── */
.session-detail-page {
  display: flex; flex-direction: column;
  height: calc(100vh - 80px);
}
.sd-header { flex-shrink: 0; margin-bottom: 12px; }
.sd-title-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.sd-title-row h1 { font-size: 20px; font-weight: 600; margin: 0; }
.sd-body {
  display: flex; gap: 16px;
  flex: 1; min-height: 0; overflow: hidden;
}

/* ── Chat Panel ── */
.chat-panel { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.chat-info-bar {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--text-secondary);
  margin-bottom: 8px; flex-shrink: 0; padding: 0 2px;
}
.ci-agent { font-weight: 600; color: var(--text-primary); }
.ci-sep { opacity: 0.4; }

.chat-messages-scroll {
  flex: 1; overflow-y: auto; padding: 12px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--bg-tertiary);
  border-radius: var(--radius-sm);
}
.chat-messages-scroll::-webkit-scrollbar { width: 6px; }
.chat-messages-scroll::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 3px; }

/* ── Message Rows ── */
.msg-row { display: flex; gap: 10px; margin-bottom: 14px; align-items: flex-start; }
.row-user { flex-direction: row-reverse; }
.row-tool { margin-left: 40px; } /* tool messages indented */

.msg-avatar { flex-shrink: 0; }
.av-ai, .av-user, .av-tool, .av-unknown {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  font-size: 11px; font-weight: 700;
}
.av-ai { background: var(--accent-blue); color: white; }
.av-user { background: var(--accent-green); color: white; }
.av-tool { background: var(--accent-orange); color: white; font-size: 10px; }
.av-unknown { background: var(--text-tertiary); color: white; font-size: 12px; }

/* ── Message Bubbles ── */
.msg-bubble {
  max-width: 80%; border-radius: 12px;
  padding: 10px 14px; line-height: 1.5;
}
.bub-agent { background: var(--bg-secondary); border: 1px solid var(--bg-tertiary); cursor: pointer; }
.bub-user { background: #0071e3; color: white; border: none; cursor: pointer; }
.bub-tool {
  background: rgba(255,149,0,0.04);
  border: 1px solid rgba(255,149,0,0.15);
  border-left: 3px solid var(--accent-orange);
  cursor: default;
}
.msg-bubble:hover { box-shadow: 0 1px 4px rgba(0,0,0,0.06); }

.bub-label { font-size: 11px; font-weight: 600; opacity: 0.65; margin-bottom: 3px; }
.row-user .bub-label { color: rgba(255,255,255,0.8); }
.lbl-tool, .lbl-toolResult { color: var(--accent-orange); opacity: 0.85; }

.bub-text {
  font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.bub-text.collapsed {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
.row-user .bub-text { color: white; }

/* ── Tool call blocks ── */
.tool-call-block {
  background: rgba(255,149,0,0.06);
  border: 1px solid rgba(255,149,0,0.12);
  border-radius: 8px; padding: 8px 10px; margin-bottom: 4px;
}
.tcb-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.tcb-icon { font-size: 13px; }
.tcb-name { font-size: 12px; font-weight: 600; color: var(--accent-orange); }
.tcb-args {
  font-size: 11px; line-height: 1.3; margin: 0;
  max-height: 80px; overflow: auto; white-space: pre-wrap;
  color: var(--text-secondary);
}

/* ── Tool result cards ── */
.tool-result-card {
  background: rgba(255,149,0,0.04);
  border: 1px solid rgba(255,149,0,0.1);
  border-left: 3px solid var(--accent-orange);
  border-radius: 8px; padding: 8px 10px; margin-bottom: 4px;
}
.trc-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.trc-icon { font-size: 13px; }
.trc-name { font-size: 12px; font-weight: 600; color: var(--accent-orange); }
.trc-ok { font-size: 11px; color: var(--accent-green); }
.trc-err { font-size: 11px; color: var(--accent-red); }
.trc-text {
  font-size: 11px; line-height: 1.3; margin: 0;
  max-height: 120px; overflow: auto; white-space: pre-wrap;
  color: var(--text-secondary);
}

/* ── Thinking ── */
.thinking-toggle {
  font-size: 11px; color: var(--accent-blue); cursor: pointer;
  opacity: 0.6; user-select: none; margin-bottom: 4px;
}
.thinking-toggle:hover { opacity: 1; }
.thinking-text {
  margin: 4px 0; padding: 8px; background: var(--bg-primary);
  border-radius: 6px; font-size: 11px; line-height: 1.4;
  color: var(--text-secondary); max-height: 150px; overflow: auto;
  white-space: pre-wrap;
}
.row-user .thinking-text { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.85); }

.bub-footer { margin-top: 4px; font-size: 10px; opacity: 0.5; font-family: monospace; }
.row-user .bub-footer { color: rgba(255,255,255,0.6); }

/* ── Info Panel ── */
.info-panel {
  width: 280px; flex-shrink: 0; display: flex; flex-direction: column;
  gap: 8px; overflow-y: auto;
}
.info-panel::-webkit-scrollbar { width: 4px; }
.info-panel::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 2px; }

.info-section {
  padding: 14px 16px; border-radius: var(--radius-sm);
  border: 1px solid var(--bg-tertiary); background: var(--bg-primary);
}
.i-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 10px; }
.i-grid { display: flex; flex-direction: column; gap: 5px; }
.i-row { display: flex; flex-direction: column; gap: 1px; }
.i-key { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; }
.i-val-code { font-family: monospace; font-size: 12px; background: var(--bg-secondary); padding: 1px 6px; border-radius: 3px; display: inline-block; word-break: break-all; color: var(--text-primary); }
.i-val-code.small { font-size: 11px; }
.i-light { font-size: 13px; color: var(--text-secondary); }
.i-accent { font-size: 13px; color: var(--accent-blue); }
.i-roles { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.role-chip { font-size: 10px; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 2px; }
.role-chip.assistant { background: rgba(0,113,227,0.08); color: var(--accent-blue); }
.role-chip.user { background: rgba(52,199,89,0.08); color: var(--accent-green); }
.role-chip.tool { background: rgba(255,149,0,0.08); color: var(--accent-orange); }
.role-chip.toolResult { background: rgba(255,149,0,0.08); color: var(--accent-orange); }
.role-chip.unknown { background: rgba(142,142,147,0.08); color: var(--text-secondary); }
.r-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.think-lvl { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.think-lvl.high { background: rgba(255,149,0,0.1); color: var(--accent-orange); }
.think-lvl.low { background: rgba(142,142,147,0.1); color: var(--text-secondary); }

.i-skeleton { display: flex; flex-direction: column; gap: 8px; }
.i-line {
  height: 14px; border-radius: 4px;
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%; animation: shimmer 1.5s infinite;
}

.skeleton-bubble {
  height: 36px; width: 75%; margin-bottom: 12px; border-radius: 12px;
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%; animation: shimmer 1.5s infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.chat-error, .chat-empty { padding: 40px 16px; text-align: center; color: var(--text-secondary); font-size: 14px; }
.chat-error { color: var(--accent-red); }

/* 失败原因 */
.fail-title { color: var(--accent-red); }
.fail-reason-card {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px; margin-top: 4px;
  background: rgba(255,59,48,0.06);
  border: 1px solid rgba(255,59,48,0.15);
  border-radius: 10px;
}
.fail-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.fail-text {
  margin: 0; font-size: 12px; line-height: 1.5; color: var(--accent-red);
  white-space: pre-wrap; word-break: break-all; font-family: inherit;
}
</style>
