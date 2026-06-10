<template>
  <Teleport to="body">
    <div v-if="visible" class="apple-modal-overlay" @click.self="$emit('close')">
      <div class="apple-modal" :style="{ width: width }">
        <div class="apple-modal-header">
          <h3>{{ title }}</h3>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>
        <div class="apple-modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="apple-modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  width?: string
}>()

defineEmits<{ close: [] }>()
</script>

<style scoped>
.apple-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.apple-modal {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  max-width: 90vw;
  max-height: 80vh;
  overflow: auto;
}
.apple-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 0;
}
.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
}
.close-btn:hover { color: var(--text-primary); }
.apple-modal-body { padding: 20px 24px; }
.apple-modal-footer {
  padding: 0 24px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
