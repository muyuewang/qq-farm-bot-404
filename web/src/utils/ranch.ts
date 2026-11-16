/**
 * 牧场（game_scene_id=2）适配器：把上游后端的原始快照折叠成前端视图模型，
 * 并实现 POST /api/ranch/:action/quote → POST /api/ranch/:action 的两阶段报价协议。
 *
 * 后端契约（core/src/services/ranch/state.ts:191-220、actions.ts、friends.ts、contract.ts）：
 * - GET /api/ranch?view=<视图> 每次都会返回完整基础快照，再按视图追加一个段落
 *   （bag / shop / market / canShop / tasks+dailyShare / book / activities+dailyShare /
 *   friends 或 friendRanch），animals 与 facilities 只用基础快照；
 * - int64 一律是十进制字符串（ranch_inst_id、instance_id、物品数量、桶秒数），
 *   int32（animal_inst_id、slot、stage、level）是数字，展示大数时不走 Number()；
 * - serverTime 与 nextAtMs、activities 起止时间是毫秒，buckets.seconds、
 *   feed.remainingSec、next.durationSec 是秒；upgradeEndTime 由后端按 <1e11 判秒；
 * - quote 返回 expected.signature，execute 必须原样回传，否则后端以 RANCH_OFFER_CHANGED 拒绝，
 *   因此 execute 的入参必须与 quote 完全一致（本模块用同一份 body 复用，不重新拼）；
 * - 失败文案由后端给出中文 message（error(code, message)），前端不再编一套码表。
 *
 * 本模块刻意不引入任何运行时依赖（Vue / Pinia / @/api），这样 web/tests 下的
 * node --test 可以直接导入它做纯映射与协议测试。
 */

export const RANCH_ENDPOINT = '/api/ranch'
export const RANCH_OPTIONS_ENDPOINT = '/api/ranch/automation-options'

export const RANCH_VIEWS = [
  'animals',
  'facilities',
  'bag',
  'shop',
  'market',
  'cans',
  'tasks',
  'illustrated',
  'friends',
  'activities',
] as const

export type RanchView = (typeof RANCH_VIEWS)[number]

export const RANCH_VIEW_LABELS: Record<RanchView, string> = {
  animals: '栏舍',
  facilities: '设施',
  bag: '背包',
  shop: '牧场商店',
  market: '交易市场',
  cans: '罐头商城',
  tasks: '牧场任务',
  illustrated: '牧场图鉴',
  friends: '好友牧场',
  activities: '牧场活动',
}

/** 后端 contract.ts 的 ACTIONS，前端只承认这份清单，避免拼出后端不认的动作。 */
export const RANCH_ACTIONS = [
  'buy',
  'place',
  'addGrass',
  'useCan',
  'feed',
  'produce',
  'harvest',
  'sell',
  'clean',
  'upgrade',
  'completeUpgrade',
  'claimTasks',
  'reportEntry',
  'exchange',
  'claimIllustrated',
  'claimDailyShare',
  'buyCan',
  'steal',
  'stroke',
  'release',
  'putMosquito',
  'cleanFriend',
] as const

export type RanchAction = (typeof RANCH_ACTIONS)[number] | 'acknowledge'

/**
 * 动作入参白名单与必填项。required 是「任一分支满足即可」的分组：
 * 组内是「与」，组间是「或」，对应后端 `input.all === true ? 全部 : 指定目标` 的分支。
 */
export const RANCH_ACTION_FIELDS: Record<RanchAction, string[]> = {
  buy: ['goodsId', 'count', 'shopId', 'autoPlace'],
  buyCan: ['goodsId', 'count', 'slotType'],
  place: ['ranchId', 'itemId', 'count'],
  addGrass: ['facilityId', 'count'],
  useCan: ['uid', 'count'],
  feed: ['bucketType', 'all', 'ranchId', 'animalId'],
  produce: ['all', 'ranchId', 'animalId'],
  harvest: ['all', 'ranchId', 'animalId'],
  sell: ['all', 'uid', 'count'],
  clean: [],
  upgrade: ['facilityId'],
  completeUpgrade: ['facilityId'],
  claimTasks: ['all', 'taskId', 'double'],
  reportEntry: ['entry'],
  exchange: ['goodsId', 'count'],
  claimIllustrated: ['kind'],
  claimDailyShare: [],
  steal: ['hostGid'],
  stroke: ['hostGid', 'ranchId', 'animalId'],
  release: ['ranchId', 'animalId'],
  putMosquito: ['hostGid', 'ranchId'],
  cleanFriend: ['hostGid'],
  acknowledge: ['id'],
}

export const RANCH_ACTION_REQUIRED: Record<RanchAction, string[][]> = {
  // buy 必须带 shopId：planAction 用 Number(input.shopId) 校验 5/6，缺省会变成 NaN 直接报参数无效。
  buy: [['goodsId', 'count', 'shopId']],
  buyCan: [['goodsId', 'count']],
  place: [['ranchId', 'itemId', 'count']],
  addGrass: [['facilityId', 'count']],
  useCan: [['uid', 'count']],
  feed: [['all'], ['bucketType', 'ranchId', 'animalId']],
  produce: [['all'], ['ranchId', 'animalId']],
  harvest: [['all'], ['ranchId', 'animalId']],
  sell: [['all'], ['uid', 'count']],
  clean: [],
  upgrade: [['facilityId']],
  completeUpgrade: [['facilityId']],
  claimTasks: [['all'], ['taskId']],
  reportEntry: [['entry']],
  exchange: [['goodsId', 'count']],
  claimIllustrated: [['kind']],
  claimDailyShare: [],
  steal: [['hostGid']],
  stroke: [['hostGid', 'ranchId', 'animalId']],
  release: [['ranchId', 'animalId']],
  putMosquito: [['hostGid', 'ranchId']],
  cleanFriend: [['hostGid']],
  acknowledge: [['id']],
}

