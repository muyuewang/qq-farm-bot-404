import type {
  CharityFlowerActivityData,
  HeluDrawReward,
  HeluSeasonPassport,
  HeluSolarTerms,
  QixiActivityData,
  QixiItem,
  RainPoemActivityData,
  StarActivityData,
  StarRecordItem,
} from '@/stores/activity'

/** activity-center 的 itemDto：id/count 为 int64 十进制字符串。 */
export interface ActivityCenterItem {
  id?: string | number | null
  count?: string | number | null
  name?: string | null
  image?: string | null
  rarity?: number | null
}

export interface ActivityCenterSolarTerm {
  id?: string | number | null
  name?: string | null
  statusCode?: string | null
  canClaim?: boolean | null
  startTime?: string | number | null
  endTime?: string | number | null
  rewards?: ActivityCenterItem[] | null
}

export interface ActivityCenterSolarTerms {
  serverTime?: string | number | null
  currentTermId?: string | number | null
  terms?: ActivityCenterSolarTerm[] | null
}

function toNumber(value: unknown, fallback = 0) {
  const raw = Number(value)
  return Number.isFinite(raw) ? raw : fallback
}

export function toActivityReward(item?: ActivityCenterItem | null): HeluDrawReward {
  const dto = item || {}
  return {
    itemId: toNumber(dto.id),
    itemName: String(dto.name || ''),
    itemCount: toNumber(dto.count, 1),
    image: String(dto.image || ''),
  }
}

/**
 * statusCode 只有 '2'（可领取）被协议证实，其余取值不做语义猜测：
 * 未开始与已结束由服务端时间与节令窗口比较得出，其他情况统一显示「暂不可领取」。
 */
function solarStatusLabel(term: ActivityCenterSolarTerm, serverTime: number) {
  if (term.canClaim)
    return '可领取'
  const start = toNumber(term.startTime)
  const end = toNumber(term.endTime)
  if (serverTime && start > serverTime)
    return '未开始'
  if (serverTime && end && end < serverTime)
    return '已结束'
  return '暂不可领取'
}

export function mapSolarTerms(payload?: ActivityCenterSolarTerms | null): HeluSolarTerms | null {
  if (!payload || !Array.isArray(payload.terms))
    return null
  const serverTime = toNumber(payload.serverTime)
  const currentId = String(payload.currentTermId ?? '')
  const terms = payload.terms.filter(Boolean).map((term) => {
    const id = toNumber(term.id)
    return {
      id,
      title: String(term.name || `节令 ${id}`),
      status: toNumber(term.statusCode),
      statusLabel: solarStatusLabel(term, serverTime),
      claimable: term.canClaim === true,
      claimStatusKnown: true,
      startTime: toNumber(term.startTime),
      endTime: toNumber(term.endTime),
      rewards: (term.rewards || []).filter(Boolean).map(toActivityReward),
    }
  })
  const currentTerm = terms.find(term => String(term.id) === currentId)
    || terms.find(term => serverTime && term.startTime <= serverTime && (!term.endTime || term.endTime >= serverTime))
    || null
  const nextTerm = terms.find(term => serverTime && term.startTime > serverTime) || null
  return {
    nowTime: serverTime || undefined,
    terms,
    claimableCount: terms.filter(term => term.claimable).length,
    currentTerm,
    nextTerm: nextTerm && nextTerm !== currentTerm ? nextTerm : null,
  }
}

function toList<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function toItems(value: unknown): HeluDrawReward[] {
  return toList(value).map((item: ActivityCenterItem) => toActivityReward(item))
}

/** 雨落成诗固定下发的活动道具 ID（core/src/services/weather-activity.ts）。 */
const WEATHER_ITEM_IDS = {
  collector: 5001,
  summon: 5002,
  frog: 5005,
  cloud: 5006,
  badge: 1027,
}

