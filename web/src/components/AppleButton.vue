<template>
  <button class="apple-btn" :class="[variant, { 'loading': loading }]" :disabled="loading">
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger',
  loading?: boolean
}>(), { variant: 'secondary', loading: false })
</script>

<style scoped>
.apple-btn {
  font-family: var(--font-family);
  font-size: 13px;
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  color: var(--accent-blue);
  line-height: 1.4;
}
.apple-btn:hover { background: rgba(0,113,227,0.08); }
.apple-btn.primary {
  background: var(--accent-blue);
  color: white;
}
.apple-btn.primary:hover { opacity: 0.85; }
.apple-btn.secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.apple-btn.secondary:hover { background: var(--bg-tertiary); }
.apple-btn.danger {
  color: var(--accent-red);
}
.apple-btn.danger:hover { background: rgba(255,59,48,0.08); }
.apple-btn.loading { opacity: 0.6; cursor: not-allowed; }
</style>
