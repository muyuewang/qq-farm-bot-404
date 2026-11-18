import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export const CROP_ILLUSTRATED_TYPE = 1
export const MUTANT_ILLUSTRATED_TYPE = 2

export interface IllustratedReward {
  itemId: number
  count: number
  name: string
  image?: string
}

export interface IllustratedAttribute {
  type: number
  param: number
  value: number
}

export interface IllustratedShopSeed {
  seedId: number
  goodsId: number
  name?: string
  price: number | null
  itemCount: number
  remainingPurchaseCount: number | null
  requiredLevel: number
  requiresUnlockCard: boolean
  locked: boolean
  soldOut: boolean
  /** 后端商店读取失败时的本地备选标记，价格与限购未知 */
  unknownMeta?: boolean
}

export interface IllustratedItem {
  seedId: number
  /** 果实 ID，「全部已读」按它上报；后端未下发时为 0 */
  fruitId: number
  name: string
  image?: string
  unlocked: boolean
  progress: number
  isNew: boolean
  group: string
  sort: number
  rewardCategory: number
  cropCategory: number
  reward: IllustratedReward | null
  attributes: IllustratedAttribute[]
  shopSeed?: IllustratedShopSeed | null
}

export interface IllustratedLevel {
  level: number
  progress: number
  claimed: boolean
  canClaim: boolean
  rewards: IllustratedReward[]
}

export interface IllustratedBook {
  type: number
  level: number
  progress: number
  nextLevelProgress: number
  claimable: boolean
  rewards: IllustratedReward[]
  buffs: any[]
  currentBuffs: any[]
  items: IllustratedItem[]
  levels: IllustratedLevel[]
}

export interface IllustratedSnapshot {
  crop: IllustratedBook | null
  mutant: IllustratedBook | null
  updatedAt: number
}

export interface IllustratedActionResult {
  ok: boolean
  data?: any
  error?: string
}

function toNumber(value: unknown, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '')
    return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function mapReward(raw: any): IllustratedReward | null {
  if (!raw)
    return null
  return {
    itemId: toNumber(raw.itemId),
    count: toNumber(raw.count),
    name: String(raw.name || ''),
    image: typeof raw.image === 'string' ? raw.image : '',
  }
}

function mapRewards(raw: any): IllustratedReward[] {
  return (Array.isArray(raw) ? raw : []).map(mapReward).filter(Boolean) as IllustratedReward[]
}

function mapShopSeed(raw: any): IllustratedShopSeed | null {
  if (!raw)
    return null
  const unknownMeta = raw.unknownMeta === true
  return {
    seedId: toNumber(raw.seedId),
    goodsId: toNumber(raw.goodsId),
    name: String(raw.name || ''),
    price: unknownMeta ? null : toNullableNumber(raw.price),
    itemCount: Math.max(1, toNumber(raw.itemCount, 1)),
    remainingPurchaseCount: unknownMeta ? null : toNullableNumber(raw.remainingPurchaseCount),
    requiredLevel: toNumber(raw.requiredLevel),
    requiresUnlockCard: raw.requiresUnlockCard === true,
    locked: raw.locked === true,
    soldOut: raw.soldOut === true,
    unknownMeta,
  }
}

function mapItem(raw: any): IllustratedItem {
  return {
    seedId: toNumber(raw?.seedId),
    fruitId: toNumber(raw?.fruitId),
    name: String(raw?.name || ''),
    image: typeof raw?.image === 'string' ? raw.image : '',
    unlocked: raw?.unlocked === true,
    progress: toNumber(raw?.progress),
    isNew: raw?.isNew === true,
    group: String(raw?.group || ''),
    sort: toNumber(raw?.sort),
    rewardCategory: toNumber(raw?.rewardCategory),
    cropCategory: toNumber(raw?.cropCategory),
    reward: mapReward(raw?.reward),
    attributes: (Array.isArray(raw?.attributes) ? raw.attributes : []).map((entry: any) => ({
      type: toNumber(entry?.type),
      param: toNumber(entry?.param),
      value: toNumber(entry?.value),
    })),
    shopSeed: mapShopSeed(raw?.shopSeed),
  }
}

function mapBook(raw: any): IllustratedBook | null {
  if (!raw)
    return null
  return {
    type: toNumber(raw.type),
    level: toNumber(raw.level),
    progress: toNumber(raw.progress),
    nextLevelProgress: toNumber(raw.nextLevelProgress),
    claimable: raw.claimable === true,
    rewards: mapRewards(raw.rewards),
    buffs: Array.isArray(raw.buffs) ? raw.buffs : [],
    currentBuffs: Array.isArray(raw.currentBuffs) ? raw.currentBuffs : [],
    items: (Array.isArray(raw.items) ? raw.items : []).map(mapItem),
    levels: (Array.isArray(raw.levels) ? raw.levels : []).map((entry: any) => ({
      level: toNumber(entry?.level),
      progress: toNumber(entry?.progress),
      claimed: entry?.claimed === true,
      canClaim: entry?.canClaim === true,
      rewards: mapRewards(entry?.rewards),
    })),
  }
}

