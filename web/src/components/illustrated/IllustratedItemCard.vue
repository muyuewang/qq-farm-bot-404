<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatGoldAmount } from '@/utils/number-format'

const props = defineProps<{
  item: any
  buying: boolean
  statusLabel: string
  progressHint: string
  unlockHint: string
}>()

const emit = defineEmits<{
  (e: 'buy', item: any): void
}>()

const imageError = ref(false)

const L = {
  planted: '\u79CD\u690D',
  harvest: '\u6536\u83B7',
  wishProgress: '\u5FC3\u613F\u8FDB\u5EA6',
  price: '\u4EF7\u683C',
  gold: '\u91D1\u5E01',
  buy: '\u7ACB\u5373\u8D2D\u4E70',
  unlocked: '\u5DF2\u89E3\u9501',
  buyable: '\u53EF\u8D2D\u4E70\u8865\u5F55',
}

watch(() => props.item?.image, () => {
  imageError.value = false
})

</script>

<template>
  <article
    class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border rounded-lg bg-white shadow-sm transition dark:bg-gray-800"
    :class="item.unlocked
      ? 'border-gray-200 hover:border-emerald-400 dark:border-gray-700'
      : item.canBuy && item.goodsId
        ? 'border-blue-200 hover:border-blue-400 dark:border-blue-900/40'
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
          : item.canBuy && item.goodsId
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'"
      >
        {{ statusLabel }}
      </span>
      <img
        v-if="item.image && !imageError"
        :src="item.image"
        :alt="item.name"
        class="max-h-14 max-w-14 object-contain"
        @error="imageError = true"
      >
      <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
        {{ String(item.name || '?').slice(0, 1) }}
      </div>
    </div>

    <div class="min-h-[120px] flex flex-1 flex-col p-3">
      <div class="line-clamp-2 text-center text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ item.name }}
      </div>
      <div class="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
        Lv.{{ item.level }}
      </div>
      <div class="mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        <div class="truncate">
          {{ L.planted }} {{ item.plantedCount || 0 }} / {{ L.harvest }} {{ item.harvestCount || 0 }}
        </div>
        <div v-if="Number(item.wishProgress?.total) > 0" class="truncate text-pink-600 font-semibold dark:text-pink-400">
          {{ L.wishProgress }} {{ item.wishProgress.current || 0 }}/{{ item.wishProgress.total }}
        </div>
        <div class="truncate">
          {{ progressHint }}
        </div>
        <div class="truncate">
          {{ unlockHint }}
        </div>
        <div v-if="item.canBuy && item.goodsId" class="text-amber-600 font-semibold dark:text-amber-400">
          {{ L.price }} {{ formatGoldAmount(item.price || 0) }} {{ L.gold }}
        </div>
      </div>

      <BaseButton
        class="mt-auto w-full"
        variant="primary"
        :loading="buying"
        :disabled="!(item.canBuy && item.goodsId)"
        @click="emit('buy', item)"
      >
        {{ item.canBuy && item.goodsId ? L.buy : statusLabel }}
      </BaseButton>
    </div>
  </article>
</template>
