<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1>Agent 模板</h1>
        <p>配置 Agent 模板与触发规则；已启用 Webhook 的项目将按规则自动匹配并调度 Agent。</p>
      </div>
      <button class="apple-btn primary" @click="addTemplate">新建模板</button>
    </div>

    <div v-if="loading" class="template-grid">
      <div v-for="i in 2" :key="'sk'+i" class="card template-card">
        <div class="template-header">
          <div class="template-info">
            <div class="skeleton-line" style="width:140px;height:18px;"></div>
          </div>
        </div>
        <div class="skeleton-line" style="width:200px;height:14px;margin-top:8px;"></div>
        <div class="skeleton-line" style="width:160px;height:14px;margin-top:6px;"></div>
        <div class="skeleton-line" style="width:120px;height:12px;margin-top:6px;"></div>
      </div>
    </div>
    <div v-else-if="templates.length === 0" class="card" style="text-align:center;padding:64px;">
      <p>暂无模板</p>
      <p style="color:var(--text-secondary);font-size:14px;margin-top:8px;">点击上方按钮创建第一个 Agent 模板</p>
    </div>
    <div v-else class="template-grid">
      <div v-for="t in templates" :key="t.id" class="card template-card">
        <div class="template-header">
          <div class="template-info">
            <h3>{{ t.name }}</h3>
            <span class="badge" :class="t.is_active ? 'status-active' : ''">
              {{ t.is_active ? '启用' : '停用' }}
            </span>
            <span class="badge type-mode" :class="'mode-' + (t.trigger_mode || 'manual')">
              {{ t.trigger_mode === 'event' ? '事件触发' : '自定义' }}
            </span>
          </div>
          <div class="template-actions">
            <button class="apple-btn" @click="editTemplate(t)">编辑</button>
            <button class="apple-btn danger" @click="deleteTemplate(t)">删除</button>
          </div>
        </div>
        <p class="template-desc" v-if="t.description">{{ t.description }}</p>

        <!-- 配置展示 -->
        <div class="config-info" v-if="t.agent_config">
          <div class="config-section trigger-summary" v-if="t.trigger_mode === 'event' && displayTriggers(t).length">
            <span class="config-label">触发规则：</span>
            <div class="trigger-tags">
              <span v-for="(rule, ri) in displayTriggers(t)" :key="ri" class="tag trigger-tag">{{ formatRule(rule) }}</span>
            </div>
          </div>
          <div class="config-section" v-if="t.agent_config.tools?.length">
            <span class="config-label">可用工具：</span>
            <span v-for="tool in t.agent_config.tools" :key="tool" class="tag tool">{{ tool }}</span>
          </div>
        </div>

        <!-- 工作空间 -->
        <div class="config-section ws-section" v-if="t.workspace_path">
          <span class="config-label">工作空间：</span>
          <code class="ws-path">{{ t.workspace_path }}</code>
        </div>

        <!-- OpenClaw 路径 -->
        <div class="config-section ws-section" v-if="t.deployed">
          <span class="config-label">Agent 路径：</span>
          <code class="ws-path">~/.openclaw/agents/{{ t.name }}/agent/</code>
        </div>

        <!-- 关联下游 Agent -->
        <div class="config-info" v-if="t.trigger_mode === 'event' && t.agent_config?.chain?.length">
          <div class="config-section" v-for="(link, li) in t.agent_config.chain" :key="li">
            <span class="chain-arrow">→</span>
            <strong class="chain-agent-name">{{ link.agent }}</strong>
            <span v-if="isOcAgent(link.agent)" class="oc-badge card">只读</span>
            <span class="config-label">当：</span>
            <span v-for="cond in link.when" :key="cond" class="tag chain-cond">{{ chainWhenLabel(cond) }}</span>
          </div>
        </div>

        <!-- 部署状态 -->
        <div class="deploy-status" :class="{ 'has-config': t.agent_config }">
          <span v-if="t.deployed" class="deploy-badge deployed">
            <span class="dot green"></span> 已初始化到 OpenClaw
            <span class="plugin-info" v-if="t.deployed">+ gitlab-tools</span>
          </span>
          <span v-else class="deploy-badge not-deployed">
            <span class="dot gray"></span> 未初始化
          </span>
        </div>

        <!-- 部署按钮 -->
        <div class="deploy-bar">
          <button
            class="apple-btn primary"
            :class="{ deploying: deploying === t.id }"
            :disabled="deploying === t.id"
            @click="deployTemplate(t)"
          >
            {{ deploying === t.id ? '初始化中...' : (t.deployed ? '重新初始化' : '初始化到 OpenClaw') }}
          </button>
          <span v-if="deployMsg && deployMsg.id === t.id" class="deploy-msg" :class="deployMsg.type">
            {{ deployMsg.text }}
          </span>
        </div>

        <p v-if="t.trigger_mode === 'event'" class="global-bind-hint">
          已启用 Webhook 的项目将按触发规则自动调度。若配置了下游 Agent（如 supervisor-dev），初始化时会一并注册到 OpenClaw。
        </p>
      </div>
    </div>

    <!-- 编辑弹窗 - 左右分栏 -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-wide card">
        <div class="modal-wide-header">
          <h3>{{ editingTemplate ? '编辑模板' : '新建模板' }}</h3>
          <div class="modal-wide-actions">
            <button class="apple-btn" @click="closeModal">取消</button>
            <button class="apple-btn primary" @click="saveTemplate">保存</button>
          </div>
        </div>
        <div class="modal-wide-body">
          <!-- 左侧：配置 -->
          <div class="modal-left">
            <div class="form-group">
              <label class="form-label">名称 <span class="hint">英文小写、数字、连字符</span></label>
              <input v-model="form.name" class="form-input" placeholder="如：webhook-status-flow"
                @input="form.name = form.name.toLowerCase().replace(/[^a-z0-9-]/g, '')" />
            </div>
            <div class="form-group">
              <label class="form-label">描述</label>
              <textarea v-model="form.description" class="form-input" rows="2" placeholder="模板描述"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">触发模式</label>
              <select v-model="form.trigger_mode" class="form-input">
                <option value="event">事件触发 — 接收到 GitLab 事件时自动调用</option>
                <option value="manual">自定义 — 由其他 Agent 在运行时调用</option>
              </select>
            </div>
            <div class="form-group" v-if="form.trigger_mode === 'event'">
              <div class="trigger-editor-head">
                <label class="form-label">触发规则</label>
                <button type="button" class="apple-btn ghost small" @click="addTriggerRule">+ 添加规则</button>
              </div>
              <p class="trigger-editor-hint">可细化到 action（如 Issue 的 open/update）、评论对象、里程碑变更等；不选 action 表示该类型全部 action。</p>
              <div v-if="!form.triggers.length" class="trigger-empty">请至少添加一条触发规则</div>
              <div v-for="(rule, ri) in form.triggers" :key="ri" class="trigger-rule-card">
                <div class="trigger-rule-top">
                  <select v-model="rule.event_type" class="form-input" @change="onRuleEventTypeChange(rule)">
                    <option v-for="c in triggerCatalog" :key="c.event_type" :value="c.event_type">{{ c.label }}</option>
                  </select>
                  <button type="button" class="apple-btn danger small" @click="removeTriggerRule(ri)" :disabled="form.triggers.length <= 1">删除</button>
                </div>
                <div v-if="ruleActions(rule).length" class="trigger-rule-row">
                  <span class="rule-row-label">Action</span>
                  <div class="checkbox-group cols-2">
                    <label v-for="act in ruleActions(rule)" :key="act.value" class="checkbox-item small">
                      <input type="checkbox" :value="act.value" v-model="rule.actions" />
                      <span>{{ act.label }}</span>
                    </label>
                  </div>
                </div>
                <div v-if="ruleNoteableTypes(rule).length" class="trigger-rule-row">
                  <span class="rule-row-label">评论对象</span>
                  <div class="checkbox-group">
                    <label v-for="nt in ruleNoteableTypes(rule)" :key="nt.value" class="checkbox-item small">
                      <input type="checkbox" :value="nt.value" v-model="rule.noteable_types" />
                      <span>{{ nt.label }}</span>
                    </label>
                  </div>
                </div>
                <div v-if="ruleSupportsMilestone(rule)" class="trigger-rule-row inline">
                  <label class="checkbox-item small">
                    <input type="checkbox" v-model="rule.milestone_only" />
                    <span>仅里程碑变更时触发</span>
                  </label>
                </div>
                <div v-if="ruleSupportsCommentMatch(rule)" class="trigger-rule-row">
                  <span class="rule-row-label">评论关键词</span>
                  <input v-model="rule.comment_match" class="form-input" placeholder="如：开始处理（留空表示任意评论）" />
                </div>
              </div>
              <div class="form-group compact">
                <label class="form-label">调度优先级 <span class="hint">多模板时数字越小越先执行</span></label>
                <input v-model.number="form.execute_order" type="number" class="form-input" min="0" max="99" />
              </div>
            </div>
            <div class="form-group" v-if="form.trigger_mode === 'event'">
              <label class="form-label">关联下游 Agent</label>
              <div class="chain-list">
                <div v-for="(link, li) in form.chain" :key="li" class="chain-item">
                  <div class="chain-row">
                    <select v-model="link.agent" class="form-input chain-agent">
                      <option value="">选择 Agent</option>
                      <optgroup label="─ B端模板（可编辑） ─">
                        <option v-for="tpl in manualTemplates" :key="'b-' + tpl.id" :value="tpl.name">{{ tpl.name }}</option>
                      </optgroup>
                      <optgroup v-if="openclawAgents.length" label="─ OpenClaw 已有 Agent（只读） ─">
                        <option v-for="agt in openclawAgents" :key="'oc-' + agt.name" :value="agt.name">{{ agt.name }}</option>
                      </optgroup>
                    </select>
                    <span v-if="link.agent && isOcAgent(link.agent)" class="oc-badge">只读</span>
                    <button class="apple-btn danger small" @click="removeChain(li)" :disabled="form.chain.length <= 1">✕</button>
                  </div>
                  <div class="chain-when">
                    <label v-for="cond in chainWhenOptions" :key="cond.value" class="checkbox-item small">
                      <input type="checkbox" :value="cond.value" v-model="link.when" />
                      <span>{{ cond.label }}</span>
                    </label>
                  </div>
                </div>
              </div>
              <button class="apple-btn ghost small" @click="addChain">+ 添加</button>
            </div>
            <div class="form-group">
              <label class="form-label">
                可用工具
                <label class="select-all-toggle" @click.stop>
                  <input type="checkbox" :checked="toolsAllSelected" @change="toggleAllTools" />
                  <span>{{ toolsAllSelected ? '取消全选' : '全选' }}</span>
                </label>
              </label>
              <div class="checkbox-group cols-2">
                <label v-for="tool in allTools" :key="tool" class="checkbox-item">
                  <input type="checkbox" :value="tool" v-model="form.tools" />
                  <span>{{ toolLabel(tool) }}</span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">工作空间 <span class="hint">留空使用默认</span></label>
              <input v-model="form.workspace_path" class="form-input" placeholder="/Users/xxx/workspace" />
            </div>
          </div>

          <!-- 右侧：指令编辑器 -->
          <div class="modal-right">
            <div class="editor-section">
              <div class="editor-section-header">
                <div class="editor-section-title">Agent 指令</div>
                <div class="editor-section-actions">
                  <button class="apple-btn ghost small" @click="generateInstructions" :disabled="!form.tools.length && !form.name">🪄 生成</button>
                  <span class="editor-info">{{ instructionsLineCount }} 行 / {{ form.instructions.length }} 字符</span>
                </div>
              </div>
              <textarea v-model="form.instructions" class="code-editor" placeholder="# 在这里编写 Agent 指令…"></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="closeDeleteModal">
      <div class="delete-modal card">
        <div class="delete-modal-icon">⚠️</div>
        <h3 class="delete-modal-title">删除模板</h3>
        <p class="delete-modal-desc">确定要删除模板 <strong>{{ deleteTarget?.name }}</strong>？</p>
        <p class="delete-modal-hint">此操作不可撤销，模板将不再可用于项目配置。</p>

        <label v-if="deleteTarget?.deployed" class="delete-option">
          <input type="checkbox" v-model="deleteRemoveOpenClaw" />
          <span class="option-text">
            <span class="option-title">同时删除 OpenClaw 本地配置</span>
            <span class="option-desc">删除 ~/.openclaw/agents/{{ deleteTarget?.name }}/ 及其注册信息</span>
          </span>
        </label>

        <div class="delete-actions">
          <button class="apple-btn" @click="closeDeleteModal">取消</button>
          <button class="apple-btn danger" @click="confirmDelete" :disabled="deleting">
            {{ deleting ? '删除中…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/api'
import {
  emptyTriggerRule,
  normalizeTriggersFromConfig,
  formatTriggerRule,
  triggersToEventTypes,
  type TriggerRule,
  type TriggerCatalogItem
} from '@/utils/eventTriggers'

const templates = ref<any[]>([])
const loading = ref(true)
const deploying = ref<number | null>(null)
const deployMsg = ref<{ id: number; type: string; text: string } | null>(null)

const showModal = ref(false)
const showDeleteModal = ref(false)
const deleteTarget = ref<any>(null)
const deleteRemoveOpenClaw = ref(false)
const deleting = ref(false)
const editingTemplate = ref<any>(null)

const triggerCatalog = ref<TriggerCatalogItem[]>([])
const allTools = [
  // Issue
  'gitlab_issue_get', 'gitlab_issue_update', 'gitlab_issue_comment',
  'gitlab_add_label', 'gitlab_set_state_label', 'gitlab_flow_state',
  // MR
  'gitlab_mr_get', 'gitlab_mr_list', 'gitlab_mr_comment', 'gitlab_mr_update',
  'gitlab_mr_merge', 'gitlab_mr_approve', 'gitlab_mr_add_label',
  // 项目
  'gitlab_project_info'
]

const toolsAllSelected = computed(() => form.value.tools.length === allTools.length)

const form = ref({
  name: '',
  description: '',
  trigger_mode: 'manual',
  instructions: '',
  tools: [] as string[],
  triggers: [] as TriggerRule[],
  execute_order: 0,
  chain: [] as { agent: string; when: string[] }[],
  workspace_path: '',
  is_active: 1
})

const instructionsLineCount = computed(() => form.value.instructions.split('\n').length)

const chainWhenOptions = [
  { value: 'issue', label: 'Issue 事件' },
  { value: 'mr', label: 'MR 事件' },
  { value: 'milestone', label: '里程碑指派' },
  { value: 'develop_comment', label: '开始处理评论' },
  { value: 'note', label: '评论事件' },
  { value: 'push', label: '推送事件' }
]

const manualTemplates = ref<any[]>([])
const openclawAgents = ref<any[]>([])

onMounted(async () => {
  await fetchTriggerCatalog()
  await fetchTemplates()
  await fetchManualTemplates()
  await fetchOpenClawAgents()
})

async function fetchTriggerCatalog() {
  try {
    const { data } = await api.getTriggerCatalog()
    triggerCatalog.value = data || []
  } catch {
    triggerCatalog.value = []
  }
}

function displayTriggers(t: any) {
  return normalizeTriggersFromConfig(t.agent_config || {})
}

function formatRule(rule: TriggerRule) {
  return formatTriggerRule(rule, triggerCatalog.value)
}

function ruleCatalog(rule: TriggerRule) {
  return triggerCatalog.value.find(c => c.event_type === rule.event_type)
}

function ruleActions(rule: TriggerRule) {
  return ruleCatalog(rule)?.actions || []
}

function ruleNoteableTypes(rule: TriggerRule) {
  return ruleCatalog(rule)?.noteable_types || []
}

function ruleSupportsMilestone(rule: TriggerRule) {
  return !!ruleCatalog(rule)?.supports_milestone_only
}

function ruleSupportsCommentMatch(rule: TriggerRule) {
  return !!ruleCatalog(rule)?.supports_comment_match
}

function onRuleEventTypeChange(rule: TriggerRule) {
  rule.actions = []
  rule.noteable_types = []
  rule.milestone_only = false
  rule.comment_match = ''
}

function addTriggerRule() {
  form.value.triggers.push(emptyTriggerRule())
}

function removeTriggerRule(idx: number) {
  form.value.triggers.splice(idx, 1)
}

async function fetchTemplates() {
  loading.value = true
  try {
    const { data } = await api.getTemplates()
    templates.value = data
  } catch { templates.value = [] }
  loading.value = false
}

async function fetchManualTemplates() {
  try {
    const { data } = await api.getTemplates()
    manualTemplates.value = data.filter((t: any) => t.trigger_mode === 'manual')
  } catch { manualTemplates.value = [] }
}

async function fetchOpenClawAgents() {
  try {
    const { data } = await api.getOpenClawAgents()
    openclawAgents.value = data || []
  } catch { openclawAgents.value = [] }
}

function chainWhenLabel(value: string) {
  const map: Record<string, string> = {
    issue: 'Issue 事件', mr: 'MR 事件', milestone: '里程碑指派',
    develop_comment: '开始处理评论', note: '评论事件', push: '推送事件'
  }
  return map[value] || value
}

function isOcAgent(name: string) {
  return openclawAgents.value.some(a => a.name === name)
}

function addTemplate() {
  editingTemplate.value = null
  form.value = {
    name: '', description: '', trigger_mode: 'event',
    instructions: '', tools: [], triggers: [emptyTriggerRule()], execute_order: 0, chain: [],
    workspace_path: '', is_active: 1
  }
  showModal.value = true
}

function addChain() {
  form.value.chain.push({ agent: '', when: [] })
}

function removeChain(idx: number) {
  form.value.chain.splice(idx, 1)
}

function generateInstructions() {
  const f = form.value
  const name = f.name || 'My Agent'
  const tools = f.tools
  const isEvent = f.trigger_mode === 'event'

  const lines = []
  lines.push(`# ${name}`)
  lines.push('')
  lines.push(`## 核心职责`)
  lines.push(`描述 ${name} 需要完成的核心任务。`)
  lines.push('')

  if (isEvent && f.triggers.length) {
    lines.push(`## 触发规则`)
    f.triggers.forEach(r => lines.push(`- ${formatTriggerRule(r, triggerCatalog.value)}`))
    lines.push('')
  }

  if (tools.length) {
    lines.push(`## 可用工具`)
    lines.push('可以使用以下工具完成目标任务：')
    tools.forEach(t => lines.push(`- \`${t}\``))
    lines.push('')
  }

  if (isEvent) {
    lines.push(`## 处理流程`)
    lines.push(`1. 接收 GitLab 事件通知`)
    lines.push(`2. 解析事件内容，获取 Issue/MR 信息`)
    if (tools.some(t => t === 'gitlab_set_state_label')) lines.push(`3. 使用 gitlab_set_state_label 更新状态标签`)
    if (tools.some(t => t === 'gitlab_issue_comment')) lines.push(`4. 使用 gitlab_issue_comment 在 Issue/MR 上评论处理结果`)
    if (!tools.some(t => t === 'gitlab_issue_comment' || t === 'gitlab_set_state_label')) {
      lines.push(`3. 根据分析结果执行相应操作`)
    }
    lines.push('')
  }

  lines.push(`## 规则`)
  lines.push(`- 仅执行与核心职责相关的操作`)
  lines.push(`- 跳过 bot 自身触发的事件`)
  lines.push(`- 操作完成后记录状态变更`)

  form.value.instructions = lines.join('\n')
}

function toolLabel(tool: string) {
  const map: Record<string, string> = {
    'gitlab_issue_get': '获取 Issue',
    'gitlab_issue_update': '更新 Issue',
    'gitlab_issue_comment': '评论 Issue',
    'gitlab_add_label': '添加标签',
    'gitlab_set_state_label': '状态标签',
    'gitlab_flow_state': '流程状态',
    'gitlab_mr_get': '获取 MR',
    'gitlab_mr_list': 'MR 列表',
    'gitlab_mr_comment': '评论 MR',
    'gitlab_mr_update': '更新 MR',
    'gitlab_mr_merge': '合并 MR',
    'gitlab_mr_approve': '审批 MR',
    'gitlab_mr_add_label': 'MR 添加标签',
    'gitlab_project_info': '项目信息'
  }
  return map[tool] || tool
}

function toggleAllTools() {
  if (toolsAllSelected.value) {
    form.value.tools = []
  } else {
    form.value.tools = [...allTools]
  }
}

function editTemplate(t: any) {
  editingTemplate.value = t
  const cfg = t.agent_config || {}
  const triggers = normalizeTriggersFromConfig(cfg)
  form.value = {
    name: t.name,
    description: t.description || '',
    trigger_mode: t.trigger_mode || 'manual',
    instructions: cfg.instructions || '',
    tools: cfg.tools || [],
    triggers: triggers.length ? triggers : [emptyTriggerRule()],
    execute_order: cfg.execute_order ?? 0,
    chain: (cfg.chain || []).map((c: any) => ({ agent: c.agent || '', when: c.when || [] })),
    workspace_path: t.workspace_path || '',
    is_active: t.is_active
  }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingTemplate.value = null
}

async function saveTemplate() {
  const triggers = form.value.trigger_mode === 'event'
    ? form.value.triggers.filter(r => r.event_type)
    : []
  const data = {
    name: form.value.name,
    description: form.value.description,
    trigger_mode: form.value.trigger_mode,
    workspace_path: form.value.workspace_path,
    agent_config: {
      instructions: form.value.instructions,
      tools: form.value.tools,
      triggers,
      event_types: triggersToEventTypes(triggers),
      execute_order: form.value.execute_order || 0,
      chain: form.value.chain.filter(c => c.agent)
    },
    is_active: form.value.is_active
  }
  if (editingTemplate.value) {
    await api.updateTemplate(editingTemplate.value.id, data)
  } else {
    await api.createTemplate(data)
  }
  closeModal()
  await fetchTemplates()
}

async function deleteTemplate(t: any) {
  deleteTarget.value = t
  deleteRemoveOpenClaw.value = false
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
  deleteTarget.value = null
  deleteRemoveOpenClaw.value = false
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    const params: any = {}
    if (deleteRemoveOpenClaw.value) params.removeOpenClaw = 'true'
    await api.deleteTemplate(deleteTarget.value.id, params)
    closeDeleteModal()
    await fetchTemplates()
  } catch { /* ignore */ }
  deleting.value = false
}

async function deployTemplate(t: any) {
  deploying.value = t.id
  deployMsg.value = null
  try {
    const { data } = await api.deployTemplate(t.id)
    const chainErr = data.chain?.errors?.length
      ? `；依赖失败: ${data.chain.errors.map((e: any) => `${e.name}: ${e.error}`).join('；')}`
      : ''
    deployMsg.value = {
      id: t.id,
      type: chainErr ? 'error' : 'success',
      text: (data.message || '初始化成功') + chainErr
    }
    if (data.registered !== false) t.deployed = 1
    if (data.chain?.deployed?.length) await fetchTemplates()
  } catch (err: any) {
    deployMsg.value = {
      id: t.id,
      type: 'error',
      text: err?.response?.data?.error || err?.message || '初始化失败'
    }
  } finally {
    deploying.value = null
  }
}
</script>

<style scoped>
.template-grid { display: flex; flex-direction: column; gap: 12px; }
.template-card { padding: 20px; }
.template-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.template-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.template-info h3 { font-size: 16px; font-weight: 600; }
.template-actions { display: flex; gap: 6px; flex-shrink: 0; }
.template-desc { margin-top: 8px; font-size: 14px; color: var(--text-secondary); }

.config-info { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.config-section { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-label { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
.tag {
  font-size: 11px; font-family: monospace;
  padding: 2px 8px; border-radius: 4px;
  background: var(--bg-secondary); color: var(--text-secondary);
}
.tag.tool { background: rgba(0,113,227,0.08); color: var(--accent-blue); }

.ws-section { margin-top: 4px; }
.ws-path { font-size: 12px; font-family: monospace; color: var(--accent-blue); background: rgba(0,113,227,0.06); padding: 2px 8px; border-radius: 4px; }

.event-badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 6px; }
.type-mode { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }

.chain-arrow { font-size: 14px; color: var(--accent-blue); font-weight: 600; }
.chain-agent-name { font-size: 13px; color: var(--text-primary); }
.chain-cond { background: rgba(255,149,0,0.1); color: var(--accent-orange); }

.form-hint { font-size: 12px; color: var(--text-tertiary); margin-top: -10px; margin-bottom: 8px; }
.chain-list { display: flex; flex-direction: column; gap: 8px; }
.chain-item {
  padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--bg-tertiary);
  background: var(--bg-secondary);
}
.chain-row { display: flex; align-items: center; gap: 8px; }
.chain-agent { flex: 1; }
.chain-when { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.chain-when .checkbox-item.small { font-size: 12px; padding: 2px 8px; }
.oc-badge {
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
  background: rgba(255,149,0,0.12); color: var(--accent-orange);
  white-space: nowrap; flex-shrink: 0;
}
.oc-badge.card {
  background: rgba(255,149,0,0.08);
  font-size: 10px; padding: 0 5px; margin-left: 2px;
}
.apple-btn.small { font-size: 12px; padding: 2px 8px; min-width: auto; }
.apple-btn.ghost.small { font-size: 12px; padding: 4px 10px; }
.mode-event { background: rgba(0,113,227,0.1); color: var(--accent-blue); }
.mode-manual { background: rgba(255,149,0,0.1); color: var(--accent-orange); }

.hint { font-weight: 400; font-size: 11px; color: var(--text-tertiary); }

/* 工具全选开关 */
.select-all-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  font-weight: 400; font-size: 11px; color: var(--accent-blue);
  cursor: pointer; margin-left: 8px; user-select: none;
  vertical-align: middle;
}
.select-all-toggle input { margin: 0; accent-color: var(--accent-blue); }
.select-all-toggle:hover { opacity: 0.8; }

.deploy-status { margin-top: 12px; }
.deploy-status.has-config { margin-top: 8px; }
.deploy-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; padding: 4px 10px; border-radius: 6px;
}
.deploy-badge.deployed { background: rgba(52,199,89,0.1); color: var(--accent-green); }
.deploy-badge.not-deployed { background: var(--bg-secondary); color: var(--text-secondary); }
.plugin-info { font-size: 11px; opacity: 0.7; margin-left: 4px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot.green { background: var(--accent-green); }
.dot.gray { background: var(--text-tertiary); }

.deploy-bar { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
.deploy-msg { font-size: 13px; }
.deploy-msg.success { color: var(--accent-green); }
.deploy-msg.error { color: var(--accent-red); }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
/* Wide modal - left/right split */
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
.modal-left {
  width: 340px; flex-shrink: 0; overflow-y: auto; padding-right: 4px;
}
.modal-left::-webkit-scrollbar { width: 4px; }
.modal-left::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 2px; }
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
.code-editor::placeholder { color: rgba(228,228,231,0.35); }
.form-group { margin-bottom: 16px; }
.form-label {
  display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--text-secondary);
}
.form-input {
  width: 100%; font-family: var(--font-family); font-size: 14px;
  padding: 10px 14px; border: none; border-radius: var(--radius-sm);
  background: var(--bg-secondary); color: var(--text-primary); outline: none; box-sizing: border-box;
}
.form-input:focus { background: var(--bg-tertiary); }
textarea.form-input { resize: vertical; }
select.form-input { cursor: pointer; }
.checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0; }
.checkbox-group.cols-2 { max-width: 480px; }
.checkbox-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; cursor: pointer;
  padding: 4px 10px; border-radius: 6px;
  background: var(--bg-secondary);
  transition: background 0.15s;
}
.checkbox-item:hover { background: var(--bg-tertiary); }
.checkbox-item input[type="checkbox"] { margin: 0; accent-color: var(--accent-blue); }