/**
 * 七夕鹊桥寄情（GET /api/activity-center/qixi）。
 * 新协议把背包余额单独放在 balances 里，未读到背包时为 null；
 * 旧面板会把 0 当成库存谎报「没有道具」，因此余额未知时显式标记 countKnown=false。
 */
export function mapQixiActivity(payload?: Record<string, any> | null): QixiActivityData | null {
  if (!payload || typeof payload !== 'object')
    return null
  const balances = payload.balances || {}
  const known = balances.known === true
  const item = (dto: ActivityCenterItem, balance: unknown): QixiItem => ({
    ...toActivityReward(dto),
    countKnown: known && balance !== null && balance !== undefined,
  })
  const rawStages = toList(payload.bridge?.stages)
  const stages = rawStages.map((stage: any) => ({
    id: toNumber(stage.id),
    status: toNumber(stage.statusCode),
    claimed: stage.claimed === true,
    cost: toActivityReward(stage.cost),
    rewards: toItems(stage.rewards),
  }))
  const nextIndex = rawStages.findIndex((stage: any) => stage.current === true)
  const gift = payload.gift || {}
  const exchange = toList(gift.exchanges)[0] || {}
  const sentCount = toNumber(gift.sentCount)
  const sendLimit = toNumber(gift.sendLimit)
  return {
    uid: String(payload.activityId ?? ''),
    title: String(payload.title || payload.name || '鹊桥寄情'),
    activityId: toNumber(payload.activityId),
    startTime: toNumber(payload.startTime),
    endTime: toNumber(payload.endTime),
    active: payload.active === true,
    items: {
      feather: item(payload.feather, balances.feather),
      dew: item(payload.dew, balances.dew),
      sachet: item(payload.sachet, balances.sachet),
    },
    bridge: {
      stages,
      completedCount: rawStages.filter((stage: any) => stage.completed === true).length,
      nextStage: nextIndex >= 0 ? stages[nextIndex] || null : null,
    },
    gift: {
      sentCount,
      maxCount: sendLimit,
      remainingCount: Math.max(0, sendLimit - sentCount),
      cost: toActivityReward(toList(exchange.costItems)[0]),
      reward: toActivityReward(toList(exchange.receiveItems)[0]),
      enabled: payload.actions?.gift?.enabled === true,
    },
  }
}

/**
 * 雨落成诗（GET /api/activity-center/weather）。
 * 新协议只下发采集每日上限和采集奖励档位，没有「今日剩余采集次数」字段，
 * 因此 remainingUseCount 记为 null，由页面显示未下发，而不是拿上限伪造满额。
 */
export function mapRainPoemActivity(payload?: Record<string, any> | null): RainPoemActivityData | null {
  if (!payload || typeof payload !== 'object')
    return null
  const inventory = toList(payload.inventory)
  const balanceOf = (itemId: number) => {
    const entry = inventory.find((item: any) => toNumber(item.id) === itemId)
    return toNumber(entry?.count)
  }
  const weather = payload.ownWeather
  const shop = payload.shop
  const research = payload.research
  return {
    title: String(payload.activity?.name || '雨落成诗'),
    startTime: toNumber(payload.activity?.startTime),
    endTime: toNumber(payload.activity?.endTime),
    active: payload.active === true,
    items: {
      collectionBottles: balanceOf(WEATHER_ITEM_IDS.collector),
      summonBottles: balanceOf(WEATHER_ITEM_IDS.summon),
      frogPrankBottles: balanceOf(WEATHER_ITEM_IDS.frog),
      cloudPrankBottles: balanceOf(WEATHER_ITEM_IDS.cloud),
      badges: balanceOf(WEATHER_ITEM_IDS.badge),
    },
    shop: shop
      ? {
          purchasedToday: shop.owned === true,
          available: shop.available === true,
          dailyLimit: toNumber(shop.dailyLimit, 1),
          cost: toActivityReward(shop.cost),
          item: toActivityReward(shop.item),
        }
      : null,
    collection: {
      dailyUseLimit: toNumber(payload.actions?.collectWeather?.dailyLimit),
      remainingUseCount: null,
      rewards: toList(payload.collector?.rewards).map((tier: any) => toActivityReward(tier.reward)),
    },
    weather: weather
      ? {
          type: toNumber(weather.type),
          status: toNumber(weather.status),
          startTime: toNumber(weather.beginTime),
          endTime: toNumber(weather.endTime),
          rainstorm: weather.isThunderstorm === true,
        }
      : undefined,
    tasks: toList(payload.tasks).map((task: any) => ({
      id: toNumber(task.id),
      itemId: toNumber(task.triggerItemId),
      desc: String(task.title || ''),
      target: toNumber(task.dailyLimit),
      progress: toNumber(task.current),
      reward: toActivityReward(task.reward),
    })),
    research: {
      currentStage: toNumber(research?.currentStage),
      stages: toList(research?.nodes).map((node: any) => ({
        id: toNumber(node.id),
        status: toNumber(node.statusCode),
        available: node.availableByStatus === true,
        completed: node.completed === true,
        claimed: node.completed === true,
        cost: toActivityReward(node.cost),
        reward: toActivityReward(node.reward),
      })),
    },
  }
}

