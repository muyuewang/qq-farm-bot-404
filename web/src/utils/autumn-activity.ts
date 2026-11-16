/**
 * 秋季活动（/api/activities/autumn/:key、/api/activities/share-reward/:activityId）
 * 属于 commerce 约定：整数是 number、时间是毫秒。
 * 这里把它们折叠成 404 基线 WishShareActivityPanel 消费的旧形状（时间按秒、物品用 itemId/itemName/itemCount）。
 */

/** 404 基线面板消费的旧物品形状。 */
export interface ActivityPanelItem {
  itemId: number
  itemName: string
  itemCount: number
  image: string
}

export interface CommerceItemDto {
  id?: number | string | null
  count?: number | string | null
  name?: string | null
  image?: string | null
}

export interface WishSignDto {
  key?: string | null
  id?: string | null
  title?: string | null
  serverTime?: number | null
  startTime?: number | null
  endTime?: number | null
  active?: boolean | null
  rules?: string[] | null
  remaining?: number | null
  day?: number | null
  choices?: Array<{ id?: number | null, name?: string | null }> | null
  rewardDays?: Array<{ day?: number | null, reward?: CommerceItemDto | null }> | null
  pending?: { chooseId?: number | null, textId?: number | null, day?: number | null, text?: string | null, rewards?: CommerceItemDto[] | null } | null
  canDraw?: boolean | null
  canClaim?: boolean | null
}

export interface ShareRewardDto {
  id?: string | null
  title?: string | null
  serverTime?: number | null
  startTime?: number | null
  endTime?: number | null
  active?: boolean | null
  rules?: string[] | null
  score?: number | null
  claimedCount?: number | null
  claimLimit?: number | null
  poolClaimedCount?: number | null
  poolClaimLimit?: number | null
  canClaimDaily?: boolean | null
  canShare?: boolean | null
  firstShareAwarded?: boolean | null
  canClaimMilestones?: boolean | null
  milestones?: Array<{ id?: string | number | null, threshold?: number | null, state?: number | null, rewards?: CommerceItemDto[] | null }> | null
}

function toNumber(value: unknown, fallback = 0) {
  const raw = Number(value)
  return Number.isFinite(raw) ? raw : fallback
}

/** 面板的 time() 会再乘 1000，所以毫秒要先折回秒。 */
function toSeconds(value: unknown) {
  return Math.round(toNumber(value) / 1000)
}

function toItemDto(item?: CommerceItemDto | null): ActivityPanelItem {
  return {
    itemId: toNumber(item?.id),
    itemName: String(item?.name || ''),
    itemCount: toNumber(item?.count, 1),
    image: String(item?.image || ''),
  }
}

export function mapWishSignActivity(dto?: WishSignDto | null) {
  if (!dto || typeof dto !== 'object')
    return null
  const rewards = (list?: CommerceItemDto[] | null) => (list || []).filter(Boolean).map(toItemDto)
  return {
    uid: String(dto.id || ''),
    title: String(dto.title || '秋祈良愿'),
    activityId: toNumber(dto.id),
    startTime: toSeconds(dto.startTime),
    endTime: toSeconds(dto.endTime),
    active: dto.active === true,
    remainingCount: toNumber(dto.remaining),
    activityDay: toNumber(dto.day),
    canDraw: dto.canDraw === true,
    canClaim: dto.canClaim === true,
    choices: (dto.choices || []).filter(Boolean).map(choice => ({ id: toNumber(choice.id), name: String(choice.name || '') })),
    rewardPool: (dto.rewardDays || []).filter(Boolean).map(entry => ({ dayId: toNumber(entry.day), ...toItemDto(entry.reward) })),
    pending: dto.pending
      ? { dayId: toNumber(dto.pending.day), chooseId: toNumber(dto.pending.chooseId), text: String(dto.pending.text || ''), rewards: rewards(dto.pending.rewards) }
      : null,
  }
}

export function mapShareRewardActivity(dto?: ShareRewardDto | null) {
  if (!dto || typeof dto !== 'object')
    return null
  const claimedCount = toNumber(dto.claimedCount)
  return {
    uid: String(dto.id || ''),
    title: String(dto.title || '快乐不独享'),
    activityId: toNumber(dto.id),
    startTime: toSeconds(dto.startTime),
    endTime: toSeconds(dto.endTime),
    active: dto.active === true,
    currentScore: toNumber(dto.score),
    // canClaimDaily 里还包含活动有效期判断，只用 claimedCount 区分“领过了”和“活动已结束”。
    daily: {
      rewardClaimed: dto.canClaimDaily === false && claimedCount > 0,
      firstShareAwarded: dto.firstShareAwarded === true,
      claimedCount,
      claimLimit: toNumber(dto.claimLimit),
    },
    pool: { claimedCount: toNumber(dto.poolClaimedCount), claimLimit: toNumber(dto.poolClaimLimit) },
    canClaimMilestones: dto.canClaimMilestones === true,
    milestones: (dto.milestones || []).filter(Boolean).map(tier => ({
      id: toNumber(tier.id),
      threshold: toNumber(tier.threshold),
      state: toNumber(tier.state),
      rewards: (tier.rewards || []).filter(Boolean).map(toItemDto),
    })),
  }
}
