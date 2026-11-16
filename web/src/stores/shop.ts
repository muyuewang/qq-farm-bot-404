import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

/**
 * 视图模型只映射后端真实字段：
 * - 种子：GET /api/seeds（商店实时） + GET /api/config/seeds（本地配置补充）
 * - 道具：GET /api/props-shop（ShopService shop_id 4）
 * - 神秘商人：GET /api/mystery-shop
 * 后端不再提供的分区（宠物商店、轮盘道具商城、神秘商人购买历史/请离）不在此处占位。
 */
export interface ShopSeedItem {
  /** 商店商品 ID；本地备选列表为 0，不可购买 */
  id: number
  itemId: number
  name: string
  image?: string
  price: number | null
  itemCount: number
  /** 本地配置要求的角色等级，仅用于排序与展示 */
  seedLevel: number
  /** 商店下发的解锁等级条件 */
  requiredLevel: number
  seasons?: number
  expPerSeason?: number
  unlocked?: boolean
  isSoldOut?: boolean
  /** 商店只下发剩余限购数量；null 表示不限购或未知 */
  remainingPurchaseCount?: number | null
  requiresUnlockCard?: boolean
  /** 后端商店读取失败时回退的本地配置行，价格与限购未知 */
  fromLocalConfig?: boolean
}

export interface ShopPropsCurrency {
  id: number
  name: string
  image?: string
  /** null 表示后端未能确认余额 */
  balance: number | null
}

export interface ShopPropsExpectedOffer {
  price: { id: number, count: number }
  rewards: Array<{ id: number, count: number }>
}

export interface ShopPropsItem {
  id: number
  itemId: number
  name: string
  image?: string
  rarity: number
  rewardCount: number
  price: number
  originalPrice: number | null
  isFree: boolean
  currencyId: number
  currencyName: string
  /** null 表示后端未能确认余额 */
  balance: number | null
  limitType: number
  limitCount: number
  boughtNum: number
  remainingPurchaseCount: number | null
  discountText: string
  isDiscounted: boolean
  discountEndTime: number
  purchaseStatus: string
  unavailableReason: string
  purchasable: boolean
  /** 购买时必须原样回传，后端据此拒绝价格或内容已变的商品 */
  expectedOffer: ShopPropsExpectedOffer
}

export interface MysteryShopOffer {
  active: boolean
  npcId: number
  itemId: number
  itemName: string
  itemImage?: string
  itemCount: number
  currencyId: number
  currencyName: string
  price: number
  originalPrice: number
  discountPercent: number
  /** null 表示后端未能确认余额 */
  balance: number | null
  startTime: number
  endTime: number
}

export interface ShopActionResult {
  ok: boolean
  data?: any
  error?: string
}

export const GOLD_ITEM_ID = 1001
export const COUPON_ITEM_ID = 1002
export const DIAMOND_ITEM_ID = 1004
export const GOLD_BEAN_ITEM_ID = 1005

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

function normalizeResult(data: any, fallbackMessage: string): ShopActionResult {
  if (data?.ok)
    return { ok: true, data: data.data }
  return {
    ok: false,
    error: String(data?.error || data?.errorMessage || fallbackMessage),
  }
}

function requestError(err: any, fallbackMessage: string) {
  const payload = err?.response?.data
  return String(payload?.error || payload?.errorMessage || err?.message || fallbackMessage)
}

function mapSeed(raw: any, config: any): ShopSeedItem {
  const fromLocalConfig = raw?.unknownMeta === true || toNumber(raw?.goodsId) <= 0
  return {
    id: toNumber(raw?.goodsId),
    itemId: toNumber(raw?.seedId),
    name: String(raw?.name || config?.name || ''),
    image: typeof config?.image === 'string' ? config.image : '',
    price: fromLocalConfig ? null : toNullableNumber(raw?.price),
    itemCount: Math.max(1, toNumber(raw?.itemCount, 1)),
    seedLevel: toNumber(config?.requiredLevel),
    requiredLevel: toNumber(raw?.requiredLevel),
    seasons: toNullableNumber(config?.seasons) ?? undefined,
    expPerSeason: toNullableNumber(config?.exp) ?? undefined,
    unlocked: fromLocalConfig ? false : raw?.locked !== true,
    isSoldOut: raw?.soldOut === true,
    remainingPurchaseCount: fromLocalConfig ? null : toNullableNumber(raw?.remainingPurchaseCount),
    requiresUnlockCard: raw?.requiresUnlockCard === true,
    fromLocalConfig,
  }
}

function mapCurrency(raw: any): ShopPropsCurrency {
  return {
    id: toNumber(raw?.id),
    name: String(raw?.name || ''),
    image: typeof raw?.image === 'string' ? raw.image : '',
    balance: raw?.balanceKnown === false ? null : toNumber(raw?.count),
  }
}

