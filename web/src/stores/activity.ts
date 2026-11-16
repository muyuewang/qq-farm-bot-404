import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { SHARE_REWARD_ACTIVITY_ID } from '@/constants/activity-windows'
import { useAccountStore } from '@/stores/account'
import {
  mapCharityFlowerActivity,
  mapQixiActivity,
  mapRainPoemActivity,
  mapStarActivity,
} from '@/utils/activity-center'
import { mapShareRewardActivity, mapWishSignActivity } from '@/utils/autumn-activity'

export interface ActivityExchangeShopItem {
  id: number
  sort: number
  status: number
  owned: boolean
  isRepeatable?: boolean
  exchangeLimit?: number
  ownedBlocksExchange?: boolean
  statusLabel: string
  name: string
  itemId: number
  itemCount: number
  itemName: string
  image?: string
  itemType: number
  itemTypeLabel: string
  isDecoration: boolean
  currencyId: number
  currencyName: string
  price: number
  desc: string
  extra: string
}

export interface HeluDrawReward {
  itemId: number
  itemCount: number
  count?: number
  itemName: string
  name?: string
  image?: string
}

export interface HeluDrawCost {
  itemId?: number
  itemName?: string
  itemCount?: number
  image?: string
}

export interface HeluDrawResult {
  rewards?: HeluDrawReward[]
  items?: HeluDrawReward[]
  cost?: HeluDrawCost | null
}

export interface HeluSeasonRewardTier {
  level: number
  /** 新协议每个通行证节点只有一份奖励列表，不再区分免费/珍藏两轨。 */
  rewards: HeluDrawReward[]
}

export interface HeluSeasonPassport {
  uid?: string
  title: string
  seasonTitle?: string
  currentLevel: number
  score?: number
  currentProgress?: number
  nextLevelNeed?: number
  maxLevel?: number
  freeClaimedLevel?: number
  premiumClaimedLevel?: number
  claimableLevels: number
  rewardTierCount?: number
  levelRewardTiers?: HeluSeasonRewardTier[]
  rewards?: HeluDrawReward[]
  configText?: string
  startTime?: number
  endTime?: number
  nowTime?: number
  warning?: string
}

export interface HeluSolarTerm {
  id: number
  title: string
  status: number
  statusLabel: string
  claimable: boolean
  claimStatusKnown?: boolean
  claimActive?: boolean
  wineActive?: boolean
  startTime: number
  endTime: number
  rewards: HeluDrawReward[]
}

export interface HeluSolarTerms {
  nowTime?: number
  terms: HeluSolarTerm[]
  claimableCount: number
  nextTerm?: HeluSolarTerm | null
  currentTerm?: HeluSolarTerm | null
  tipsText?: string
  warning?: string
}

export interface StarRecordItem {
  id: number
  title: string
  category: string
  explain: string
  /** 新协议星宿图鉴不下发星图与精选标记，缺省即未提供。 */
  graph?: string
  featured?: boolean
  unlocked: boolean
  claimed: boolean
  claimable: boolean
  rewards: HeluDrawReward[]
}

export interface StarActivityData {
  uid: string
  title: string
  activityId: number
  startTime?: number
  endTime?: number
  starRecord: {
    status: number
    openedDays: number
    records: StarRecordItem[]
    totalCount: number
    unlockedCount: number
    claimedCount: number
    claimableCount: number
  }
  exchangeShop: ActivityExchangeShopItem[]
  shopReadOnly: boolean
  shopWarning?: string
  starSandCurrencyId: number
  starSandBalance: number
  passport?: HeluSeasonPassport | null
  solarTerms?: HeluSolarTerms | null
  qingmei?: QingmeiActivity | null
  warning?: string
}

export interface QixiItem {
  itemId: number
  itemCount: number
  itemName: string
  image?: string
  /** 服务端没读到背包时余额为 null，此时 itemCount 不可信，页面显示「-」而不是 0。 */
  countKnown?: boolean
}
export interface QixiFriend { gid: number, name: string, avatar?: string, level?: number }
export interface QixiActivityData {
  uid: string
  title: string
  activityId: number
  startTime: number
  endTime: number
  active: boolean
  items: { feather: QixiItem, dew: QixiItem, sachet: QixiItem }
  bridge: {
    stages: Array<{ id: number, status: number, claimed: boolean, cost: QixiItem, rewards: QixiItem[] }>
    completedCount: number
    nextStage?: { id: number, status: number, claimed: boolean, cost: QixiItem, rewards: QixiItem[] } | null
  }
  gift: {
    sentCount: number
    maxCount: number
    remainingCount: number
    cost: QixiItem
    reward: QixiItem
    enabled: boolean
  }
}

