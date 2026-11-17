/**
 * 蓝晶藏品册（/api/collections、/api/collections/:action）与变异/藏品静态目录
 * （/api/illustrated/mutations）的纯适配器。
 *
 * 后端契约（core/src/services/collections.ts）：
 * - GET /api/collections 直接返回 normalizeCollections 的结果，整份快照里所有档位、
 *   系列与展台都由后端算好，前端不重复推导星级、分数或解锁条件；读取失败会抛
 *   「当前账号未返回蓝晶藏品信息」，此时没有快照可用，不能渲染零值冒充进度；
 * - POST /api/collections/upgrade 需要 collectionId + expectedStarLevel（0–4），
 *   可选 expectedCosts；后端用 costSignature 比对材料，变了就 PRICE_CHANGED 拒绝，
 *   所以这里把报价时的材料原样带上，等价于牧场的 expected.signature；
 * - POST /api/collections/display 需要 collectionId + displayed（布尔）+ 可选
 *   expectedDisplayItemId，后端拿它和当前展台物品比对，不一致按 COLLECTION_STATE_CHANGED 拒绝；
 * - POST /api/collections/claim 无入参，没有可领档位时返回 { skipped: true }，不发协议；
 * - 三个动作的成功返回都带最新 snapshot，前端直接采纳，不再额外拉一次；
 * - 错误经 handleApiError 输出，字符串错误码会被 Number() 丢掉，只有中文 message 可用，
 *   因此前端只展示 message，不再维护第二套码表。
 *
 * 本模块不引入 Vue / Pinia / @/api 运行时依赖，便于 web/tests 用 node --test 直接导入。
 */

export const COLLECTIONS_ENDPOINT = '/api/collections'
export const MUTATION_CATALOG_ENDPOINT = '/api/illustrated/mutations'

/** 后端 operateCollections 的动作白名单，页面无法拼出第四个动作。 */
export const COLLECTION_ACTIONS = ['upgrade', 'claim', 'display'] as const
export type CollectionAction = (typeof COLLECTION_ACTIONS)[number]

/** 后端 rarityNames 的下标 1–4，超出范围按「未知」处理而不是猜一个。 */
const RARITY_LABELS: Record<number, string> = {
  1: '普通',
  2: '稀有',
  3: '珍品',
  4: '天工',
}

export interface CollectionItemDto {
  id: number
  name: string
  description: string
  image: string
  starLevel: number
  maxStarLevel: number
  ownCount: string
  activated: boolean
  isNew: boolean
  score: number
  displayed: boolean
  wished: boolean
  requirements: string[]
  nextStarCosts: CollectionCost[]
  unlocked: boolean
  canUpgrade: boolean
}

export interface CollectionCost {
  itemId: number
  /** 后端下发的是十进制字符串，原样保留：升星时要按同一份字面量回传做签名比对。 */
  count: string
  name: string
  image: string
}

export interface CollectionSeries {
  id: number
  name: string
  rarity: number
  rarityName: string
  description: string
  requirements: string[]
  mutationRules: CollectionMutationRule[]
  items: CollectionItemDto[]
  activatedCount: number
  totalCount: number
}

export interface CollectionMutationRule {
  name: string
  probability: number
  guarantee: number
}

export interface CollectionBuff {
  id: number
  name: string
  value: number
  description: string
}

export interface CollectionMilestone {
  level: number
  score: number
  claimed: boolean
  reached: boolean
  rewards: CollectionCost[]
  buffs: CollectionBuff[]
}

export interface CollectionPedestal {
  id: number
  name: string
  image: string
  owned: boolean
}

export interface CollectionsSnapshot {
  score: number
  claimedScore: number
  activatedCount: number
  totalCount: number
  /** 后端在没有未领取档位时返回 null，表示已达最高档，不要显示成 0 分。 */
  nextRewardScore: number | null
  currentBuffs: CollectionBuff[]
  milestones: CollectionMilestone[]
  series: CollectionSeries[]
  display: { itemId: string, pedestalId: string } | null
  pedestals: CollectionPedestal[]
  updatedAt: number
}

