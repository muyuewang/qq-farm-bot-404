<script setup lang="ts">
import type { SolarCalendarEvent } from './solar-calendar-types'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatSolarTime, solarRewardSummary, solarStatusLabel } from './solar-calendar-types'

const props = defineProps<{ event: SolarCalendarEvent }>()
const emit = defineEmits<{ claim: [event: SolarCalendarEvent], answer: [event: SolarCalendarEvent] }>()

const open = props.event.status === 2
</script>

<template>
  <div class="flex h-full min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/20">
    <div class="flex items-center justify-between gap-2">
      <span class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{{ event.name }}</span>
      <span
        class="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold"
        :class="open ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'"
      >{{ solarStatusLabel(event) }}</span>
    </div>
    <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
      {{ formatSolarTime(event.startTime) }} - {{ formatSolarTime(event.endTime) }}
    </div>

    <p v-if="event.description" class="mt-2 whitespace-pre-line text-[11px] leading-5 text-gray-500 dark:text-gray-400">{{ event.description }}</p>

    <div class="mt-3">
      <div class="text-xs font-medium text-gray-600 dark:text-gray-300">节令赠礼</div>
      <div class="mt-1 flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-400">{{ solarRewardSummary(event.rewards) }}</span>
        <BaseButton v-if="event.canClaim" variant="primary" size="sm" @click="emit('claim', event)">领取赠礼</BaseButton>
        <span v-else-if="event.directClaimed" class="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">已领取</span>
        <span v-else-if="open" class="shrink-0 text-[11px] text-gray-400">暂不可领</span>
      </div>
    </div>

    <div v-if="event.question" class="mt-3">
      <div class="text-xs font-medium text-gray-600 dark:text-gray-300">节令问答</div>
      <div class="mt-1 flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-400">答对可得 {{ solarRewardSummary(event.questionRewards) }}</span>
        <BaseButton v-if="event.canAnswer" variant="secondary" size="sm" @click="emit('answer', event)">作答</BaseButton>
        <span v-else-if="event.quizClaimed" class="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">已答对</span>
        <span v-else-if="event.quizWrongToday" class="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">今日已答错</span>
      </div>
    </div>
  </div>
</template>
