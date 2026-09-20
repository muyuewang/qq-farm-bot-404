import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

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
  freeRewards: HeluDrawReward[]
  premiumRewards: HeluDrawReward[]
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

export interface PetDiaryActivityBalance {
  itemId: number
  count: number
}

export interface PetDiaryActivityCost {
  itemId: number
  count: number
}

export interface PetDiaryActivityData {
  activityId: number
  groupId: number
  title: string
  active: boolean
  startTime: number
  endTime: number
  serverTime: number
  rules?: string
  warnings?: string[]
  balances: PetDiaryActivityBalance[]
  nurture: {
    initialized: boolean
    adult: boolean
    growth: number
    adultGrowth: number
    dogGranted: boolean
    stage: number
    feedCount: number
    feedLimit: number
    feedCosts: PetDiaryActivityCost[]
    canFeed: boolean
  }
  hunt: {
    count: number
    limit: number
    total: number
    luckyStarTotal: number
    costs: PetDiaryActivityCost[]
    canDraw: boolean
    canPlunder: boolean
  }
  seeds: {
    canClaim: boolean
    days: Array<{ day: number, claimed: boolean, claimable: boolean, rewards: PetDiaryActivityCost[] }>
  }
  stories: Array<{
    order: number
    unlocked: boolean
    claimed: boolean
    animated: boolean
    photo?: string
    caption?: string
  }>
  charms: {
    pool: Array<{ id: number, name: string, description?: string }>
    equipped: Array<{ id: number, name: string }>
    all: Array<{ id: number, name: string, description?: string }>
    picked: boolean
    freeRefreshRemaining: number
    canRefresh: boolean
    refreshNote?: string
  }
  treasures: Array<{
    id: string
    itemId: number
    count: number
    originalCount?: number
    protectedCount?: number
    maxCount?: number
    status: number
    startTime?: number
    endTime?: number
    plunderCount?: number
    maxPlunderCount?: number
    previews?: Array<{
      challengeId: number
      canStart?: boolean
      maxProfit?: PetDiaryActivityCost
      maxLoss?: PetDiaryActivityCost
      plunderableCount?: number
    }>
  }>
  compensationCount: number
  battleCount: number
  battleLimit: number
  skipBattle: boolean
  shop: Array<{
    id: number
    name: string
    order?: number
    category?: string
    rewards: PetDiaryActivityCost[]
    costs: PetDiaryActivityCost[]
    limit: number
    purchased: number
    remaining: number | null
    usesDiamond: boolean
    exchangeable: boolean
  }>
  shopActive: boolean
  solarTerms?: {
    claimableCount: number
    tipsText?: string
    currentTerm?: {
      id: number
      title?: string
      status?: number
      claimable?: boolean
    } | null
    terms: Array<{
      id: number
      title?: string
      status?: number
      statusLabel?: string
      claimable?: boolean
      startTime?: number
      endTime?: number
      rewards?: PetDiaryActivityCost[]
    }>
  } | null
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
  currentTerm?: HeluSolarTerm | null
  tipsText?: string
  warning?: string
}

