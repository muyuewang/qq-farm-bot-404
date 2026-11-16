<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCurrencyAmount } from '@/utils/number-format'

defineProps<{
  item: any
  currentLevel: number
  canAfford: boolean
  statusLabel: string
  hint: string
}>()

const emit = defineEmits<{
  (e: 'buy', item: any, currency: string): void
}>()

const L = {
  gold: '\u91D1\u5E01',
  goldBean: '\u91D1\u8C46\u8C46',
  noDesc: '\u6682\u65E0\u63CF\u8FF0',
  buy: '\u7ACB\u5373\u8D2D\u4E70',
  canBuy: '\u53EF\u8D2D\u4E70',
}
</script>

<template>
  <article class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
      <span class="absolute left-0 top-0 rounded-br-lg bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 font-semibold dark:bg-gray-700 dark:text-gray-300">
        #{{ item.itemId }}
      </span>
      <span class="absolute right-0 top-0 rounded-bl-lg bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 font-semibold dark:bg-emerald-900/20 dark:text-emerald-300">
        Lv.{{ item.requiredLevel }}
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
        {{ formatCurrencyAmount(item.price, item.isGoldenBean ? 'goldBean' : 'gold') }} {{ item.isGoldenBean ? L.goldBean : L.gold }}
      </div>
      <p class="line-clamp-2 mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        {{ item.desc || L.noDesc }}
      </p>
      <p class="line-clamp-2 mt-1 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        {{ hint }}
      </p>
      <BaseButton
        class="mt-auto w-full"
        variant="primary"
        :disabled="item.isSoldOut || !item.unlocked || currentLevel < item.requiredLevel || !canAfford"
        @click="emit('buy', item, item.isGoldenBean ? L.goldBean : L.gold)"
      >
        {{ statusLabel === L.canBuy ? L.buy : statusLabel }}
      </BaseButton>
    </div>
  </article>
</template>
