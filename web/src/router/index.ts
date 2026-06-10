import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue')
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('@/views/ProjectListView.vue')
  },
  {
    path: '/events',
    name: 'Events',
    component: () => import('@/views/EventListView.vue')
  },
  {
    path: '/events/:id',
    name: 'EventDetail',
    component: () => import('@/views/EventDetail.vue')
  },
  {
    path: '/agents',
    name: 'Agents',
    component: () => import('@/views/AgentTreeView.vue')
  },
  {
    path: '/templates',
    name: 'Templates',
    component: () => import('@/views/AgentTemplatesView.vue')
  },
  {
    path: '/sessions',
    name: 'Sessions',
    component: () => import('@/views/SessionListView.vue')
  },
  {
    path: '/sessions/:id',
    name: 'SessionDetail',
    component: () => import('@/views/SessionDetail.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue')
  }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
