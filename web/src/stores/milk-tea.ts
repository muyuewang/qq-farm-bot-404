/**
 * 奶茶冲鸭（S4）适配器：新版分页快照 → 404 基线前端使用的旧形状视图模型。
 *
 * 奶茶本体只有 GET /api/activities/milk-tea?page=<page> 与
 * POST /api/activities/milk-tea/:action（见 core/src/controllers/admin/commerce-routes.ts），
 * 每个页面快照只带自己那一段数据；这里把若干页面快照按“后写入者优先”合并成
 * 组件模板原本消费的单一 activity 视图，并按 protobuf 的缺省语义补齐：
 * toObject({ longs: String }) 会省略取默认值的字段，缺字段即 0 / false / 空数组。
 *
 * 快乐不独享不在奶茶分页里，是同一活动组下的独立实例，
 * 走 GET/POST /api/activities/share-reward/:activityId，这里一并映射成旧 share 段落形状。
 *
 * 本模块刻意不引入任何运行时依赖（Vue / Pinia / @/api），这样 web/tests 下的
 * `node --test tests/*.test.mjs` 可以直接导入它做纯映射测试。
 */

export const MILK_TEA_ENDPOINT = '/api/activities/milk-tea'

/** 每个主标签页需要的基础页面；切换标签与轮询都只取这些页面。 */
export const MILK_TEA_TAB_PAGES: Record<string, string[]> = {
  shop: ['shop', 'work'],
  exchange: ['exchange'],
  work: ['work'],
}

/** 弹窗懒加载的页面（沿用旧版 open(kind) 的时机）。 */
export const MILK_TEA_MODAL_PAGES: Record<string, string> = {
  upgrade: 'upgrade',
  sales: 'logs',
  rank: 'rank',
  hireList: 'hireList',
  fund: 'fund',
  craft: 'workshop',
}

/** 弹窗的 records 取合并视图里的哪一段。 */
export const MILK_TEA_MODAL_RECORDS: Record<string, string> = {
  sales: 'logs',
  rank: 'rank',
  hireList: 'hire',
}

/** 动作 → 后端写回后返回的页面（与 core/src/services/milk-tea.ts 的映射保持一致）。 */
export const MILK_TEA_ACTION_PAGES: Record<string, string> = {
  create: 'shop',
  rename: 'settings',
  boost: 'shop',
  claim: 'shop',
  upgrade: 'upgrade',
  craft: 'workshop',
  hire: 'hireList',
  exchange: 'exchange',
  unlock: 'fund',
  fundClaim: 'fund',
  wages: 'work',
  interact: 'work',
  hireSetting: 'settings',
}

/** 旧控件动作名 → 新版动作名；显式 null 表示新后端没有对应动作，控件必须禁用。 */
export const MILK_TEA_LEGACY_ACTIONS: Record<string, string | null> = {
  cashier: 'claim',
  buy: 'exchange',
  fundRewards: 'fundClaim',
  hireDisabled: 'hireSetting',
  sales: null,
  rank: null,
}

/**
 * 快乐不独享挂在奶茶活动组下的独立实例（2026110104），
 * 读写都走 /api/activities/share-reward，不在奶茶分页快照里。
 */
export const MILK_TEA_SHARE_ENDPOINT = '/api/activities/share-reward'
export const MILK_TEA_SHARE_ACTIVITY_ID = '2026110104'

/** 旧控件动作名 → 快乐不独享动作名。 */
export const MILK_TEA_SHARE_ACTIONS: Record<string, string> = {
  shareDaily: 'daily',
  shareRewards: 'milestones',
}

/** 兑换商店没有下发 maxPurchasable，限购上限只能取剩余限购；不限购时退化为后端 integer() 的上界。 */
export const MILK_TEA_MAX_EXCHANGE_COUNT = 9999

const LIMIT_PERIOD_LABELS: Record<string, string> = { daily: '每日', weekly: '每周', monthly: '每月', permanent: '永久' }

const CURRENCY_NAMES: Record<string, string> = { 1001: '金币', 1041: '奶茶券' }

const SNAPSHOT_KEYS = [
  'id', 'title', 'page', 'serverTime', 'startTime', 'endTime', 'settleStartTime',
  'exchangeStartTime', 'exchangeEndTime', 'active', 'settling', 'summary', 'rules',
  'recommendedNames', 'actionAvailability', 'levels', 'shop', 'recipes', 'fruits',
  'work', 'interactions', 'durations', 'hire', 'goods', 'fund', 'rank', 'logs',
]

