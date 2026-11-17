<script setup lang="ts">
import type { RanchDailyBenefit } from '@/utils/ranch'
import { itemListLine } from '@/utils/ranch'

defineProps<{ benefit: RanchDailyBenefit | null }>()
</script>

<template>
  <div
    v-if="benefit"
    class="flex flex-wrap items-center gap-2 border border-gray-200 rounded-xl bg-white px-3 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
  >
    <span class="i-carbon-gift h-5 w-5 shrink-0" :style="{ color: 'var(--theme-primary)' }" />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium">
        每日福利
      </p>
      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        <template v-if="benefit.hasGift">
          牧场商店每日免费福利 · {{ benefit.dateKey || '日期未下发' }}<template v-if="benefit.rewards.length">
            · 奖励 {{ itemListLine(benefit.rewards) }}
          </template>
        </template>
        <template v-else>
          服务端未下发免费福利商品，可能今日已下架或活动未开放。
        </template>
      </p>
    </div>
    <span
      class="rounded-lg px-2 py-1 text-xs font-medium"
      :class="benefit.claimed
        ? 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'
        : (benefit.available ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300')"
    >
      {{ benefit.claimed ? '今日已领取' : (benefit.available ? '可领取' : '暂不可领') }}
    </span>
  </div>
  <div v-else class="border border-gray-200 rounded-lg border-dashed px-3 py-2.5 text-xs text-gray-500 dark:border-gray-700">
    每日福利状态未随本次响应下发。
  </div>
</template>