/** 后端放生不接受 all，必须逐只确认。 */
export const RANCH_NO_ALL_ACTIONS: RanchAction[] = ['release']

export const RANCH_FIELD_LABELS: Record<string, string> = {
  goodsId: '商品',
  shopId: '商店',
  slotType: '罐头商城',
  count: '数量',
  ranchId: '栏舍',
  facilityId: '设施',
  itemId: '幼崽',
  animalId: '动物',
  uid: '物品批次',
  bucketType: '罐头类型',
  taskId: '任务',
  double: '双倍领取',
  entry: '引导入口',
  kind: '图鉴类型',
  hostGid: '好友',
  id: '记录',
  all: '全部目标',
  autoPlace: '购买后自动放养',
}

/** 罐头桶：7003=普通（无机）、7004=有机；后端 itemDto 用同一套名称。 */
export const RANCH_BUCKET_IDS = { normal: 7003, organic: 7004 } as const
export const RANCH_BUCKET_TYPES = { organic: 1, normal: 2 } as const

export interface RanchItem {
  itemId: number
  id: string
  name: string
  image: string
  count: string
}

export interface QuoteResult {
  action?: string
  label?: string
  costs?: any[]
  costItems?: RanchItem[]
  rewards?: RanchItem[]
  count?: number
  expected?: { signature?: string }
  skipped?: boolean
  message?: string
}

