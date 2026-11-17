/**
 * 牧歌初启（2026111700）store
 *
 * 接口来自 core/src/services/muge-activity.ts：
 * - GET  /api/activities/muge            读取活动组快照
 * - POST /api/activities/muge/:action    写操作，回包带最新 activity
 *
 * 本地惯例：
 * - 用代际 + 账号双校验防陈旧响应，避免 A -> B -> A 后旧快照覆盖新快照
 * - 错误提取走 err?.response?.data?.error || err?.message || 兜底
 * - 写操作后如果后端标记 refreshRequired，置 needsRefresh 阻止继续提交
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

export interface MugeReward {
  id: number
  count: number
  name: string
  image: string
}

export interface MugeTier {
  id: string
  threshold: number
  status: number
  rewards: MugeReward[]
}

export interface MugeTask {
  id: string
  description: string
  progress: number
  target: number
  status: number
  unlockDay: number
  points: number
  rewards: MugeReward[]
}

export interface MugeQuestionOption {
  value: number
  text: string
  label: string
}

export interface MugeQuestion {
  id: number
  title: string
  options: MugeQuestionOption[]
}

export interface MugeState {
  activityId: string
  title: string
  serverTime: number
  startTime: number
  endTime: number
  active: boolean
  rules: string[]
  celebration: { total: number, tiers: MugeTier[] } | null
  friends: { count: number, tiers: MugeTier[] } | null
  handbook: { points: number, tiers: MugeTier[], tasks: MugeTask[] } | null
  personality: {
    answers: Record<string, number>
    personalityId: number
    settleCount: number
    image: string
    shareRewardClaimed: boolean
  } | null
  questions: MugeQuestion[]
}

export type MugeAction
  = | 'claimCelebration'
    | 'claimFriends'
    | 'claimTask'
    | 'claimHandbook'
    | 'saveAnswers'
    | 'settle'
    | 'claimShare'

/** 档位与任务共用同一套状态码：1 进行中、2 可领取、3 已领取、4 未解锁。 */
export const MUGE_TIER_READY = 2
export const MUGE_TIER_CLAIMED = 3
export const MUGE_TASK_LOCKED = 4

const READ_TIMEOUT_MS = 60_000
const WRITE_TIMEOUT_MS = 190_000

export const useMugeStore = defineStore('muge', () => {
  const state = ref<MugeState | null>(null)
  const accountId = ref('')
  const loading = ref(false)
  const pending = ref<MugeAction | ''>('')
  const error = ref('')
  const needsRefresh = ref(false)

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

  function isStillTargeting(id: string, gen: number) {
    return gen === generation && accountId.value === String(id) && isCurrentAccount(id)
  }

  function selectAccount(id: string) {
    const next = String(id || '')
    if (accountId.value === next)
      return
    generation++
    accountId.value = next
    state.value = null
    loading.value = false
    pending.value = ''
    error.value = ''
    needsRefresh.value = false
  }

  function clear() {
    generation++
    state.value = null
    loading.value = false
    pending.value = ''
    error.value = ''
    needsRefresh.value = false
  }

  async function load(id: string) {
    if (!id)
      return
    selectAccount(id)
    const gen = ++generation
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/api/activities/muge', {
        headers: { 'x-account-id': id },
        timeout: READ_TIMEOUT_MS,
        skipErrorToast: true,
      } as any)
      if (!isStillTargeting(id, gen))
        return
      if (!data?.ok)
        throw new Error(data?.error || '牧歌初启数据读取失败')
      state.value = data.data || null
      needsRefresh.value = false
    }
    catch (err: any) {
      if (isStillTargeting(id, gen))
        error.value = err?.response?.data?.error || err?.message || '牧歌初启数据读取失败'
    }
    finally {
      if (isStillTargeting(id, gen))
        loading.value = false
    }
  }

  async function operate(action: MugeAction, input: Record<string, unknown> = {}) {
    const id = accountId.value || ''
    if (!id || pending.value || needsRefresh.value)
      return false
    const gen = ++generation
    pending.value = action
    error.value = ''
    const toast = useToastStore()
    try {
      const { data } = await api.post(`/api/activities/muge/${action}`, input, {
        headers: { 'x-account-id': id },
        timeout: WRITE_TIMEOUT_MS,
        skipErrorToast: true,
      } as any)
      if (!isStillTargeting(id, gen))
        return false
      if (!data?.ok)
        throw new Error(data?.error || '操作失败')
      const result = data.data || {}
      // 后端在回包读不出最新状态时返回 activity: null + refreshRequired，
      // 此时绝不能沿用旧快照，否则页面会显示过期进度并允许重复提交。
      if (result.activity)
        state.value = result.activity
      else
        needsRefresh.value = true

      if (action !== 'saveAnswers') {
        const text = (result.rewards || [])
          .map((reward: MugeReward) => `${reward.name} ×${reward.count}`)
          .join('、')
        toast.success(text || (action === 'settle' ? '牧场人格已生成' : '操作已完成'))
      }
      return true
    }
    catch (err: any) {
      if (isStillTargeting(id, gen)) {
        error.value = err?.response?.data?.error || err?.message || '操作失败'
        // 写操作失败后状态已不可信，必须重新读取才能再提交。
        needsRefresh.value = true
      }
      return false
    }
    finally {
      if (isStillTargeting(id, gen))
        pending.value = ''
    }
  }

  return { state, accountId, loading, pending, error, needsRefresh, load, operate, clear }
})