function mapPropsGoods(raw: any): ShopPropsItem {
  const rewards = Array.isArray(raw?.rewards) ? raw.rewards : []
  const reward = rewards[0] || {}
  const price = raw?.price || {}
  const limit = raw?.limit || null
  return {
    id: toNumber(raw?.id),
    itemId: toNumber(reward?.id),
    name: String(raw?.name || reward?.name || ''),
    image: typeof reward?.image === 'string' ? reward.image : '',
    rarity: toNumber(reward?.rarity),
    rewardCount: toNumber(reward?.count),
    price: toNumber(price?.count),
    originalPrice: toNullableNumber(raw?.originalPrice),
    isFree: raw?.isFree === true,
    currencyId: toNumber(price?.id),
    currencyName: String(price?.name || ''),
    balance: toNullableNumber(price?.balance),
    limitType: toNumber(limit?.type),
    limitCount: toNumber(limit?.max),
    boughtNum: toNumber(limit?.bought),
    remainingPurchaseCount: limit ? toNumber(limit?.remaining) : null,
    discountText: String(raw?.discountText || ''),
    isDiscounted: raw?.isDiscounted === true,
    discountEndTime: toNumber(raw?.discountEndTime),
    purchaseStatus: String(raw?.purchaseStatus || 'unavailable'),
    unavailableReason: String(raw?.unavailableReason || ''),
    purchasable: raw?.purchasable === true,
    expectedOffer: {
      price: { id: toNumber(price?.id), count: toNumber(price?.count) },
      rewards: rewards.map((entry: any) => ({
        id: toNumber(entry?.id),
        count: toNumber(entry?.count),
      })),
    },
  }
}

function mapMysteryOffer(shop: any): MysteryShopOffer | null {
  const npc = shop?.npc
  if (!shop?.active || !npc || toNumber(npc.id) <= 0)
    return null
  const reward = npc?.reward || {}
  const price = npc?.price || {}
  return {
    active: true,
    npcId: toNumber(npc.id),
    itemId: toNumber(reward.id),
    itemName: String(reward.name || ''),
    itemImage: typeof reward.image === 'string' ? reward.image : '',
    itemCount: toNumber(reward.count),
    currencyId: toNumber(price.id),
    currencyName: String(price.name || ''),
    price: toNumber(price.count),
    originalPrice: toNumber(npc.originalPrice),
    discountPercent: toNumber(npc.discountPercent),
    balance: toNullableNumber(price.balance),
    startTime: toNumber(shop.activeTime),
    endTime: toNumber(shop.expireTime),
  }
}

