import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export type LedgerCurrency = 'gold' | 'coupon' | 'diamond' | 'goldBean'

export interface LedgerEntry {
  id: string
  ts: number
  currency: LedgerCurrency
  delta: number
  balanceBefore: number
  balanceAfter: number
  reasonKey: string
  reason: string
  method?: string
  candidates?: string[]
}

export interface ReasonSummary {
  reasonKey: string
  reason: string
  income: number
  expense: number
  count: number
}

export interface CurrencySummary {
  income: number
  expense: number
  net: number
  count: number
  reasons: ReasonSummary[]
}

const PAGE_SIZE = 100

export const useCurrencyLedgerStore = defineStore('currencyLedger', () => {
  const accountStore = useAccountStore()

  const entries = ref<LedgerEntry[]>([])
  const summary = ref<Record<string, CurrencySummary>>({})
  const hasMore = ref(false)
  const nextCursor = ref('')
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref('')
  // 「加载更多」失败单独记录：已加载的列表仍然有效，不能被整页错误态替换掉
  const loadMoreError = ref('')
  const days = ref(1)
  const currency = ref<LedgerCurrency | ''>('')
  // 每次筛选或账号变化都换代，旧请求晚到的结果直接丢弃，避免串号或串筛选
  let generation = 0

  const isEmpty = computed(() => !loading.value && !error.value && entries.value.length === 0)

  function buildParams(before = '') {
    const params: Record<string, string | number> = { days: days.value, limit: PAGE_SIZE }
    if (currency.value)
      params.currency = currency.value
    if (before)
      params.before = before
    return params
  }

  async function fetch() {
    const accountId = accountStore.currentAccountId
    const current = ++generation
    entries.value = []
    summary.value = {}
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
      const { data } = await api.get('/api/currency-ledger', {
        headers: { 'x-account-id': accountId },
        params: buildParams(),
      })
      if (current !== generation)
        return
      if (!data?.ok)
        throw new Error(data?.error || '流水读取失败')
      entries.value = data.data.entries || []
      summary.value = data.data.summary || {}
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
      const { data } = await api.get('/api/currency-ledger', {
        headers: { 'x-account-id': accountId },
        params: buildParams(nextCursor.value),
      })
      if (current !== generation)
        return
      if (!data?.ok)
        throw new Error(data?.error || '流水读取失败')
      // 游标已不在查询范围内（例如「今日」跨过零点、旧记录被清理），翻页无法接续，回到首页
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

  function setDays(value: number) {
    if (days.value === value)
      return
    days.value = value
    fetch()
  }

  function setCurrency(value: LedgerCurrency | '') {
    if (currency.value === value)
      return
    currency.value = value
    fetch()
  }

  return { entries, summary, hasMore, loading, loadingMore, error, loadMoreError, days, currency, isEmpty, fetch, fetchMore, setDays, setCurrency }
})
