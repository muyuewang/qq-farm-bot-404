/**
 * 萌宠成长日记（S3）store
 *
 * 从上游 web/src/stores/pet-diary.ts 移植，改用本地惯例：
 * - 用 isCurrentAccount() 防陈旧响应（上游用 generation 计数器）
 * - 错误提取走 err?.response?.data?.error || err?.message || 兜底
 * - 接口前缀 /api/activity/pet-diary/（上游为 /api/activity-center/pet-diary）
 */
import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface PetItem {
  id: string
  name: string
  image: string
  count: string
}

export interface PetCharm {
  id: number
  name: string
  description: string
  shortDescription: string
  useLimit: number
  image: string
  remaining: number[]
}

export interface PetTreasurePreview {
  challengeId: string
  canStart: boolean
  maxProfit: PetItem
  maxLoss: PetItem
  plunderableCount: string
}

export interface PetTreasure {
  id: string
  status: number
  item: PetItem
  protectedCount: string
  originalCount: string
  maxCount: string
  startTime: number
  endTime: number
  createdTime: number
  sourceCharmIds: number[]
  plunderCount: number
  maxPlunderCount: number
  previews: PetTreasurePreview[]
}

export interface PetStory {
  order: number
  unlocked: boolean
  claimed: boolean
  animated: boolean
  photo: string
  captionImage: string
  caption: string
}

export interface PetShopGoods {
  id: string
  name: string
  image: string
  rewards: PetItem[]
  costs: PetItem[]
  limit: string
  purchased: string
  remaining: string | null
  exchangeable: boolean
  safeCosts: boolean
  order: number
  category: string
}

/**
 * 节令小礼。本地后端 normalizeSolarTerm 产出 title / status(number)，
 * 上游页面消费 name / statusCode(string)，两套字段都由后端适配器同时给出。
 */
export interface PetSolarTerm {
  id: string
  /** 本地字段 */
  title: string
  /** 本地字段，数字状态：1 未开启 / 2 可领取 / 3 已领取 / 5 已结束 */
  status: number
  statusLabel: string
  /** 上游别名，等同 title */
  name: string
  /** 上游别名，status 的字符串形式 */
  statusCode: string
  canClaim: boolean
  startTime: number
  endTime: number
  rewards: PetItem[]
}

export interface PetDiary {
  activityId: string
  groupId: string
  title: string
  active: boolean
  startTime: number
  endTime: number
  serverTime: number
  rules: string[]
  treasureRules: string[]
  warnings: string[]
  balances: (PetItem & { known: boolean })[]
  nurture: {
    initialized: boolean
    adult: boolean
    growth: number
    adultGrowth: number
    dogGranted: boolean
    feedCount: number
    feedLimit: number
    feedCosts: PetItem[]
    canFeed: boolean
  }
  hunt: {
    count: number
    limit: number
    total: string
    luckyStarTotal: string
    costs: PetItem[]
    canDraw: boolean
    canPlunder: boolean
  }
  seeds: {
    canClaim: boolean
    days: { day: number, claimed: boolean, claimable: boolean, rewards: PetItem[] }[]
  }
  stories: PetStory[]
  charms: {
    pool: PetCharm[]
    equipped: PetCharm[]
    all: PetCharm[]
    picked: boolean
    canChoose: boolean
    freeRefreshRemaining: number
    freeRefreshLimit: number
    paidRefreshCount: number
    paidRefreshRemaining: number
    paidRefreshLimit: number
    refreshCost: PetItem
    refreshBalance: string | null
    canRefresh: boolean
    refreshNote: string
  }
  treasures: PetTreasure[]
  compensationCount: string
  battleCount: number
  battleLimit: number
  skipBattle: boolean
  shop: PetShopGoods[]
  solarTerms: { terms: PetSolarTerm[] } | null
  plants: PetItem[]
}

