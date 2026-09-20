<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import StrategySettingsTab from '@/components/settings/StrategySettingsTab.vue'
import StrategyTimingPanel from '@/components/settings/StrategyTimingPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { CHARITY_FLOWER_ACTIVITY_WINDOW, isWithinActivityWindowMs, PET_DIARY_ACTIVITY_WINDOW, RAIN_POEM_ACTIVITY_WINDOW } from '@/constants/activity-windows'

type ModuleKey = 'planting' | 'fertilizer' | 'friends' | 'steal' | 'merchant' | 'activity'

const props = defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  plantingStrategyOptions: any[]
  bagFallbackStrategyOptions: any[]
  strategyPreviewLabel: string | null
  availableSeeds?: Array<{ seedId: number, name: string, requiredLevel: number, locked?: boolean, soldOut?: boolean }>
  fertilizerLandTypeOptions: any[]
  fertilizerOptions: any[]
}>()

const emit = defineEmits<{
  save: [module: ModuleKey, quiet?: boolean]
}>()

const strategy = defineModel<any>('strategy', { required: true })
const automation = defineModel<any>('automation', { required: true })
const activeModule = ref<ModuleKey | null>(null)
const editSnapshot = ref<{ strategy: any, automation: any } | null>(null)
const qixiFriends = ref<Array<{ gid: number, name: string }>>([])
const SHOW_STAR_ACTIVITY = false
const SHOW_QIXI_ACTIVITY = false
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof window.setInterval> | null = null
const showRainPoemActivity = computed(() => isWithinActivityWindowMs(RAIN_POEM_ACTIVITY_WINDOW, nowMs.value))
const showCharityFlowerActivity = computed(() => isWithinActivityWindowMs(CHARITY_FLOWER_ACTIVITY_WINDOW, nowMs.value))
const showPetDiaryActivity = computed(() => isWithinActivityWindowMs(PET_DIARY_ACTIVITY_WINDOW, nowMs.value))

const moduleInfo: Record<ModuleKey, { title: string, description: string, icon: string, image: string, tone: string }> = {
  planting: { title: '种植与收获', description: '选种、收获、出售和巡田节奏', icon: 'i-carbon-sprout', image: '/game-config/module_icons/planting.png', tone: 'emerald' },
  fertilizer: { title: '土地与施肥', description: '土地升级、施肥和化肥补充', icon: 'i-carbon-soil-moisture', image: '/game-config/module_icons/fertilizer.png', tone: 'amber' },
  friends: { title: '好友', description: '帮助、捣乱和好友申请', icon: 'i-carbon-user-multiple', image: '/game-config/module_icons/friends-friendship.png', tone: 'sky' },
  steal: { title: '偷菜', description: '巡查频率和操作延迟', icon: 'i-carbon-crop-health', image: '/game-config/module_icons/steal.png', tone: 'lime' },
  merchant: { title: '神秘商人', description: '商品购买和货币范围', icon: 'i-carbon-store', image: '/game-config/module_icons/merchant.png', tone: 'orange' },
  activity: { title: '日常与活动', description: '日常任务、活动奖励和活动道具', icon: 'i-carbon-events', image: '/game-config/module_icons/activity-task.png', tone: 'violet' },
}