export interface MutationEffect {
  id: number
  name: string
  tag: string
  image: string
  effect: string
  description: string
  probabilities: Array<{ rarity: number, percent: number }>
}

export interface MutationCatalog {
  normal: MutationEffect[]
  decoration: MutationEffect[]
  collections: Array<{
    id: number
    name: string
    rarityName: string
    description: string
    mutationRules: CollectionMutationRule[]
    items: Array<{ id: number, name: string, image: string }>
  }>
}

function number(value: unknown, fallback: number | null = 0): number | null {
  const result = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(result))
    return result
  return fallback
}

function integer(value: unknown, fallback = 0): number {
  const result = number(value, null)
  return result === null ? fallback : Math.trunc(result)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

/** 后端的 own_count / item_id 是十进制字符串，原样保留避免大数被 Number() 截断。 */
function decimal(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '')
    return value.trim()
  if (typeof value === 'bigint')
    return value.toString()
  const result = number(value, null)
  return result === null ? '0' : String(result)
}

function bool(value: unknown): boolean {
  return value === true
}

function list<T>(value: unknown, map: (entry: any) => T): T[] {
  return Array.isArray(value) ? value.map(map) : []
}

function mapCost(raw: any): CollectionCost {
  return {
    itemId: integer(raw?.itemId),
    count: decimal(raw?.count),
    name: text(raw?.name),
    image: text(raw?.image),
  }
}

function mapBuff(raw: any): CollectionBuff {
  return {
    id: integer(raw?.id),
    name: text(raw?.name),
    value: number(raw?.value, 0) ?? 0,
    description: text(raw?.description),
  }
}

function mapMutationRule(raw: any): CollectionMutationRule {
  return {
    name: text(raw?.name),
    probability: number(raw?.probability, null) ?? 0,
    guarantee: integer(raw?.guarantee),
  }
}

function mapItem(raw: any): CollectionItemDto {
  return {
    id: integer(raw?.id),
    name: text(raw?.name),
    description: text(raw?.description),
    image: text(raw?.image),
    starLevel: integer(raw?.starLevel),
    maxStarLevel: integer(raw?.maxStarLevel, 5) || 5,
    ownCount: decimal(raw?.ownCount),
    activated: bool(raw?.activated),
    isNew: bool(raw?.isNew),
    score: number(raw?.score, 0) ?? 0,
    displayed: bool(raw?.displayed),
    wished: bool(raw?.wished),
    requirements: list(raw?.requirements, text),
    nextStarCosts: list(raw?.nextStarCosts, mapCost),
    unlocked: bool(raw?.unlocked),
    canUpgrade: bool(raw?.canUpgrade),
  }
}

function mapSeries(raw: any): CollectionSeries {
  const rarity = integer(raw?.rarity)
  const items = list(raw?.items, mapItem)
  return {
    id: integer(raw?.id),
    name: text(raw?.name),
    rarity,
    rarityName: text(raw?.rarityName) || RARITY_LABELS[rarity] || '等级未知',
    description: text(raw?.description),
    requirements: list(raw?.requirements, text),
    mutationRules: list(raw?.mutationRules, mapMutationRule),
    items,
    activatedCount: number(raw?.activatedCount, items.filter(item => item.activated).length) ?? 0,
    totalCount: number(raw?.totalCount, items.length) ?? 0,
  }
}

function mapMilestone(raw: any): CollectionMilestone {
  return {
    level: integer(raw?.level),
    score: integer(raw?.score),
    claimed: bool(raw?.claimed),
    reached: bool(raw?.reached),
    rewards: list(raw?.rewards, mapCost),
    buffs: list(raw?.buffs, mapBuff),
  }
}

function mapPedestal(raw: any): CollectionPedestal {
  return {
    id: integer(raw?.pedestal_id ?? raw?.id),
    name: text(raw?.name),
    image: text(raw?.image),
    owned: bool(raw?.owned),
  }
}

