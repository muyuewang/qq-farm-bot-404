<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatGoldAmount } from '@/utils/number-format'

defineProps<{
  item: any
  currentLevel: number
  canAfford: boolean
  statusLabel: string
  hint: string
}>()

const emit = defineEmits<{
  (e: 'buy', item: any): void
}>()

const L = {
  price: '\u4EF7\u683C',
  gold: '\u91D1\u5E01',
  requiredLevel: '\u9700\u6C42\u7B49\u7EA7',
  seasons: '\u5B63\u6570',
  exp: '\u6BCF\u5B63\u7ECF\u9A8C',
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
        Lv.{{ item.seedLevel }}
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
        {{ L.price }} {{ formatGoldAmount(item.price) }} {{ L.gold }}
      </div>
      <div class="mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        <div>{{ L.requiredLevel }} {{ item.requiredLevel }}</div>
        <div class="truncate">
          {{ L.seasons }} {{ item.seasons || 0 }} / {{ L.exp }} {{ item.expPerSeason?.toLocaleString?.() || 0 }}
        </div>
      </div>
      <p class="line-clamp-2 mt-1 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        {{ hint }}
      </p>
      <BaseButton
        class="mt-auto w-full"
        variant="primary"
        :disabled="!item.unlocked || item.isSoldOut || currentLevel < item.requiredLevel || !canAfford"
        @click="emit('buy', item)"
      >
        {{ statusLabel === L.canBuy ? L.buy : statusLabel }}
      </BaseButton>
    </div>
  </article>
</template>
