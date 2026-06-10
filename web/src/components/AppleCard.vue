<template>
  <div class="apple-card" :style="{ padding: padding }">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ padding?: string }>(), { padding: '24px' })
</script>

<style scoped>
.apple-card {
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.2s ease;
}
.apple-card:hover {
  box-shadow: var(--shadow-md);
}
</style>
