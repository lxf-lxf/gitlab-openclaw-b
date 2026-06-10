<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="visible" class="apple-toast" :class="type">
        {{ message }}
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  message: string
  type?: 'success' | 'error' | 'info'
  duration?: number
}>(), { type: 'info', duration: 3000 })

const visible = ref(false)

watch(() => props.message, (val) => {
  if (val) {
    visible.value = true
    setTimeout(() => { visible.value = false }, props.duration)
  }
})
</script>

<style scoped>
.apple-toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: var(--radius-sm);
  background: var(--text-primary);
  color: white;
  font-size: 14px;
  z-index: 2000;
  box-shadow: var(--shadow-lg);
}
.apple-toast.success { background: var(--accent-green); }
.apple-toast.error { background: var(--accent-red); }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(10px); }
</style>
