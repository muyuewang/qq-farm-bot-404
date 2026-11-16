import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import {
  buildCollectionsBody,
  COLLECTIONS_ENDPOINT,
  describeClaimResult,
  describeCollectionResult,
  mapCollectionsSnapshot,
  mapMutationCatalog,
  MUTATION_CATALOG_ENDPOINT,
} from '@/utils/collections'
import type { CollectionAction, CollectionsSnapshot, MutationCatalog } from '@/utils/collections'

export interface CollectionActionResult {
  ok: boolean
  status?: 'confirmed' | 'skipped' | 'unknown'
  message?: string
  error?: string
  data?: any
}

/**
 * 蓝晶藏品册 store。
 * 后端三个写动作都会把操作后的最新快照整份带回来，因此成功后直接采纳，
 * 不再补一次读取；只有响应里缺 snapshot 时才标记 refreshRequired，
 * 避免页面继续显示操作前的旧星级和旧分数。
 *
 * 藏品册没有后台自动动作（core 里没有对应的 automation 开关），
 * 所以这个 store 只服务手工操作，不注册设置项。
 */
export const useCollectionsStore = defineStore('collections', () => {
  const snapshot = ref<CollectionsSnapshot | null>(null)
  const catalog = ref<MutationCatalog | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const acting = ref(false)
  const error = ref('')
  const catalogError = ref('')
  const refreshRequired = ref(false)

  let fetchRequestId = 0
  /** 最近一次成功读取所属账号，写操作回包时用它判断是否已经切号，避免把 A 号快照写进 B 号页面。 */
  let loadedForAccount = ''

  /** 展台上的藏品 id，用于卡片判断「正在展示」；后端用 '0' 表示空展台。 */
  const displayedItemId = computed(() => snapshot.value?.display?.itemId ?? null)
  const claimableMilestones = computed(() => (snapshot.value?.milestones || []).filter(m => m.reached && !m.claimed))
  const upgradableCount = computed(() => (snapshot.value?.series || [])
    .reduce((sum, series) => sum + series.items.filter(item => item.canUpgrade).length, 0))

  function clearCollectionsData() {
    snapshot.value = null
    loadedForAccount = ''
    loading.value = false
    loaded.value = false
    acting.value = false
    error.value = ''
    refreshRequired.value = false
  }

  function readError(data: any, fallback: string) {
    return String(data?.error || data?.errorMessage || data?.message || fallback)
  }

  async function fetchSnapshot(accountId: string) {
    if (!accountId)
      return null
    const requestId = ++fetchRequestId
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get(COLLECTIONS_ENDPOINT, {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId)
        return null
      if (data?.ok) {
        snapshot.value = mapCollectionsSnapshot(data.data)
        loaded.value = snapshot.value !== null
        loadedForAccount = snapshot.value ? String(accountId) : loadedForAccount
        refreshRequired.value = false
        if (!snapshot.value)
          error.value = '藏品数据不完整，后端未返回系列列表'
      }
      else {
        error.value = readError(data, '获取蓝晶藏品失败')
      }
      return snapshot.value
    }
    catch (err: any) {
      if (requestId === fetchRequestId)
        error.value = readError(err?.response?.data, '获取蓝晶藏品失败')
      return null
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  /** 静态目录不带账号，读失败只影响「概率与隐藏系列」参考区，不阻塞藏品册本体。 */
  async function fetchCatalog() {
    if (catalog.value)
      return catalog.value
    try {
      const { data } = await api.get(MUTATION_CATALOG_ENDPOINT)
      if (data?.ok)
        catalog.value = mapMutationCatalog(data.data)
      else
        catalogError.value = readError(data, '获取变异目录失败')
      return catalog.value
    }
    catch (err: any) {
      catalogError.value = readError(err?.response?.data, '获取变异目录失败')
      return null
    }
  }

  async function operate(accountId: string, action: CollectionAction, input: Record<string, any> = {}): Promise<CollectionActionResult> {
    if (!accountId)
      return { ok: false, error: '请先选择账号' }
    if (acting.value)
      return { ok: false, error: '上一条藏品操作仍在执行，请稍候' }
    const built = buildCollectionsBody(action, input)
    if (!built.ok)
      return { ok: false, error: built.error }
    acting.value = true
    const requestedId = String(accountId)
    try {
      const { data } = await api.post(`${COLLECTIONS_ENDPOINT}/${action}`, built.body, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok)
        return { ok: false, error: readError(data, '藏品操作失败') }
      const next = mapCollectionsSnapshot(data.data?.snapshot)
      if (next && requestedId === loadedForAccount) {
        snapshot.value = next
        loaded.value = true
        refreshRequired.value = false
      }
      else if (data.data?.snapshot) {
        refreshRequired.value = true
      }
      const outcome = describeCollectionResult(data.data, action === 'claim' ? describeClaimResult(data.data) : '藏品已更新')
      return {
        ok: true,
        status: outcome.status,
        message: outcome.message,
        data: data.data,
      }
    }
    catch (err: any) {
      return { ok: false, error: readError(err?.response?.data, '藏品操作失败') }
    }
    finally {
      acting.value = false
    }
  }

  return {
    snapshot,
    catalog,
    loading,
    loaded,
    acting,
    error,
    catalogError,
    refreshRequired,
    displayedItemId,
    claimableMilestones,
    upgradableCount,
    clearCollectionsData,
    fetchSnapshot,
    fetchCatalog,
    operate,
  }
})