/* Skeleton */
.skeleton-line {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* 删除确认弹窗 */
.delete-modal {
  width: 420px; max-width: 90vw; padding: 32px; text-align: center;
}
.delete-modal-icon { font-size: 36px; margin-bottom: 12px; }
.delete-modal-title { font-size: 18px; font-weight: 600; margin: 0 0 8px 0; color: var(--text-primary); }
.delete-modal-desc { font-size: 14px; color: var(--text-secondary); margin: 0 0 4px 0; line-height: 1.5; }
.delete-modal-hint { font-size: 12px; color: var(--text-tertiary); margin: 0 0 20px 0; }

.delete-option {
  display: flex; align-items: flex-start; gap: 10px; margin-bottom: 24px;
  padding: 12px 14px;
  background: var(--bg-secondary); border-radius: 10px;
  cursor: pointer; text-align: left;
  transition: background 0.2s;
}
.delete-option:hover { background: var(--bg-tertiary); }
.delete-option input[type="checkbox"] {
  margin-top: 3px; width: 16px; height: 16px; accent-color: var(--accent);
  cursor: pointer; flex-shrink: 0;
}
.option-text { display: flex; flex-direction: column; gap: 2px; }
.option-title { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.option-desc { font-size: 11px; color: var(--text-tertiary); }

.delete-actions { display: flex; justify-content: flex-end; gap: 10px; }

.global-bind-hint { font-size: 12px; color: var(--text-tertiary); margin-top: 10px; line-height: 1.5; }
.trigger-summary .trigger-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.trigger-tag { font-size: 11px; }
.trigger-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.trigger-editor-hint { font-size: 12px; color: var(--text-tertiary); margin: 4px 0 10px; line-height: 1.5; }
.trigger-empty { font-size: 13px; color: var(--text-tertiary); padding: 12px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 8px; }
.trigger-rule-card {
  border: 1px solid var(--bg-tertiary); border-radius: 10px; padding: 10px 12px;
  margin-bottom: 8px; background: var(--bg-secondary);
}
.trigger-rule-top { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.trigger-rule-top .form-input { flex: 1; }
.trigger-rule-row { margin-top: 8px; }
.trigger-rule-row.inline { margin-top: 6px; }
.rule-row-label { display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.form-group.compact { margin-top: 10px; margin-bottom: 0; }
</style>
