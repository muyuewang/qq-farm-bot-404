<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatGoldAmount } from '@/utils/number-format'

defineProps<{
  item: any
  statusLabel: string
  progressHint: string
  unlockHint: string
  actionLabel: string
}>()

const L = {
  progress: '收录进度',
  reward: '收录奖励',
  seedShop: '种子商店',
  onSale: '有售',
  priceUnknown: '价格未确认',
  soldOut: '已售罄',
  locked: '未解锁',
}
</script>

<template>
  <article
    class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border rounded-lg bg-white shadow-sm transition dark:bg-gray-800"
    :class="item.unlocked
      ? 'border-gray-200 hover:border-emerald-400 dark:border-gray-700'
      : 'border-gray-200 opacity-85 dark:border-gray-700'"
  >
    <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
      <span class="absolute left-0 top-0 rounded-br-lg bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 font-semibold dark:bg-gray-700 dark:text-gray-300">
        #{{ item.seedId }}
      </span>
      <span
        class="absolute right-0 top-0 rounded-bl-lg px-2 py-0.5 text-[10px] font-semibold"
        :class="item.unlocked
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'"
      >
        {{ statusLabel }}
      </span>
      <img
        v-if="item.image"
        :src="item.image"
        :alt="item.name"
        class="max-h-14 max-w-14 object-contain"
      >
      <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
        {{ String(item.name || '?').slice(0, 1) }}
      </div>
    </div>

    <div class="min-h-[120px] flex flex-1 flex-col p-3">
      <div class="line-clamp-2 text-center text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ item.name }}
      </div>
      <div class="mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        <div class="truncate">
          {{ L.progress }} {{ item.progress }}
        </div>
        <div v-if="item.reward" class="truncate">
          {{ L.reward }} {{ item.reward.name }} x{{ item.reward.count }}
        </div>
        <div v-if="item.shopSeed" class="truncate">
          {{ L.seedShop }}
          <span v-if="item.shopSeed.unknownMeta">{{ L.priceUnknown }}</span>
          <span v-else-if="item.shopSeed.soldOut">{{ L.soldOut }}</span>
          <span v-else-if="item.shopSeed.locked">{{ L.locked }}</span>
          <span v-else>{{ L.onSale }} · {{ formatGoldAmount(item.shopSeed.price || 0) }} 金币</span>
        </div>
        <div class="truncate">
          {{ progressHint }}
        </div>
        <div class="truncate">
          {{ unlockHint }}
        </div>
      </div>

      <BaseButton
        class="mt-auto w-full"
        variant="secondary"
        disabled
      >
        {{ actionLabel }}
      </BaseButton>
    </div>
  </article>
</template>
