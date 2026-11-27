import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export type OperationScene = 'farm' | 'ranch'

export interface OperationItem {
  id: number
  name: string
  count: number
}

export interface FarmEntry {
  id: string
  ts: number
  op: 'buy_seed' | 'plant' | 'harvest' | 'sell'
  seedId?: number
  seedName?: string
  count?: number
  totalCost?: number
  unitPrice?: number
  landCount?: number
  landIds?: number[]
  harvestCount?: number
  harvestInfo?: Array<{ landId: number, plantId?: number, name?: string, exp?: number }>
  items?: OperationItem[]
  goldEarned?: number
}

export interface RanchEntry {
  id: string
  ts: number
  action: string
  label: string
  completed: number
  costs: OperationItem[]
  rewards: OperationItem[]
}

export interface FarmSummaryItem {
  times: number
  quantity: number
  gold: number
  exp: number
}

export interface RanchSummary {
  actions: Array<{ action: string, label: string, times: number, completed: number }>
  costs: OperationItem[]
  rewards: OperationItem[]
}

export type OperationEntry = FarmEntry | RanchEntry

interface FarmSummary {
  buy_seed: FarmSummaryItem
  plant: FarmSummaryItem
  harvest: FarmSummaryItem
  sell: FarmSummaryItem
}

const PAGE_SIZE = 100

export const useOperationLedgerStore = defineStore('operationLedger', () => {
  const accountStore = useAccountStore()

  const scene = ref<OperationScene>('farm')
  const entries = ref<OperationEntry[]>([])
  const summary = ref<FarmSummary | RanchSummary | null>(null)
  const hasMore = ref(false)
  const nextCursor = ref('')
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref('')
  const loadMoreError = ref('')
  const days = ref(1)
  const op = ref('')
  let generation = 0

  const isEmpty = computed(() => !loading.value && !error.value && entries.value.length === 0)

  function buildParams(before = '') {
    const params: Record<string, string | number> = { scene: scene.value, days: days.value, limit: PAGE_SIZE }
    if (op.value)
      params.op = op.value
    if (before)
      params.before = before
    return params
  }

  async function fetch() {
    const accountId = accountStore.currentAccountId
    const current = ++generation
    entries.value = []
    summary.value = null
    hasMore.value = false
    nextCursor.value = ''
    error.value = ''
    loadMoreError.value = ''
    loadingMore.value = false
    if (!accountId) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      const { data } = await api.get('/api/operation-ledger', {
        headers: { 'x-account-id': accountId },
        params: buildParams(),
      })
      if (current !== generation)
        return
      if (!data?.ok)
        throw new Error(data?.error || '流水读取失败')
      entries.value = data.data.entries || []
      summary.value = data.data.summary || null
      hasMore.value = !!data.data.hasMore
      nextCursor.value = data.data.nextCursor || ''
    }
    catch (e: any) {
      if (current === generation)
        error.value = e?.response?.data?.error || e?.message || '流水读取失败'
    }
    finally {
      if (current === generation)
        loading.value = false
    }
  }

  async function fetchMore() {
    const accountId = accountStore.currentAccountId
    if (!accountId || !hasMore.value || !nextCursor.value || loading.value || loadingMore.value)
      return
    const current = generation
    loadingMore.value = true
    loadMoreError.value = ''
    try {
      const { data } = await api.get('/api/operation-ledger', {
        headers: { 'x-account-id': accountId },
        params: buildParams(nextCursor.value),
      })
      if (current !== generation)
        return
      if (!data?.ok)
        throw new Error(data?.error || '流水读取失败')
      if (data.data.cursorInvalid) {
        fetch()
        return
      }
      entries.value = [...entries.value, ...(data.data.entries || [])]
      hasMore.value = !!data.data.hasMore
      nextCursor.value = data.data.nextCursor || ''
    }
    catch (e: any) {
      if (current === generation)
        loadMoreError.value = e?.response?.data?.error || e?.message || '流水读取失败'
    }
    finally {
      if (current === generation)
        loadingMore.value = false
    }
  }

  /** 切换到某个场景并拉取；场景变化时清掉上一个场景的动作筛选。 */
  function open(value: OperationScene) {
    if (scene.value !== value) {
      scene.value = value
      op.value = ''
    }
    fetch()
  }

  function setDays(value: number) {
    if (days.value === value)
      return
    days.value = value
    fetch()
  }

  function setOp(value: string) {
    if (op.value === value)
      return
    op.value = value
    fetch()
  }

  return {
    scene,
    entries,
    summary,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMoreError,
    days,
    op,
    isEmpty,
    fetch,
    fetchMore,
    open,
    setDays,
    setOp,
  }
})
