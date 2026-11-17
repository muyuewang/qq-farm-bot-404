import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

/**
 * 特殊互动道具（闪电变异瓶、黄金虫、足球、青蛙使坏瓶等）。
 *
 * 后端按 targetKind 把同一份背包拆成两类：
 * - land：必须指定地块（好友农场用 /api/friend/:gid/interaction-items/use-batch，
 *   自己农场用 /api/farm/interaction-items/use-batch）
 * - farm：整座农场生效，无需地块（/api/friend/:gid/interaction-items/use-farm）
 *
 * 库存、可选中地块和逐地块结果全部由后端判定，前端只负责选择与展示，
 * 不做本地预判放行，避免和自动化流程出现两套规则。
 */
export interface InteractionItem {
  id: string
  itemId: string
  name: string
  image: string
  count: number
  interactionType: string
  targetKind: 'land' | 'farm'
  description: string
  nearestExpireTime: number
  selfUsable?: boolean
}

export interface InteractionAttempt {
  landId: string
  ok: boolean
  code: string
  message: string
}

export interface InteractionResult {
  ownerName?: string
  itemName?: string
  successCount?: number
  failureCount?: number
  results?: InteractionAttempt[]
  items?: InteractionItem[]
  message?: string
  [key: string]: any
}

export const useInteractionStore = defineStore('interaction', () => {
  const friendItems = ref<InteractionItem[]>([])
  const friendItemsLoading = ref(false)
  const friendItemsError = ref('')

  const selfItems = ref<InteractionItem[]>([])
  const selfItemsLoading = ref(false)
  const selfItemsError = ref('')

  const submitting = ref(false)
  const lastResult = ref<InteractionResult | null>(null)

  const landItems = computed(() => friendItems.value.filter(item => item.targetKind === 'land'))
  const farmItems = computed(() => friendItems.value.filter(item => item.targetKind === 'farm'))

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function pickItems(payload: any): InteractionItem[] {
    const list = Array.isArray(payload?.items) ? payload.items : []
    return list.map((item: any) => ({
      id: String(item?.itemId ?? item?.id ?? ''),
      itemId: String(item?.itemId ?? item?.id ?? ''),
      name: String(item?.name || `物品${item?.itemId ?? item?.id ?? ''}`),
      image: String(item?.image || ''),
      count: Math.max(0, Number(item?.count) || 0),
      interactionType: String(item?.interactionType || ''),
      targetKind: item?.targetKind === 'farm' ? 'farm' : 'land',
      description: String(item?.description || ''),
      nearestExpireTime: Number(item?.nearestExpireTime) || 0,
      selfUsable: Boolean(item?.selfUsable),
    })).filter((item: InteractionItem) => item.itemId && item.count > 0)
  }

  async function fetchFriendItems(accountId: string) {
    if (!accountId)
      return
    friendItemsLoading.value = true
    friendItemsError.value = ''
    try {
      const { data } = await api.get('/api/friend-interaction-items', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(accountId))
        return
      if (data?.ok)
        friendItems.value = pickItems(data.data)
      else
        friendItemsError.value = String(data?.error || '读取互动道具失败')
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        friendItemsError.value = String(error?.response?.data?.error || error?.message || '读取互动道具失败')
    }
    finally {
      friendItemsLoading.value = false
    }
  }

  async function fetchSelfItems(accountId: string) {
    if (!accountId)
      return
    selfItemsLoading.value = true
    selfItemsError.value = ''
    try {
      const { data } = await api.get('/api/farm/interaction-items', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(accountId))
        return
      if (data?.ok)
        selfItems.value = pickItems(data.data)
      else
        selfItemsError.value = String(data?.error || '读取互动道具失败')
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        selfItemsError.value = String(error?.response?.data?.error || error?.message || '读取互动道具失败')
    }
    finally {
      selfItemsLoading.value = false
    }
  }

  function applyResult(result: InteractionResult | null) {
    lastResult.value = result
    // 使用成功后后端会回传最新库存，直接覆盖避免额外一次请求。
    if (Array.isArray(result?.items))
      friendItems.value = pickItems({ items: result?.items })
  }

  /** 好友农场按地块批量使用；返回逐地块结果供页面展示。 */
  async function useFriendLandBatch(accountId: string, gid: string, itemId: string, landIds: string[]) {
    if (!accountId || !gid || !itemId || landIds.length === 0)
      return null
    submitting.value = true
    try {
      const { data } = await api.post(`/api/friend/${gid}/interaction-items/use-batch`, { itemId, landIds }, {
        headers: { 'x-account-id': accountId },
      })
      applyResult(data?.data || null)
      if (!data?.ok)
        throw new Error(String(data?.error || '使用失败'))
      return data.data as InteractionResult
    }
    finally {
      submitting.value = false
    }
  }

  /** 好友农场整场生效道具（青蛙使坏瓶一类），不需要地块。 */
  async function useFriendFarmItem(accountId: string, gid: string, itemId: string) {
    if (!accountId || !gid || !itemId)
      return null
    submitting.value = true
    try {
      const { data } = await api.post(`/api/friend/${gid}/interaction-items/use-farm`, { itemId }, {
        headers: { 'x-account-id': accountId },
      })
      applyResult(data?.data || null)
      if (!data?.ok)
        throw new Error(String(data?.error || '使用失败'))
      return data.data as InteractionResult
    }
    finally {
      submitting.value = false
    }
  }

  /** 自己农场按地块批量使用。 */
  async function useSelfLandBatch(accountId: string, itemId: string, landIds: string[]) {
    if (!accountId || !itemId || landIds.length === 0)
      return null
    submitting.value = true
    try {
      const { data } = await api.post('/api/farm/interaction-items/use-batch', { itemId, landIds }, {
        headers: { 'x-account-id': accountId },
      })
      applyResult(data?.data || null)
      if (!data?.ok)
        throw new Error(String(data?.error || '使用失败'))
      return data.data as InteractionResult
    }
    finally {
      submitting.value = false
    }
  }

  function clearInteractionData() {
    friendItems.value = []
    friendItemsError.value = ''
    selfItems.value = []
    selfItemsError.value = ''
    lastResult.value = null
  }

  return {
    friendItems,
    friendItemsLoading,
    friendItemsError,
    selfItems,
    selfItemsLoading,
    selfItemsError,
    landItems,
    farmItems,
    submitting,
    lastResult,
    clearInteractionData,
    fetchFriendItems,
    fetchSelfItems,
    useFriendLandBatch,
    useFriendFarmItem,
    useSelfLandBatch,
  }
})