const activeInfo = computed(() => activeModule.value ? moduleInfo[activeModule.value] : null)
const fertilizerName = computed(() => props.fertilizerOptions.find(item => item.value === automation.value.automation.fertilizer)?.label || '未设置')
const selectedLandNames = computed(() => props.fertilizerLandTypeOptions.filter(item => automation.value.automation.fertilizer_land_types?.includes(item.value)).map(item => item.label))
const selectedLandTypeCount = computed(() => Array.isArray(automation.value.automation.fertilizer_land_types) ? automation.value.automation.fertilizer_land_types.length : 0)
const activityKeys = computed(() => [
  ...(showRainPoemActivity.value
    ? ['rain_poem_bottle_buy', 'rain_poem_weather_collect', 'rain_poem_summon_use', 'rain_poem_prank_use', 'rain_poem_research_unlock']
    : []),
  ...(showCharityFlowerActivity.value
    ? ['charity_flower_share_claim', 'charity_flower_donate', 'charity_flower_reward_claim', 'charity_flower_public_fund_claim']
    : []),
  ...(showPetDiaryActivity.value
    ? ['pet_diary_adopt', 'pet_diary_feed', 'pet_diary_draw', 'pet_diary_story_claim', 'pet_diary_seed_claim', 'pet_diary_solar_claim', 'pet_diary_treasure_open', 'pet_diary_compensation_claim', 'pet_diary_charm_equip', 'pet_diary_battle']
    : []),
])
const activityEnabledCount = computed(() => activityKeys.value.filter(key => automation.value.automation[key]).length)
const starFestivalEnabled = computed(() => ['star_passport_claim', 'star_solar_claim', 'star_record_claim'].some(key => automation.value.automation[key]))
const qixiActivityEnabled = computed(() => ['qixi_dew_use', 'qixi_bridge_build', 'qixi_sachet_gift'].some(key => automation.value.automation[key]))
// 按活动分别判断。此前这里复用 activityKeys（含全部活动），只开公益或萌宠时
// 也会被标成「雨落成诗」，标签会失真。
const rainPoemActivityEnabled = computed(() => ['rain_poem_bottle_buy', 'rain_poem_weather_collect', 'rain_poem_summon_use', 'rain_poem_prank_use', 'rain_poem_research_unlock'].some(key => automation.value.automation[key]))
const charityFlowerActivityEnabled = computed(() => ['charity_flower_share_claim', 'charity_flower_donate', 'charity_flower_reward_claim', 'charity_flower_public_fund_claim'].some(key => automation.value.automation[key]))
const petDiaryActivityEnabled = computed(() => ['pet_diary_adopt', 'pet_diary_feed', 'pet_diary_draw', 'pet_diary_story_claim', 'pet_diary_seed_claim', 'pet_diary_solar_claim', 'pet_diary_treasure_open', 'pet_diary_compensation_claim', 'pet_diary_charm_equip', 'pet_diary_battle'].some(key => automation.value.automation[key]))

function intervalTag(min: number, max: number) {
  return `${min}-${max} 秒`
}

function moduleStateLabel(key: ModuleKey) {
  if (key === 'activity')
    return moduleEnabled(key) ? '已配置' : '未开启'
  return moduleEnabled(key) ? '已开启' : '已关闭'
}

