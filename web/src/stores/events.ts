import { defineStore } from 'pinia'
import api from '@/api'

export const useEventStore = defineStore('events', {
  state: () => ({
    list: [] as any[],
    loading: false,
    error: '',
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    keyword: '',
    filter: { project_id: '', event_type: '', status: '', dispatch: '' }
  }),
  actions: {
    async fetchEvents() {
      this.loading = true
      this.error = ''
      try {
        const params: any = {
          page: this.page,
          pageSize: this.pageSize
        }
        if (this.keyword) params.keyword = this.keyword
        if (this.filter.project_id) params.project_id = this.filter.project_id
        if (this.filter.event_type) params.event_type = this.filter.event_type
        if (this.filter.status) params.status = this.filter.status
        if (this.filter.dispatch) params.dispatch = this.filter.dispatch
        const { data } = await api.getEvents(params)
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
      this.fetchEvents()
    },
    setKeyword(keyword: string) {
      this.keyword = keyword
      this.page = 1
      this.fetchEvents()
    },
    async retryEvent(id: number) {
      await api.retryEvent(id)
      await this.fetchEvents()
    },
    async deleteEvent(id: number) {
      await api.deleteEvent(id)
      await this.fetchEvents()
    },
    setFilter(filter: Partial<{ project_id: string; event_type: string; status: string; dispatch: string }>) {
      Object.assign(this.filter, filter)
      this.page = 1
      this.fetchEvents()
    }
  }
})
