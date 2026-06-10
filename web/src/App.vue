<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h1 class="sidebar-title">B 端中台</h1>
        <p class="sidebar-subtitle">GitLab 管理</p>
      </div>
      <nav class="sidebar-nav">
        <router-link to="/" class="nav-item" exact-active-class="active">
          仪表盘
        </router-link>
        <router-link to="/projects" class="nav-item" active-class="active">
          项目列表
        </router-link>
        <router-link to="/events" class="nav-item" active-class="active">
          事件管理
        </router-link>
        <router-link to="/agents" class="nav-item" active-class="active">
          Agent Pipeline
        </router-link>
        <router-link to="/templates" class="nav-item" active-class="active">
          Agent 模板
        </router-link>
        <router-link to="/sessions" class="nav-item" active-class="active">
          会话消息
        </router-link>
        <router-link to="/settings" class="nav-item settings" active-class="active">
          系统设置
        </router-link>
      </nav>
    </aside>
    <main class="main-content">
      <router-view />
    </main>
    <GitLabUserBadge />
    <NotificationBell />
  </div>
</template>

<script setup lang="ts">
import GitLabUserBadge from '@/components/GitLabUserBadge.vue'
import NotificationBell from '@/components/NotificationBell.vue'
</script>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-primary);
  padding: 32px 12px;
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  z-index: 10;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--bg-tertiary);
}

.sidebar-header {
  padding: 0 12px 24px;
}

.sidebar-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.sidebar-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-item {
  display: block;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
  cursor: pointer;
}

.nav-item:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-secondary);
  color: var(--accent-blue);
  font-weight: 500;
}

.nav-item.settings {
  margin-top: auto;
}

.main-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  padding: 40px 48px;
  max-width: calc(100vw - var(--sidebar-width));
  min-height: 100vh;
}

/* 响应式适配 */
@media (max-width: 1200px) {
  .main-content {
    padding: 32px 32px;
  }
}

@media (max-width: 900px) {
  .main-content {
    padding: 24px 20px;
  }
}
</style>
