<script setup lang="ts">
import BagSeedPriority from '@/components/settings/BagSeedPriority.vue'
import StrategyTimingPanel from '@/components/settings/StrategyTimingPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

interface SelectOption<T = string | number> {
  label: string
  value: T
  disabled?: boolean
}

interface StrategySettings {
  plantingStrategy: string
  prioritize2x2Crops: boolean
  prioritizeGrowthTasks: boolean
  bagSeedPriority: number[]
  bagSeedFallbackStrategy: string
  intervals: {
    farmMin: number
    farmMax: number
    helpMin: number
    helpMax: number
  }
  friendQuietHours: {
    enabled: boolean
    start: string
    end: string
  }
}

withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  plantingStrategyOptions: SelectOption[]
  bagFallbackStrategyOptions: SelectOption[]
  strategyPreviewLabel: string | null
  title?: string
  saveLabel?: string
  showActions?: boolean
  timingSection?: 'all' | 'planting' | 'friends'
}>(), {
  title: '策略设置',
  saveLabel: '保存策略设置',
  showActions: true,
  timingSection: 'all',
})

const emit = defineEmits<{
  save: []
}>()

const settings = defineModel<StrategySettings>('settings', { required: true })

function selectPlantingStrategy(value: string | number | undefined) {
  if (value === undefined)
    return
  const strategy = String(value)
  settings.value.plantingStrategy = strategy
  settings.value.prioritizeGrowthTasks = strategy === 'task_priority'
}

function selectBagFallbackStrategy(value: string | number) {
  settings.value.bagSeedFallbackStrategy = String(value)
}

function isBagFallbackStrategySelected(value: string | number) {
  return settings.value.bagSeedFallbackStrategy === value
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
        <div class="i-fas-cog text-lg" />
        {{ title }}
        <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
          ({{ currentAccountName }})
        </span>
      </h3>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!currentAccountId" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings-adjust mx-auto mb-2 text-3xl text-gray-400" />
      <p>请先选择账号</p>
    </div>

    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseSelect
          v-model="settings.plantingStrategy"
          label="种植策略"
          :options="plantingStrategyOptions"
          @update:model-value="selectPlantingStrategy"
        />
        <div class="flex flex-col gap-1.5">
          <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
            {{ ['bag_priority', 'task_priority'].includes(settings.plantingStrategy) ? '第二优先策略预览' : '策略选种预览' }}
          </label>
          <div
            class="w-full flex items-center justify-between border border-gray-200 rounded-lg border-dashed bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
            title="根据当前策略自动匹配，仅供预览"
          >
            <span class="truncate">{{ strategyPreviewLabel ?? '加载中...' }}</span>
            <div class="i-carbon-information shrink-0 text-base text-gray-400" />
          </div>
        </div>
      </div>

      <BagSeedPriority v-if="settings.plantingStrategy === 'bag_priority'" :key="currentAccountId" v-model="settings.bagSeedPriority" :account-id="currentAccountId" />

      <div v-if="['bag_priority', 'task_priority'].includes(settings.plantingStrategy)" class="flex flex-col gap-2">
        <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
          第二优先策略
        </label>
        <div class="grid grid-cols-1 gap-2 lg:grid-cols-3 sm:grid-cols-2">
          <button
            v-for="option in bagFallbackStrategyOptions"
            :key="option.value"
            type="button"
            class="min-h-11 flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-left text-sm transition"
            :class="isBagFallbackStrategySelected(option.value)
              ? 'border-[var(--theme-primary)] bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] text-gray-900 shadow-sm dark:text-gray-100'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-700/60'"
            :aria-pressed="isBagFallbackStrategySelected(option.value)"
            @click="selectBagFallbackStrategy(option.value)"
          >
            <span class="min-w-0 break-words font-medium leading-5">{{ option.label }}</span>
            <span
              class="grid h-5 w-5 shrink-0 place-items-center border rounded-full text-xs transition"
              :class="isBagFallbackStrategySelected(option.value)
                ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white'
                : 'border-gray-300 text-transparent dark:border-gray-600'"
            >
              <span class="i-carbon-checkmark text-sm" />
            </span>
          </button>
        </div>
      </div>

      <StrategyTimingPanel v-model:settings="settings" :section="timingSection" />

      <div v-if="showActions" class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          {{ saveLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