export interface StarRecordItem {
  id: number
  title: string
  category: string
  explain: string
  graph: string
  featured: boolean
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

export interface QixiItem { itemId: number, itemCount: number, itemName: string, image?: string }
export interface QixiFriend { gid: number, name: string, avatar?: string, level?: number }
export interface QixiActivityData {
  uid: string
  title: string
  activityId: number
  startTime: number
  endTime: number
  active: boolean
  items: { feather: QixiItem, dew: QixiItem, sachet: QixiItem }
  dewUsage: { dailyLimit: number, limitReached: boolean }
  bridge: {
    stages: Array<{ id: number, status: number, claimed: boolean, cost: QixiItem, rewards: QixiItem[] }>
    completedCount: number
    nextStage?: { id: number, status: number, claimed: boolean, cost: QixiItem, rewards: QixiItem[] } | null
    canBuild: boolean
  }
  gift: {
    sentCount: number
    receivedCount: number
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
  shop: { purchasedToday: boolean, available: boolean, dailyLimit: number, cost: QixiItem, item: QixiItem }
  collection: { remainingUseCount: number, dailyUseLimit: number, reward: QixiItem }
  summon: { itemId: number, dailyUseLimit: number, durationSeconds: number, usedToday: number }
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
  global: { score: number, target: number, amountYuan: number, targetYuan: number, reached: boolean }
  share: { status: number, claimable: boolean, claimed: boolean, rewards: QixiItem[] }
  personalRewards: Array<{ needScore: number, reached: boolean, claimed: boolean, rewards: QixiItem[] }>
  finalReward: { threshold: number, settlementTime: number, settled: boolean, eligible: boolean, rewards: QixiItem[] }
  publicFund: { status: number, claimable: boolean, claimed: boolean, complianceAgreed: boolean, rewards: QixiItem[], successCount: number }
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
  const petDiaryActivity = ref<PetDiaryActivityData | null>(null)
  const petDiaryLoading = ref(false)
  const qixiFriends = ref<QixiFriend[]>([])
  const qixiLoading = ref(false)
  const qixiBuildLoading = ref(false)
  const qixiGiftLoading = ref(false)
  const qixiDewLoading = ref(false)

  const heluLoading = ref(false)
  const drawLoading = ref(false)
  const exchangeLoading = ref(false)
  const passportClaimLoading = ref(false)
  const solarClaimLoading = ref(false)
  const starRecordClaimLoading = ref(false)
  const qingmeiClaimLoading = ref(false)
  const qingmeiSellLoading = ref(false)

  const heluError = ref('')

  let heluRequestId = 0

  function clearActivityData() {
    heluActivity.value = null
    qixiActivity.value = null
    rainPoemActivity.value = null
    charityFlowerActivity.value = null
    petDiaryActivity.value = null
    qixiFriends.value = []
    heluLoading.value = false
    drawLoading.value = false
    exchangeLoading.value = false
    passportClaimLoading.value = false
    solarClaimLoading.value = false
    starRecordClaimLoading.value = false
    qingmeiClaimLoading.value = false
    qingmeiSellLoading.value = false
    petDiaryLoading.value = false
    heluError.value = ''
  }

  async function fetchQixiActivity(accountId: string) {
    qixiLoading.value = true
    try {
      const { data } = await api.get('/api/activity/qixi', { headers: { 'x-account-id': accountId } })
      if (data.ok && isCurrentAccount(String(accountId))) {
        qixiActivity.value = data.activity || null
        qixiFriends.value = data.friends || []
      }
      return data
    }
    finally { qixiLoading.value = false }
  }

  async function fetchRainPoemActivity(accountId: string) {
    rainPoemLoading.value = true
    try {
      const { data } = await api.get('/api/activity/rain-poem', { headers: { 'x-account-id': accountId } })
      if (data.ok && isCurrentAccount(String(accountId)))
        rainPoemActivity.value = data.activity || null
      return data
    }
    finally { rainPoemLoading.value = false }
  }

  async function fetchCharityFlowerActivity(accountId: string) {
    charityFlowerLoading.value = true
    try {
      const { data } = await api.get('/api/activity/charity-flower', { headers: { 'x-account-id': accountId } })
      if (data.ok && isCurrentAccount(String(accountId)))
        charityFlowerActivity.value = data.activity || null
      return data
    }
    finally { charityFlowerLoading.value = false }
  }

  async function fetchPetDiaryActivity(accountId: string) {
    petDiaryLoading.value = true
    try {
      const { data } = await api.get('/api/activity/pet-diary', { headers: { 'x-account-id': accountId } })
      if (data.ok && isCurrentAccount(String(accountId))) petDiaryActivity.value = data.activity || null
      return data
    }
    finally { petDiaryLoading.value = false }
  }

  async function operatePetDiary(accountId: string, action: string, input: Record<string, unknown> = {}) {
    petDiaryLoading.value = true
    try {
      const { data } = await api.post('/api/activity/pet-diary/operate', { action, input }, {
        headers: { 'x-account-id': accountId },
      })
      if (data.ok && data.activity && isCurrentAccount(String(accountId)))
        petDiaryActivity.value = data.activity
      else if (data.ok && isCurrentAccount(String(accountId)))
        await fetchPetDiaryActivity(accountId)
      return data
    }
    finally { petDiaryLoading.value = false }
  }

  async function fetchPetDiaryFriend(accountId: string, gid: number) {
    const { data } = await api.get('/api/activity/pet-diary/friend', {
      params: { gid },
      headers: { 'x-account-id': accountId },
    })
    return data
  }

  async function buildQixiBridge(accountId: string) {
    qixiBuildLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qixi/bridge/build', {}, { headers: { 'x-account-id': accountId } })
      if (data.ok && data.activity && isCurrentAccount(String(accountId)))
        qixiActivity.value = data.activity
      return data
    }
    finally { qixiBuildLoading.value = false }
  }
  async function useQixiDew(accountId: string) {
    qixiDewLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qixi/dew/use', {}, { headers: { 'x-account-id': accountId } })
      if (data.ok && data.activity && isCurrentAccount(String(accountId)))
        qixiActivity.value = data.activity
      return data
    }
    finally { qixiDewLoading.value = false }
  }

