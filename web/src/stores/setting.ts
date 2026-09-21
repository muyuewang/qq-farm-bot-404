import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface AutomationConfig {
  farm?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  friend?: boolean
  friend_auto_accept?: boolean
  task?: boolean
  star_passport_claim?: boolean
  star_solar_claim?: boolean
  star_record_claim?: boolean
  qingmei_seed_claim?: boolean
  qingmei_wine_brew?: boolean
  qixi_dew_use?: boolean
  qixi_bridge_build?: boolean
  qixi_sachet_gift?: boolean
  qixi_friend_priority?: number[]
  rain_poem_bottle_buy?: boolean
  rain_poem_weather_collect?: boolean
  rain_poem_summon_use?: boolean
  rain_poem_prank_use?: boolean
  rain_poem_research_unlock?: boolean
  charity_flower_share_claim?: boolean
  charity_flower_donate?: boolean
  charity_flower_reward_claim?: boolean
  charity_flower_public_fund_claim?: boolean
  pet_diary_adopt?: boolean
  pet_diary_feed?: boolean
  pet_diary_draw?: boolean
  pet_diary_story_claim?: boolean
  pet_diary_seed_claim?: boolean
  pet_diary_solar_claim?: boolean
  pet_diary_treasure_open?: boolean
  pet_diary_compensation_claim?: boolean
  pet_diary_charm_equip?: boolean
  pet_diary_battle?: boolean
  sell?: boolean
  fertilizer_gift?: boolean
  fertilizer_buy_organic?: boolean
  fertilizer_buy_normal?: boolean
  mystery_shop_auto_buy?: boolean
  mystery_shop_allow_gold?: boolean
  mystery_shop_allow_coupon?: boolean
  mystery_shop_allow_gold_bean?: boolean
  fertilizer?: string
  fertilizer_multi_season?: boolean
  fertilizer_land_types?: string[]
  fertilizer_smart_seconds?: number
  friend_steal?: boolean
  friend_help?: boolean
  friend_bad?: boolean
  friend_golden_bug?: boolean
  friend_help_exp_limit?: boolean
  golden_bug_clear?: boolean
  skip_own_weed_bug?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
  helpMin?: number
  helpMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
}

export interface OfflineConfig {
  channel: string
  reloginUrlMode: string
  endpoint: string
  token: string
  title: string
  msg: string
  offlineDeleteSec: number
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  senderName: string
  recipientEmail: string
  emailContent: string
}

export interface OfflineConfigSavePayload extends OfflineConfig {
  confirmed?: boolean
  confirmText?: string
}

export interface UIConfig {
  theme?: string
}

export interface AutoCodeRefreshConfig {
  enabled: boolean
  intervalMinutes: number
}

export interface SettingsState {
  plantingStrategy: string
  prioritize2x2Crops: boolean
  auto2x2SyncBuy: boolean
  prioritizeGrowthTasks: boolean
  bagSeedPriority: number[]
  bagSeedKnownIds: number[]
  bagSeedExcludedIds: number[]
  bagSeedFallbackStrategy: string
  plantSeedPriority: number[]
  autoAcceptFriendMinLevel: number
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  automation: AutomationConfig
  autoCodeRefresh: AutoCodeRefreshConfig
  ui: UIConfig
  offlineReminder: OfflineConfig
  stealDelaySeconds: number
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  goldenBugKeepCount: number
  goldenBugRoundLimit: number
}

function createDefaultOfflineReminder(): OfflineConfig {
  return {
    channel: 'smtp',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 0,
    smtpHost: '',
    smtpPort: 465,
    smtpUser: '',
    smtpPass: '',
    senderName: '',
    recipientEmail: '',
    emailContent: '',
  }
}

function createDefaultAutoCodeRefresh(): AutoCodeRefreshConfig {
  return {
    enabled: false,
    intervalMinutes: 60,
  }
}

