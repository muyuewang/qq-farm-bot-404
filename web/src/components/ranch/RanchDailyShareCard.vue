<script setup lang="ts">
import type { RanchDailyShare, RanchRequest } from '@/utils/ranch'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatQuantity, itemListLine } from '@/utils/ranch'

defineProps<{ share: RanchDailyShare | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

/** 领取动作不带参数：后端自己判断是否需要先补一次分享上报。 */
function claimShare() {
  emit('request', {
    action: 'claimDailyShare',
    input: {},
    title: '领取牧场每日首次分享礼包',
    note: '尚未上报分享时，服务端会先补一次分享上报再领取；上报未确认时不会重复提交。',
  })
}
</script>

<template>
  <div
    v-if="share"
    class="flex flex-wrap items-center gap-2 border border-gray-200 rounded-xl bg-white px-3 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
  >
    <span class="i-carbon-share h-5 w-5 shrink-0" :style="{ color: 'var(--theme-primary)' }" />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium">
        每日首次分享礼包
      </p>
      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        已分享 {{ formatQuantity(share.shareCount) }} 次 · {{ share.dateKey || '日期未下发' }} · 奖励 {{ itemListLine(share.rewards) }}
      </p>
    </div>
    <span
      class="rounded-lg px-2 py-1 text-xs font-medium"
      :class="share.claimed ? 'bg-gray-100 text-gray-500 dark:bg-gray-900/40' : 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'"
    >
      {{ share.claimed ? '今日已领取' : (share.shared ? '待领取' : '未分享') }}
    </span>
    <BaseButton variant="secondary" size="sm" :disabled="share.claimed" @click="claimShare">
      领取
    </BaseButton>
  </div>
  <div v-else class="border border-gray-200 rounded-lg border-dashed px-3 py-2.5 text-xs text-gray-500 dark:border-gray-700">
    每日分享状态未随本次响应下发。
  </div>
</template>
