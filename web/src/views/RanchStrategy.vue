<script setup lang="ts">
import type { RanchFeedStage } from '@/utils/ranch'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import RanchCubPriority from '@/components/settings/RanchCubPriority.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import {
  isRanchFeedStage,
  RANCH_AUTOMATION_DEFAULTS,
  RANCH_AUTOMATION_GROUPS,
  RANCH_AUTOMATION_LIMITS,
  RANCH_AUTOMATION_SWITCHES,
  RANCH_BAG_FALLBACK_OPTIONS,
  RANCH_FEED_STAGE_HINTS,
  RANCH_FEED_STAGE_OPTIONS,
  RANCH_STRATEGY_OPTIONS,
  ranchUsesPreferredAnimal,
} from '@/utils/ranch'

/**
 * 牧场策略独立页。
 *
 * 上游把这份配置从设置页搬出来单独成页，本项目沿用同一思路，但按本项目的
 * 组件体系与「单套路由 + 场景开关」结构实现，不引入上游的 Naive UI。
 *
 * 保存只提交 ranch_ 前缀的 automation 字段：后端 /api/automation 是逐键写入，
 * 提交整份 automation 会把农场配置一并覆盖，这里必须收窄范围。
 */
const accountStore = useAccountStore()
const settingStore = useSettingStore()
const ranchStore = useRanchStore()
const toast = useToastStore()
const statusStore = useStatusStore()
const { currentAccountId } = storeToRefs(accountStore)
const { settings, loading } = storeToRefs(settingStore)
const { status, currentStatusReady } = storeToRefs(statusStore)

/** 幼崽优先级组件要读实时背包，只有账号在线才拉取；离线时保留已保存顺序。 */
const connected = computed(() => currentStatusReady.value && status.value?.connection?.connected === true)

const automation = ref<Record<string, any>>({})
const saving = ref(false)
const error = ref('')
let loadGeneration = 0

/** 时机说明随选择变化：只给选项名，用户没法判断哪种更省罐头。 */
const feedStageHints = computed(() => {
  const hint = (value: unknown, fallback: RanchFeedStage) => (isRanchFeedStage(value) ? RANCH_FEED_STAGE_HINTS[value] : RANCH_FEED_STAGE_HINTS[fallback])
  return {
    normal: hint(automation.value.ranch_feed_normal_stage, 'longest'),
    organic: hint(automation.value.ranch_feed_organic_stage, 'near_harvest'),
  }
})

const feedStageVisible = computed(() => automation.value.ranch_feed_normal === true || automation.value.ranch_feed_organic === true)

const ready = computed(() => !!currentAccountId.value && !!automation.value && Object.keys(automation.value).length > 0)

const switchGroups = computed(() => RANCH_AUTOMATION_GROUPS.map(group => ({
  ...group,
  items: RANCH_AUTOMATION_SWITCHES.filter(item => item.group === group.key),
})).map(group => ({
  ...group,
  allOn: group.items.length > 0 && group.items.every(item => automation.value[item.key] === true),
})))

const enabledCount = computed(() => RANCH_AUTOMATION_SWITCHES.filter(item => automation.value[item.key] === true).length)

const needsPreferredAnimal = computed(() => ranchUsesPreferredAnimal(
  automation.value.ranch_strategy,
  automation.value.ranch_bag_fallback,
))

function animalOptions(kind: string) {
  return [
    { label: '不指定', value: 0 },
    ...ranchStore.animalOptions.filter(item => item.kind === kind).map(item => ({ label: item.label, value: item.value })),
  ]
}

const coopOptions = computed(() => animalOptions('窝'))
const shedOptions = computed(() => animalOptions('棚'))

function errorMessage(cause: any, fallback: string) {
  return cause?.response?.data?.error || cause?.message || fallback
}

function applySettings() {
  const next = { ...((settings.value as any)?.automation || {}) }
  // 服务端尚未下发阈值字段时补默认值，避免输入框空白、保存时提交 undefined 被后端校验拒绝。
  if (typeof next.ranch_grass_threshold_percent !== 'number')
    next.ranch_grass_threshold_percent = RANCH_AUTOMATION_DEFAULTS.ranch_grass_threshold_percent
  // 罐头时机是后加的字符串枚举，旧账号没有这两个键，补默认值避免选择器空白。
  for (const key of ['ranch_feed_normal_stage', 'ranch_feed_organic_stage'] as const) {
    if (!isRanchFeedStage(next[key]))
      next[key] = RANCH_AUTOMATION_DEFAULTS[key]
  }
  // 幼崽优先顺序是数组，且旧账号配置里没有这两个键；补空数组避免子组件拿到 undefined。
  for (const key of ['ranch_coop_cub_priority', 'ranch_shed_cub_priority'] as const) {
    if (!Array.isArray(next[key]))
      next[key] = [...RANCH_AUTOMATION_DEFAULTS[key]]
  }
  automation.value = next
}

