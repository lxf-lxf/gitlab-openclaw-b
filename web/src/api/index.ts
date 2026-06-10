import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export default {
  // Dashboard
  getDashboard: () => api.get('/dashboard'),

  // Admin
  getConfigs: () => api.get('/admin/configs'),
  updateConfig: (key: string, value: string) => api.put(`/admin/configs/${key}`, { value }),
  getGitLabProfile: () => api.get('/admin/gitlab-profile'),

  // Projects
  getProjects: (params?: any) => api.get('/projects', { params }),
  syncProjects: () => api.post('/projects/sync'),
  stopProjectSync: () => api.post('/projects/sync/stop'),
  getProjectSyncStatus: () => api.get('/projects/sync/status'),
  deleteProject: (id: number) => api.delete(`/projects/${id}`),
  getWebhook: (id: number) => api.get(`/projects/${id}/webhook`),
  enableWebhook: (id: number) => api.post(`/projects/${id}/webhook/enable`),
  disableWebhook: (id: number) => api.post(`/projects/${id}/webhook/disable`),
  getProjectGroups: () => api.get('/projects/groups', { params: { meta: 1 } }),
  enableGroupWebhooks: (namespace: string) => api.post(`/projects/groups/${encodeURIComponent(namespace)}/webhook/enable-all`),
  disableGroupWebhooks: (namespace: string) => api.post(`/projects/groups/${encodeURIComponent(namespace)}/webhook/disable-all`),

  // Events
  getEvents: (params?: any) => api.get('/events', { params }),
  getEvent: (id: number) => api.get(`/events/${id}`),
  retryEvent: (id: number) => api.post(`/events/${id}/retry`),
  deleteEvent: (id: number) => api.delete(`/events/${id}`),

  // Agents
  getProjectAgents: (projectId: number) => api.get(`/projects/${projectId}/agents`),
  getProjectPipeline: (projectId: number, params?: any) => api.get(`/projects/${projectId}/pipeline`, { params }),
  getPipelineFlows: (params?: any) => api.get('/pipeline/flows', { params }),
  getAgents: (params?: any) => api.get('/agents', { params }),

  // Templates
  getTemplates: () => api.get('/templates'),
  getTriggerCatalog: () => api.get('/templates/trigger-catalog'),
  getTemplate: (id: number) => api.get(`/templates/${id}`),
  createTemplate: (data: any) => api.post('/templates', data),
  updateTemplate: (id: number, data: any) => api.put(`/templates/${id}`, data),
  deleteTemplate: (id: number, params?: any) => api.delete(`/templates/${id}`, { params }),
  deployTemplate: (id: number) => api.post(`/templates/${id}/deploy`),

  // Sessions
  getSessions: (params?: any) => api.get('/sessions', { params }),
  getGroupedSessions: (params?: any) => api.get('/sessions/grouped', { params }),
  getProjectGroupedSessions: (params?: any) => api.get('/sessions/project-grouped', { params }),
  getSession: (id: number) => api.get(`/sessions/${id}`),
  sendMessage: (id: number, content: string) => api.post(`/sessions/${id}/message`, { content }),
  getOpenClawSessionMessages: (id: number) => api.get(`/sessions/${id}/openclaw-messages`),

  // OpenClaw Agents (read-only)
  getOpenClawAgents: () => api.get('/openclaw-agents'),

  // Project-Agent associations

  // System Notification
  getNotificationConfig: () => api.get('/notification-config'),
  saveNotificationConfig: (data: any) => api.put('/notification-config', data),
  triggerNotificationCheck: () => api.post('/notification-config/check'),
  getNotifications: (params?: any) => api.get('/notifications', { params }),
  getNotification: (id: number) => api.get(`/notifications/${id}`),
  markNotificationRead: (id: number) => api.put(`/notifications/${id}/read`),
  notificationAction: (id: number, action: string) => api.post(`/notifications/${id}/action`, { action }),

  // System Agent
  deploySystemAgent: (data?: any) => api.post('/admin/deploy-system-agent', data),
  removeSystemAgent: () => api.post('/admin/remove-system-agent'),
  getSystemAgentStatus: () => api.get('/admin/system-agent-status'),
  getSystemAgentConfig: () => api.get('/admin/system-agent-config'),
  updateSystemAgentConfig: (data: any) => api.put('/admin/system-agent-config', data),
  getOpenClawWorkspaces: () => api.get('/admin/openclaw-workspaces'),

  // Max Concurrent Agents
  getMaxConcurrentAgents: () => api.get('/admin/max-concurrent-agents'),
  setMaxConcurrentAgents: (value: number) => api.put('/admin/max-concurrent-agents', { value }),

  // Daily Report
  getReportConfig: () => api.get('/daily-report/config'),
  saveReportConfig: (data: any) => api.put('/daily-report/config', data),
  triggerDailyReport: () => api.post('/daily-report/trigger'),
  getDailyReport: (date: string) => api.get(`/daily-report/${date}`)
}
