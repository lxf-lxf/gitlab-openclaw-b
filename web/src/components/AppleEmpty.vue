<template>
  <div class="apple-empty">
    <p class="empty-title">{{ title }}</p>
    <p class="empty-desc">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
}>(), { title: '暂无数据', description: '还没有任何内容' })
</script>

<style scoped>
.apple-empty {
  text-align: center;
  padding: 64px 24px;
}
.empty-title { font-size: 16px; color: var(--text-primary); font-weight: 500; }
.empty-desc { font-size: 14px; color: var(--text-secondary); margin-top: 6px; }
</style>
