<template>
  <span class="apple-badge" :class="variant">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: string
}>(), { variant: '' })
</script>

<style scoped>
.apple-badge {
  display: inline-block;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: 100px;
  font-weight: 500;
  white-space: nowrap;
}
</style>