export interface RainPoemActivityData {
  title: string
  startTime: number
  endTime: number
  active: boolean
  items: { collectionBottles: number, summonBottles: number, frogPrankBottles: number, cloudPrankBottles: number, badges: number }
  /** 服务端没下发商店档位时为 null，页面显示未下发而不是「不可购买」。 */
  shop: { purchasedToday: boolean, available: boolean, dailyLimit: number, cost: QixiItem, item: QixiItem } | null
  collection: {
    dailyUseLimit: number
    /** 新协议不下发今日剩余采集次数，null 表示未提供。 */
    remainingUseCount: number | null
    rewards: QixiItem[]
  }
  weather?: { type: number, status: number, startTime?: number, endTime?: number, rainstorm: boolean, error?: string }
  tasks: Array<{ id: number, itemId: number, desc: string, target: number, progress: number, reward: QixiItem }>
  research: { currentStage: number, stages: Array<{ id: number, status: number, available: boolean, completed: boolean, claimed: boolean, cost: QixiItem, reward: QixiItem }> }
}

export interface CharityFlowerActivityData {
  uid: string
  title: string
  activityId: number
  startTime: number
  endTime: number
  active: boolean
  love: { itemId: number, count: number, personalScore: number, canDonate: boolean }
  /** 新协议只按爱心计数，没有爱心到公益金的换算字段，因此不再有金额。 */
  global: { score: number, target: number, reached: boolean }
  share: { claimed: boolean, claimable: boolean, rewards: QixiItem[] }
  personalRewards: Array<{ needScore: number, reached: boolean, claimed: boolean, claimable: boolean, rewards: QixiItem[] }>
  finalReward: { threshold: number, eligible: boolean, rewards: QixiItem[] }
  /** 公益金只下发日期与状态码，状态码语义未确认，页面不猜成「已送出」。 */
  publicFund: { date: number, statusCode: string } | null
}

export type HeluSubActivityKey = 'giftLotus' | 'shop' | 'journey' | 'notes'

export interface QingmeiActivity {
  uid: string
  title: string
  activityId: number
  claimActivityId: number
  claimCommand: number
  wineActivityId?: number
  wineTitle?: string
  winePreviewCommand?: number
  wineBrewCommand?: number
  wineSellCommand?: number
  startTime?: number
  endTime?: number
  status?: number
  claimed: boolean
  claimable: boolean
  reward: HeluDrawReward
  material?: HeluDrawReward
  warning?: string
}

export interface QingmeiBrewResult {
  wineType: number
  cost: number
  price: number
  canDouble: boolean
}

export interface QingmeiSellResult {
  multiple: number
  gold: number
  item?: HeluDrawReward
}

export interface HeluSubActivity {
  key: HeluSubActivityKey
  id: number
  parentId: number
  title: string
  icon: string
  type: number
  sort: number
  status: number
  visible: boolean
  enabled: boolean
  startTime: number
  endTime: number
  payload?: Record<string, unknown> | null
  payloadSummary: Array<{ key: string, value: string }>
  hasDraw: boolean
  hasExchangeShop: boolean
  available: boolean
  source: string
}

export interface HeluActivityData {
  uid: string
  title: string
  activityId: number
  drawActivityId: number
  drawCommand: number
  draw: {
    freeMax: number
    freeUsed: number
    freeRemaining: number
    paidMax: number
    paidUsed: number
    paidRemaining: number
    paidPrice: number
    paidCurrencyId: number
    rewardPool: HeluDrawReward[]
    actions?: {
      one?: { count: number, available: boolean, cost: number, currencyId: number, type: string, label: string }
      batch?: { count: number, available: boolean, cost: number, currencyId: number, type: string, label: string }
    }
    dailyMax: number
    dailyUsed: number
    dailyRemaining: number
  }
  exchangeActivityId: number
  exchangeShop: ActivityExchangeShopItem[]
  subActivities: HeluSubActivity[]
  passport?: HeluSeasonPassport | null
  solarTerms?: HeluSolarTerms | null
  qingmei?: QingmeiActivity | null
  heluBalance: number
  lastDrawResult?: HeluDrawResult | null
  warning?: string
  summary: {
    rewardPoolCount: number
    exchangeShopCount: number
    activityCount: number
    subActivityCount?: number
    dailyUsed: number
    dailyRemaining: number
  }
  raw?: {
    activityCount?: number
    activityTitles?: string[]
    activityIds?: number[]
  }
}