export const useShopStore = defineStore('shop', () => {
  const seeds = ref<ShopSeedItem[]>([])
  const propsGoods = ref<ShopPropsItem[]>([])
  const propsCurrencies = ref<ShopPropsCurrency[]>([])
  const mysteryOffer = ref<MysteryShopOffer | null>(null)
  const mysteryOfferAccountId = ref('')

  const loading = ref(false)
  const propsLoading = ref(false)
  const mysteryLoading = ref(false)

  const error = ref('')
  const propsError = ref('')
  const mysteryError = ref('')

  /** 后端商店读取失败时回退的本地备选列表：价格与限购均不可信 */
  const seedsFromLocalConfig = computed(() =>
    seeds.value.length > 0 && seeds.value.every(item => item.fromLocalConfig === true))

  const currencyById = computed(() => {
    const map = new Map<number, ShopPropsCurrency>()
    for (const currency of propsCurrencies.value)
      map.set(currency.id, currency)
    return map
  })

  let seedRequestId = 0
  let propsRequestId = 0
  let mysteryRequestId = 0

  function clearShopData() {
    seeds.value = []
    propsGoods.value = []
    propsCurrencies.value = []
    mysteryOffer.value = null
    mysteryOfferAccountId.value = ''
    loading.value = false
    propsLoading.value = false
    mysteryLoading.value = false
    error.value = ''
    propsError.value = ''
    mysteryError.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function currencyBalance(currencyId: number): number | null {
    return currencyById.value.get(currencyId)?.balance ?? null
  }

  async function fetchSeeds(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++seedRequestId
    loading.value = true
    error.value = ''
    try {
      const headers = { 'x-account-id': accountId }
      const [seedReply, configReply] = await Promise.all([
        api.get('/api/seeds', { headers }),
        api.get('/api/config/seeds', { headers }),
      ])
      if (requestId !== seedRequestId || !isCurrentAccount(requestedId))
        return

      if (!seedReply.data?.ok) {
        seeds.value = []
        error.value = String(seedReply.data?.error || '获取种子商店失败')
        return
      }

      const configBySeedId = new Map<number, any>()
      if (Array.isArray(configReply.data?.data)) {
        for (const entry of configReply.data.data)
          configBySeedId.set(toNumber(entry?.seedId), entry)
      }

      const rows = Array.isArray(seedReply.data.data) ? seedReply.data.data : []
      seeds.value = rows.map((row: any) => mapSeed(row, configBySeedId.get(toNumber(row?.seedId))))
    }
    catch (err: any) {
      if (requestId === seedRequestId && isCurrentAccount(requestedId)) {
        seeds.value = []
        error.value = requestError(err, '获取种子商店失败')
      }
    }
    finally {
      if (requestId === seedRequestId)
        loading.value = false
    }
  }

  async function fetchPropsShop(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++propsRequestId
    propsLoading.value = true
    propsError.value = ''
    try {
      const { data } = await api.get('/api/props-shop', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== propsRequestId || !isCurrentAccount(requestedId))
        return
      if (data?.ok) {
        propsGoods.value = (Array.isArray(data.data?.goods) ? data.data.goods : []).map(mapPropsGoods)
        propsCurrencies.value = (Array.isArray(data.data?.currencies) ? data.data.currencies : []).map(mapCurrency)
      }
      else {
        propsGoods.value = []
        propsCurrencies.value = []
        propsError.value = String(data?.error || data?.errorMessage || '获取道具商店失败')
      }
    }
    catch (err: any) {
      if (requestId === propsRequestId && isCurrentAccount(requestedId)) {
        propsGoods.value = []
        propsCurrencies.value = []
        propsError.value = requestError(err, '获取道具商店失败')
      }
    }
    finally {
      if (requestId === propsRequestId)
        propsLoading.value = false
    }
  }

  async function fetchMysteryShop(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++mysteryRequestId
    mysteryLoading.value = true
    mysteryError.value = ''
    try {
      const { data } = await api.get('/api/mystery-shop', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== mysteryRequestId || !isCurrentAccount(requestedId))
        return
      if (data?.ok) {
        mysteryOffer.value = mapMysteryOffer(data.data)
        mysteryOfferAccountId.value = requestedId
      }
      else {
        mysteryOffer.value = null
        mysteryOfferAccountId.value = ''
        mysteryError.value = String(data?.error || data?.errorMessage || '获取神秘商人失败')
      }
    }
    catch (err: any) {
      if (requestId === mysteryRequestId && isCurrentAccount(requestedId)) {
        mysteryOffer.value = null
        mysteryOfferAccountId.value = ''
        mysteryError.value = requestError(err, '获取神秘商人失败')
      }
    }
    finally {
      if (requestId === mysteryRequestId)
        mysteryLoading.value = false
    }
  }

  async function purchaseSeed(accountId: string, goodsId: number, count: number): Promise<ShopActionResult> {
    try {
      const { data } = await api.post('/api/seeds/purchase', { goodsId, count }, {
        headers: { 'x-account-id': accountId },
      })
      return normalizeResult(data, '购买种子失败')
    }
    catch (err: any) {
      return { ok: false, error: requestError(err, '购买种子失败') }
    }
  }

  async function purchasePropsGoods(
    accountId: string,
    goodsId: number,
    count: number,
    expectedOffer: ShopPropsExpectedOffer,
  ): Promise<ShopActionResult> {
    try {
      const { data } = await api.post('/api/props-shop/purchase', { goodsId, count, expectedOffer }, {
        headers: { 'x-account-id': accountId },
      })
      const result = normalizeResult(data, '购买道具失败')
      if (result.ok)
        applyPropsCatalogResult(result.data)
      return result
    }
    catch (err: any) {
      return { ok: false, error: requestError(err, '购买道具失败') }
    }
  }

  function applyPropsCatalogResult(payload: any) {
    const catalog = payload?.catalog
    if (!catalog)
      return
    propsGoods.value = (Array.isArray(catalog.goods) ? catalog.goods : []).map(mapPropsGoods)
    propsCurrencies.value = (Array.isArray(catalog.currencies) ? catalog.currencies : []).map(mapCurrency)
  }

  async function purchaseMysteryOffer(accountId: string, npcId: number): Promise<ShopActionResult> {
    try {
      const { data } = await api.post('/api/mystery-shop/purchase', { npcId }, {
        headers: { 'x-account-id': accountId },
      })
      const result = normalizeResult(data, '购买神秘商人商品失败')
      if (result.ok && isCurrentAccount(accountId)) {
        mysteryOffer.value = mapMysteryOffer(result.data?.shop)
        mysteryOfferAccountId.value = String(accountId)
      }
      return result
    }
    catch (err: any) {
      return { ok: false, error: requestError(err, '购买神秘商人商品失败') }
    }
  }

  async function refreshAll(accountId: string) {
    await Promise.all([
      fetchSeeds(accountId),
      fetchPropsShop(accountId),
      fetchMysteryShop(accountId),
    ])
  }

  return {
    seeds,
    propsGoods,
    propsCurrencies,
    mysteryOffer,
    mysteryOfferAccountId,
    loading,
    propsLoading,
    mysteryLoading,
    error,
    propsError,
    mysteryError,
    seedsFromLocalConfig,
    currencyBalance,
    clearShopData,
    fetchSeeds,
    fetchPropsShop,
    fetchMysteryShop,
    refreshAll,
    purchaseSeed,
    purchasePropsGoods,
    purchaseMysteryOffer,
  }
})
