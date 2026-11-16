<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCurrencyAmountByLabel } from '@/utils/number-format'

defineProps<{
  item: any
  canAfford: boolean
  statusLabel: string
  hint: string
}>()

const emit = defineEmits<{
  (e: 'buy', item: any): void
}>()

const L = {
  free: '\u514D\u8D39',
  buy: '\u7ACB\u5373\u8D2D\u4E70',
  canBuy: '\u53EF\u8D2D\u4E70',
  balanceUnknown: '\u4F59\u989D\u672A\u786E\u8BA4',
}

function balanceText(item: any) {
  return item.balance === null || item.balance === undefined
    ? L.balanceUnknown
    : formatCurrencyAmountByLabel(item.balance, item.currencyName)
}
</script>

<template>
  <article class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
      <span class="absolute left-0 top-0 rounded-br-lg bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 font-semibold dark:bg-gray-700 dark:text-gray-300">
        #{{ item.itemId }}
      </span>
      <span class="absolute right-0 top-0 rounded-bl-lg bg-purple-50 px-2 py-0.5 text-[10px] text-purple-700 font-semibold dark:bg-purple-900/20 dark:text-purple-300">
        {{ statusLabel }}
      </span>
      <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-14 max-w-14 object-contain">
      <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
        {{ String(item.name || '?').slice(0, 1) }}
      </div>
    </div>

    <div class="min-h-[120px] flex flex-1 flex-col p-3">
      <div class="line-clamp-2 text-center text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ item.name }}
      </div>
      <div class="mt-1 text-center text-xs text-amber-600 font-semibold dark:text-amber-400">
        {{ item.isFree ? L.free : `${formatCurrencyAmountByLabel(item.price, item.currencyName)} ${item.currencyName}` }}
      </div>
      <div v-if="item.originalPrice && item.originalPrice > item.price" class="text-center text-[11px] text-gray-400 line-through">
        {{ formatCurrencyAmountByLabel(item.originalPrice, item.currencyName) }}
      </div>
      <div class="mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        <div class="truncate">
          {{ item.currencyName }}余额 {{ balanceText(item) }}
        </div>
        <div v-if="item.remainingPurchaseCount !== null" class="truncate">
          限购 {{ item.limitCount }} · 剩余 {{ item.remainingPurchaseCount }}
        </div>
      </div>
      <p class="line-clamp-2 mt-1 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        {{ hint }}
      </p>
      <BaseButton
        class="mt-auto w-full"
        variant="primary"
        :disabled="!item.purchasable || !canAfford"
        @click="emit('buy', item)"
      >
        {{ statusLabel === L.canBuy ? L.buy : statusLabel }}
      </BaseButton>
    </div>
  </article>
</template>
