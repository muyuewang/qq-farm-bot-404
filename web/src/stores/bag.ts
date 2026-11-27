import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export const useBagStore = defineStore('bag', () => {
  const allItems = ref<any[]>([])
  const originalItems = ref<any[]>([])
  // 后端 getBagDetail 把无 UID 的容器/余额条目（化肥容器、收藏点等）只放在 systemItems，不进 items。
  const systemItems = ref<any[]>([])
  const loading = ref(false)
  const pendingFetches = new Map<string, Promise<void>>()

  function clearBag() {
    allItems.value = []
    originalItems.value = []
    systemItems.value = []
  }

  const items = computed(() => {
    const hiddenIds = new Set([1, 1001, 1002, 1101, 1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => !hiddenIds.has(Number(it.id || 0)))
  })

  const dashboardItems = computed(() => {
    const targetIds = new Set([1011, 1012, 3001, 3002])
    // systemItems 优先；仍回退 items 以兼容尚未拆分 systemItems 的旧后端，同一 ID 只取一次。
    const picked = new Map<number, any>()
    for (const it of [...systemItems.value, ...allItems.value]) {
      const id = Number(it?.id || 0)
      if (targetIds.has(id) && !picked.has(id))
        picked.set(id, it)
    }
    return [...picked.values()]
  })

  async function fetchBag(accountId: string) {
    if (!accountId)
      return

    const pending = pendingFetches.get(accountId)
    if (pending)
      return pending

    const request = fetchBagOnce(accountId).finally(() => {
      if (pendingFetches.get(accountId) === request)
        pendingFetches.delete(accountId)
      loading.value = pendingFetches.size > 0
    })
    pendingFetches.set(accountId, request)
    loading.value = true
    return request
  }

  async function fetchBagOnce(accountId: string) {
    const requestedId = accountId
    try {
      const res = await api.get('/api/bag', {
        headers: { 'x-account-id': accountId },
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
        clearBag()
      }
    }
    catch (e) {
      const acc = useAccountStore()
      const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
      if (curId === requestedId)
        clearBag()
      console.error(e)
    }
  }

  async function useItem(accountId: string, itemId: number, count = 1, uid = 0) {
    const res = await api.post('/api/bag/use', { itemId, count, uid }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  async function sellItems(accountId: string, items: Array<{ id: number, count: number, uid?: number }>) {
    const res = await api.post('/api/bag/sell', { items }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  /** 锁定/解锁按背包堆栈的 uid 生效，后端会再校验物品类型与当前状态。 */
  async function setItemsLocked(accountId: string, itemUids: number[], locked: boolean) {
    const res = await api.post('/api/bag/lock', { itemUids, locked }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  return { items, allItems, originalItems, dashboardItems, loading, fetchBag, clearBag, useItem, sellItems, setItemsLocked }
})