function normalizeOfflineReminder(input: Partial<OfflineConfig> | null | undefined): OfflineConfig {
  return {
    ...createDefaultOfflineReminder(),
    ...(input || {}),
  }
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>({
    plantingStrategy: 'max_exp',
    prioritize2x2Crops: false,
    auto2x2SyncBuy: false,
    prioritizeGrowthTasks: false,
    bagSeedPriority: [],
    bagSeedKnownIds: [],
    bagSeedExcludedIds: [],
    bagSeedFallbackStrategy: 'level',
    plantSeedPriority: [],
    autoAcceptFriendMinLevel: 0,
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    automation: {},
    autoCodeRefresh: createDefaultAutoCodeRefresh(),
    ui: {},
    offlineReminder: createDefaultOfflineReminder(),
    stealDelaySeconds: 0,
    fertilizerBuyOrganicCount: 10,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 10,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 30,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
  })
  const loading = ref(false)
  let fetchRequestId = 0

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function clearSettingsState() {
    settings.value = {
      plantingStrategy: 'max_exp',
      prioritize2x2Crops: false,
      auto2x2SyncBuy: false,
      prioritizeGrowthTasks: false,
      bagSeedPriority: [],
      bagSeedKnownIds: [],
      bagSeedExcludedIds: [],
      bagSeedFallbackStrategy: 'level',
      plantSeedPriority: [],
      autoAcceptFriendMinLevel: 0,
      intervals: {},
      friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
      automation: {},
      autoCodeRefresh: createDefaultAutoCodeRefresh(),
      ui: {},
      offlineReminder: createDefaultOfflineReminder(),
      stealDelaySeconds: 0,
      fertilizerBuyOrganicCount: 10,
      fertilizerBuyOrganicThresholdHours: 10,
      fertilizerBuyNormalCount: 10,
      fertilizerBuyNormalThresholdHours: 10,
      fertilizerBuyCheckIntervalMinutes: 30,
      goldenBugKeepCount: 0,
      goldenBugRoundLimit: 24,
    }
    loading.value = false
  }

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (data && data.ok && data.data) {
        const d = data.data
        settings.value.plantingStrategy = d.plantingStrategy || d.strategy || 'max_exp'
        settings.value.prioritize2x2Crops = d.prioritize2x2Crops === true
        settings.value.auto2x2SyncBuy = d.auto2x2SyncBuy === true
        settings.value.prioritizeGrowthTasks = d.prioritizeGrowthTasks === true
        settings.value.intervals = d.intervals || {}
        settings.value.friendQuietHours = d.friendQuietHours || { enabled: false, start: '23:00', end: '07:00' }
        settings.value.automation = d.automation || {}
        settings.value.autoCodeRefresh = {
          ...createDefaultAutoCodeRefresh(),
          ...(d.autoCodeRefresh || {}),
        }
        settings.value.ui = d.ui || {}
        settings.value.autoAcceptFriendMinLevel = d.autoAcceptFriendMinLevel ?? 0
        settings.value.offlineReminder = normalizeOfflineReminder(d.offlineReminder)
        settings.value.stealDelaySeconds = d.stealDelaySeconds ?? 0
        settings.value.fertilizerBuyOrganicCount = d.fertilizerBuyOrganicCount ?? 10
        settings.value.fertilizerBuyOrganicThresholdHours = d.fertilizerBuyOrganicThresholdHours ?? 10
        settings.value.fertilizerBuyNormalCount = d.fertilizerBuyNormalCount ?? 10
        settings.value.fertilizerBuyNormalThresholdHours = d.fertilizerBuyNormalThresholdHours ?? 10
        settings.value.fertilizerBuyCheckIntervalMinutes = d.fertilizerBuyCheckIntervalMinutes ?? 30
        settings.value.goldenBugKeepCount = d.goldenBugKeepCount ?? 0
        settings.value.goldenBugRoundLimit = d.goldenBugRoundLimit ?? 24
        settings.value.bagSeedPriority = d.bagSeedPriority ?? []
        settings.value.bagSeedKnownIds = d.bagSeedKnownIds ?? []
        settings.value.bagSeedExcludedIds = d.bagSeedExcludedIds ?? []
        settings.value.bagSeedFallbackStrategy = d.bagSeedFallbackStrategy ?? 'level'
        settings.value.plantSeedPriority = d.plantSeedPriority ?? []
      }
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function saveSettings(accountId: string, newSettings: any) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      const settingsPayload = {
        plantingStrategy: newSettings.plantingStrategy,
        prioritize2x2Crops: newSettings.prioritize2x2Crops === true,
        auto2x2SyncBuy: newSettings.auto2x2SyncBuy === true,
        prioritizeGrowthTasks: newSettings.prioritizeGrowthTasks === true,
        bagSeedPriority: newSettings.bagSeedPriority ?? [],
        bagSeedKnownIds: newSettings.bagSeedKnownIds ?? [],
        bagSeedExcludedIds: newSettings.bagSeedExcludedIds ?? [],
        bagSeedFallbackStrategy: newSettings.bagSeedFallbackStrategy ?? 'level',
        plantSeedPriority: newSettings.plantSeedPriority ?? [],
        autoAcceptFriendMinLevel: newSettings.autoAcceptFriendMinLevel ?? 0,
        autoCodeRefresh: newSettings.autoCodeRefresh,
        intervals: newSettings.intervals,
        friendQuietHours: newSettings.friendQuietHours,
        stealDelaySeconds: newSettings.stealDelaySeconds ?? 0,
        fertilizerBuyOrganicCount: newSettings.fertilizerBuyOrganicCount ?? 10,
        fertilizerBuyOrganicThresholdHours: newSettings.fertilizerBuyOrganicThresholdHours ?? 10,
        fertilizerBuyNormalCount: newSettings.fertilizerBuyNormalCount ?? 10,
        fertilizerBuyNormalThresholdHours: newSettings.fertilizerBuyNormalThresholdHours ?? 10,
        fertilizerBuyCheckIntervalMinutes: newSettings.fertilizerBuyCheckIntervalMinutes ?? 30,
        goldenBugKeepCount: newSettings.goldenBugKeepCount ?? 0,
        goldenBugRoundLimit: newSettings.goldenBugRoundLimit ?? 24,
      }

      await api.post('/api/settings/save', settingsPayload, {
        headers: { 'x-account-id': accountId },
      })

      if (newSettings.automation) {
        await api.post('/api/automation', newSettings.automation, {
          headers: { 'x-account-id': accountId },
        })
      }

      await fetchSettings(accountId)
      return { ok: true }
    }
    finally {
      loading.value = false
    }
  }

  async function saveOfflineConfig(config: OfflineConfigSavePayload) {
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder', config)
      if (data && data.ok) {
        settings.value.offlineReminder = normalizeOfflineReminder(config)
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }

  async function saveAutoCodeRefresh(accountId: string, config: AutoCodeRefreshConfig) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh', config, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok) {
        settings.value.autoCodeRefresh = {
          ...createDefaultAutoCodeRefresh(),
          ...(data.data?.autoCodeRefresh || config),
        }
        return { ok: true }
      }
      return { ok: false, error: data?.error || '保存失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
    finally {
      loading.value = false
    }
  }

  async function runAutoCodeRefresh(accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh/run', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok)
        return { ok: true }
      return { ok: false, error: data?.error || '刷新失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
  }

  return {
    settings,
    loading,
    clearSettingsState,
    fetchSettings,
    saveSettings,
    saveOfflineConfig,
    saveAutoCodeRefresh,
    runAutoCodeRefresh,
  }
})
