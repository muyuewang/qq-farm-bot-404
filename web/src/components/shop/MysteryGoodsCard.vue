<script setup lang="ts">
import type { MysteryShopOffer } from '@/stores/shop'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCurrencyAmountByLabel } from '@/utils/number-format'

const props = defineProps<{
  offer: MysteryShopOffer
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'buy', offer: MysteryShopOffer): void
}>()

const L = {
  balanceUnknown: '余额未确认',
  buy: '购买后商人将离开',
  insufficient: '余额不足',
}

const balanceKnown = computed(() => props.offer.balance !== null && props.offer.balance !== undefined)
const isInsufficient = computed(() => balanceKnown.value && Number(props.offer.balance) < Number(props.offer.price))

function formatEndTime(timestamp: number) {
  if (!timestamp)
    return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <article class="max-w-md overflow-hidden border border-purple-200 rounded-xl from-purple-50 to-amber-50 bg-gradient-to-br shadow-sm dark:border-purple-800 dark:from-purple-950/40 dark:to-amber-950/20">
    <div class="flex items-center gap-4 p-5">
      <div class="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-white shadow-sm dark:bg-gray-800">
        <img v-if="offer.itemImage" :src="offer.itemImage" :alt="offer.itemName" class="max-h-16 max-w-16 object-contain">
        <span v-else class="text-lg text-purple-500 font-bold">{{ offer.itemName.slice(0, 1) }}</span>
      </div>

      <div class="min-w-0 flex-1">
        <div class="text-xs text-purple-600 font-semibold dark:text-purple-300">
          限时神秘商品
        </div>
        <h3 class="mt-1 truncate text-base text-gray-900 font-bold dark:text-gray-100">
          {{ offer.itemName }} ×{{ offer.itemCount }}
        </h3>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-lg text-amber-600 font-bold dark:text-amber-400">
            {{ formatCurrencyAmountByLabel(offer.price, offer.currencyName) }} {{ offer.currencyName }}
          </span>
          <span v-if="offer.originalPrice > offer.price" class="text-xs text-gray-400 line-through">
            {{ formatCurrencyAmountByLabel(offer.originalPrice, offer.currencyName) }}
          </span>
        </div>
        <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ offer.currencyName }}余额
          {{ balanceKnown ? formatCurrencyAmountByLabel(offer.balance, offer.currencyName) : L.balanceUnknown }}
          <span v-if="offer.endTime"> · {{ formatEndTime(offer.endTime) }} 离开</span>
        </div>
      </div>
    </div>

    <div class="flex gap-3 border-t border-purple-100 p-4 dark:border-purple-900">
      <BaseButton
        class="flex-1"
        variant="primary"
        :loading="loading"
        :disabled="isInsufficient"
        @click="emit('buy', props.offer)"
      >
        {{ isInsufficient ? `${offer.currencyName}${L.insufficient}` : L.buy }}
      </BaseButton>
    </div>
  </article>
</template>