async function load() {
  const accountId = currentAccountId.value
  const generation = ++loadGeneration
  error.value = ''
  if (!accountId)
    return
  try {
    await settingStore.fetchSettings(String(accountId))
    if (generation !== loadGeneration || accountId !== currentAccountId.value)
      return
    applySettings()
    if (ranchStore.animalOptions.length === 0)
      void ranchStore.fetchAutomationOptions()
  }
  catch (cause: any) {
    if (generation !== loadGeneration)
      return
    error.value = errorMessage(cause, '牧场策略读取失败')
  }
}

/** 整组开关复用设置页的行为：关闭清空，开启只恢复服务端默认开启的项。 */
function setGroup(group: { items: ReadonlyArray<{ key: string }> }, enabled: boolean) {
  group.items.forEach((item) => {
    automation.value[item.key] = enabled ? (RANCH_AUTOMATION_DEFAULTS as Record<string, any>)[item.key] === true : false
  })
}

function ranchOnlyAutomation() {
  return Object.fromEntries(Object.entries(automation.value).filter(([key]) => key.startsWith('ranch_')))
}

async function save() {
  const accountId = currentAccountId.value
  if (!accountId || saving.value || !ready.value)
    return
  saving.value = true
  error.value = ''
  try {
    const result = await settingStore.saveSettings(String(accountId), { automation: ranchOnlyAutomation() })
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    applySettings()
    toast.success('牧场策略已保存')
  }
  catch (cause: any) {
    error.value = errorMessage(cause, '牧场策略保存失败')
    toast.error(error.value)
  }
  finally {
    saving.value = false
  }
}

watch(currentAccountId, () => {
  automation.value = {}
  void load()
}, { immediate: true })

watch(settings, () => {
  if (ready.value && !saving.value)
    applySettings()
})
</script>