function summaryTags(key: ModuleKey) {
  if (key === 'planting') {
    const primaryStrategy = strategy.value.plantingStrategy
    const hasFallback = primaryStrategy === 'bag_priority' || primaryStrategy === 'task_priority'
    const primaryLabel = props.plantingStrategyOptions.find(option => option.value === primaryStrategy)?.label
    return [
      ...(hasFallback ? [primaryLabel || '未设置策略'] : []),
      hasFallback ? `第二策略：${props.strategyPreviewLabel || '等待选种'}` : props.strategyPreviewLabel || '等待选种',
      automation.value.automation.sell ? '卖果实' : '不卖果实',
      strategy.value.prioritize2x2Crops ? '优先 2x2' : '常规占地',
      strategy.value.auto2x2SyncBuy ? '2×2同步买种' : '不买种填格',
      `巡田 ${intervalTag(strategy.value.intervals.farmMin, strategy.value.intervals.farmMax)}`,
    ]
  }
  if (key === 'fertilizer') {
    return [
      fertilizerName.value,
      selectedLandNames.value.join('、') || '未选土地',
      automation.value.automation.land_upgrade ? '升级土地' : '不升级',
      automation.value.automation.fertilizer_buy_organic || automation.value.automation.fertilizer_buy_normal ? '自动补肥' : '不补肥',
    ]
  }
  if (key === 'friends') {
    return [
      automation.value.automation.friend_help ? '帮助好友' : '不帮助',
      automation.value.automation.friend_auto_accept ? `自动通过 ${automation.value.autoAcceptFriendMinLevel || 0} 级+` : '不自动通过',
      strategy.value.friendQuietHours?.enabled ? '静默时段' : '无静默',
      `帮助 ${intervalTag(strategy.value.intervals.helpMin, strategy.value.intervals.helpMax)}`,
    ]
  }
  if (key === 'steal') {
    return [
      automation.value.automation.friend_steal ? '偷菜开启' : '偷菜关闭',
      '巡查节奏自动跟随好友作物成熟时间',
    ]
  }
  if (key === 'merchant') {
    const currencies = [
      automation.value.automation.mystery_shop_allow_gold && '金币',
      automation.value.automation.mystery_shop_allow_coupon && '点券',
      automation.value.automation.mystery_shop_allow_gold_bean && '金豆豆',
    ].filter(Boolean)
    return [
      automation.value.automation.mystery_shop_auto_buy ? '自动购买' : '未开启购买',
      currencies.join('、') || '未选货币',
    ]
  }
  return [
    automation.value.automation.task ? '自动完成日常任务' : '不做日常',
    SHOW_STAR_ACTIVITY && starFestivalEnabled.value && '心许千灯星垂野',
    SHOW_QIXI_ACTIVITY && qixiActivityEnabled.value && '鹊桥寄情',
    showRainPoemActivity.value && rainPoemActivityEnabled.value && '雨落成诗',
    showCharityFlowerActivity.value && charityFlowerActivityEnabled.value && '公益小红花',
    showPetDiaryActivity.value && petDiaryActivityEnabled.value && '萌宠成长日记',
    activityEnabledCount.value === 0 && !starFestivalEnabled.value
    && (!SHOW_QIXI_ACTIVITY || !qixiActivityEnabled.value) && '未开启活动',
  ].filter(Boolean)
}

function moduleEnabled(key: ModuleKey) {
  if (key === 'planting')
    return automation.value.automation.farm
  if (key === 'fertilizer')
    return automation.value.automation.fertilizer !== 'none' || automation.value.automation.land_upgrade
  if (key === 'friends')
    return automation.value.automation.friend
  if (key === 'steal')
    return automation.value.automation.friend && automation.value.automation.friend_steal
  if (key === 'merchant')
    return automation.value.automation.mystery_shop_auto_buy
  return activityEnabledCount.value > 0 || automation.value.automation.task
}

function setModuleEnabled(key: ModuleKey, enabled: boolean) {
  if (key === 'planting') {
    automation.value.automation.farm = enabled
  }
  else if (key === 'fertilizer') {
    automation.value.automation.fertilizer = enabled ? (automation.value.automation.fertilizer === 'none' ? 'normal' : automation.value.automation.fertilizer) : 'none'
  }
  else if (key === 'friends') {
    automation.value.automation.friend = enabled
  }
  else if (key === 'steal') {
    automation.value.automation.friend_steal = enabled
    if (enabled)
      automation.value.automation.friend = true
  }
  else if (key === 'merchant') {
    automation.value.automation.mystery_shop_auto_buy = enabled
  }
  else {
    automation.value.automation.task = enabled
    if (!enabled) {
      activityKeys.value.forEach((activityKey) => {
        automation.value.automation[activityKey] = false
      })
    }
  }
  emit('save', key, true)
}

function isFertilizerLandSelected(value: string | number) {
  return Array.isArray(automation.value.automation.fertilizer_land_types)
    && automation.value.automation.fertilizer_land_types.includes(value)
}

function toggleFertilizerLand(value: string | number) {
  const current = Array.isArray(automation.value.automation.fertilizer_land_types)
    ? automation.value.automation.fertilizer_land_types
    : []
  automation.value.automation.fertilizer_land_types = current.includes(value)
    ? current.filter((item: string | number) => item !== value)
    : [...current, value]
}

