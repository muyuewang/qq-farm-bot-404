import type { QuoteResult, RanchAction, RanchState, RanchView } from '@/utils/ranch'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import {
  buildRanchBody,
  buildRanchExecuteBody,
  describeOperateResult,
  describeQuote,
  mapRanchState,
  RANCH_ENDPOINT,
  RANCH_OPTIONS_ENDPOINT,
} from '@/utils/ranch'

export interface RanchActionResult {
  ok: boolean
  status?: 'confirmed' | 'skipped' | 'unknown'
  data?: any
  error?: string
  message?: string
  errorCode?: string
  /** 报价已被后端标为无需执行，属正常分支，不算失败。 */
  skipped?: boolean
}

export interface RanchQuoteHandle {
  action: RanchAction
  input: Record<string, any>
  quote: QuoteResult
  summary: string
  skipped: boolean
}

/**
 * 牧场状态与操作 store。
 * 一次请求同时拿到基础快照和当前视图段落，视图切换即重新拉取；
 * 写操作统一走 quote → execute 两阶段，execute 复用 quote 时的那份入参，
 * 避免前端重新拼出与 signature 不一致的 body（后端会直接 RANCH_OFFER_CHANGED）。
 */
export const useRanchStore = defineStore('ranch', () => {
  const state = ref<RanchState | null>(null)
  const activeView = ref<RanchView>('animals')
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const errorCode = ref('')
  const refreshRequired = ref(false)
  /** 弹窗期间的报价与执行状态，分开记录以免用户看到旧报价却按新状态提交。 */
  const quoting = ref(false)
  const acting = ref(false)
  const quoteHandle = ref<RanchQuoteHandle | null>(null)
  const animalOptions = ref<Array<{ value: number, label: string, kind: string }>>([])
  /** 当前视图段落需要的查询参数（商店 id、好友 gid），写操作后按同一套参数重拉。 */
  const viewParams = ref<Record<string, any>>({})

  let fetchRequestId = 0

  const unlocked = computed(() => state.value?.unlocked === true)
  const facilities = computed(() => state.value?.facilities || [])
  const pendingCount = computed(() => state.value?.pending.length || 0)

  function clearRanchData() {
    state.value = null
    loaded.value = false
    loading.value = false
    quoting.value = false
    acting.value = false
    quoteHandle.value = null
    error.value = ''
    errorCode.value = ''
    refreshRequired.value = false
    viewParams.value = {}
  }

  function readError(data: any, fallback: string) {
    return {
      message: String(data?.error || data?.errorMessage || fallback),
      code: String(data?.errorCode || ''),
    }
  }

  async function fetchView(accountId: string, view: RanchView = activeView.value, params: Record<string, any> = {}) {
    if (!accountId)
      return null
    const requestId = ++fetchRequestId
    loading.value = true
    error.value = ''
    errorCode.value = ''
    try {
      const { data } = await api.get(RANCH_ENDPOINT, {
        params: { view, ...params },
        headers: { 'x-account-id': accountId },
      })
      // 慢响应回来时账号或视图已经切走，直接丢弃，避免把旧视图段落写进新视图。
      if (requestId !== fetchRequestId)
        return null
      if (data?.ok) {
        state.value = mapRanchState(data.data)
        loaded.value = true
        activeView.value = view
        viewParams.value = params
        refreshRequired.value = false
      }
      else {
        const failure = readError(data, '获取牧场数据失败')
        error.value = failure.message
        errorCode.value = failure.code
      }
      return state.value
    }
    catch (err: any) {
      if (requestId === fetchRequestId) {
        const failure = readError(err?.response?.data, '获取牧场数据失败')
        error.value = err?.message === 'canceled' ? '' : failure.message
        errorCode.value = failure.code
      }
      return null
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function switchView(accountId: string, view: RanchView, params: Record<string, any> = {}) {
    if (view === activeView.value && loaded.value && !error.value)
      return state.value
    return fetchView(accountId, view, params)
  }

  /** 报价：只读预览，不产生任何写操作，好友动作会真实进出好友牧场，因此按钮文案不能写成「试算免费」。 */
  async function quote(accountId: string, action: RanchAction, input: Record<string, any> = {}): Promise<RanchQuoteHandle | null> {
    if (!accountId)
      return null
    const built = buildRanchBody(action, input)
    if (!built.ok) {
      error.value = built.error
      return null
    }
    quoting.value = true
    quoteHandle.value = null
    try {
      const { data } = await api.post(`${RANCH_ENDPOINT}/${action}/quote`, built.body, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok) {
        const failure = readError(data, '牧场报价失败')
        error.value = failure.message
        errorCode.value = failure.code
        return null
      }
      const result = data.data as QuoteResult
      const summary = describeQuote(result)
      quoteHandle.value = { action, input: built.body, quote: result, summary: summary.summary, skipped: summary.skipped }
      return quoteHandle.value
    }
    catch (err: any) {
      const failure = readError(err?.response?.data, '牧场报价失败')
      error.value = failure.message
      errorCode.value = failure.code
      return null
    }
    finally {
      quoting.value = false
    }
  }

  /** 执行报价过的动作；handle 缺失或被跳过时不发起写请求。 */
  async function execute(accountId: string, handle?: RanchQuoteHandle | null): Promise<RanchActionResult> {
    const target = handle || quoteHandle.value
    if (!accountId)
      return { ok: false, error: '请先选择账号' }
    if (!target)
      return { ok: false, error: '请先获取牧场报价' }
    const built = buildRanchExecuteBody(target.action, target.input, target.quote)
    if (!built.ok)
      return { ok: false, error: built.error, skipped: built.skipped }
    acting.value = true
    try {
      const { data } = await api.post(`${RANCH_ENDPOINT}/${target.action}`, built.body, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok) {
        const failure = readError(data, '牧场操作失败')
        error.value = failure.message
        errorCode.value = failure.code
        return { ok: false, error: failure.message, errorCode: failure.code }
      }
      const outcome = describeOperateResult(data.data)
      // 后端回包里带最新基础快照时直接采用，避免操作完页面还停留在旧进度。
      const snapshot = mapRanchState(data.data?.snapshot)
      if (snapshot) {
        // 基础快照不含视图段落；animals / facilities 两段本身就在快照里，其余视图写完后必须重新拉取该段，
        // 否则限购、库存这类刚变化的信息会一直停在操作前的值。
        state.value = baseOnly(activeView.value) ? snapshot : { ...snapshot, ...sectionsOf(state.value) }
        loaded.value = true
        refreshRequired.value = data.data?.refreshRequired === true
        if (!baseOnly(activeView.value))
          void fetchView(accountId, activeView.value, viewParams.value)
      }
      else {
        refreshRequired.value = true
      }
      quoteHandle.value = null
      return { ok: true, status: outcome.status, message: outcome.message, data: data.data }
    }
    catch (err: any) {
      const failure = readError(err?.response?.data, '牧场操作失败')
      error.value = failure.message
      errorCode.value = failure.code
      refreshRequired.value = true
      return { ok: false, error: failure.message, errorCode: failure.code }
    }
    finally {
      acting.value = false
    }
  }

  /** 新快照没有段落信息，沿用同视图的旧段落，等刚才发出的刷新覆盖，避免面板先空一帧。 */
  function sectionsOf(previous: RanchState | null): Partial<RanchState> {
    if (!previous)
      return {}
    return {
      bag: previous.bag,
      shop: previous.shop,
      market: previous.market,
      canShop: previous.canShop,
      tasks: previous.tasks,
      book: previous.book,
      activities: previous.activities,
      friends: previous.friends,
      friendRanch: previous.friendRanch,
      dailyShare: previous.dailyShare,
    }
  }

  /** animals 与 facilities 两个分区的数据全在基础快照里，写完不必再拉一次。 */
  function baseOnly(view: RanchView) {
    return view === 'animals' || view === 'facilities'
  }

  /** 待核对记录是唯一不需要报价的写动作（后端没有 acknowledge/quote 路由）。 */
  async function acknowledge(accountId: string, id: string): Promise<RanchActionResult> {
    if (!accountId)
      return { ok: false, error: '请先选择账号' }
    if (!id)
      return { ok: false, error: '缺少待核对记录标识，未发起请求' }
    acting.value = true
    try {
      const { data } = await api.post(`${RANCH_ENDPOINT}/acknowledge`, { id }, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok) {
        const failure = readError(data, '解除牧场待核对保护失败')
        return { ok: false, error: failure.message, errorCode: failure.code }
      }
      refreshRequired.value = true
      return { ok: true, status: 'confirmed', message: '已解除该操作的资源预留', data: data.data }
    }
    catch (err: any) {
      const failure = readError(err?.response?.data, '解除牧场待核对保护失败')
      return { ok: false, error: failure.message, errorCode: failure.code }
    }
    finally {
      acting.value = false
    }
  }

  async function fetchAutomationOptions() {
    try {
      const { data } = await api.get(RANCH_OPTIONS_ENDPOINT)
      animalOptions.value = data?.ok && Array.isArray(data.data)
        ? data.data.map((row: any) => ({ value: Number(row.value), label: String(row.label || ''), kind: String(row.kind || '') }))
        : []
    }
    catch {
      // 选项接口失败时设置页只保留「不指定」，不把动物列表冒充成空数组的成功结果。
      animalOptions.value = []
    }
  }

  return {
    state,
    activeView,
    loading,
    loaded,
    error,
    errorCode,
    refreshRequired,
    quoting,
    acting,
    quoteHandle,
    animalOptions,
    viewParams,
    unlocked,
    facilities,
    pendingCount,
    clearRanchData,
    fetchView,
    switchView,
    quote,
    execute,
    acknowledge,
    fetchAutomationOptions,
  }
})
