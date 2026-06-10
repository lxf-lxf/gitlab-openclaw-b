<template>
  <div class="report-viewer">
    <div v-for="(section, idx) in sections" :key="idx" class="rv-section">
      <!-- Section title -->
      <div class="rv-section-title" v-if="section.title">
        {{ section.title }}
        <span class="rv-subtitle" v-if="section.subtitle">{{ section.subtitle }}</span>
      </div>

      <!-- type: stats - 统计卡片 -->
      <div v-if="section.type === 'stats'" class="rv-stats-grid">
        <div
          v-for="(item, i) in section.items"
          :key="i"
          class="rv-stat-card"
          :class="{ 'rv-stat-warn': item.warn }"
        >
          <span class="rv-stat-icon">{{ item.icon }}</span>
          <div class="rv-stat-body">
            <span class="rv-stat-value">{{ item.value }}</span>
            <span class="rv-stat-label">{{ item.label }}</span>
          </div>
        </div>
      </div>

      <!-- type: event_stats / agent_stats - 树状统计列表 -->
      <div v-if="section.type === 'event_stats' || section.type === 'agent_stats'" class="rv-bar-list">
        <div v-for="(item, i) in section.items" :key="i" class="rv-bar-row">
          <span class="rv-bar-label">{{ item.label }}</span>
          <span class="rv-bar-value">{{ item.value }}</span>
          <div class="rv-bar-track">
            <div
              class="rv-bar-fill"
              :style="{ width: barWidth(item.value, section.items) + '%' }"
            ></div>
          </div>
        </div>
      </div>

      <!-- type: list - 列表 -->
      <div v-if="section.type === 'list'" class="rv-list">
        <div v-for="(item, i) in section.items" :key="i" class="rv-list-item">
          <div class="rv-list-text">{{ item.text }}</div>
          <div class="rv-list-detail" v-if="item.detail">{{ item.detail }}</div>
        </div>
      </div>

      <!-- type: text - 纯文本 -->
      <div v-if="section.type === 'text'" class="rv-text-block">
        {{ section.content }}
      </div>

      <!-- type: agent_text - AI 分析报告（markdown 样式渲染） -->
      <div v-if="section.type === 'agent_text'" class="rv-agent-block">
        <div v-for="(line, li) in section.content.split('\n').filter(l => l.trim())" :key="li" class="rv-agent-line" :class="agentLineClass(line)">
          <template v-if="line.startsWith('## ')"><h4 class="ag-h4">{{ line.replace(/^##\s*/, '') }}</h4></template>
          <template v-else-if="line.startsWith('# ')"><h3 class="ag-h3">{{ line.replace(/^#\s*/, '') }}</h3></template>
          <template v-else-if="line.startsWith('**') && line.endsWith('**')"><strong class="ag-strong">{{ line.replace(/^\*\*|\*\*$/g, '') }}</strong></template>
          <template v-else-if="/^\d+\.\s/.test(line.trim())"><span class="ag-num">{{ line }}</span></template>
          <template v-else-if="line.startsWith('- ')"><span class="ag-bullet">{{ line.substring(2) }}</span></template>
          <template v-else><span class="ag-p">{{ line }}</span></template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  sections: any[]
}>()

function barWidth(value: number, items: any[]) {
  const max = Math.max(...items.map(i => i.value), 1)
  return (value / max) * 100
}

function agentLineClass(line: string) {
  if (line.startsWith('## ') || line.startsWith('# ')) return 'ag-heading'
  if (line.startsWith('**') && line.endsWith('**')) return 'ag-strong-line'
  if (/^\d+\.\s/.test(line.trim())) return 'ag-num-line'
  if (line.startsWith('- ')) return 'ag-bullet-line'
  return ''
}
</script>

<style scoped>
.report-viewer {
  padding: 4px 0;
}

.rv-section {
  margin-bottom: 24px;
}

.rv-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 12px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.rv-subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #86868b;
}

/* ── Stats Grid ── */
.rv-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.rv-stat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f5f5f7;
  border-radius: 10px;
  padding: 12px 14px;
  transition: background 0.2s;
}

.rv-stat-card.rv-stat-warn {
  background: #fff2f0;
}

.rv-stat-icon {
  font-size: 22px;
  line-height: 1;
}

.rv-stat-body {
  display: flex;
  flex-direction: column;
}

.rv-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #1d1d1f;
  line-height: 1.2;
}

.rv-stat-label {
  font-size: 11px;
  color: #86868b;
  margin-top: 1px;
}

/* ── Bar List ── */
.rv-bar-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rv-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rv-bar-label {
  width: 140px;
  font-size: 13px;
  color: #1d1d1f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.rv-bar-value {
  width: 40px;
  font-size: 13px;
  font-weight: 600;
  color: #1d1d1f;
  text-align: right;
  flex-shrink: 0;
}

.rv-bar-track {
  flex: 1;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
}

.rv-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #007aff, #0a84ff);
  border-radius: 4px;
  transition: width 0.3s ease;
}

/* ── List ── */
.rv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rv-list-item {
  background: #f5f5f7;
  border-radius: 8px;
  padding: 10px 14px;
}

.rv-list-text {
  font-size: 13px;
  font-weight: 500;
  color: #1d1d1f;
}

.rv-list-detail {
  font-size: 12px;
  color: #86868b;
  margin-top: 4px;
  line-height: 1.4;
}

/* ── Agent Text (Markdown-style) ── */
.rv-agent-block {
  background: #f8f9fa;
  border-radius: 10px;
  padding: 16px 20px;
  line-height: 1.7;
  font-size: 13px;
  color: #1d1d1f;
}
.rv-agent-line { margin-bottom: 6px; }
.rv-agent-line:last-child { margin-bottom: 0; }
.ag-heading { margin-top: 12px; }
.ag-heading:first-child { margin-top: 0; }
.ag-h3 { font-size: 16px; font-weight: 700; color: #1d1d1f; margin: 14px 0 8px; }
.ag-h4 { font-size: 14px; font-weight: 600; color: #1d1d1f; margin: 12px 0 6px; }
.ag-strong { font-weight: 600; color: #1d1d1f; display: block; margin-bottom: 4px; }
.ag-num { color: #515154; }
.ag-bullet { display: block; padding-left: 14px; color: #515154; position: relative; }
.ag-bullet::before { content: '•'; position: absolute; left: 2px; color: #007aff; }
.ag-p { color: #515154; }
.rv-text-block {
  font-size: 13px;
  color: #515154;
  line-height: 1.6;
  background: #f5f5f7;
  border-radius: 10px;
  padding: 14px;
}
</style>