export const useActivityStore = defineStore('activity', () => {
  const heluActivity = ref<StarActivityData | null>(null)
  const qixiActivity = ref<QixiActivityData | null>(null)
  const rainPoemActivity = ref<RainPoemActivityData | null>(null)
  const rainPoemLoading = ref(false)
  const charityFlowerActivity = ref<CharityFlowerActivityData | null>(null)
  const charityFlowerLoading = ref(false)
  const wishSignActivity = ref<any | null>(null)
  const wishSignLoading = ref(false)
  const shareRewardActivity = ref<any | null>(null)
  const shareRewardLoading = ref(false)
  const qixiFriends = ref<QixiFriend[]>([])
  const qixiLoading = ref(false)
  const qixiGiftLoading = ref(false)

  const heluLoading = ref(false)
  const exchangeLoading = ref(false)
  const passportClaimLoading = ref(false)
  const solarClaimLoading = ref(false)
  const starRecordClaimLoading = ref(false)

  const heluError = ref('')

  let heluRequestId = 0

  function clearActivityData() {
    heluActivity.value = null
    qixiActivity.value = null
    rainPoemActivity.value = null
    charityFlowerActivity.value = null
    wishSignActivity.value = null
    shareRewardActivity.value = null
    qixiFriends.value = []
    heluLoading.value = false
    exchangeLoading.value = false
    passportClaimLoading.value = false
    solarClaimLoading.value = false
    starRecordClaimLoading.value = false
    heluError.value = ''
  }

  /** 新后端把好友列表独立到 /api/friends，读取失败不影响活动详情本身。 */
  async function fetchQixiFriends(accountId: string) {
    try {
      const { data } = await api.get('/api/friends', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (!isCurrentAccount(String(accountId)))
        return
      qixiFriends.value = (Array.isArray(data?.data) ? data.data : [])
        .map((friend: any) => ({
          gid: Number(friend?.gid),
          name: String(friend?.name || friend?.nickname || ''),
          level: Number(friend?.level) || undefined,
        }))
        .filter((friend: any) => Number.isFinite(friend.gid) && friend.gid > 0)
    }
    catch {
      qixiFriends.value = []
    }
  }

  async function fetchQixiActivity(accountId: string) {
    qixiLoading.value = true
    try {
      const { data } = await api.get('/api/activity-center/qixi', { headers: { 'x-account-id': accountId } })
      if (data?.ok && isCurrentAccount(String(accountId)))
        qixiActivity.value = mapQixiActivity(data.data)
      void fetchQixiFriends(accountId)
      return data
    }
    finally { qixiLoading.value = false }
  }

  async function fetchRainPoemActivity(accountId: string) {
    rainPoemLoading.value = true
    try {
      // 雨落成诗现在挂在 activity-center 的天气活动快照下，时间为秒、物品 id 为十进制字符串。
      const { data } = await api.get('/api/activity-center/weather', { headers: { 'x-account-id': accountId } })
      if (data?.ok && isCurrentAccount(String(accountId)))
        rainPoemActivity.value = mapRainPoemActivity(data.data)
      return data
    }
    finally { rainPoemLoading.value = false }
  }

  async function fetchCharityFlowerActivity(accountId: string) {
    charityFlowerLoading.value = true
    try {
      // 公益小红花的活动 ID 由服务端固定，未下发该活动活动时 data 为 null。
      const { data } = await api.get('/api/activity-center/charity-red-flower', { headers: { 'x-account-id': accountId } })
      if (data?.ok && isCurrentAccount(String(accountId)))
        charityFlowerActivity.value = mapCharityFlowerActivity(data.data)
      return data
    }
    finally { charityFlowerLoading.value = false }
  }

  async function fetchWishSignActivity(accountId: string) {
    wishSignLoading.value = true
    try {
      // 秋祈良愿现在挂在 commerce 的秋季活动接口下，时间是毫秒、物品 id 是数字。
      const { data } = await api.get('/api/activities/autumn/wish', { headers: { 'x-account-id': accountId } })
      if (data?.ok && isCurrentAccount(String(accountId)))
        wishSignActivity.value = mapWishSignActivity(data.data)
      return data
    }
    finally { wishSignLoading.value = false }
  }

  async function fetchShareRewardActivity(accountId: string) {
    shareRewardLoading.value = true
    try {
      // 快乐不独享改成按实例 ID 读取，实例白名单见 core/src/activity-data/share-reward-instances.json。
      const { data } = await api.get(`/api/activities/share-reward/${SHARE_REWARD_ACTIVITY_ID}`, { headers: { 'x-account-id': accountId } })
      if (data?.ok && isCurrentAccount(String(accountId)))
        shareRewardActivity.value = mapShareRewardActivity(data.data)
      return data
    }
    finally { shareRewardLoading.value = false }
  }

  async function sendQixiSachet(accountId: string, friendGid: number) {
    qixiGiftLoading.value = true
    try {
      // 新接口每次固定赠出 1 个香囊，份数由服务端决定，页面不再让用户自选数量。
      const { data } = await api.post('/api/activity-center/qixi/gift', { friendGid: String(friendGid) }, { headers: { 'x-account-id': accountId } })
      if (data?.ok && isCurrentAccount(String(accountId)))
        await fetchQixiActivity(accountId)
      return data
    }
    finally { qixiGiftLoading.value = false }
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchHeluActivity(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++heluRequestId
    heluLoading.value = true
    heluError.value = ''
    try {
      const { data } = await api.get('/api/activity-center/stellar', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== heluRequestId || !isCurrentAccount(requestedId))
        return
      if (data?.ok)
        heluActivity.value = mapStarActivity(data.data)
      else
        heluError.value = data?.error || '获取心许千灯星垂野失败'
    }
    catch (err: any) {
      if (requestId === heluRequestId && isCurrentAccount(requestedId))
        heluError.value = err.message || '获取心许千灯星垂野失败'
    }
    finally {
      if (requestId === heluRequestId)
        heluLoading.value = false
    }
  }

  /**
   * 星垂野写操作的回包只带自身段落（shop / pass / constellation），没有整份赛季聚合视图，
   * 因此成功后统一重读 /stellar，避免页面在领取或兑换后继续停留在旧进度。
   */
  async function claimStarRecords(accountId: string) {
    const requestedId = String(accountId)
    starRecordClaimLoading.value = true
    try {
      // 「一键点亮领取」对应新后端的点亮今日星宿；奖励由服务端结算，回包不返回奖励明细列表。
      const { data } = await api.post('/api/activity-center/constellation/light', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok && isCurrentAccount(requestedId))
        await fetchHeluActivity(accountId)
      return data
    }
    finally {
      starRecordClaimLoading.value = false
    }
  }

  async function exchangeStarSand(accountId: string, goodsId: number, count: number) {
    const requestedId = String(accountId)
    exchangeLoading.value = true
    try {
      // 兑换走赛季星砂商店，goodsId/count 都是正十进制整数。
      const { data } = await api.post('/api/activity-center/shop/exchange', {
        goodsId: String(goodsId),
        count: String(count),
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok && isCurrentAccount(requestedId))
        await fetchHeluActivity(accountId)
      return data
    }
    finally {
      exchangeLoading.value = false
    }
  }

  async function claimHeluPassport(accountId: string) {
    const requestedId = String(accountId)
    passportClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity-center/pass/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok && isCurrentAccount(requestedId))
        await fetchHeluActivity(accountId)
      return data
    }
    finally {
      passportClaimLoading.value = false
    }
  }

  async function claimHeluSolar(accountId: string, termId?: number) {
    const requestedId = String(accountId)
    // 节令 ID 走路径参数，服务端只接受正十进制整数，非法值直接在前端挡掉。
    if (!Number.isInteger(termId) || Number(termId) <= 0)
      return { ok: false, error: '节令 ID 无效，未发起领取' }
    solarClaimLoading.value = true
    try {
      const { data } = await api.post(`/api/activity-center/solar-terms/${termId}/claim`, {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok && isCurrentAccount(requestedId))
        await fetchHeluActivity(accountId)
      return data
    }
    finally {
      solarClaimLoading.value = false
    }
  }

  return {
    heluActivity,
    qixiActivity,
    rainPoemActivity,
    rainPoemLoading,
    charityFlowerActivity,
    charityFlowerLoading,
    wishSignActivity,
    wishSignLoading,
    shareRewardActivity,
    shareRewardLoading,
    qixiFriends,
    qixiLoading,
    qixiGiftLoading,
    heluLoading,
    exchangeLoading,
    passportClaimLoading,
    solarClaimLoading,
    starRecordClaimLoading,
    heluError,
    clearActivityData,
    fetchHeluActivity,
    fetchQixiActivity,
    fetchRainPoemActivity,
    fetchCharityFlowerActivity,
    fetchWishSignActivity,
    fetchShareRewardActivity,
    sendQixiSachet,
    claimStarRecords,
    exchangeStarSand,
    claimHeluPassport,
    claimHeluSolar,
  }
})