function mapSnapshot(raw: any): IllustratedSnapshot {
  return {
    crop: mapBook(raw?.crop),
    mutant: mapBook(raw?.mutant),
    updatedAt: toNumber(raw?.updatedAt),
  }
}

export const useIllustratedStore = defineStore('illustrated', () => {
  const snapshot = ref<IllustratedSnapshot>({ crop: null, mutant: null, updatedAt: 0 })
  /** 后端一次请求同时返回作物与变异两本图鉴，没有按类型查询的参数 */
  const loaded = ref(false)
  const loading = ref(false)
  const claiming = ref(false)
  const error = ref('')
  /** 领取成功后到下一次快照刷新前的提示，避免用旧进度冒充最新值 */
  const refreshRequired = ref(false)

  let fetchRequestId = 0

  const bookByType = computed(() => ({
    [CROP_ILLUSTRATED_TYPE]: snapshot.value.crop,
    [MUTANT_ILLUSTRATED_TYPE]: snapshot.value.mutant,
  } as Record<number, IllustratedBook | null>))

  function clearIllustratedData() {
    snapshot.value = { crop: null, mutant: null, updatedAt: 0 }
    loaded.value = false
    loading.value = false
    claiming.value = false
    error.value = ''
    refreshRequired.value = false
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchSnapshot(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/api/illustrated', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (data?.ok) {
        snapshot.value = mapSnapshot(data.data)
        loaded.value = true
        refreshRequired.value = false
      }
      else {
        snapshot.value = { crop: null, mutant: null, updatedAt: 0 }
        loaded.value = false
        error.value = String(data?.error || data?.errorMessage || '获取图鉴失败')
      }
    }
    catch (err: any) {
      if (requestId === fetchRequestId && isCurrentAccount(requestedId)) {
        snapshot.value = { crop: null, mutant: null, updatedAt: 0 }
        loaded.value = false
        error.value = String(err?.response?.data?.error || err?.response?.data?.errorMessage || err?.message || '获取图鉴失败')
      }
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function claimRewards(accountId: string, type: number): Promise<IllustratedActionResult> {
    if (!accountId)
      return { ok: false, error: '请先选择账号' }
    const requestedId = String(accountId)
    claiming.value = true
    try {
      const { data } = await api.post('/api/illustrated/claim', { type }, {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok) {
        if (data.data?.snapshot && isCurrentAccount(requestedId)) {
          snapshot.value = mapSnapshot(data.data.snapshot)
          loaded.value = true
          refreshRequired.value = false
        }
        else if (isCurrentAccount(requestedId)) {
          refreshRequired.value = true
        }
        return { ok: true, data: data.data }
      }
      return {
        ok: false,
        error: String(data?.error || data?.errorMessage || '领取图鉴奖励失败'),
      }
    }
    catch (err: any) {
      return {
        ok: false,
        error: String(err?.response?.data?.error || err?.response?.data?.errorMessage || err?.message || '领取图鉴奖励失败'),
      }
    }
    finally {
      claiming.value = false
    }
  }

  async function clearNew(accountId: string, fruitIds: number[]): Promise<IllustratedActionResult> {
    const ids = (Array.isArray(fruitIds) ? fruitIds : []).filter(id => Number.isFinite(id) && id > 0)
    if (!accountId)
      return { ok: false, error: '请先选择账号' }
    if (!ids.length)
      return { ok: true, data: { cleared: [] } }
    const requestedId = String(accountId)
    try {
      const { data } = await api.post('/api/illustrated/clear-new', { fruitIds: ids }, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok)
        return { ok: false, error: String(data?.error || data?.errorMessage || '图鉴已读清除失败') }
      const cleared: number[] = Array.isArray(data?.data?.cleared) ? data.data.cleared : []
      // 只更新已确认清除的条目；其余条目保持原状态，等服务端下次快照纠正。
      if (cleared.length && isCurrentAccount(requestedId)) {
        const done = new Set(cleared.map((id: any) => toNumber(id)))
        for (const book of [snapshot.value.crop, snapshot.value.mutant]) {
          for (const item of (book?.items || [])) {
            if (done.has(item.fruitId))
              item.isNew = false
          }
        }
      }
      return { ok: true, data: { cleared } }
    }
    catch (err: any) {
      return {
        ok: false,
        error: String(err?.response?.data?.error || err?.response?.data?.errorMessage || err?.message || '图鉴已读清除失败'),
      }
    }
  }

  return {
    snapshot,
    loaded,
    loading,
    claiming,
    error,
    refreshRequired,
    bookByType,
    clearIllustratedData,
    fetchSnapshot,
    claimRewards,
    clearNew,
  }
})
