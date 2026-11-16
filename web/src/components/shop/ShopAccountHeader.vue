<script setup lang="ts">
import type { ResourceCurrency } from '@/utils/number-format'
import { formatCurrencyAmount } from '@/utils/number-format'

const props = defineProps<{
  accountName?: string
  level: number
  gold: number
  coupon: number
  diamond: number
  goldBean: number
}>()

const L = {
  title: '\u5546\u57CE',
  gold: '\u91D1\u5E01',
  coupon: '\u70B9\u5238',
  diamond: '\u94BB\u77F3',
  goldBean: '\u91D1\u8C46\u8C46',
  none: '\u672A\u9009\u62E9',
}

const resourcePills = [
  {
    label: L.gold,
    icon: '/game-config/resource-icons/gold.png',
    value: () => props.gold,
    currency: 'gold' as ResourceCurrency,
    class: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  },
  {
    label: L.coupon,
    icon: '/game-config/resource-icons/coupon.png',
    value: () => props.coupon,
    currency: 'coupon' as ResourceCurrency,
    class: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  },
  {
    label: L.diamond,
    icon: '/game-config/resource-icons/diamond.png',
    value: () => props.diamond,
    currency: 'coupon' as ResourceCurrency,
    class: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300',
  },
  {
    label: L.goldBean,
    icon: '/game-config/resource-icons/gold-bean.png',
    value: () => props.goldBean,
    currency: 'goldBean' as ResourceCurrency,
    class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  },
]
</script>

<template>
  <div class="min-w-0 flex flex-wrap items-center gap-3">
    <div class="flex items-center gap-2">
      <div class="i-carbon-store text-2xl text-emerald-500" />
      <h1 class="text-xl font-bold">
        {{ L.title }}
      </h1>
    </div>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <div
        v-for="item in resourcePills"
        :key="item.label"
        class="h-8 flex items-center gap-2 rounded-lg px-3 text-xs"
        :class="item.class"
      >
        <img :src="item.icon" :alt="item.label" class="h-5 w-5 shrink-0 object-contain">
        <span>{{ item.label }} {{ formatCurrencyAmount(item.value(), item.currency) }}</span>
      </div>
      <div class="h-8 flex items-center rounded-lg bg-gray-50 px-3 text-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
        Lv.{{ level }} {{ accountName || L.none }}
      </div>
    </div>
  </div>
</template>