function qixiPriority() {
  return Array.isArray(automation.value.automation.qixi_friend_priority) ? automation.value.automation.qixi_friend_priority : []
}
function toggleQixiFriend(gid: number) {
  const list = qixiPriority()
  automation.value.automation.qixi_friend_priority = list.includes(gid) ? list.filter((id: number) => id !== gid) : [...list, gid]
}
function moveQixiFriend(index: number, direction: number) {
  const list = [...qixiPriority()]
  const target = index + direction
  if (target < 0 || target >= list.length) {
    return
  }
  const currentValue = list[index]
  list[index] = list[target]
  list[target] = currentValue
  automation.value.automation.qixi_friend_priority = list
}
function friendName(gid: number) {
  return qixiFriends.value.find(item => item.gid === gid)?.name || `好友 ${gid}`
}
async function loadQixiFriends() {
  if (!props.currentAccountId)
    return
  try {
    const { data } = await api.get('/api/activity/qixi', { headers: { 'x-account-id': props.currentAccountId } })
    qixiFriends.value = data?.friends || []
  }
  catch { qixiFriends.value = [] }
}
function finish() {
  if (!activeModule.value)
    return
  emit('save', activeModule.value, true)
  editSnapshot.value = null
  activeModule.value = null
}
function openModule(key: ModuleKey) {
  editSnapshot.value = {
    strategy: JSON.parse(JSON.stringify(strategy.value)),
    automation: JSON.parse(JSON.stringify(automation.value)),
  }
  activeModule.value = key
}
function cancel() {
  if (editSnapshot.value) {
    strategy.value = editSnapshot.value.strategy
    automation.value = editSnapshot.value.automation
  }
  editSnapshot.value = null
  activeModule.value = null
}
onMounted(() => {
  loadQixiFriends()
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 60000)
})
onUnmounted(() => {
  if (nowTimer)
    window.clearInterval(nowTimer)
})
watch(() => props.currentAccountId, loadQixiFriends)
</script>

