<script setup lang="ts">
import type { ActivityLabels } from './types'
import type { HeluDrawReward, HeluSolarTerm, HeluSolarTerms } from '@/stores/activity'
import BaseButton from '@/components/ui/BaseButton.vue'

defineProps<{
  solarTerms?: HeluSolarTerms | null
  loading?: boolean
  labels: ActivityLabels
}>()

defineEmits<{
  claim: [term: HeluSolarTerm]
}>()

const T = {
  currentTerm: '\u5F53\u524D\u8282\u4EE4',
  claimableUnit: '\u4E2A\u53EF\u9886',
  termUnit: '\u4E2A\u8282\u4EE4',
  itemPrefix: '\u7269\u54C1',
  none: '\u65E0',
  termPrefix: '\u8282\u4EE4',
  reward: '\u5956\u52B1',
  claimReward: '\u9886\u53D6\u5956\u52B1',
  unavailable: '\u4E0D\u53EF\u9886\u53D6',
}

function formatTime(value?: number) {
  const raw = Number(value || 0)
  if (!raw)
    return '-'
  const date = new Date(raw > 1000000000000 ? raw : raw * 1000)
  if (Number.isNaN(date.getTime()))
    return '-'
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function rewardName(item: { itemName?: string, name?: string, itemId?: number }) {
  return item.itemName || item.name || `${T.itemPrefix}${item.itemId || ''}`
}

function rewardCount(item: { itemCount?: number, count?: number }) {
  return item.itemCount || item.count || 1
}

function rewardSummary(items?: HeluDrawReward[]) {
  if (!items?.length)
    return T.none
  return items.map(item => `${rewardName(item)}x${rewardCount(item)}`).join(' / ')
}

function previewRewards(items?: HeluDrawReward[]) {
  return (items || []).slice(0, 3)
}
</script>

<template>
  <section class="rounded-lg bg-white shadow-sm dark:bg-gray-800">
    <div class="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
      <div class="min-w-0 flex items-center gap-3">
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300">
          <div class="i-carbon-notebook" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-base text-gray-900 font-semibold dark:text-gray-100">
            {{ labels.notesTab }}
          </h2>
          <div class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            {{ solarTerms?.currentTerm ? `当前节令：${solarTerms.currentTerm.title}` : solarTerms?.nextTerm ? `下一节令：${solarTerms.nextTerm.title}` : '当前暂无开放的节令' }}
          </div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span class="rounded-lg bg-gray-50 px-2.5 py-1 dark:bg-gray-900/40">
          {{ solarTerms?.claimableCount || 0 }} {{ T.claimableUnit }}
        </span>
        <span class="rounded-lg bg-gray-50 px-2.5 py-1 dark:bg-gray-900/40">
          {{ solarTerms?.terms?.length || 0 }} {{ T.termUnit }}
        </span>
      </div>
    </div>

    <div
      v-if="!solarTerms?.terms?.length"
      class="m-4 rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400"
    >
      {{ labels.empty }}
    </div>

    <div v-else class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
      <article
        v-for="term in solarTerms.terms"
        :key="term.id"
        class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900/20"
      >
        <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
          <span
            class="absolute left-0 top-0 rounded-br-lg px-2 py-1 text-[10px] font-semibold"
            :class="term.claimable ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'"
          >
            {{ term.statusLabel }}
          </span>
          <img
            v-if="term.rewards?.[0]?.image"
            :src="term.rewards[0].image"
            :alt="rewardName(term.rewards[0])"
            class="max-h-16 max-w-16 object-contain"
          >
          <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
            {{ (term.title || `${T.termPrefix}${term.id}`).slice(0, 1) }}
          </div>
        </div>

        <div class="min-h-[120px] flex flex-1 flex-col p-3">
          <div class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100">
            {{ term.title || `${T.termPrefix} ${term.id}` }}
          </div>
          <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            {{ formatTime(term.startTime) }} - {{ formatTime(term.endTime) }}
          </div>

          <div class="mt-2 flex -space-x-1">
            <span
              v-for="item in previewRewards(term.rewards)"
              :key="`${term.id}-${item.itemId}-${item.itemCount}`"
              class="grid h-6 w-6 place-items-center rounded-full bg-white ring-1 ring-gray-100 dark:bg-gray-800 dark:ring-gray-700"
            >
              <img
                v-if="item.image"
                :src="item.image"
                :alt="rewardName(item)"
                class="h-4 w-4 object-contain"
              >
              <span v-else class="text-[10px] text-gray-500">{{ rewardName(item).slice(0, 1) }}</span>
            </span>
          </div>

          <div class="line-clamp-2 mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
            {{ T.reward }}: {{ rewardSummary(term.rewards) }}
          </div>

          <div v-if="!term.claimable" class="mt-auto rounded-lg bg-gray-100 px-3 py-2 text-center text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {{ term.statusLabel || T.unavailable }}
          </div>
          <BaseButton
            v-else
            class="mt-auto w-full"
            variant="primary"
            :loading="loading"
            :disabled="!term.claimable"
            @click="$emit('claim', term)"
          >
            {{ term.claimable ? T.claimReward : (term.statusLabel || T.unavailable) }}
          </BaseButton>
        </div>
      </article>
    </div>
  </section>
</template>
