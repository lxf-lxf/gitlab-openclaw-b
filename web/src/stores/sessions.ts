import { defineStore } from 'pinia'
import api from '@/api'

export const useSessionStore = defineStore('sessions', {
  state: () => ({
    list: [] as any[],
    current: null as any,
    loading: false,
    error: '',
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    keyword: ''
  }),
  actions: {
    async fetchSessions() {
      this.loading = true
      this.error = ''
      try {
        const params: any = {
          page: this.page,
          pageSize: this.pageSize
        }
        if (this.keyword) params.keyword = this.keyword
        const { data } = await api.getSessions(params)
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
      this.fetchSessions()
    },
    setKeyword(keyword: string) {
      this.keyword = keyword
      this.page = 1
      this.fetchSessions()
    },
    async fetchSession(id: number) {
      this.loading = true
      try {
        const { data } = await api.getSession(id)
        this.current = data
      } catch (err: any) {
        this.error = err.message
      } finally {
        this.loading = false
      }
    },
    async sendMessage(id: number, content: string) {
      const { data } = await api.sendMessage(id, content)
      if (this.current?.id === id && this.current.session_messages) {
        this.current.session_messages.push(data)
      }
      return data
    }
  }
})