<template>
  <div class="h-full flex flex-col overflow-y-auto p-4">
    <div class="mx-auto max-w-5xl w-full space-y-4">
      <div class="ui-card flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
        <div class="i-carbon-settings-adjust shrink-0 text-xl" :style="{ color: 'var(--theme-primary)' }" />
        <div class="min-w-0 flex-1">
          <h1 class="text-lg text-gray-900 font-bold dark:text-gray-100">
            牧场策略
          </h1>
          <p class="text-xs" :style="{ color: 'var(--muted-text)' }">
            栏舍养殖、牧草罐头、集市兑换、好友牧场与每日奖励的自动化开关
          </p>
        </div>
        <span class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          已开启 {{ enabledCount }}/{{ RANCH_AUTOMATION_SWITCHES.length }} 项
        </span>
        <BaseButton variant="primary" size="sm" :loading="saving" :disabled="saving || !ready" @click="save">
          保存策略
        </BaseButton>
      </div>

      <p v-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300" role="alert">
        {{ error }}
      </p>

      <div v-if="!currentAccountId" class="ui-subtle-panel rounded-xl px-4 py-12 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
        请先在左侧选择账号后再配置牧场策略。
      </div>
      <div v-else-if="loading && !ready" class="ui-subtle-panel rounded-xl px-4 py-12 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
        正在读取牧场策略…
      </div>

      <template v-else-if="ready">
        <section class="ui-card rounded-xl p-4">
          <h2 class="mb-3 text-sm text-gray-800 font-semibold dark:text-gray-200">
            巡查节奏
          </h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <BaseInput
              v-model.number="automation.ranch_check_minutes"
              label="牧场巡查间隔（分钟）"
              type="number"
              :min="RANCH_AUTOMATION_LIMITS.checkMinutes.min"
              :max="RANCH_AUTOMATION_LIMITS.checkMinutes.max"
            />
            <BaseInput
              v-model.number="automation.ranch_grass_threshold_percent"
              label="牧草余量低于（%）时补满"
              type="number"
              :min="RANCH_AUTOMATION_LIMITS.grassThresholdPercent.min"
              :max="RANCH_AUTOMATION_LIMITS.grassThresholdPercent.max"
              :disabled="!automation.ranch_grass"
            />
          </div>
          <p class="mt-2 text-xs" :style="{ color: 'var(--muted-text)' }">
            巡查间隔只接受 1–60 的整数分钟，动物成熟或设施升级更早完成时后台会提前唤醒。牧草阈值只接受 1–100 的整数百分比，装满该比例以下才补满，需先开启「自动补充牧草」。
          </p>
        </section>

        <!-- 罐头使用时机：桶内时长等价，挑对阶段才不会把时长浪费在会被重置的窗口上。 -->
        <section v-if="feedStageVisible" class="ui-card rounded-xl p-4">
          <h2 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
            罐头使用时机
          </h2>
          <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
            两种罐头各自按自己的时机筛动物，互不影响；没有动物符合条件时整轮跳过并记录原因。
          </p>
          <div class="grid mt-3 gap-4 sm:grid-cols-2">
            <div v-if="automation.ranch_feed_normal === true">
              <BaseSelect
                v-model="automation.ranch_feed_normal_stage"
                label="普通罐头使用时机"
                :options="RANCH_FEED_STAGE_OPTIONS"
              />
              <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
                {{ feedStageHints.normal }}
              </p>
            </div>
            <div v-if="automation.ranch_feed_organic === true">
              <BaseSelect
                v-model="automation.ranch_feed_organic_stage"
                label="有机罐头使用时机"
                :options="RANCH_FEED_STAGE_OPTIONS"
              />
              <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
                {{ feedStageHints.organic }}
              </p>
            </div>
          </div>
        </section>

        <section v-for="group in switchGroups" :key="group.key" class="ui-card rounded-xl p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
                {{ group.title }}
              </h2>
              <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
                {{ group.detail }}
              </p>
            </div>
            <BaseSwitch
              :aria-label="`一键${group.allOn ? '关闭' : '开启'}${group.title}`"
              :model-value="group.allOn"
              :disabled="saving"
              @update:model-value="setGroup(group, !!$event)"
            />
          </div>

          <div class="grid grid-cols-1 mt-3 gap-3 lg:grid-cols-2">
            <div
              v-for="item in group.items"
              :key="item.key"
              class="ui-subtle-panel min-w-0 flex items-center justify-between gap-4 rounded-lg px-3 py-2.5"
            >
              <div class="min-w-0">
                <label class="text-sm text-gray-800 font-medium leading-5 dark:text-gray-200" :for="`ranch-strategy-${item.key}`">
                  {{ item.label }}
                </label>
                <p class="mt-1 text-xs leading-5" :style="{ color: 'var(--muted-text)' }">
                  {{ item.desc }}
                </p>
              </div>
              <BaseSwitch
                v-model="automation[item.key]"
                class="shrink-0"
                :aria-label="item.label"
              />
            </div>
          </div>

          <p v-if="group.key === 'friend'" class="mt-3 text-xs text-amber-600 dark:text-amber-400">
            这些动作会真实进入好友牧场并在对方牧场内操作，抚摸与放蚊子受每日次数限制；后端每轮巡查最多拜访三位好友。
          </p>
        </section>

        <section v-if="automation.ranch_buy === true" class="ui-card rounded-xl p-4">
          <h2 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
            补栏策略
          </h2>
          <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
            仅在「自动购买幼崽」开启时参与选品；背包已有的幼崽先放养，缺额才按策略在商店购买。
          </p>
          <div class="grid mt-3 gap-3 sm:grid-cols-2">
            <BaseSelect v-model="automation.ranch_strategy" label="养殖策略" :options="RANCH_STRATEGY_OPTIONS" />
            <BaseSelect
              v-if="automation.ranch_strategy === 'bag_priority'"
              v-model="automation.ranch_bag_fallback"
              label="背包缺货时回退"
              :options="RANCH_BAG_FALLBACK_OPTIONS"
            />
          </div>
          <div v-if="needsPreferredAnimal" class="grid mt-3 gap-3 sm:grid-cols-2">
            <BaseSelect
              v-model="automation.ranch_coop_animal"
              label="窝指定动物"
              :options="coopOptions"
              :disabled="ranchStore.animalOptionsLoading"
            />
            <BaseSelect
              v-model="automation.ranch_shed_animal"
              label="棚指定动物"
              :options="shedOptions"
              :disabled="ranchStore.animalOptionsLoading"
            />
          </div>
          <!-- 动物清单是整个设置页唯一依赖在线接口的选项，失败时必须能就地重试。 -->
          <p v-if="needsPreferredAnimal && ranchStore.animalOptionsLoading" class="mt-3 text-xs" :style="{ color: 'var(--muted-text)' }">
            正在读取可养动物清单…
          </p>
          <div v-else-if="needsPreferredAnimal && ranchStore.animalOptionsError" class="mt-3 flex flex-wrap items-center gap-2">
            <p class="text-xs text-amber-600 dark:text-amber-400">
              动物清单未加载成功（{{ ranchStore.animalOptionsError }}），当前只能保留「不指定」；保存时后端仍会按官方配置校验窝与棚的适用范围。
            </p>
            <BaseButton variant="secondary" size="sm" @click="ranchStore.fetchAutomationOptions()">
              重试
            </BaseButton>
          </div>
          <!-- 只在背包优先策略下有意义：此时放养顺序由这份清单决定，其它策略按等级或指定动物选品。 -->
          <div v-if="automation.ranch_strategy === 'bag_priority'" class="ui-subtle-panel mt-3 rounded-lg p-3">
            <RanchCubPriority v-model="automation" :account-id="String(currentAccountId || '')" :connected="connected" />
          </div>
          <p class="mt-3 text-xs" :style="{ color: 'var(--muted-text)' }">
            补栏、升级与购买牧草只花费金券；报价里出现其他消耗品时后端会跳过本次操作，不会产生钻石消费。
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