<template>
  <div class="space-y-5">
    <div v-if="loading" class="py-12 text-center text-gray-500">
      <span class="i-svg-spinners-ring-resize mb-2 inline-block text-2xl" /><div>加载中...</div>
    </div>
    <div v-else-if="!currentAccountId" class="py-12 text-center text-gray-500">
      请先选择账号
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span class="text-gray-700 font-medium dark:text-gray-300">账号设置</span>
        <span class="h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        <span>{{ currentAccountName ? `正在配置：${currentAccountName}` : '请先在账号管理中选择账号' }}</span>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="(info, key) in moduleInfo"
          :key="key"
          class="group min-h-[184px] flex flex-col border border-gray-200 rounded-lg bg-white p-4 transition dark:border-gray-700 hover:border-[var(--theme-primary)] dark:bg-gray-800 hover:shadow-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex items-center gap-3">
              <img v-if="info.image" :src="info.image" alt="" class="h-10 w-10 shrink-0 rounded-lg bg-gray-100 object-contain p-1.5 dark:bg-gray-700">
              <span v-else class="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700" :class="info.icon" /><div>
                <h4 class="text-gray-900 font-semibold dark:text-gray-100">
                  {{ info.title }}
                </h4><p class="mt-0.5 text-xs text-gray-500">
                  {{ info.description }}
                </p>
              </div>
            </div>
            <BaseSwitch
              :model-value="moduleEnabled(key as ModuleKey)"
              :disabled="saving"
              @update:model-value="setModuleEnabled(key as ModuleKey, !!$event)"
            />
          </div>

          <div class="mt-4 min-h-[56px] flex flex-wrap content-start gap-2">
            <span
              v-for="tag in summaryTags(key as ModuleKey)"
              :key="tag"
              class="max-w-full truncate rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
            >
              {{ tag }}
            </span>
          </div>

          <div class="mt-auto flex items-center justify-between pt-4">
            <span class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span class="h-2 w-2 rounded-full" :class="moduleEnabled(key as ModuleKey) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
              {{ moduleStateLabel(key as ModuleKey) }}
            </span>
            <BaseButton variant="secondary" size="sm" @click="openModule(key as ModuleKey)">
              配置
            </BaseButton>
          </div>
        </article>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="activeModule && activeInfo" class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-gray-950/45 p-3 backdrop-blur-[2px] sm:p-6" @click.self="cancel">
        <section class="max-h-[94vh] max-w-4xl w-full flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
          <header class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-700 sm:px-6">
            <div class="min-w-0 flex items-start gap-3">
              <img v-if="activeInfo.image" :src="activeInfo.image" alt="" class="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-contain p-1.5 dark:bg-gray-700">
              <span v-else class="inline-grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700" :class="activeInfo.icon" />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-lg text-gray-900 font-semibold dark:text-gray-100">
                    {{ activeInfo.title }}
                  </h3>
                  <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {{ moduleStateLabel(activeModule as ModuleKey) }}
                  </span>
                </div>
                <p class="mt-1 text-sm text-gray-500">
                  {{ activeInfo.description }}
                </p>
              </div>
            </div>
            <button class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" @click="cancel">
              <span class="i-carbon-close text-xl" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div class="mb-5 flex flex-wrap gap-2">
              <span
                v-for="tag in summaryTags(activeModule as ModuleKey)"
                :key="tag"
                class="max-w-full truncate rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
              >
                {{ tag }}
              </span>
            </div>

            <div v-if="activeModule === 'planting'" class="space-y-4">
              <section class="border border-gray-100 rounded-lg bg-gray-50/70 p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900/25">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  基础功能
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="strategy.prioritize2x2Crops" label="优先种植 2×2 作物" />
                  <BaseSwitch v-model="strategy.auto2x2SyncBuy" label="2×2 同步填格（可自动买种）" />
                  <BaseSwitch v-model="automation.automation.sell" label="卖果实" />
                  <BaseSwitch v-model="automation.automation.golden_bug_clear" label="祛除黄金虫" />
                  <BaseSwitch v-model="automation.automation.farm_push" label="推送触发巡田" />
                  <BaseSwitch v-model="automation.automation.skip_own_weed_bug" label="保留自己农场的草虫" />
                </div>
                <p v-if="strategy.auto2x2SyncBuy" class="text-xs text-amber-600 dark:text-amber-400">
                  预留 2×2 区有空格时，会种生长时长最接近「该区最晚成熟时间」的 1×1 作物；背包没有合适的会自动购买（每日最多 30 次，仅用金币）。
                </p>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 dark:border-gray-700">
                <StrategySettingsTab
                  v-model:settings="strategy"
                  :current-account-name="null"
                  :current-account-id="currentAccountId"
                  :loading="false"
                  :saving="saving"
                  :show-actions="false"
                  timing-section="planting"
                  title="选种策略与巡田频率"
                  :planting-strategy-options="plantingStrategyOptions"
                  :bag-fallback-strategy-options="bagFallbackStrategyOptions"
                  :strategy-preview-label="strategyPreviewLabel"
                  :available-seeds="availableSeeds"
                />
              </section>
            </div>

            <div v-else-if="activeModule === 'fertilizer'" class="space-y-5">
              <section class="border border-gray-100 rounded-lg bg-gray-50/70 p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900/25">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  基础功能
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.land_upgrade" label="升级土地" />
                  <BaseSwitch v-model="automation.automation.fertilizer_gift" label="填充化肥" />
                  <BaseSwitch v-model="automation.automation.fertilizer_buy_organic" label="购买有机肥" />
                  <BaseSwitch v-model="automation.automation.fertilizer_buy_normal" label="购买无机肥" />
                </div>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="flex items-center justify-between gap-3">
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    施肥范围
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    已选 {{ selectedLandTypeCount }}/{{ fertilizerLandTypeOptions.length }}
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-2 lg:grid-cols-5">
                  <button
                    v-for="option in fertilizerLandTypeOptions"
                    :key="option.value"
                    type="button"
                    class="min-h-11 flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-left text-sm transition"
                    :class="isFertilizerLandSelected(option.value)
                      ? 'border-[var(--theme-primary)] bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] text-gray-900 shadow-sm dark:text-gray-100'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-700/60'"
                    @click="toggleFertilizerLand(option.value)"
                  >
                    <span class="truncate font-medium">{{ option.label }}</span>
                    <span
                      class="grid h-5 w-5 shrink-0 place-items-center border rounded-full text-xs transition"
                      :class="isFertilizerLandSelected(option.value)
                        ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white'
                        : 'border-gray-300 text-transparent dark:border-gray-600'"
                    >
                      <span class="i-carbon-checkmark text-sm" />
                    </span>
                  </button>
                </div>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSelect v-model="automation.automation.fertilizer" label="施肥策略" :options="fertilizerOptions" />
                  <BaseInput v-if="['smart', 'smart_only', 'smart_normal'].includes(automation.automation.fertilizer)" v-model.number="automation.automation.fertilizer_smart_seconds" label="快成熟判定秒数" type="number" min="30" max="3600" />
                </div>
                <BaseSwitch v-model="automation.automation.fertilizer_multi_season" label="多季补肥" />
              </section>

              <section v-if="automation.automation.fertilizer_buy_organic || automation.automation.fertilizer_buy_normal" class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm font-medium">
                  自动补肥参数
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseInput v-if="automation.automation.fertilizer_buy_organic" v-model.number="automation.fertilizerBuyOrganicCount" label="有机肥购买数量" type="number" min="1" />
                  <BaseInput v-if="automation.automation.fertilizer_buy_organic" v-model.number="automation.fertilizerBuyOrganicThresholdHours" label="有机肥触发阈值（小时）" type="number" min="1" />
                  <BaseInput v-if="automation.automation.fertilizer_buy_normal" v-model.number="automation.fertilizerBuyNormalCount" label="无机肥购买数量" type="number" min="1" />
                  <BaseInput v-if="automation.automation.fertilizer_buy_normal" v-model.number="automation.fertilizerBuyNormalThresholdHours" label="无机肥触发阈值（小时）" type="number" min="1" />
                  <BaseInput v-model.number="automation.fertilizerBuyCheckIntervalMinutes" label="检测间隔（分钟）" type="number" min="1" />
                </div>
              </section>
            </div>

            <div v-else-if="activeModule === 'friends'" class="space-y-5">
              <section class="border border-gray-100 rounded-lg bg-gray-50/70 p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900/25">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  好友互动
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.friend_help" label="帮助好友" />
                  <BaseSwitch v-model="automation.automation.friend_bad" label="好友捣乱" />
                  <BaseSwitch v-model="automation.automation.friend_golden_bug" label="放黄金虫" />
                  <BaseSwitch v-model="automation.automation.friend_help_exp_limit" label="经验满只帮护主犬" />
                </div>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  好友申请
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.friend_auto_accept" label="自动通过好友申请" />
                  <BaseInput v-if="automation.automation.friend_auto_accept" v-model.number="automation.autoAcceptFriendMinLevel" label="自动通过好友最低等级" type="number" min="0" max="200" />
                </div>
              </section>

              <section v-if="automation.automation.friend_golden_bug" class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  黄金虫策略
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseInput v-model.number="automation.goldenBugKeepCount" label="黄金虫保留数量" type="number" min="0" />
                  <BaseInput v-model.number="automation.goldenBugRoundLimit" label="黄金虫单轮上限" type="number" min="1" />
                </div>
              </section>

              <section class="border border-gray-100 rounded-lg p-4 dark:border-gray-700">
                <StrategyTimingPanel v-model:settings="strategy" section="friends" />
              </section>
            </div>
            <div v-else-if="activeModule === 'steal'" class="space-y-5">
              <section class="border border-gray-100 rounded-lg bg-gray-50/70 p-4 space-y-2 dark:border-gray-700 dark:bg-gray-900/25">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  巡查节奏说明
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  偷菜巡查不再使用固定的巡查间隔或延迟设置。系统会根据已知好友农场的作物成熟时间动态计算下一次巡查的时机，成熟越近巡查越勤，避免固定间隔造成的空跑或错过窗口。开启右上角的开关即可自动运行。
                </p>
              </section>
            </div>

            <div v-else-if="activeModule === 'merchant'" class="space-y-4">
              <section class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div>
                  <div class="mb-2 text-sm text-gray-700 font-medium dark:text-gray-300">
                    允许使用的货币
                  </div>
                  <div class="grid gap-3 sm:grid-cols-3">
                    <BaseSwitch v-model="automation.automation.mystery_shop_allow_gold" label="金币" />
                    <BaseSwitch v-model="automation.automation.mystery_shop_allow_coupon" label="点券" />
                    <BaseSwitch v-model="automation.automation.mystery_shop_allow_gold_bean" label="金豆豆" />
                  </div>
                </div>
              </section>
            </div>

            <div v-else class="space-y-4">
              <section class="border border-gray-100 rounded-lg bg-gray-50/70 p-4 space-y-3 dark:border-gray-700 dark:bg-gray-900/25">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  日常任务
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.task" label="自动完成日常任务" />
                </div>
              </section>

              <section v-if="SHOW_STAR_ACTIVITY" class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div>
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    心许千灯星垂野
                  </div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    千星游记与观星礼录领取
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.star_passport_claim" label="领取千星游记" />
                  <BaseSwitch v-model="automation.automation.star_solar_claim" label="领取节令小札" />
                  <BaseSwitch v-model="automation.automation.star_record_claim" label="领取观星礼录" />
                </div>
              </section>

              <section v-if="SHOW_QIXI_ACTIVITY" class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div>
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    鹊桥寄情
                  </div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    灵露、鹊桥与香囊赠送
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.qixi_dew_use" label="使用鹊羽灵露" />
                  <BaseSwitch v-model="automation.automation.qixi_bridge_build" label="驻建鹊桥" />
                  <BaseSwitch v-model="automation.automation.qixi_sachet_gift" label="赠送鹊羽香囊" />
                </div>

                <div v-if="automation.automation.qixi_sachet_gift" class="border-t border-gray-100 pt-3 space-y-3 dark:border-gray-700">
                  <div class="text-sm font-medium">
                    香囊好友优先级
                  </div>
                  <div v-for="(gid, index) in qixiPriority()" :key="gid" class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40">
                    <span class="w-6 text-gray-400">{{ Number(index) + 1 }}</span>
                    <span class="flex-1">{{ friendName(Number(gid)) }}</span>
                    <button :disabled="Number(index) === 0" @click="moveQixiFriend(Number(index), -1)">
                      ↑
                    </button>
                    <button :disabled="Number(index) === qixiPriority().length - 1" @click="moveQixiFriend(Number(index), 1)">
                      ↓
                    </button>
                    <button class="text-red-500" @click="toggleQixiFriend(Number(gid))">
                      ×
                    </button>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button v-for="friend in qixiFriends.filter(item => !qixiPriority().includes(item.gid))" :key="friend.gid" class="border rounded-full px-3 py-1.5 text-xs" @click="toggleQixiFriend(friend.gid)">
                      + {{ friend.name }}
                    </button>
                  </div>
                </div>
              </section>

              <section v-if="showRainPoemActivity" class="border border-gray-100 rounded-lg p-4 space-y-3 dark:border-gray-700">
                <div>
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    雨落成诗
                  </div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    天气采集、雷雨召唤与气象研究
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.rain_poem_bottle_buy" label="购买天气采集瓶" />
                  <BaseSwitch v-model="automation.automation.rain_poem_weather_collect" label="采集好友雷雨" />
                  <BaseSwitch v-model="automation.automation.rain_poem_summon_use" label="使用雷雨召唤瓶" />
                  <BaseSwitch v-model="automation.automation.rain_poem_prank_use" label="使用青蛙与乌云使坏瓶" />
                  <BaseSwitch v-model="automation.automation.rain_poem_research_unlock" label="解锁气象研究" />
                </div>
              </section>

              <section v-if="showCharityFlowerActivity" class="border border-rose-100 rounded-lg p-4 space-y-3 dark:border-rose-900/40">
                <div>
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    公益小红花
                  </div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    分享奖励、爱心捐赠、档位奖励与公益金
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.charity_flower_share_claim" label="领取每日分享奖励" />
                  <BaseSwitch v-model="automation.automation.charity_flower_donate" label="送出全部爱心" />
                  <BaseSwitch v-model="automation.automation.charity_flower_reward_claim" label="领取爱心档位奖励" />
                  <BaseSwitch v-model="automation.automation.charity_flower_public_fund_claim" label="领取并送出 1 元公益金" />
                </div>
                <p class="text-xs text-amber-600 dark:text-amber-400">
                  该开关会执行真实的 1 元公益助力，每个角色活动期仅一次；仅在官方状态可领取且账号已同意腾讯公益平台协议时执行。
                </p>
              </section>

              <section v-if="showPetDiaryActivity" class="border border-violet-100 rounded-lg p-4 space-y-3 dark:border-violet-900/40">
                <div>
                  <div class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    萌宠成长日记
                  </div>
                  <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    比熊养成、爪印手记、宝藏护送与节令赠礼
                  </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <BaseSwitch v-model="automation.automation.pet_diary_adopt" label="领养并领取比熊" />
                  <BaseSwitch v-model="automation.automation.pet_diary_feed" label="自动投喂（每日 16 次）" />
                  <BaseSwitch v-model="automation.automation.pet_diary_draw" label="自动寻宝（每日 10 次）" />
                  <BaseSwitch v-model="automation.automation.pet_diary_story_claim" label="领取爪印手记奖励" />
                  <BaseSwitch v-model="automation.automation.pet_diary_seed_claim" label="领取活动种子礼包" />
                  <BaseSwitch v-model="automation.automation.pet_diary_solar_claim" label="领取节令赠礼" />
                  <BaseSwitch v-model="automation.automation.pet_diary_treasure_open" label="护送完成后开启宝藏" />
                  <BaseSwitch v-model="automation.automation.pet_diary_compensation_claim" label="领取夺宝补偿" />
                  <BaseSwitch v-model="automation.automation.pet_diary_battle" label="自动好友夺宝" />
                  <BaseSwitch v-model="automation.automation.pet_diary_charm_equip" label="自动选择锦囊（含免费刷新）" />
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  投喂与寻宝消耗萌宠元气糕，元气糕来自收获活动作物，元气糕不足时自动跳过。锦囊只使用每日免费刷新额度，不消耗点券或钻石。
                </p>
                <p class="text-xs text-amber-600 dark:text-amber-400">
                  自动夺宝轮转检查好友并跳过好友黑名单，按初级、中级、高级顺序使用宝藏允许的已有挑战书，不自动购买。拾物小铺兑换仍需手动选择商品。
                </p>
              </section>
            </div>
          </div>
          <footer class="flex justify-end gap-2 border-t bg-gray-50/70 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/20 sm:px-6">
            <BaseButton variant="secondary" size="sm" @click="cancel">
              取消
            </BaseButton>
            <BaseButton size="sm" :loading="saving" @click="finish">
              保存并关闭
            </BaseButton>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>
