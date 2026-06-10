<template>
  <div class="page">
    <div class="page-header">
      <router-link to="/events" style="color:var(--accent-blue);text-decoration:none;font-size:14px;">← 返回事件列表</router-link>
      <h1 style="margin-top:8px;">事件详情</h1>
    </div>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="event" class="card">
      <div style="margin-bottom:16px;">
        <p><strong>类型:</strong> {{ event.event_type }}</p>
        <p><strong>动作:</strong> {{ event.event_action }}</p>
        <p><strong>状态:</strong> <span class="badge" :class="'status-' + event.status">{{ event.status }}</span></p>
        <p><strong>接收时间:</strong> {{ new Date(event.received_at).toLocaleString('zh-CN') }}</p>
      </div>
      <h3 style="margin-bottom:8px;">原始 Payload</h3>
      <pre style="background:var(--bg-secondary);padding:16px;border-radius:8px;overflow:auto;font-size:12px;max-height:400px;">{{ JSON.stringify(event.payload, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'

const route = useRoute()
const event = ref<any>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const { data } = await api.getEvent(Number(route.params.id))
    event.value = data
  } catch {}
  loading.value = false
})
</script>