/**
 * 公益小红花（GET /api/activity-center/charity-red-flower）。
 * 新协议只按「爱心」计数，没有爱心→公益金的换算字段，页面因此不再显示金额；
 * 结算邮件时间也没有下发字段，改为展示活动结束时间。
 */
export function mapCharityFlowerActivity(payload?: Record<string, any> | null): CharityFlowerActivityData | null {
  if (!payload || typeof payload !== 'object')
    return null
  const progress = payload.globalProgress || {}
  const settlement = payload.settlement || {}
  const dailyGift = payload.dailyGift || {}
  return {
    uid: String(payload.activityId ?? ''),
    title: String(payload.title || payload.name || '公益小红花'),
    activityId: toNumber(payload.activityId),
    startTime: toNumber(payload.startTime),
    endTime: toNumber(payload.endTime),
    active: payload.active === true,
    love: {
      itemId: toNumber(payload.love?.id),
      count: toNumber(payload.loveBalance),
      personalScore: toNumber(payload.donatedLove),
      canDonate: payload.actions?.donateLove?.enabled === true,
    },
    global: {
      score: toNumber(progress.donated),
      target: toNumber(progress.target),
      reached: progress.reached === true,
    },
    share: {
      claimed: dailyGift.claimed === true,
      claimable: payload.actions?.claimDailyGift?.enabled === true,
      rewards: dailyGift.reward ? [toActivityReward(dailyGift.reward)] : [],
    },
    personalRewards: toList(payload.progressRewards).map((tier: any) => ({
      needScore: toNumber(tier.target),
      reached: tier.reached === true,
      claimed: tier.claimed === true,
      claimable: tier.claimable === true,
      rewards: tier.reward ? [toActivityReward(tier.reward)] : [],
    })),
    finalReward: {
      threshold: toNumber(settlement.requiredLove),
      eligible: settlement.eligible === true,
      rewards: settlement.reward ? [toActivityReward(settlement.reward)] : [],
    },
    publicFund: dailyGift.publicFund
      ? {
          date: toNumber(dailyGift.publicFund.date),
          statusCode: String(dailyGift.publicFund.statusCode ?? ''),
        }
      : null,
  }
}

/**
 * 星垂野 / 心许千灯（GET /api/activity-center/stellar 聚合视图）。
 * 观星礼录改由星宿图鉴驱动（28 组静态目录 + 服务端开关状态）：
 * visualState 只认协议证实过的 'lit' / 'lightable'，其余（unknown、claimableUnknown、locked）
 * 一律按「未开放」显示，不猜成可领。
 */
