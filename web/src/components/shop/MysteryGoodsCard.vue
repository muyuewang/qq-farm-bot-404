<script setup lang="ts">
import type { MysteryShopOffer } from '@/stores/shop'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCurrencyAmountByLabel } from '@/utils/number-format'

const props = defineProps<{
  offer: MysteryShopOffer
  balance: number
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'buy', offer: MysteryShopOffer): void
  (e: 'abandon', offer: MysteryShopOffer): void
}>()

function formatEndTime(timestamp: number) {
  if (!timestamp)
    return ''
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
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
          限时神秘商品 · {{ offer.discount / 10 }} 折
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
        <div v-if="offer.endTime" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ formatEndTime(offer.endTime) }} 离开
        </div>
      </div>
    </div>

    <div class="flex gap-3 border-t border-purple-100 p-4 dark:border-purple-900">
      <BaseButton
        class="flex-1"
        variant="outline"
        :disabled="loading"
        @click="emit('abandon', props.offer)"
      >
        请离
      </BaseButton>
      <BaseButton
        class="flex-1"
        variant="primary"
        :loading="loading"
        :disabled="balance < offer.price"
        @click="emit('buy', props.offer)"
      >
        {{ balance >= offer.price ? '购买后商人将离开' : `${offer.currencyName}不足` }}
      </BaseButton>
    </div>
  </article>
</template>
