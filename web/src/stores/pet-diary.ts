import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'

export interface PetItem { id: string, name: string, image: string, count: string }
export interface PetCharm { id: number, name: string, description: string, shortDescription: string, useLimit: number, image: string, remaining: number[] }
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
  previews: { challengeId: string, canStart: boolean, maxProfit: PetItem, maxLoss: PetItem, plunderableCount: string }[]
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
  nurture: { initialized: boolean, adult: boolean, growth: number, adultGrowth: number, dogGranted: boolean, feedCount: number, feedLimit: number, feedCosts: PetItem[], canFeed: boolean }
  hunt: { count: number, limit: number, total: string, luckyStarTotal: string, costs: PetItem[], canDraw: boolean, canPlunder: boolean }
  seeds: { canClaim: boolean, days: { day: number, claimed: boolean, claimable: boolean, rewards: PetItem[] }[] }
  stories: { order: number, unlocked: boolean, claimed: boolean, animated: boolean, photo: string }[]
  charms: { pool: PetCharm[], equipped: PetCharm[], all: PetCharm[], picked: boolean, canChoose: boolean, freeRefreshRemaining: number, freeRefreshLimit: number, paidRefreshCount: number, paidRefreshRemaining: number, paidRefreshLimit: number, refreshCost: PetItem, refreshBalance: string | null, canRefresh: boolean, refreshNote: string }
  treasures: PetTreasure[]
  compensationCount: string
  battleCount: number
  battleLimit: number
  skipBattle: boolean
  shop: { id: string, name: string, image: string, rewards: PetItem[], costs: PetItem[], limit: string, purchased: string, remaining: string | null, exchangeable: boolean, safeCosts: boolean, category: string }[]
  solarTerms: { terms: { id: string, name: string, startTime: string, endTime: string, statusCode: string, canClaim: boolean, rewards: PetItem[] }[] } | null
  plants: PetItem[]
}
export type PetAction = 'initialize' | 'feed' | 'draw' | 'story' | 'refreshCharm' | 'equipCharm' | 'battle' | 'openTreasure' | 'compensation' | 'claimDog' | 'markStories' | 'skipBattle' | 'seeds' | 'exchange'
export interface PetRecord { time: number, type?: number, costs?: PetItem[], rewards?: PetItem[], name?: string, won?: boolean, lost?: PetItem[], injected?: PetItem[], fake?: boolean, attackerGid?: string, treasureId?: string, challenge?: PetItem, level?: number, attackerCharms?: number[], defenderCharms?: number[] }
export interface PetFriend { gid: string, treasures: PetTreasure[], charms: number[] }

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
  let generation = 0
  let noticeTimer: ReturnType<typeof setTimeout> | undefined

  function clearNotice() {
    clearTimeout(noticeTimer)
    noticeTimer = undefined
    notice.value = ''
  }
  onScopeDispose(clearNotice)

  function selectAccount(id: string) {
    if (accountId.value === id)
      return
    generation++
    accountId.value = id
    activity.value = null
    records.value = null
    plunderRecords.value = null
    friend.value = null
    pending.value = ''
    error.value = ''
    clearNotice()
    stale.value = false
  }
  function options() {
    return { headers: { 'x-account-id': accountId.value }, timeout: 185000, skipErrorToast: true } as any
  }
  function payload(response: any) {
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data))
    return response.data.data
  }
  async function load(id: string) {
    selectAccount(id)
    if (!id || pending.value)
      return
    const version = generation
    pending.value = 'load'
    error.value = ''
    try {
      const result = payload(await api.get('/api/activity-center/pet-diary', options()))
      if (version === generation) {
        activity.value = result
        stale.value = false
      }
    }
    catch (e) {
      if (version === generation) {
        error.value = getApiErrorMessage(e)
        stale.value = true
      }
    }
    finally {
      if (version === generation)
        pending.value = ''
    }
  }
  async function operate(action: PetAction | 'solar', params: Record<string, unknown> = {}) {
    if (pending.value || stale.value || !accountId.value || !activity.value?.active)
      return
    const version = generation
    pending.value = action
    error.value = ''
    clearNotice()
    try {
      const result = payload(await api.post('/api/activity-center/pet-diary/operate', { action, params }, options()))
      if (version !== generation)
        return
      const rewards = (result.rewards || []) as PetItem[]
      notice.value = `${result.message || '操作成功'}${rewards.length ? ` · ${rewards.map(i => `${i.name} ×${i.count}`).join('、')}` : ''}`
      noticeTimer = setTimeout(clearNotice, 4000)
      if (result.snapshot) {
        activity.value = result.snapshot
      }
      else {
        stale.value = true
        error.value = result.refreshError || '操作已完成，请刷新以查看最新状态'
      }
      if (action === 'battle')
        friend.value = null
    }
    catch (e) {
      if (version === generation) {
        error.value = `${getApiErrorMessage(e)}。请刷新确认最新状态后再操作。`
        stale.value = true
      }
    }
    finally {
      if (version === generation)
        pending.value = ''
    }
  }
  async function readExtra(kind: 'interact' | 'plunder' | 'friend', gid = '') {
    if (!accountId.value || pending.value)
      return
    const version = generation
    pending.value = kind
    error.value = ''
    if (kind === 'friend')
      friend.value = null
    else if (kind === 'plunder')
      plunderRecords.value = null
    else records.value = null
    try {
      const result = payload(await api.get(`/api/activity-center/pet-diary/${kind === 'friend' ? 'friend' : 'records'}`, {
        ...options(),
        params: kind === 'friend' ? { gid } : { kind },
      }))
      if (version !== generation)
        return
      if (kind === 'friend')
        friend.value = result
      else if (kind === 'plunder')
        plunderRecords.value = result
      else records.value = result
    }
    catch (e) {
      if (version === generation)
        error.value = getApiErrorMessage(e)
    }
    finally {
      if (version === generation)
        pending.value = ''
    }
  }
  return { activity, accountId, pending, error, notice, stale, records, plunderRecords, friend, selectAccount, load, operate, readExtra, clearNotice }
})
