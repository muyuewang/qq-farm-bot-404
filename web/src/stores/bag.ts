import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useAccountStore } from '@/stores/account'

export const useBagStore = defineStore('bag', () => {
  const allItems = ref<any[]>([])
  const originalItems = ref<any[]>([])
  const systemItems = ref<any[]>([])
  const loading = ref(false)
  let pendingFetch: Promise<void> | null = null
  let pendingAccountId = ''

  function clearBag() {
    allItems.value = []
    originalItems.value = []
    systemItems.value = []
  }

  const items = computed(() => allItems.value)

  const dashboardItems = computed(() => {
    const targetIds = new Set([1011, 1012, 3001, 3002])
    return systemItems.value.filter((it: any) => targetIds.has(Number(it.id || 0)))
  })

  async function fetchBag(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    if (pendingFetch && pendingAccountId === requestedId)
      return pendingFetch

    loading.value = true
    const request = (async () => {
      try {
        const res = await api.get('/api/bag', {
          headers: { 'x-account-id': requestedId },
        })
        const acc = useAccountStore()
        const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
        if (curId !== requestedId)
          return
        if (res.data.ok && res.data.data) {
          allItems.value = Array.isArray(res.data.data.items) ? res.data.data.items : []
          originalItems.value = Array.isArray(res.data.data.originalItems) ? res.data.data.originalItems : []
          systemItems.value = Array.isArray(res.data.data.systemItems) ? res.data.data.systemItems : []
        }
        else if (res.data && res.data.ok === false && res.data.error) {
          allItems.value = []
          originalItems.value = []
          systemItems.value = []
        }
      }
      catch (e) {
        const acc = useAccountStore()
        const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
        if (curId === requestedId) {
          allItems.value = []
          originalItems.value = []
          systemItems.value = []
        }
        console.error(e)
      }
    })()
    pendingFetch = request
    pendingAccountId = requestedId
    try {
      await request
    }
    finally {
      if (pendingFetch === request) {
        pendingFetch = null
        pendingAccountId = ''
        loading.value = false
      }
    }
  }

  async function useItem(accountId: string, itemId: number, count = 1, uid = 0) {
    const res = await api.post('/api/bag/use', { itemId, count, uid }, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (res.data && res.data.ok === false)
      res.data.error = getApiErrorMessage(res.data, '操作失败')
    return res.data
  }

  async function sellItems(accountId: string, items: Array<{ id: number, count: number, uid?: number }>) {
    const res = await api.post('/api/bag/sell', { items }, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (res.data && res.data.ok === false)
      res.data.error = getApiErrorMessage(res.data, '出售失败')
    return res.data
  }

  async function setItemsLocked(accountId: string, itemUids: number[], locked: boolean) {
    const res = await api.post('/api/bag/lock', { itemUids, locked }, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (res.data && res.data.ok === false)
      res.data.error = getApiErrorMessage(res.data, '操作失败')
    return res.data
  }

  return {
    items,
    allItems,
    originalItems,
    systemItems,
    dashboardItems,
    loading,
    fetchBag,
    clearBag,
    useItem,
    sellItems,
    setItemsLocked,
  }
})
