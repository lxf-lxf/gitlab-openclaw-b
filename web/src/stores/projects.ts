import { defineStore } from 'pinia'
import api from '@/api'

export const useProjectStore = defineStore('projects', {
  state: () => ({
    list: [] as any[],
    loading: false,
    error: '',
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    keyword: ''
  }),
  actions: {
    async fetchProjects() {
      this.loading = true
      this.error = ''
      try {
        const { data } = await api.getProjects({
          page: this.page,
          pageSize: this.pageSize,
          keyword: this.keyword || undefined
        })
        this.list = data.items
        this.total = data.total
        this.totalPages = data.totalPages
        this.page = data.page
      } catch (err: any) {
        this.error = err.message
        this.list = []
      } finally {
        this.loading = false
      }
    },
    setPage(page: number) {
      this.page = page
      this.fetchProjects()
    },
    setKeyword(keyword: string) {
      this.keyword = keyword
      this.page = 1
      this.fetchProjects()
    },
    async syncProjects() {
      this.loading = true
      try {
        await api.syncProjects()
        await this.fetchProjects()
      } catch (err: any) {
        this.error = err.message
      } finally {
        this.loading = false
      }
    },
    async deleteProject(id: number) {
      await api.deleteProject(id)
      await this.fetchProjects()
    },
    async enableWebhook(id: number) {
      await api.enableWebhook(id)
    },
    async disableWebhook(id: number) {
      await api.disableWebhook(id)
    }
  }
})