export type PetAction
  = | 'initialize' | 'feed' | 'draw' | 'story' | 'refreshCharm' | 'equipCharm'
    | 'battle' | 'openTreasure' | 'compensation' | 'claimDog' | 'markStories'
    | 'skipBattle' | 'seeds' | 'exchange' | 'solar'

export interface PetRecord {
  time: number
  type?: number
  costs?: PetItem[]
  rewards?: PetItem[]
  dogId?: string
  skins?: string[]
  attackerGid?: string
  name?: string
  won?: boolean
  treasureId?: string
  challenge?: PetItem
  level?: number
  attackerCharms?: number[]
  defenderCharms?: number[]
  lost?: PetItem[]
  injected?: PetItem[]
  fake?: boolean
}

export interface PetFriend {
  gid: string
  treasures: PetTreasure[]
  charms: number[]
}

/** 操作耗时较长（后端串行多次 RPC），单独放宽超时 */
const OPERATE_TIMEOUT_MS = 185000
const READ_TIMEOUT_MS = 95000

function errorMessage(err: any, fallback: string) {
  return err?.response?.data?.error || err?.message || fallback
}

export const usePetDiaryStore = defineStore('pet-diary', () => {
  const activity = ref<PetDiary | null>(null)
  const accountId = ref('')
  const pending = ref('')
  const error = ref('')
  const notice = ref('')
  const stale = ref(false)
  const records = ref<PetRecord[] | null>(null)
  const plunderRecords = ref<PetRecord[] | null>(null)
  const friend = ref<PetFriend | null>(null)
  /** 读取类错误单独存放，避免打开记录弹窗时把写操作的错误横幅抹掉 */
  const readError = ref('')

  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * 请求代际。仅比对账号 id 不足以识别「同账号但已被更新请求取代」的响应：
   * A -> B -> A 之后，第一次 A 的迟到响应账号校验仍会通过，
   * 从而用切换前的旧快照覆盖新快照，且 stale 为 false 无人察觉。
   */
  let generation = 0

  function isCurrentAccount(id: string) {
    const accountStore = useAccountStore()
    const currentId = String(
      (accountStore.currentAccountId as { value?: string })?.value
      ?? accountStore.currentAccountId
      ?? '',
    )
    return currentId === String(id)
  }

  /**
   * 响应是否仍然有效：代际未被新请求顶掉，且账号没切走。
   * 代际是承重条件，账号校验是第二道保险。
   */
  function isStillTargeting(id: string, gen: number) {
    return gen === generation && accountId.value === String(id) && isCurrentAccount(id)
  }

  function clearNotice() {
    notice.value = ''
    if (noticeTimer) {
      clearTimeout(noticeTimer)
      noticeTimer = null
    }
  }

  function showNotice(message: string) {
    clearNotice()
    notice.value = message
    noticeTimer = setTimeout(() => {
      notice.value = ''
    }, 4000)
  }

  function selectAccount(id: string) {
    const next = String(id || '')
    if (accountId.value === next)
      return
    generation++
    accountId.value = next
    activity.value = null
    records.value = null
    plunderRecords.value = null
    friend.value = null
    error.value = ''
    readError.value = ''
    pending.value = ''
    stale.value = false
    clearNotice()
  }

  async function load(id: string) {
    if (!id)
      return
    selectAccount(id)
    const gen = ++generation
    pending.value = 'load'
    error.value = ''
    try {
      const { data } = await api.get('/api/activity/pet-diary/state', {
        headers: { 'x-account-id': id },
        timeout: READ_TIMEOUT_MS,
        skipErrorToast: true,
      } as any)
      if (!isStillTargeting(id, gen))
        return
      if (data?.ok) {
        activity.value = data.data || null
        stale.value = false
      }
      else {
        error.value = data?.error || '获取萌宠成长日记失败'
        stale.value = true
      }
    }
    catch (err: any) {
      if (isStillTargeting(id, gen)) {
        error.value = errorMessage(err, '获取萌宠成长日记失败')
        stale.value = true
      }
    }
    finally {
      if (isStillTargeting(id, gen))
        pending.value = ''
    }
  }

  /**
   * 执行活动动作。后端返回的 snapshot 直接替换本地状态，
   * 拿不到 snapshot 时标记 stale，由页面决定何时重读。
   */
  async function operate(action: PetAction, params: Record<string, unknown> = {}) {
    const id = accountId.value
    if (!id) {
      error.value = '请先选择账号'
      return
    }
    // 同一 tick 内的第二次点击必须挡在这里：模板 disabled 要等渲染刷新才生效，
    // 而后端 serializeMutation 只串行化不去重，两次投喂会真的扣两份元气糕。
    if (pending.value)
      return
    const gen = generation
    pending.value = action
    error.value = ''
    clearNotice()
    try {
      const { data } = await api.post(
        '/api/activity/pet-diary/operate',
        { action, params },
        {
          headers: { 'x-account-id': id },
          timeout: OPERATE_TIMEOUT_MS,
          skipErrorToast: true,
        } as any,
      )
      if (!isStillTargeting(id, gen))
        return
      if (!data?.ok) {
        error.value = data?.error || '操作失败，请刷新后重试'
        stale.value = true
        return
      }

      const result = data.data || {}
      if (result.snapshot) {
        activity.value = result.snapshot
        stale.value = false
      }
      else {
        stale.value = true
      }

      const rewards = Array.isArray(result.rewards) ? result.rewards : []
      const rewardText = rewards.map((item: PetItem) => `${item.name} ×${item.count}`).join('、')
      showNotice([result.message, rewardText && `获得 ${rewardText}`, result.refreshError]
        .filter(Boolean).join('；'))

      // 夺宝后好友宝藏状态已变化，强制重新拉取
      if (action === 'battle')
        friend.value = null

      return result
    }
    catch (err: any) {
      if (isStillTargeting(id, gen)) {
        error.value = errorMessage(err, '操作失败，请刷新后重试')
        stale.value = true
      }
    }
    finally {
      if (isStillTargeting(id, gen))
        pending.value = ''
    }
  }

  async function readExtra(kind: 'interact' | 'plunder' | 'friend', gid = '') {
    const id = accountId.value
    if (!id)
      return
    // 用裸 kind：面板模板按 pending === 'interact' / 'plunder' 判断加载态。
    // 加 read: 前缀会让两处加载提示永远不触发，改而显示「暂无记录」误导用户。
    // 三个 kind 与 PetAction 无重名，无需前缀区分。
    pending.value = kind
    // 只清读取类错误，不动 error：写操作失败时 error 与 stale 同时置起，
    // 若在此抹掉 error，横幅消失而 stale 仍为 true，所有按钮会静默禁用且无提示。
    readError.value = ''
    const gen = generation
    try {
      const path = kind === 'friend'
        ? '/api/activity/pet-diary/friend'
        : '/api/activity/pet-diary/records'
      const params = kind === 'friend' ? { gid } : { kind }
      const { data } = await api.get(path, {
        params,
        headers: { 'x-account-id': id },
        skipErrorToast: true,
      } as any)
      if (!isStillTargeting(id, gen))
        return
      if (!data?.ok) {
        readError.value = data?.error || '读取失败'
        return
      }
      if (kind === 'friend')
        friend.value = data.data || null
      else if (kind === 'plunder')
        plunderRecords.value = data.data || []
      else
        records.value = data.data || []
    }
    catch (err: any) {
      if (isStillTargeting(id, gen))
        readError.value = errorMessage(err, '读取失败')
    }
    finally {
      if (isStillTargeting(id, gen))
        pending.value = ''
    }
  }

  onScopeDispose(() => clearNotice())

  return {
    activity,
    readError,
    accountId,
    pending,
    error,
    notice,
    stale,
    records,
    plunderRecords,
    friend,
    selectAccount,
    clearNotice,
    load,
    operate,
    readExtra,
  }
})
