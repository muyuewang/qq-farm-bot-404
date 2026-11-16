import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface IllustratedItem {
  seedId: number
  illustratedTier?: number
  name: string
  image?: string
  level: number
  layer?: number
  unlocked: boolean
  plantedCount?: number
  harvestCount?: number
  wishProgress?: {
    type: number
    current: number
    total: number
  } | null
  canBuy?: boolean
  goodsId?: number
  price?: number
}

export interface IllustratedSummary {
  total: number
  unlocked: number
  locked: number
  canBuy: number
}

export const useIllustratedStore = defineStore('illustrated', () => {
  const items = ref<IllustratedItem[]>([])
  const summary = ref<IllustratedSummary>({
    total: 0,
    unlocked: 0,
    locked: 0,
    canBuy: 0,
  })
  const userLevel = ref(0)
  const loading = ref(false)
  const buying = ref(false)
  const error = ref('')
  let fetchRequestId = 0

  function clearIllustratedData() {
    items.value = []
    summary.value = {
      total: 0,
      unlocked: 0,
      locked: 0,
      canBuy: 0,
    }
    userLevel.value = 0
    loading.value = false
    buying.value = false
    error.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchList(accountId: string, refresh = false, illustratedType = 1) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/api/illustrated', {
        params: { refresh, illustrated_type: illustratedType },
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (data.ok) {
        items.value = data.data?.items || []
        summary.value = data.data?.summary || summary.value
        userLevel.value = data.data?.userLevel || 0
      }
      else {
        error.value = data.error || '获取图鉴失败'
      }
    }
    catch (err: any) {
      if (requestId === fetchRequestId && isCurrentAccount(requestedId))
        error.value = err.message || '获取图鉴失败'
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function buySeed(accountId: string, goodsId: number, price: number) {
    buying.value = true
    try {
      const { data } = await api.post('/api/illustrated/buy', {
        goodsId,
        price,
      }, {
        headers: { 'x-account-id': accountId },
      })
      return data
    }
    finally {
      buying.value = false
    }
  }

  async function buyAllSeeds(accountId: string, illustratedType = 1) {
    buying.value = true
    try {
      const { data } = await api.post('/api/illustrated/buy-all', {
        illustrated_type: illustratedType,
      }, {
        headers: { 'x-account-id': accountId },
      })
      return data
    }
    finally {
      buying.value = false
    }
  }

  return {
    items,
    summary,
    userLevel,
    loading,
    buying,
    error,
    clearIllustratedData,
    fetchList,
    buySeed,
    buyAllSeeds,
  }
})
