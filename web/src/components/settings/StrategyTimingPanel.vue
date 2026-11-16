<script setup lang="ts">
import { computed } from 'vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface StrategyTimingSettings {
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

withDefaults(defineProps<{ section?: 'all' | 'planting' | 'friends' }>(), { section: 'all' })
const settings = defineModel<StrategyTimingSettings>('settings', { required: true })
type IntervalKey = keyof StrategyTimingSettings['intervals']

function intervalModel(key: IntervalKey) {
  return computed({
    get: () => settings.value.intervals[key],
    set: (value: number | string) => {
      const parsed = Number.parseInt(String(value), 10)
      settings.value = {
        ...settings.value,
        intervals: {
          ...settings.value.intervals,
          [key]: Number.isFinite(parsed) ? parsed : 1,
        },
      }
    },
  })
}

const farmMin = intervalModel('farmMin')
const farmMax = intervalModel('farmMax')
const helpMin = intervalModel('helpMin')
const helpMax = intervalModel('helpMax')
</script>

<template>
  <div class="space-y-3">
    <div v-if="section === 'all' || section === 'planting'" class="grid grid-cols-2 gap-3 md:grid-cols-2">
      <BaseInput
        v-model.number="farmMin"
        label="农场巡查最小 (秒)"
        type="number"
        min="1"
      />
      <BaseInput
        v-model.number="farmMax"
        label="农场巡查最大 (秒)"
        type="number"
        min="1"
      />
    </div>

    <div v-if="section === 'all' || section === 'friends'" class="grid grid-cols-2 gap-3 md:grid-cols-2">
      <BaseInput
        v-model.number="helpMin"
        label="帮助巡查最小 (秒)"
        type="number"
        min="1"
      />
      <BaseInput
        v-model.number="helpMax"
        label="帮助巡查最大 (秒)"
        type="number"
        min="1"
      />
    </div>

    <div v-if="section === 'all' || section === 'friends'" class="flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
      <BaseSwitch
        v-model="settings.friendQuietHours.enabled"
        label="启用静默时段"
      />
      <div class="flex items-center gap-2">
        <input
          v-model="settings.friendQuietHours.start"
          type="time"
          class="w-20 border border-gray-200 rounded bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          :disabled="!settings.friendQuietHours.enabled"
        >
        <span class="text-xs text-gray-500">-</span>
        <input
          v-model="settings.friendQuietHours.end"
          type="time"
          class="w-20 border border-gray-200 rounded bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          :disabled="!settings.friendQuietHours.enabled"
        >
      </div>
    </div>
  </div>
</template>