export function mapStarActivity(payload?: Record<string, any> | null): StarActivityData | null {
  const season = payload?.season
  if (!season || typeof season !== 'object')
    return null
  const constellationGroups = toList(payload?.constellation?.groups)
  const records: StarRecordItem[] = constellationGroups.map((group: any) => ({
    id: toNumber(group.nodeId ?? group.id),
    title: String(group.name || `星宿 ${group.id}`),
    category: String(group.category || ''),
    explain: String(group.explain || ''),
    unlocked: group.opened === true,
    claimed: group.lit === true,
    claimable: group.visualState === 'lightable',
    rewards: toItems(group.rewards),
  }))
  const shop = payload?.shop
  const currency = toList<Record<string, any>>(shop?.currencies)[0] || {}
  const pass = season.pass
  const passNodes = toList(pass?.nodes)
  const passport: HeluSeasonPassport | null = pass
    ? {
        uid: String(pass.activityId ?? ''),
        title: String(pass.title || season.title || ''),
        seasonTitle: String(season.title || ''),
        currentLevel: toNumber(pass.level),
        currentProgress: toNumber(pass.progress),
        nextLevelNeed: toNumber(pass.progressMax),
        maxLevel: toNumber(pass.nodeCount),
        freeClaimedLevel: toNumber(pass.claimedThroughLevel),
        claimableLevels: passNodes.filter((node: any) => node.claimable === true).length,
        rewardTierCount: passNodes.length,
        levelRewardTiers: passNodes.map((node: any) => ({
          level: toNumber(node.level),
          rewards: toItems(node.rewards),
        })),
      }
    : null
  return {
    uid: String(season.id ?? ''),
    title: String(season.title || ''),
    activityId: toNumber(season.id),
    startTime: toNumber(season.startTime),
    endTime: toNumber(season.endTime),
    starRecord: {
      status: toNumber(season.statusCode),
      openedDays: toNumber(payload?.constellation?.currentDay),
      records,
      totalCount: records.length,
      unlockedCount: records.filter(record => record.unlocked).length,
      claimedCount: records.filter(record => record.claimed).length,
      claimableCount: records.filter(record => record.claimable).length,
    },
    exchangeShop: toList<Record<string, any>>(shop?.goods).map((goods: any) => {
      // maxExchangeCountKnown=false 时不下发限购次数，按不限次处理，由服务端兜底拒绝超量兑换。
      const limit = goods.maxExchangeCountKnown === true ? toNumber(goods.maxExchangeCount) : 0
      return {
        id: toNumber(goods.id),
        sort: toNumber(goods.sortOrder),
        status: toNumber(goods.statusCode),
        owned: goods.owned === true,
        isRepeatable: limit !== 1,
        exchangeLimit: limit,
        ownedBlocksExchange: goods.owned === true,
        statusLabel: goods.exchangeable === true ? '可兑换' : goods.owned === true ? '已拥有' : '暂不可兑换',
        name: String(goods.name || ''),
        itemId: toNumber(goods.item?.id),
        itemCount: toNumber(goods.item?.count, 1),
        itemName: String(goods.item?.name || goods.name || ''),
        image: String(goods.item?.image || ''),
        itemType: 0,
        itemTypeLabel: String(goods.category || ''),
        isDecoration: false,
        currencyId: toNumber(goods.cost?.id),
        currencyName: String(goods.cost?.name || ''),
        price: toNumber(goods.cost?.count),
        desc: String(goods.name || ''),
        extra: '',
      }
    }),
    shopReadOnly: payload?.actions?.exchange?.enabled !== true,
    shopWarning: String(payload?.errors?.shop || ''),
    starSandCurrencyId: toNumber(currency.id),
    starSandBalance: toNumber(currency.balance),
    passport,
    solarTerms: mapSolarTerms(payload?.solarTerms),
    warning: String(payload?.errors?.solarTerms || ''),
  }
}