  async function sendQixiSachet(accountId: string, friendGid: number, count: number) {
    qixiGiftLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qixi/gift', { friendGid, count }, { headers: { 'x-account-id': accountId } })
      if (data.ok && data.activity && isCurrentAccount(String(accountId)))
        qixiActivity.value = data.activity
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
      const { data } = await api.get('/api/activity/star', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== heluRequestId || !isCurrentAccount(requestedId))
        return
      if (data.ok)
        heluActivity.value = data.activity || null
      else
        heluError.value = data.error || '获取心许千灯星垂野失败'
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

  async function claimStarRecords(accountId: string) {
    const requestedId = String(accountId)
    starRecordClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity/star/records/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      starRecordClaimLoading.value = false
    }
  }

  async function drawHelu(accountId: string, payload: { mode?: string, count?: number } = {}) {
    const requestedId = String(accountId)
    drawLoading.value = true
    try {
      const { data } = await api.post('/api/activity/helu/draw', payload, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      drawLoading.value = false
    }
  }

  async function exchangeHelu(accountId: string, slotId: number, count: number) {
    const requestedId = String(accountId)
    exchangeLoading.value = true
    try {
      const { data } = await api.post('/api/activity/helu/exchange', {
        slotId,
        count,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      exchangeLoading.value = false
    }
  }

  async function exchangeStarSand(accountId: string, slotId: number, count: number) {
    const requestedId = String(accountId)
    exchangeLoading.value = true
    try {
      const { data } = await api.post('/api/activity/star/exchange', {
        slotId,
        count,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
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
      const { data } = await api.post('/api/activity/star/passport/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      passportClaimLoading.value = false
    }
  }

  async function claimHeluSolar(accountId: string, termId?: number) {
    const requestedId = String(accountId)
    solarClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity/star/solar/claim', {
        termId,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      solarClaimLoading.value = false
    }
  }

  async function claimQingmeiSeeds(accountId: string) {
    const requestedId = String(accountId)
    qingmeiClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qingmei/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity) {
        heluActivity.value = data.activity
      }
      return data
    }
    finally {
      qingmeiClaimLoading.value = false
    }
  }

  async function brewAndSellQingmeiWine(accountId: string) {
    const requestedId = String(accountId)
    qingmeiSellLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qingmei/wine/sell', {
        share: true,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      qingmeiSellLoading.value = false
    }
  }

  return {
    heluActivity,
    qixiActivity,
    rainPoemActivity,
    rainPoemLoading,
    charityFlowerActivity,
    charityFlowerLoading,
    petDiaryActivity,
    petDiaryLoading,
    qixiFriends,
    qixiLoading,
    qixiBuildLoading,
    qixiGiftLoading,
    qixiDewLoading,
    heluLoading,
    drawLoading,
    exchangeLoading,
    passportClaimLoading,
    solarClaimLoading,
    starRecordClaimLoading,
    qingmeiClaimLoading,
    qingmeiSellLoading,
    heluError,
    clearActivityData,
    fetchHeluActivity,
    fetchQixiActivity,
    fetchRainPoemActivity,
    fetchCharityFlowerActivity,
    fetchPetDiaryActivity,
    operatePetDiary,
    fetchPetDiaryFriend,
    buildQixiBridge,
    useQixiDew,
    sendQixiSachet,
    claimStarRecords,
    drawHelu,
    exchangeHelu,
    exchangeStarSand,
    claimHeluPassport,
    claimHeluSolar,
    claimQingmeiSeeds,
    brewAndSellQingmeiWine,
  }
})
