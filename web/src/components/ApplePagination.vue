<template>
  <div class="apple-pagination" v-if="totalPages > 1">
    <div class="pagination-info">{{ total }} 条，共 {{ totalPages }} 页</div>
    <div class="pagination-controls">
      <button class="page-btn" :disabled="page <= 1" @click="go(page - 1)">
        ‹
      </button>
      <button
        v-for="p in visiblePages"
        :key="p"
        class="page-btn"
        :class="{ active: p === page }"
        @click="go(p)"
      >
        {{ p }}
      </button>
      <button class="page-btn" :disabled="page >= totalPages" @click="go(page + 1)">
        ›
      </button>
    </div>
    <div class="pagination-jump">
      <input
        type="number"
        :min="1"
        :max="totalPages"
        v-model.number="jumpValue"
        @keyup.enter="go(jumpValue)"
        placeholder="页码"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
  totalPages: number
}>()

const emit = defineEmits<{
  (e: 'change', payload: { page: number; pageSize: number }): void
}>()

const jumpValue = ref(1)

const visiblePages = computed(() => {
  const pages: number[] = []
  const total = props.totalPages
  const current = props.page
  let start = Math.max(1, current - 2)
  let end = Math.min(total, current + 2)
  if (end - start < 4) {
    if (start === 1) end = Math.min(total, start + 4)
    else start = Math.max(1, end - 4)
  }
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
})

function go(p: number) {
  const target = Math.max(1, Math.min(props.totalPages, p))
  if (target === props.page) return
  jumpValue.value = target
  emit('change', { page: target, pageSize: props.pageSize })
}
</script>

<style scoped>
.apple-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
  padding: 16px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.pagination-info {
  margin-right: auto;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.page-btn:hover:not(:disabled):not(.active) {
  background: var(--bg-secondary);
}

.page-btn.active {
  background: var(--accent-blue);
  color: #fff;
  font-weight: 500;
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pagination-jump input {
  width: 56px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  text-align: center;
  outline: none;
  font-family: var(--font-family);
}

.pagination-jump input:focus {
  background: var(--bg-tertiary);
}

/* Hide spinner for number input */
.pagination-jump input::-webkit-outer-spin-button,
.pagination-jump input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.pagination-jump input[type='number'] {
  -moz-appearance: textfield;
}
</style>