export function toNumber(value: any, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** 余额只在该页面快照真的取过时才存在；缺失即未确认，不能当成 0。 */
export function mapMilkTeaBalances(balances: any): Array<{ itemId: string, count: number | null }> {
  if (!balances || typeof balances !== 'object')
    return []
  return Object.entries(balances).map(([itemId, count]) => ({
    itemId,
    count: Number.isFinite(Number(count)) ? Number(count) : null,
  }))
}

/**
 * 后端资源 URL 形如 /activity-assets/milk-tea/<file>.png，该前缀既没有被 core 静态挂载、
 * 也没有被 vite 代理；仓库里已有的等价素材在 /activity/milk-tea/ 下且命名不同。
 * 这里只做已知文件的落地映射，未知路径返回空串让模板回退到原有本地图。
 */
export function resolveMilkTeaAsset(url: any): string {
  const text = String(url || '')
  if (!text.startsWith('/activity-assets/'))
    return text
  const file = String(text.split('/').pop() || '').replace(/\.png$/i, '')
  const recipe = /^recipe-(\d+)$/.exec(file)
  if (recipe)
    return `/activity/milk-tea/icon_s4_milktea_${recipe[1]}.png`
  const interaction = /^interact-(\d+)$/.exec(file)
  if (interaction)
    return `/activity/milk-tea/icon_S4MyJob_interact_${interaction[1]}.png`
  return ''
}

export function deriveMilkTeaPhase(snapshot: any): 'upcoming' | 'business' | 'settling' | 'ended' {
  if (!snapshot || typeof snapshot !== 'object')
    return 'ended'
  const serverTime = toNumber(snapshot.serverTime, -1)
  if (!snapshot.active)
    return serverTime >= 0 && serverTime < toNumber(snapshot.startTime) ? 'upcoming' : 'ended'
  return snapshot.settling ? 'settling' : 'business'
}

export function mapMilkTeaShop(shop: any): any {
  if (!shop || typeof shop !== 'object')
    return null
  return {
    ...shop,
    level: toNumber(shop.level),
    total_revenue: shop.total_revenue ?? '0',
    next_level_revenue: shop.next_level_revenue ?? '0',
    effective_cups_per_hour: shop.effective_cups_per_hour ?? '0',
    sales_item_id: shop.sales_item_id ?? null,
    slots: (shop.slots || []).map((slot: any) => ({ ...slot, employee: slot.employee || null })),
    pending_rewards: shop.pending_rewards || [],
    boost_preview_rewards: shop.boost_preview_rewards || [],
    drink_cups: shop.drink_cups || {},
    pending_cups_by_recipe: shop.pending_cups_by_recipe || {},
    pending_cups_by_source: shop.pending_cups_by_source || {},
    boost_coin_price: shop.boost_coin_price || {},
  }
}

export function mapMilkTeaRecipes(recipes: any): any[] {
  return (recipes || []).map((recipe: any) => ({
    ...recipe,
    stock_cups: recipe.stock_cups ?? '0',
    config: { image: resolveMilkTeaAsset(recipe.image) },
  }))
}

/** recipes 的 fruits 依赖同一次 workshop 快照里的背包果实，合并完视图后再挂回去。 */
export function attachMilkTeaFruits(recipes: any, fruits: any): any[] {
  const list = fruits || []
  return (recipes || []).map((recipe: any) => ({
    ...recipe,
    fruits: recipe.unlocked ? list.filter((fruit: any) => String(fruit.id) === String(recipe.fruitId)) : [],
  }))
}

export function mapMilkTeaGoods(goods: any): any[] {
  return (goods || []).map((good: any) => {
    const remaining = good.remaining == null ? null : toNumber(good.remaining)
    const conditions = good.conditions || []
    const unlocked = conditions.every((condition: any) => condition.satisfied === true)
    const costs = good.costs || []
    return {
      ...good,
      id: String(good.id),
      desc: good.description || '',
      items: good.rewards || [],
      costs,
      cond_hints: conditions,
      conditions,
      unlocked,
      available: good.available !== false,
      remaining,
      purchase_limit: good.purchaseLimit == null ? null : toNumber(good.purchaseLimit),
      limit_label: LIMIT_PERIOD_LABELS[String(good.limitPeriod)] || '',
      category_tag: good.category,
      paid: costs.some((cost: any) => String(cost.id) === '1004'),
      maxPurchasable: !unlocked ? 0 : remaining === null ? MILK_TEA_MAX_EXCHANGE_COUNT : remaining,
    }
  })
}

export function mapMilkTeaWork(work: any): any {
  if (!work || typeof work !== 'object')
    return null
  return {
    ...work,
    my_shift: work.my_shift || null,
    slips: work.slips || [],
    interact_done: work.interact_done === true,
  }
}

export function mapMilkTeaLevels(levels: any): any[] {
  return (levels || []).map((level: any) => ({ ...level, recipe_names: level.recipes || [] }))
}

export function mapMilkTeaHire(hire: any): any {
  if (!hire || typeof hire !== 'object')
    return null
  return {
    ...hire,
    wage_total: hire.wage_total ?? '0',
    friends: hire.friends || [],
    robots: hire.robots || [],
  }
}

export function mapMilkTeaFund(fund: any): any {
  if (!fund || typeof fund !== 'object')
    return null
  const costs = fund.costs || []
  return {
    unlocked: fund.unlocked === true,
    costs,
    unlock_cost: costs,
    tiers: (fund.tiers || []).map((tier: any) => ({
      ...tier,
      tier_id: tier.id,
      rewards: tier.rewards || [],
      reward: tier.rewards || [],
      conditions: (tier.conditions || []).map((condition: any) => ({
        ...condition,
        target_value: condition.target,
        current_value: condition.current,
      })),
    })),
  }
}

export function mapMilkTeaRank(rank: any): any {
  if (!rank || typeof rank !== 'object')
    return null
  return { ...rank, ranks: rank.ranks || [], my_rank: rank.my_rank ?? null }
}

/**
 * 营业记录页。新后端只给 cups_by_recipe / items，配方名与图标取自同一会话里已读到的
 * recipes 段落；没读到就退化成 `配方 #<id>`，不编名字。
 */
export function mapMilkTeaLogs(logs: any, recipes: any): any {
  if (!logs || typeof logs !== 'object')
    return null
  const rows = (recipes || []).map((recipe: any) => ({
    recipe_id: String(recipe.recipe_id),
    name: String(recipe.recipe_name || ''),
    image: resolveMilkTeaAsset(recipe.image),
  }))
  const drinks = Object.entries(logs.cups_by_recipe || {}).map(([id, cups]) => {
    const row = rows.find((x: any) => x.recipe_id === String(id))
    return {
      recipe_id: String(id),
      cups,
      name: row?.name || `配方 #${id}`,
      image: row?.image || '',
    }
  })
  const rewards = [...(logs.items || [])]
  for (const [id, count] of [['1041', logs.token], ['1001', logs.coin]] as Array<[string, any]>) {
    if (toNumber(count) > 0 && !rewards.some((item: any) => String(item.id) === id))
      rewards.unshift({ id, count, name: CURRENCY_NAMES[id], image: '' })
  }
  return {
    ...logs,
    drinks,
    rewards,
    hires: logs.hires || [],
    cups_by_recipe: logs.cups_by_recipe || {},
    cups_by_source: logs.cups_by_source || {},
  }
}

/**
 * 快乐不独享 DTO → 旧 milk-tea `share` 段落。
 * 后端把“今日是否已领”折进 canClaimDaily（其中还包含活动有效期判断），
 * 因此再用 claimedCount 区分“领过了”和“活动已结束”，避免把未领取显示成已领取。
 */
export function mapMilkTeaShare(dto: any): any {
  if (!dto || typeof dto !== 'object')
    return null
  return {
    current_score: toNumber(dto.score),
    daily: {
      daily_reward_claimed: dto.canClaimDaily === false && toNumber(dto.claimedCount) > 0,
    },
    my_pool: {
      claimed_count: toNumber(dto.poolClaimedCount),
      claim_limit: toNumber(dto.poolClaimLimit),
    },
    milestones: (dto.milestones || []).map((tier: any) => ({
      tier_id: String(tier.id),
      threshold: toNumber(tier.threshold),
      state: toNumber(tier.state),
      rewards: tier.rewards || [],
    })),
  }
}

/**
 * 把已抓取的分页快照折叠成旧形状单一视图。entries 按写入先后排列，后写入的段落覆盖先写入的。
 */
export function buildMilkTeaView(entries: any): any {
  const list = Array.isArray(entries)
    ? entries.filter((entry: any) => entry?.snapshot && typeof entry.snapshot === 'object')
    : []
  const base: Record<string, any> = {
    id: '',
    title: '',
    page: '',
    serverTime: 0,
    startTime: 0,
    endTime: 0,
    settleStartTime: 0,
    exchangeStartTime: 0,
    exchangeEndTime: 0,
    active: false,
    settling: false,
    summary: null,
    rules: [],
    recommendedNames: [],
    actionAvailability: null,
    levels: [],
    shop: null,
    recipes: [],
    fruits: [],
    work: null,
    interactions: [],
    durations: [],
    hire: null,
    goods: [],
    fund: null,
    rank: null,
    logs: null,
  }
  const balanceMap: Record<string, any> = {}
  for (const entry of list) {
    const snapshot = entry.snapshot
    for (const key of SNAPSHOT_KEYS) {
      if (snapshot[key] !== undefined)
        base[key] = snapshot[key]
    }
    if (snapshot.balances && typeof snapshot.balances === 'object')
      Object.assign(balanceMap, snapshot.balances)
  }
  const summary = base.summary && typeof base.summary === 'object'
    ? { ...base.summary, shop_open_at: toNumber(base.summary.shop_open_at), level: toNumber(base.summary.level, toNumber(base.shop?.level, -1)) }
    : null
  const levels = mapMilkTeaLevels(base.levels)
  return {
    ...base,
    summary,
    phase: deriveMilkTeaPhase(base),
    // 旧模板用 settleTime 表示营业期结束，新模型里叫 settleStartTime。
    settleTime: toNumber(base.settleStartTime),
    balances: mapMilkTeaBalances(balanceMap),
    shop: mapMilkTeaShop(base.shop),
    recipes: attachMilkTeaFruits(mapMilkTeaRecipes(base.recipes), base.fruits),
    fruits: base.fruits || [],
    work: mapMilkTeaWork(base.work),
    interactions: (base.interactions || []).map((interaction: any) => ({ ...interaction, image: resolveMilkTeaAsset(interaction.image) })),
    durations: base.durations || [],
    hire: mapMilkTeaHire(base.hire),
    goods: mapMilkTeaGoods(base.goods),
    fund: mapMilkTeaFund(base.fund),
    rank: mapMilkTeaRank(base.rank),
    logs: mapMilkTeaLogs(base.logs, base.recipes),
    levels,
  }
}

/**
 * 旧控件动作名 + 旧参数 → 新动作名 + 新请求体。
 * 后端会用 expectedCosts 签名复核页面上展示过的价格，因此必须原样回传，不得省略。
 */
export function buildMilkTeaRequest(action: string, params: any = {}, view: any = {}): { action: string | null, body: any, error?: string } {
  const legacy = MILK_TEA_LEGACY_ACTIONS[action]
  const name = Object.prototype.hasOwnProperty.call(MILK_TEA_ACTION_PAGES, action) ? action : legacy
  if (name == null)
    return { action: null, body: {}, error: '当前后端未提供该操作' }
  if (name === 'create' || name === 'rename')
    return { action: name, body: { name: String(params.shopName ?? params.name ?? '') } }
  if (name === 'unlock')
    return { action: name, body: { expectedCosts: (view.fund?.costs || []).map((cost: any) => ({ id: cost.id, count: cost.count })) } }
  if (name === 'claim' || name === 'wages' || name === 'fundClaim')
    return { action: name, body: {} }
  if (name === 'upgrade') {
    const expectedLevel = toNumber(view.summary?.level, -1)
    if (expectedLevel < 0)
      return { action: null, body: {}, error: '店铺等级未确认，请刷新后重试' }
    return { action: name, body: { expectedLevel } }
  }
  if (name === 'exchange') {
    const good = (view.goods || []).find((x: any) => String(x.id) === String(params.goodsId))
    if (!good)
      return { action: null, body: {}, error: '商品信息已变化，请刷新后重新确认' }
    return {
      action: name,
      body: {
        goodsId: good.id,
        count: toNumber(params.count, 1),
        expectedCosts: (good.costs || []).map((cost: any) => ({ id: cost.id, count: cost.count })),
      },
    }
  }
  if (name === 'craft') {
    const requested = (params.fruitUids || []).map((uid: any) => String(uid))
    const fruits = (view.fruits || []).filter((fruit: any) => requested.includes(String(fruit.uid)))
    if (!requested.length || new Set(requested).size !== requested.length || fruits.length !== requested.length)
      return { action: null, body: {}, error: '果实数量或锁定状态已变化，请重新选择' }
    return { action: name, body: { fruits: fruits.map((fruit: any) => ({ uid: String(fruit.uid), count: fruit.count })) } }
  }
  if (name === 'hire') {
    if (!view.hire)
      return { action: null, body: {}, error: '员工列表未确认，请刷新后重试' }
    return {
      action: name,
      body: {
        targetGid: String(params.targetGid),
        durationId: toNumber(params.durationId ?? view.hire.duration_id, 1),
        expectedCosts: [{ id: 1041, count: view.hire.wage_total }],
      },
    }
  }
  if (name === 'interact') {
    const shift = view.work?.my_shift
    if (!shift)
      return { action: null, body: {}, error: '当前班次未确认，请刷新后重试' }
    return { action: name, body: { interactionType: toNumber(params.interactionType), expectedShiftId: String(shift.shift_id ?? '') } }
  }
  if (name === 'boost')
    return { action: name, body: { count: toNumber(params.count, 1), expectedCosts: [{ id: view.shop?.sales_item_id ?? 0, count: 1 }] } }
  if (name === 'hireSetting')
    return { action: name, body: { disabled: params.disabled === true } }
  return { action: null, body: {}, error: '当前后端未提供该操作' }
}