/**
 * 快照映射。后端读取失败时整个请求非 ok，data 为 undefined；这里返回 null 让页面
 * 显示独立错误态，而不是用一份全零快照冒充「账号没有藏品」。
 */
export function mapCollectionsSnapshot(raw: any): CollectionsSnapshot | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.series))
    return null
  const nextReward = number(raw.nextRewardScore, null)
  return {
    score: integer(raw.score),
    claimedScore: integer(raw.claimedScore),
    activatedCount: integer(raw.activatedCount),
    totalCount: integer(raw.totalCount),
    nextRewardScore: nextReward === null || nextReward <= 0 ? null : nextReward,
    currentBuffs: list(raw.currentBuffs, mapBuff),
    milestones: list(raw.milestones, mapMilestone),
    series: raw.series.map(mapSeries),
    display: mapDisplay(raw.display),
    pedestals: list(raw.pedestals, mapPedestal),
    updatedAt: integer(raw.updatedAt),
  }
}

function mapDisplay(raw: any) {
  const itemId = decimal(raw?.itemId)
  if (!raw || itemId === '0' || itemId === '')
    return null
  return { itemId, pedestalId: decimal(raw.pedestalId) }
}

export function mapMutationCatalog(raw: any): MutationCatalog {
  const mapEffect = (entry: any): MutationEffect => ({
    id: integer(entry?.id),
    name: text(entry?.name),
    tag: text(entry?.tag),
    image: text(entry?.image),
    effect: text(entry?.effect),
    description: text(entry?.description),
    probabilities: list(entry?.probabilities, item => ({
      rarity: integer(item?.rarity),
      percent: number(item?.percent, 0) ?? 0,
    })),
  })
  return {
    normal: list(raw?.normal, mapEffect),
    decoration: list(raw?.decoration, mapEffect),
    collections: list(raw?.collections, entry => ({
      id: integer(entry?.id),
      name: text(entry?.name),
      rarityName: text(entry?.rarityName),
      description: text(entry?.description),
      mutationRules: list(entry?.mutationRules, mapMutationRule),
      items: list(entry?.items, item => ({ id: integer(item?.id), name: text(item?.name), image: text(item?.image) })),
    })),
  }
}

/** 星级点：已激活才画实心，未激活保持空位，避免出现「0 星却有 5 格亮」。 */
export function starDots(item: Pick<CollectionItemDto, 'starLevel' | 'maxStarLevel'>) {
  const total = Math.max(0, integer(item.maxStarLevel, 5) || 5)
  const filled = Math.min(total, Math.max(0, integer(item.starLevel)))
  return { filled, total }
}

/** 单个藏品的可操作状态与置灰原因，直接对应后端会抛出的拒绝条件。 */
export function describeItemAction(item: CollectionItemDto, displayedItemId: string | null) {
  if (!item.unlocked)
    return { canActivate: false, reason: '尚未满足解锁条件' }
  if (!item.activated)
    return { canActivate: true, reason: item.canUpgrade ? '' : '激活需要消耗藏品本体' }
  if (item.starLevel >= item.maxStarLevel)
    return { canActivate: false, reason: '已达最高星级' }
  if (!item.nextStarCosts.length)
    return { canActivate: false, reason: '升星材料未下发' }
  if (!item.canUpgrade)
    return { canActivate: false, reason: `升星还需 ${copiesShort(item)} 件本体` }
  const onShow = !!displayedItemId && displayedItemId === String(item.id)
  return { canActivate: true, reason: '', canDisplay: !onShow, canHide: onShow }
}

function copiesShort(item: CollectionItemDto) {
  const need = item.nextStarCosts.find(cost => cost.itemId === item.id)?.count
  return need === undefined ? '未知数量' : String(need)
}

/**
 * 组装 upgrade 请求体。后端要求 expectedStarLevel 是 0–4 的整数且必须等于当前星级，
 * 不满足时直接返回 null，让页面不发这个请求，而不是等后端拒绝。
 */
