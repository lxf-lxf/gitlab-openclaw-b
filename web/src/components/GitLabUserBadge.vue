<template>
  <div class="gitlab-badge-wrapper" ref="wrapperRef">
    <button
      v-if="profile.connected && profile.user"
      class="gitlab-badge"
      @click="togglePanel"
      :title="profile.user.name"
    >
      <span class="gitlab-name">{{ profile.user.name }}</span>
      <span class="gitlab-username">@{{ profile.user.username }}</span>
    </button>

    <router-link
      v-else
      to="/settings"
      class="gitlab-badge disconnected"
      title="配置 GitLab 连接"
    >
      <span class="gitlab-icon">GL</span>
      <span class="gitlab-hint">{{ loading ? '检测中...' : '未连接 GitLab' }}</span>
    </router-link>

    <transition name="panel-fade">
      <div v-if="showPanel && profile.connected && profile.user" class="gitlab-panel card">
        <div class="gp-header">
          <div class="gp-info">
            <div class="gp-name">{{ profile.user.name }}</div>
            <div class="gp-username">@{{ profile.user.username }}</div>
            <div class="gp-email" v-if="profile.user.email">{{ profile.user.email }}</div>
          </div>
        </div>
        <div class="gp-meta">
          <div class="gp-row" v-if="profile.baseUrl">
            <span class="gp-label">API</span>
            <span class="gp-value">{{ profile.baseUrl }}</span>
          </div>
          <div class="gp-row" v-if="profile.user.state">
            <span class="gp-label">状态</span>
            <span class="gp-value">{{ profile.user.state }}</span>
          </div>
        </div>
        <div class="gp-actions">
          <a
            v-if="profile.user.web_url"
            :href="profile.user.web_url"
            target="_blank"
            rel="noopener noreferrer"
            class="apple-btn small"
          >打开 GitLab 主页</a>
          <router-link to="/settings" class="apple-btn small ghost" @click="showPanel = false">
            连接设置
          </router-link>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/api'

interface GitLabUser {
  id: number
  username: string
  name: string
  email?: string | null
  avatar_url: string
  web_url?: string
  state?: string | null
}

interface GitLabProfile {
  connected: boolean
  error?: string | null
  baseUrl?: string | null
  user: GitLabUser | null
}

const loading = ref(true)
const showPanel = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)
const profile = ref<GitLabProfile>({ connected: false, user: null })

async function loadProfile() {
  loading.value = true
  try {
    const { data } = await api.getGitLabProfile()
    profile.value = data
  } catch {
    profile.value = { connected: false, error: '无法获取 GitLab 信息', user: null }
  }
  loading.value = false
}

function togglePanel() {
  showPanel.value = !showPanel.value
}

function onDocClick(e: MouseEvent) {
  if (!showPanel.value) return
  const el = wrapperRef.value
  if (el && !el.contains(e.target as Node)) showPanel.value = false
}

function onProfileChanged() {
  loadProfile()
}

onMounted(() => {
  loadProfile()
  document.addEventListener('click', onDocClick)
  window.addEventListener('gitlab-profile-changed', onProfileChanged)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('gitlab-profile-changed', onProfileChanged)
})
</script>

<style scoped>
.gitlab-badge-wrapper {
  position: fixed;
  top: 16px;
  right: 68px;
  z-index: 100;
}

.gitlab-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  padding: 4px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
  color: inherit;
  font-family: var(--font-family);
  box-shadow: var(--shadow-sm);
}

.gitlab-badge:hover {
  background: var(--bg-secondary);
  border-color: var(--accent-blue);
}

.gitlab-badge.disconnected {
  padding: 4px 12px;
  color: var(--text-secondary);
}

.gitlab-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary);
}

.gitlab-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.gitlab-username {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.gitlab-hint {
  font-size: 12px;
}

.gitlab-panel {
  position: absolute;
  top: 44px;
  right: 0;
  width: 300px;
  padding: 16px;
  box-shadow: var(--shadow-lg);
}

.gp-header {
  margin-bottom: 12px;
}

.gp-name {
  font-size: 15px;
  font-weight: 600;
}

.gp-username {
  font-size: 13px;
  color: var(--text-secondary);
}

.gp-email {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.gp-meta {
  border-top: 1px solid var(--bg-tertiary);
  padding-top: 10px;
  margin-bottom: 12px;
}

.gp-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 4px;
}

.gp-label {
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 36px;
}

.gp-value {
  color: var(--text-primary);
  word-break: break-all;
}

.gp-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 900px) {
  .gitlab-username,
  .gitlab-name {
    display: none;
  }
  .gitlab-badge {
    padding: 4px;
  }
}
</style>