function text(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function list<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function number(value: unknown, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

/** 后端把「未确认」显式下发为 null，这类字段保留 null，不折算成 0。 */
function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '')
    return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

/** 十进制字符串转 BigInt，非法值按 0n，避免页面因为一个脏字段整体崩掉。 */
function bigint(value: unknown) {
  const raw = text(value).trim()
  if (!/^-?\d+$/.test(raw))
    return 0n
  try {
    return BigInt(raw)
  }
  catch {
    return 0n
  }
}

/** int64 十进制字符串按位分组，不经 Number()，超过 2^53 的数量也不会失真。 */
export function formatQuantity(value: unknown) {
  const raw = text(value).trim()
  if (!/^-?\d+$/.test(raw))
    return raw || '—'
  const negative = raw.startsWith('-')
  const digits = negative ? raw.slice(1) : raw
  const grouped = digits.replace(/\B(?=(\d{3})+$)/g, ',')
  return negative ? `-${grouped}` : grouped
}

/** 秒数（罐头时长、阶段倒计时共用）；未知即空，不拿 0 冒充「已就绪」。 */
export function formatSeconds(value: unknown) {
  const seconds = nullableNumber(value)
  if (seconds === null || seconds < 0)
    return '—'
  if (seconds < 60)
    return `${Math.floor(seconds)} 秒`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  if (hours >= 24)
    return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}

/** 毫秒时间戳转可读时间；0 或缺失一律显示占位符，不猜时区以外的格式。 */
export function formatDateTime(valueMs: unknown) {
  const ms = number(valueMs, 0) || 0
  if (!ms)
    return '—'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

/**
 * 设施升级结束时间在后端也是按 <1e11 判秒的临时约定（actions.ts:174），
 * 这里沿用同一判据，避免前端把秒当毫秒显示成 1970。
 */
export function toMillis(value: unknown) {
  const raw = number(value, 0) || 0
  if (raw <= 0)
    return 0
  return raw < 1e11 ? raw * 1000 : raw
}

/** 目标毫秒时间与服务端毫秒时钟相减；目标缺失返回 null，表示「没有倒计时」。 */
export function countdownSeconds(nextAtMs: unknown, serverTimeMs: unknown) {
  const target = nullableNumber(nextAtMs)
  const now = nullableNumber(serverTimeMs)
  if (target === null || target <= 0 || now === null)
    return null
  return Math.max(0, Math.ceil((target - now) / 1000))
}

export function isRanchUnlocked(state?: Record<string, any> | null) {
  return state?.unlocked === true
}

function toItem(raw: any): RanchItem {
  const dto = raw || {}
  const id = text(dto.id)
  return {
    itemId: number(id, 0) || 0,
    id,
    name: text(dto.name) || (id ? `物品${id}` : '未知物品'),
    image: text(dto.image),
    count: text(dto.count) || '0',
  }
}

function toItems(value: unknown): RanchItem[] {
  return list(value).map(toItem)
}

/** 奖励/消耗的一行文案：`名称 ×数量`，数量保持字符串原样。 */
export function itemLine(item: RanchItem) {
  return `${item.name} ×${formatQuantity(item.count)}`
}

export function itemListLine(value: unknown) {
  const items = toItems(value)
  return items.length ? items.map(itemLine).join('、') : '—'
}

export interface RanchResource {
  key: string
  label: string
  image: string
  value: string
  unit: string
  /** 桶类资源用秒数计量，剩余秒数为 0 时相关动作不可用。 */
  seconds: string | null
  locked: string | null
  itemId: number
}

/** 顶部资源条：货币、罐头桶（秒）、牧草。 */
export function mapResources(state?: Record<string, any> | null): RanchResource[] {
  if (!state)
    return []
  const currencies = list(state.currencies).map((item: any) => ({
    key: `currency:${item.id}`,
    label: text(item.name) || `物品${item.id}`,
    image: text(item.image),
    value: formatQuantity(item.count),
    unit: '',
    seconds: null,
    locked: text(item.locked) || null,
    itemId: number(item.id, 0) || 0,
  }))
  const buckets = list(state.buckets).map((bucket: any) => ({
    key: `bucket:${bucket.id}`,
    label: Number(bucket.id) === RANCH_BUCKET_IDS.organic ? '有机罐头桶' : '普通罐头桶',
    image: '',
    value: formatSeconds(bucket.seconds),
    unit: '',
    seconds: text(bucket.seconds) || '0',
    locked: null,
    itemId: number(bucket.id, 0) || 0,
  }))
  const bar = [...currencies, ...buckets]
  if (state.grass !== undefined && state.grass !== null)
    bar.push({ key: 'grass', label: '牧草', image: '', value: formatQuantity(state.grass), unit: '', seconds: null, locked: null, itemId: 7001 })
  return bar
}

export function bucketSeconds(resources: RanchResource[], bucketId: number) {
  return bigint(resources.find(resource => resource.itemId === bucketId)?.seconds ?? null)
}

export interface RanchPendingOperation {
  id: string
  target: string
  label: string
  message: string
  createdAt: number
  costs: Array<{ resourceKey: string, amount: string }>
}

/** 待核对操作：同 target 未确认前后端会拒绝再次花同一笔资源（PENDING_CONFIRMATION），页面必须先让用户核对。 */
export function mapPendingOperations(state?: Record<string, any> | null): RanchPendingOperation[] {
  return list(state?.pendingOperations).map((item: any) => ({
    id: text(item.id),
    target: text(item.target),
    label: text(item.label) || '牧场操作',
    message: text(item.message),
    createdAt: number(item.createdAt, 0) || 0,
    costs: list(item.costs).map((cost: any) => ({ resourceKey: text(cost.resourceKey), amount: text(cost.amount) })),
  }))
}

export interface RanchAnimalAction {
  action: RanchAction
  label: string
  danger: boolean
  enabled: boolean
  reason: string
  input: Record<string, any>
}

export interface RanchAnimal {
  id: number
  ranchId: string
  animalId: number
  name: string
  image: string
  stage: number
  stageName: string
  nextAtMs: number | null
  countdown: number | null
  grassBlocked: boolean
  produceCount: string
  maxProduceCount: number | null
  limitedCanUsed: boolean
  mutation: Record<string, any> | null
  stroked: boolean
  canStroke: boolean
  bucketType: number
  /** 好友栏舍的动物只能抚摸，自家动作位不适用于它，因此不生成 actions。 */
  isFriend: boolean
  actions: RanchAnimalAction[]
}

/** 桶类型：有限制的动物只能用有机桶（后端 feed 的 eligible 判据 bucketType===1 || !limited_can_used）。 */
export function bucketTypeFor(animal: Record<string, any>) {
  return animal.limitedCanUsed === true ? RANCH_BUCKET_TYPES.organic : RANCH_BUCKET_TYPES.normal
}

/** 单个动物的可用动作，禁用条件只用后端显式下发的布尔位，不从名称或阶段猜测。 */
export function animalActions(animal: Record<string, any>, resources: RanchResource[]): RanchAnimalAction[] {
  const target = { ranchId: text(animal.ranchId), animalId: number(animal.id, 0) || 0 }
  const bucketType = bucketTypeFor(animal)
  const bucketId = bucketType === RANCH_BUCKET_TYPES.organic ? RANCH_BUCKET_IDS.organic : RANCH_BUCKET_IDS.normal
  const bucketEmpty = bucketSeconds(resources, bucketId) <= 0n
  return [
    {
      action: 'produce',
      label: '催产',
      danger: false,
      enabled: animal.canProduce === true,
      reason: animal.grassBlocked === true ? '缺少牧草，动物已停止产出' : animal.canProduce === true ? '' : '当前阶段还不能生产',
      input: target,
    },
    {
      action: 'harvest',
      label: '收获',
      danger: false,
      enabled: animal.canHarvest === true,
      reason: animal.canHarvest === true ? '' : '没有可收获的产物',
      input: target,
    },
    {
      action: 'feed',
      label: bucketType === RANCH_BUCKET_TYPES.organic ? '有机罐头加速' : '普通罐头加速',
      danger: false,
      enabled: animal.canFeed === true && !bucketEmpty,
      reason: animal.canFeed === true ? (bucketEmpty ? `${bucketId === RANCH_BUCKET_IDS.organic ? '有机' : '普通'}罐头桶为空，请先添加罐头` : '') : '当前阶段不需要加速',
      input: { ...target, bucketType },
    },
    {
      action: 'release',
      label: '放生',
      danger: true,
      enabled: animal.canRelease === true,
      reason: animal.canRelease === true ? '' : '该动物当前不可放生',
      input: target,
    },
  ]
}

/** 按后端布尔位统计某动作当前可执行的动物数，页面用它决定一键按钮是否出现。 */
function countEnabled(animals: RanchAnimal[], action: RanchAction) {
  return animals.filter(animal => animal.actions.some(entry => entry.action === action && entry.enabled)).length
}

function mapAnimal(raw: any, serverTimeMs: unknown, resources: RanchResource[], isFriend = false): RanchAnimal {
  const animal = raw || {}
  const nextAtMs = nullableNumber(animal.nextAtMs)
  return {
    id: number(animal.id, 0) || 0,
    ranchId: text(animal.ranchId),
    animalId: number(animal.animalId, 0) || 0,
    name: text(animal.name) || `动物${animal.animalId}`,
    image: text(animal.image),
    stage: number(animal.stage, 0) || 0,
    stageName: text(animal.stageName) || '未知',
    nextAtMs: nextAtMs && nextAtMs > 0 ? nextAtMs : null,
    countdown: countdownSeconds(animal.nextAtMs, serverTimeMs),
    grassBlocked: animal.grassBlocked === true,
    produceCount: text(animal.produceCount) || '0',
    maxProduceCount: nullableNumber(animal.maxProduceCount),
    limitedCanUsed: animal.limitedCanUsed === true,
    mutation: animal.mutation && typeof animal.mutation === 'object' ? animal.mutation : null,
    stroked: animal.stroked === true,
    canStroke: animal.canStroke === true,
    bucketType: bucketTypeFor(animal),
    isFriend,
    actions: isFriend ? [] : animalActions(animal, resources),
  }
}

/** 产物货架：remaining 是 int64 字符串，只有后端明确 canCollect 才给收获入口。 */
function mapShelf(raw: any) {
  const shelf = raw || {}
  return {
    slot: number(shelf.slot, 0) || 0,
    remaining: text(shelf.remaining) || '0',
    canCollect: shelf.canCollect === true,
    canSteal: shelf.canSteal === true,
    products: toItems(shelf.products),
  }
}

function mapHazard(raw: any) {
  const hazard = raw || {}
  return { id: text(hazard.id), type: number(hazard.type, 0) || 0, label: Number(hazard.type) === 1 ? '蚊子' : `危险物${hazard.type}` }
}

export interface RanchFacility {
  id: string
  facilityId: number
  name: string
  moduleType: number
  level: number
  capacity: number
  active: boolean
  state: number
  upgradeState: number
  upgradeEndAtMs: number
  upgradeCountdown: number | null
  isRanch: boolean
  isGrassMachine: boolean
  next: { level: number, capacity: number, durationSec: number, requiredLevel: number | null, costs: RanchItem[], available: boolean } | null
  feed: { count: string, consumeRate: number, remainingSec: string, status: number } | null
  ranch: { count: number, capacity: number, animals: RanchAnimal[], shelves: ReturnType<typeof mapShelf>[], hazards: ReturnType<typeof mapHazard>[] } | null
  summary: { animalText: string, shelfText: string, hazardCount: number, harvestReady: number, needProduce: number }
}

function mapFacility(raw: any, serverTimeMs: unknown, resources: RanchResource[]): RanchFacility {
  const facility = raw || {}
  const ranch = facility.ranch && typeof facility.ranch === 'object' ? facility.ranch : null
  const feed = facility.feed && typeof facility.feed === 'object' ? facility.feed : null
  const animals = list(ranch?.animals).map((animal: any) => mapAnimal(animal, serverTimeMs, resources))
  const shelves = list(ranch?.shelves).map(mapShelf)
  const hazards = list(ranch?.hazards).map(mapHazard)
  const upgradeEndAtMs = facility.upgradeState ? toMillis(facility.upgradeEndTime) : 0
  const filledShelves = shelves.filter(shelf => bigint(shelf.remaining) > 0n).length
  const capacity = number(ranch?.capacity ?? facility.capacity, 0) || 0
  const count = number(ranch?.count, 0) || 0
  return {
    id: text(facility.id),
    facilityId: number(facility.facilityId, 0) || 0,
    name: text(facility.name) || `设施${facility.facilityId}`,
    moduleType: number(facility.moduleType, 0) || 0,
    level: number(facility.level, 0) || 0,
    capacity,
    active: facility.active === true,
    state: number(facility.state, 0) || 0,
    upgradeState: number(facility.upgradeState, 0) || 0,
    upgradeEndAtMs,
    upgradeCountdown: facility.upgradeState ? countdownSeconds(upgradeEndAtMs, serverTimeMs) : null,
    isRanch: !!ranch,
    isGrassMachine: !!feed,
    next: facility.next && typeof facility.next === 'object'
      ? {
          level: number(facility.next.level, 0) || 0,
          capacity: number(facility.next.capacity, 0) || 0,
          durationSec: number(facility.next.durationSec, 0) || 0,
          requiredLevel: nullableNumber(facility.next.requiredLevel),
          costs: toItems(facility.next.costs),
          available: facility.next.available === true,
        }
      : null,
    feed: feed
      ? {
          count: text(feed.count) || '0',
          consumeRate: number(feed.consumeRate, 0) || 0,
          remainingSec: text(feed.remainingSec) || '0',
          status: number(feed.status, 0) || 0,
        }
      : null,
    ranch: ranch
      ? { count, capacity, animals, shelves, hazards }
      : null,
    summary: {
      animalText: ranch ? `${count} / ${capacity}` : '—',
      shelfText: filledShelves ? `${filledShelves} 个货架有产物` : '货架已清空',
      hazardCount: hazards.length,
      harvestReady: countEnabled(animals, 'harvest'),
      needProduce: countEnabled(animals, 'produce'),
    },
  }
}

/** 后端 addGrass 判据：count <= capacity - feed.count。 */
export function grassRoom(facility: RanchFacility) {
  const capacity = bigint(facility.capacity)
  const current = bigint(facility.feed?.count ?? '0')
  return capacity - current > 0n ? capacity - current : 0n
}

function mapBagItem(raw: any) {
  const item = raw || {}
  return {
    ...toItem(item),
    uid: text(item.uid),
    locked: item.locked === true,
    tabId: number(item.tabId, 0) || 0,
    type: number(item.type, 0) || 0,
    sellPrices: toItems(item.sellPrices),
    canSell: item.canSell === true,
    can: item.can && typeof item.can === 'object' ? item.can : null,
    animalId: nullableNumber(item.animalId),
    giantCub: item.giantCub === true,
    product: item.product && typeof item.product === 'object'
      ? {
          weightKg: number(item.product.weightX10, 0) / 100,
          tier: number(item.product.tier, 0) || 0,
          priceRate: text(item.product.priceRate) || '0',
        }
      : null,
  }
}

function mapShopGood(raw: any, shopId: number) {
  const good = raw || {}
  const price = good.price || {}
  return {
    id: text(good.id),
    shopId,
    reward: toItem(good.reward),
    price: toItem({ ...price, count: price.count }),
    balance: price.balance === null || price.balance === undefined ? null : text(price.balance),
    available: good.available === true,
    maxCount: number(good.maxCount, 1) || 1,
    remaining: nullableNumber(good.remaining),
    requiredLevel: nullableNumber(good.requiredLevel),
    animal: good.animal && typeof good.animal === 'object' ? good.animal : null,
  }
}

function mapCanGood(raw: any, slotType: number) {
  const good = raw || {}
  return {
    id: text(good.id),
    slotType,
    name: text(good.name) || `罐头商品${good.id}`,
    rewards: toItems(good.rewards),
    free: good.free === true,
    price: toItem(good.price),
    balance: good.price?.balance === null || good.price?.balance === undefined ? null : text(good.price.balance),
    remaining: nullableNumber(good.remaining),
    maxCount: number(good.maxCount, 1) || 1,
    available: good.available === true,
  }
}

function mapMarketGood(raw: any) {
  const good = raw || {}
  return {
    id: text(good.id),
    shelfId: number(good.shelfId, 0) || 0,
    slot: number(good.slot, 0) || 0,
    reward: toItem(good.reward),
    price: toItem(good.price),
    balance: good.price?.balance === null || good.price?.balance === undefined ? null : text(good.price.balance),
    remaining: nullableNumber(good.remaining),
    requiredLevel: nullableNumber(good.requiredLevel),
    available: good.available === true,
  }
}

/** 任务进度：后端用 int64 字符串给 progress/total，total<=0 时不给百分比，避免伪造分母。 */
export function taskRatio(task: Record<string, any>) {
  const progress = bigint(task.progress)
  const total = bigint(task.total)
  const percent = total > 0n ? Math.min(100, Number(progress * 100n / total)) : 0
  return {
    percent,
    known: total > 0n,
    progress: formatQuantity(task.progress),
    total: formatQuantity(task.total),
  }
}

function mapTask(raw: any) {
  const task = raw || {}
  return {
    id: text(task.id),
    category: text(task.category) === 'daily' ? 'daily' : 'growth',
    desc: text(task.desc) || `任务${task.id}`,
    ...taskRatio(task),
    claimed: task.claimed === true,
    unlocked: task.unlocked === true,
    canClaim: task.canClaim === true,
    shareMultiple: number(task.shareMultiple, 1) || 1,
    conditionType: number(task.conditionType, 0) || 0,
    rewards: toItems(task.rewards),
    entry: text(task.entry) || null,
  }
}

function mapDailyShare(raw: any) {
  if (!raw || typeof raw !== 'object')
    return null
  return {
    shareCount: text(raw.shareCount) || '0',
    claimed: raw.claimed === true,
    shared: raw.shared === true,
    canClaim: raw.canClaim === true,
    dateKey: text(raw.dateKey),
    rewards: toItems(raw.rewards),
  }
}

function mapBook(raw: any) {
  if (!raw || typeof raw !== 'object')
    return null
  const normal = raw.normal || {}
  const giant = raw.giant || {}
  return {
    normal: {
      level: number(normal.level, 0) || 0,
      progress: text(normal.progress) || '0',
      nextProgress: text(normal.nextProgress) || '0',
      canClaim: normal.canClaim === true,
      rewards: toItems(normal.rewards),
    },
    giant: {
      score: text(giant.score) || '0',
      // calc_mode 的取值语义未确认，页面只原样展示，不翻译成文字。
      calculationMode: giant.calculationMode === undefined || giant.calculationMode === null ? null : String(giant.calculationMode),
      levels: list(giant.levels).map((level: any) => ({
        id: text(level.id),
        score: text(level.score) || '0',
        claimed: level.claimed === true,
        canClaim: level.canClaim === true,
        rewards: toItems(level.rewards),
      })),
    },
    animals: list(raw.animals).map((entry: any) => ({
      ...toItem(entry),
      rarity: number(entry.rarity, 0) || 0,
      layer: number(entry.layer, 0) || 0,
      unlocked: entry.unlocked === true,
      progress: text(entry.progress) || '0',
      giant: entry.giant && typeof entry.giant === 'object'
        ? {
            unlocked: entry.giant.unlocked === true,
            tier: number(entry.giant.tier, 0) || 0,
            tierName: text(entry.giant.tierName),
            weightKg: number(entry.giant.weightKg, 0) || 0,
            minWeightKg: number(entry.giant.minWeightKg, 0) || 0,
            maxWeightKg: number(entry.giant.maxWeightKg, 0) || 0,
            harvestCount: text(entry.giant.harvestCount) || '0',
            isNew: entry.giant.isNew === true,
          }
        : null,
    })),
    mutations: list(raw.mutations).map((row: any) => ({
      type: number(row.type, 0) || 0,
      name: text(row.name) || `变异${row.type}`,
      description: text(row.description),
      baseProbabilityPercent: number(row.baseProbabilityPercent, 0) || 0,
    })),
  }
}

function mapFriendRanch(raw: any, serverTimeMs: unknown) {
  if (!raw || typeof raw !== 'object')
    return null
  return {
    gid: text(raw.gid),
    name: text(raw.name) || `好友${raw.gid}`,
    level: number(raw.level, 0) || 0,
    canSteal: raw.canSteal === true,
    stealableShelves: number(raw.stealableShelves, 0) || 0,
    cleanableHazards: number(raw.cleanableHazards, 0) || 0,
    strokeRemaining: nullableNumber(raw.strokeRemaining),
    mosquitoRemaining: nullableNumber(raw.mosquitoRemaining),
    ranches: list(raw.ranches).map((ranch: any) => ({
      id: text(ranch.id),
      name: text(ranch.name) || '栏舍',
      mosquitoes: number(ranch.mosquitoes, 0) || 0,
      mosquitoLimit: number(ranch.mosquitoLimit, 0) || 0,
      mosquitoRoom: number(ranch.mosquitoRoom, 0) || 0,
      animals: list(ranch.animals).map((animal: any) => mapAnimal(animal, serverTimeMs, [], true)),
      shelves: list(ranch.shelves).map(mapShelf),
    })),
  }
}

export type RanchDailyShare = NonNullable<ReturnType<typeof mapDailyShare>>

export type RanchFriendRanch = NonNullable<ReturnType<typeof mapFriendRanch>>

export interface RanchState {
  unlocked: boolean
  reason: string
  serverTime: number
  level: number
  exp: string
  currentExp: string
  neededExp: string | null
  progressPercent: number
  resources: RanchResource[]
  facilities: RanchFacility[]
  pending: RanchPendingOperation[]
  bag: ReturnType<typeof mapBagItem>[] | null
  shop: { shopId: number, goods: ReturnType<typeof mapShopGood>[] } | null
  market: { opened: boolean, present: boolean, periodDay: string, roundIndex: string, shelves: any[], goods: ReturnType<typeof mapMarketGood>[] } | null
  canShop: { slotType: number, goods: ReturnType<typeof mapCanGood>[] } | null
  tasks: ReturnType<typeof mapTask>[] | null
  book: ReturnType<typeof mapBook>
  activities: { id: string, name: string, startTime: number, endTime: number, status: ReturnType<typeof activityStatus> }[] | null
  friends: { gid: string, name: string, avatarUrl: string }[] | null
  friendRanch: ReturnType<typeof mapFriendRanch>
  dailyShare: ReturnType<typeof mapDailyShare>
}

/** 活动分区：只按服务端毫秒时钟和起止时间分三态，起止时间都没下发时不猜状态。 */
export function activityStatus(activity: Record<string, any>, serverTimeMs: unknown) {
  const start = nullableNumber(activity.startTime)
  const end = nullableNumber(activity.endTime)
  const now = nullableNumber(serverTimeMs)
  if (now === null || now <= 0)
    return { label: '时间未知', state: 'unknown' as const }
  if (!(start && start > 0) && !(end && end > 0))
    return { label: '时间未下发', state: 'unknown' as const }
  if (start !== null && start > 0 && now < start)
    return { label: '未开始', state: 'upcoming' as const }
  if (end !== null && end > 0 && now > end)
    return { label: '已结束', state: 'ended' as const }
  return { label: '进行中', state: 'active' as const }
}

/**
 * 折叠一次 GET /api/ranch 的响应。视图段落是否存在由后端决定，
 * 缺失的段落保持 null，页面据此显示「未下发」而不是空列表。
 */
export function mapRanchState(state?: Record<string, any> | null): RanchState | null {
  if (!state || typeof state !== 'object')
    return null
  const resources = mapResources(state)
  const serverTime = number(state.serverTime, 0) || 0
  const neededExp = state.neededExp === null || state.neededExp === undefined ? null : text(state.neededExp)
  const currentExp = text(state.currentExp) || '0'
  const progressPercent = neededExp && bigint(neededExp) > 0n
    ? Math.min(100, Number(BigInt(currentExp || '0') * 100n / bigint(neededExp)))
    : 0
  return {
    unlocked: state.unlocked === true,
    reason: text(state.reason),
    serverTime,
    level: number(state.level, 0) || 0,
    exp: text(state.exp) || '0',
    currentExp,
    neededExp,
    progressPercent,
    resources,
    facilities: list(state.facilities).map((facility: any) => mapFacility(facility, serverTime, resources)),
    pending: mapPendingOperations(state),
    bag: state.bag === undefined ? null : list(state.bag).map(mapBagItem),
    shop: state.shop && typeof state.shop === 'object'
      ? { shopId: number(state.shop.shopId, 5) || 5, goods: list(state.shop.goods).map((good: any) => mapShopGood(good, number(state.shop.shopId, 5) || 5)) }
      : null,
    market: state.market && typeof state.market === 'object'
      ? {
          opened: state.market.opened === true,
          present: state.market.present === true,
          periodDay: text(state.market.periodDay) || '0',
          roundIndex: text(state.market.roundIndex) || '0',
          shelves: list(state.market.shelves),
          goods: list(state.market.goods).map(mapMarketGood),
        }
      : null,
    canShop: state.canShop && typeof state.canShop === 'object'
      ? { slotType: number(state.canShop.slotType, 6) || 6, goods: list(state.canShop.goods).map((good: any) => mapCanGood(good, number(state.canShop.slotType, 6) || 6)) }
      : null,
    tasks: state.tasks === undefined ? null : list(state.tasks).map(mapTask),
    book: state.book === undefined ? null : mapBook(state.book),
    activities: state.activities === undefined
      ? null
      : list(state.activities).map((activity: any) => ({
          id: text(activity.id),
          name: text(activity.name) || `活动${activity.id}`,
          startTime: number(activity.startTime, 0) || 0,
          endTime: number(activity.endTime, 0) || 0,
          status: activityStatus(activity, serverTime),
        })),
    friends: state.friends === undefined ? null : list(state.friends).map((friend: any) => ({ gid: text(friend.gid), name: text(friend.name) || text(friend.gid), avatarUrl: text(friend.avatarUrl) })),
    friendRanch: state.friendRanch === undefined ? null : mapFriendRanch(state.friendRanch, serverTime),
    dailyShare: state.dailyShare === undefined ? null : mapDailyShare(state.dailyShare),
  }
}

/** 一键操作汇总：只统计后端布尔位为真的目标，数量为 0 时不显示按钮。 */
export function batchTargets(state: RanchState | null, action: RanchAction) {
  if (!state)
    return { animals: 0, shelves: 0, hazards: 0, total: 0 }
  if (action === 'clean') {
    const hazards = state.facilities.reduce((sum, facility) => sum + facility.summary.hazardCount, 0)
    return { animals: 0, shelves: 0, hazards, total: hazards }
  }
  let animals = 0
  let shelves = 0
  for (const facility of state.facilities) {
    animals += facility.ranch?.animals.filter(animal => animal.actions.find(entry => entry.action === action)?.enabled).length || 0
    if (action === 'harvest')
      shelves += facility.ranch?.shelves.filter(shelf => shelf.canCollect).length || 0
  }
  return { animals, shelves, hazards: 0, total: animals + shelves }
}

/** 组装请求体：只带该动作认识的字段，undefined 与空串一律不发。 */
export type RanchBodyResult = { ok: true, body: Record<string, any> } | { ok: false, error: string, skipped?: boolean }

export function buildRanchBody(action: RanchAction, input: Record<string, any> = {}): RanchBodyResult {
  const allowed = RANCH_ACTION_FIELDS[action]
  if (!allowed)
    return { ok: false as const, error: '不支持的牧场操作，未发起请求' }
  const body: Record<string, any> = {}
  for (const key of allowed) {
    const value = input[key]
    if (value === undefined || value === null || value === '')
      continue
    body[key] = value
  }
  if (RANCH_NO_ALL_ACTIONS.includes(action) && input.all !== undefined)
    return { ok: false as const, error: '放生需要逐只确认，后端不接受一键放生' }
  const branches = RANCH_ACTION_REQUIRED[action] || []
  if (branches.length) {
    const matched = branches.some(group => group.every(key => body[key] !== undefined))
    if (!matched) {
      const readable = branches.map(group => group.map(key => RANCH_FIELD_LABELS[key] || key).join(' + ')).join(' 或 ')
      return { ok: false as const, error: `缺少必填参数（${readable}），未发起请求` }
    }
  }
  return { ok: true as const, body }
}

/**
 * 两阶段协议：先 quote，再把 expected 原样塞进 execute 的 body。
 * 报价缺失或被后端标 skipped 时不发起写请求，避免拿空 signature 去撞 RANCH_OFFER_CHANGED。
 */
export function buildRanchExecuteBody(action: RanchAction, input: Record<string, any>, quote?: QuoteResult | null): RanchBodyResult {
  if (!quote)
    return { ok: false as const, error: '尚未取得牧场报价，未发起操作' }
  if (quote.skipped === true)
    return { ok: false as const, skipped: true as const, error: quote.message || '当前没有需要执行的操作' }
  const signature = quote.expected?.signature
  if (typeof signature !== 'string' || !signature)
    return { ok: false as const, error: '牧场报价缺少校验签名，未发起操作' }
  const built = buildRanchBody(action, input)
  if (!built.ok)
    return built
  return { ok: true as const, body: { ...built.body, expected: { signature } } }
}

/** 后端写操作的统一结果归一；status 缺失按未知处理，不当成成功。 */
export function describeOperateResult(data: Record<string, any> | null | undefined) {
  const status = text(data?.status)
  if (status === 'skipped')
    return { status: 'skipped' as const, message: text(data?.notice) || '服务端判断无需执行，已跳过', refreshRequired: data?.refreshRequired === true }
  if (status === 'confirmed')
    return { status: 'confirmed' as const, message: text(data?.notice) || '操作已完成', refreshRequired: data?.refreshRequired === true }
  if (status)
    return { status: 'unknown' as const, message: `牧场返回了未知状态：${status}`, refreshRequired: true }
  return { status: 'unknown' as const, message: '牧场操作结果未能确认，请刷新核对，勿重复提交', refreshRequired: true }
}

/** 页面发起一次报价确认流程时携带的意图；note 用于解释不可逆后果，不编造规则。 */
export interface RanchRequest {
  action: RanchAction
  input: Record<string, any>
  title: string
  note?: string
  danger?: boolean
}

/** 报价文案：把 costs / rewards / count 汇总成一行，skipped 时给出后端 message。 */
export function describeQuote(quote?: QuoteResult | null) {
  if (!quote)
    return { summary: '', detail: [] as RanchItem[], skipped: true, count: 0 }
  const costs = toItems(quote.costItems)
  const rewards = toItems(quote.rewards)
  const parts = [`数量：${quote.count ?? 0}`]
  if (costs.length)
    parts.push(`消耗：${costs.map(itemLine).join('、')}`)
  if (rewards.length)
    parts.push(`预计获得：${rewards.map(itemLine).join('、')}`)
  return {
    summary: quote.skipped === true ? (text(quote.message) || '当前没有需要执行的操作') : parts.join('　·　'),
    detail: [...costs, ...rewards],
    skipped: quote.skipped === true,
    count: number(quote.count, 0) || 0,
  }
}

/** 资源是否付得起某件价格；balance 缺失（后端未确认）时返回 null，让页面显示「未确认」而不是「不足」。 */
export function affordability(balance: string | null | undefined, priceCount: unknown) {
  if (balance === null || balance === undefined || balance === '')
    return null
  return bigint(balance) >= bigint(priceCount)
}

export type RanchAutomationGroup = 'own' | 'friend' | 'reward'

/** 设置页二级分组；好友牧场三项会真实拜访好友，单独成组便于提示。 */
export const RANCH_AUTOMATION_GROUPS: ReadonlyArray<{ key: RanchAutomationGroup, title: string, detail: string }> = [
  { key: 'own', title: '自家牧场', detail: '收获、催产、补栏、升级、出售、牧草、罐头与清理' },
  { key: 'friend', title: '好友牧场', detail: '进入好友牧场偷取、清理、抚摸与放蚊子，每轮巡查最多拜访三位好友' },
  { key: 'reward', title: '每日奖励', detail: '领取牧场任务奖励与每日分享礼包' },
]

/** 牧场自动化配置：与 core/src/config/ranch-automation.ts 的默认值一一对应。 */
export const RANCH_AUTOMATION_SWITCHES: ReadonlyArray<{ key: string, label: string, desc: string, group: RanchAutomationGroup }> = [
  { key: 'ranch_harvest', label: '自动收获', desc: '收获栏舍里已成熟的产物', group: 'own' },
  { key: 'ranch_produce', label: '自动催产', desc: '触发可生产动物的产出', group: 'own' },
  { key: 'ranch_buy', label: '自动购买幼崽', desc: '按养殖策略在牧场商店补栏', group: 'own' },
  { key: 'ranch_upgrade', label: '自动升级设施', desc: '满足等级与材料时升级窝、棚与牧草机', group: 'own' },
  { key: 'ranch_sell', label: '自动出售产物', desc: '出售背包里可出售的产物', group: 'own' },
  { key: 'ranch_grass', label: '自动补充牧草', desc: '牧草机容量不满时用背包牧草补满', group: 'own' },
  { key: 'ranch_grass_buy', label: '自动购买牧草', desc: '背包牧草不足时先在商店购买，需同时开启补充牧草', group: 'own' },
  { key: 'ranch_fill_cans', label: '自动补充罐头桶', desc: '使用背包罐头为罐头桶增加时长', group: 'own' },
  { key: 'ranch_feed_normal', label: '自动普通罐头加速', desc: '用普通罐头桶加速非限制动物', group: 'own' },
  { key: 'ranch_feed_organic', label: '自动有机罐头加速', desc: '用有机罐头桶加速，含限制罐头动物', group: 'own' },
  { key: 'ranch_clean', label: '自动清理栏舍', desc: '清理自家栏舍的危险物', group: 'own' },
  { key: 'ranch_stroke', label: '自动抚摸动物', desc: '在好友牧场抚摸可触发巨大变异的动物，受每日抚摸次数限制', group: 'friend' },
  { key: 'ranch_friend_steal', label: '自动偷取好友产物', desc: '逐位好友进入牧场偷取', group: 'friend' },
  { key: 'ranch_friend_clean', label: '自动清理好友栏舍', desc: '清理好友栏舍危险物', group: 'friend' },
  { key: 'ranch_friend_mosquito', label: '自动放蚊子', desc: '向好友栏舍投放蚊子', group: 'friend' },
  { key: 'ranch_task', label: '自动领取牧场任务', desc: '领取已完成的牧场任务奖励', group: 'reward' },
  { key: 'ranch_share', label: '自动领取每日分享', desc: '上报分享并领取每日首次分享礼包', group: 'reward' },
]

/** 与 core/src/config/ranch-automation.ts 的 RANCH_AUTOMATION_DEFAULTS 逐 key、逐值对应，改动需同步。 */
export const RANCH_AUTOMATION_DEFAULTS = {
  ranch_harvest: false,
  ranch_produce: false,
  ranch_buy: false,
  ranch_upgrade: false,
  ranch_sell: false,
  ranch_grass: false,
  ranch_grass_buy: false,
  ranch_fill_cans: false,
  ranch_feed_normal: false,
  ranch_feed_organic: false,
  ranch_clean: false,
  ranch_stroke: false,
  ranch_friend_steal: false,
  ranch_friend_clean: false,
  ranch_friend_mosquito: false,
  ranch_task: true,
  ranch_share: true,
  ranch_check_minutes: 5,
  ranch_strategy: 'level',
  ranch_bag_fallback: 'level',
  ranch_coop_animal: 0,
  ranch_shed_animal: 0,
}

/**
 * 后端没有牧场总开关。设置页卡片的开关：关闭时清掉全部牧场动作，
 * 开启时只恢复到服务端默认里本就为 true 的动作，避免一次打开全部自动购买与好友互动。
 */
export function isRanchSwitchDefaultOn(key: string) {
  const defaults = RANCH_AUTOMATION_DEFAULTS as Record<string, boolean | number | string>
  return RANCH_AUTOMATION_SWITCHES.some(item => item.key === key) && defaults[key] === true
}

/**
 * 「指定动物」何时真正生效：策略直接选 preferred，或按背包库存缺货后回退到 preferred。
 * 与 core/src/services/ranch/automation.ts 的 selectAnimal 一致，其余情况下窝/棚指定项不参与选品。
 */
export function ranchUsesPreferredAnimal(strategy: unknown, bagFallback: unknown) {
  return strategy === 'preferred' || (strategy === 'bag_priority' && bagFallback === 'preferred')
}

export const RANCH_STRATEGY_OPTIONS: Array<{ value: string, label: string, desc: string }> = [
  { value: 'level', label: '按等级优先', desc: '优先养殖当前等级允许的最高档动物' },
  { value: 'preferred', label: '按指定动物', desc: '优先养殖窝/棚各自指定的动物' },
  { value: 'bag_priority', label: '按背包库存', desc: '优先放养背包里已有的幼崽' },
]

export const RANCH_BAG_FALLBACK_OPTIONS: Array<{ value: string, label: string, desc: string }> = [
  { value: 'level', label: '按等级优先', desc: '指定动物缺货时回退到等级优先' },
  { value: 'preferred', label: '按指定动物', desc: '指定动物缺货时不放养' },
]

export const RANCH_AUTOMATION_LIMITS = { checkMinutes: { min: 1, max: 60 } } as const