export function buildUpgradeBody(item: CollectionItemDto): Record<string, unknown> | null {
  if (!item.unlocked || !item.canUpgrade)
    return null
  if (item.starLevel < 0 || item.starLevel >= item.maxStarLevel || !item.nextStarCosts.length)
    return null
  return {
    collectionId: item.id,
    expectedStarLevel: item.starLevel,
    expectedCosts: item.nextStarCosts.map(cost => ({ itemId: cost.itemId, count: cost.count })),
  }
}

/**
 * 组装 display 请求体。后端要求藏品已激活，并把 expectedDisplayItemId 与展台当前物品
 * 比对；快照没有展台物品时按 '0' 上报，与后端 `snapshot.display?.itemId || '0'` 一致。
 */
export function buildDisplayBody(item: CollectionItemDto, displayed: boolean, snapshot: CollectionsSnapshot | null): Record<string, unknown> | null {
  if (!item.activated)
    return null
  if (displayed && !item.unlocked)
    return null
  return {
    collectionId: item.id,
    displayed,
    expectedDisplayItemId: snapshot?.display?.itemId ?? '0',
  }
}

/** 动作白名单；未登记的动作不发给后端，避免拼出 404 之外的隐性错误。 */
export function buildCollectionsBody(action: unknown, input: Record<string, unknown> = {}) {
  if (!COLLECTION_ACTIONS.includes(action as CollectionAction))
    return { ok: false as const, error: '未知的藏品操作' }
  if (action === 'claim')
    return { ok: true as const, body: {} }
  const collectionId = number(input.collectionId, null)
  if (collectionId === null || collectionId <= 0)
    return { ok: false as const, error: '缺少藏品编号，未发起请求' }
  if (action === 'upgrade')
    return { ok: true as const, body: { ...input, collectionId } }
  if (typeof input.displayed !== 'boolean')
    return { ok: false as const, error: '请指定展示或取消展示' }
  return { ok: true as const, body: { ...input, collectionId } }
}

/** 后端 skipped 表示「当前状态已经是目标状态」，不报错也不刷新，只提示。 */
export function describeCollectionResult(result: any, fallback: string) {
  if (result?.skipped === true)
    return { status: 'skipped' as const, message: result.message || '当前没有需要变更的藏品状态' }
  if (result?.snapshot)
    return { status: 'confirmed' as const, message: fallback }
  return { status: 'unknown' as const, message: `${fallback}结果未确认，请刷新核对，不要重复提交` }
}

/** 领取档位的汇总文案：claimedScores 是后端下发的已领分数，缺失时不编数量。 */
export function describeClaimResult(result: any) {
  if (result?.skipped === true)
    return '当前没有可达成的收藏分数档位'
  const scores = Array.isArray(result?.claimedScores) ? result.claimedScores.map((v: any) => Number(v)).filter(Number.isFinite) : null
  const rewards = Array.isArray(result?.rewards) ? result.rewards : []
  const rewardText = rewards.length
    ? rewards.map((item: any) => `${text(item?.name) || `物品${integer(item?.id)}`} ×${decimal(item?.count)}`).join('、')
    : ''
  const head = scores ? `已领取 ${scores.length} 个分数档位` : '奖励已领取'
  return rewardText ? `${head}：${rewardText}` : head
}

/** 分数进度：分母取下一个未领取档位，全部领完时返回 null 让页面显示「已达最高档」。 */
export function collectionsProgress(snapshot: CollectionsSnapshot | null) {
  if (!snapshot)
    return null
  const target = snapshot.nextRewardScore
  if (target === null || target <= 0)
    // 全角空格是排版用的宽间隔，写成转义避免触发 no-irregular-whitespace。
    return { percent: 100, text: `当前分数 ${snapshot.score}\u3000·\u3000全部档位已达成` }
  return {
    percent: Math.min(100, Math.max(0, Math.round((snapshot.score / target) * 100))),
    text: `当前分数 ${snapshot.score} / ${target}`,
  }
}

/** 材料行文案：与牧场 itemLine 保持同样的「名称 × 数量」格式。 */
export function costLine(cost: CollectionCost) {
  return `${cost.name || `物品${cost.itemId}`} ×${cost.count}`
}
