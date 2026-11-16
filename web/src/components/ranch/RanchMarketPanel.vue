<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { affordability, formatQuantity, itemLine } from '@/utils/ranch'
import type { RanchRequest, RanchState } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

const counts = ref<Record<string, string | number>>({})

const market = computed(() => props.state?.market ?? null)

/** 商品按服务端货架分组；货架顺序沿用后端 sort，不在前端重排。 */
const groups = computed(() => {
  const rows = market.value?.shelves || []
  const goods = market.value?.goods || []
  return rows
    .slice()
    .sort((a: any, b: any) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
    .map((shelf: any) => ({
      id: String(shelf.id),
      name: String(shelf.name || `货架${shelf.id}`),
      goods: goods.filter(good => String(good.shelfId) === String(shelf.id)),
    }))
    .filter(group => group.goods.length)
})

const orphanGoods = computed(() => {
  const shelfIds = new Set((market.value?.shelves || []).map((shelf: any) => String(shelf.id)))
  return (market.value?.goods || []).filter(good => !shelfIds.has(String(good.shelfId)))
})

function maxCount(good: any) {
  return good.remaining === null ? 0 : good.remaining
}

/** remaining 为 null 表示不限购；后端 exchange 只按 remaining 与 available 拒绝。 */
function canExchange(good: any) {
  return good.available === true && (good.remaining === null || good.remaining > 0)
}

function countOf(good: any) {
  const raw = Number(counts.value[good.id])
  if (!Number.isFinite(raw) || raw <= 0)
    return 1
  return good.remaining === null ? raw : Math.min(raw, good.remaining)
}

function requestExchange(good: any) {
  const count = countOf(good)
  const round = `第 ${props.state?.market?.periodDay ?? '?'} 天 第 ${props.state?.market?.roundIndex ?? '?'} 轮`
  emit('request', {
    action: 'exchange',
    input: { goodsId: good.id, count },
    title: `兑换${good.reward.name} ×${count}`,
    note: `集市每期货架与价格都会变化，报价按当前期次（${round}）核算。`,
  })
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!market" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      交易市场数据未下发，请点击刷新或在上方切到「交易市场」重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span
          class="rounded-lg px-3 py-1.5 font-medium"
          :class="market.opened ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'"
        >
          {{ market.opened ? '集市已开启' : '集市未开启' }}
        </span>
        <span
          class="rounded-lg px-3 py-1.5 font-medium"
          :class="market.present ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'"
        >
          {{ market.present ? '本期在场' : '本期已离场' }}
        </span>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          第 {{ formatQuantity(market.periodDay) }} 天 · 第 {{ formatQuantity(market.roundIndex) }} 轮
        </span>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          共 {{ market.goods.length }} 件商品
        </span>
      </div>

      <div v-if="!market.goods.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
        本期集市没有商品。
      </div>

      <div v-for="group in groups" :key="group.id" class="space-y-2">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ group.name }}
        </p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          <div
            v-for="good in group.goods"
            :key="good.id"
            class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            :class="good.available ? '' : 'opacity-70'"
          >
            <div class="flex items-start gap-2">
              <img v-if="good.reward.image" :src="good.reward.image" :alt="good.reward.name" class="h-11 w-11 shrink-0 rounded object-contain">
              <div v-else class="i-carbon-store h-11 w-11 shrink-0 text-2xl text-gray-300" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ itemLine(good.reward) }}
                </p>
                <p class="mt-0.5 truncate text-xs text-gray-500">
                  {{ formatQuantity(good.price.count) }} {{ good.price.name }}
                  <span v-if="good.remaining !== null">· 限购余 {{ good.remaining }}</span>
                </p>
              </div>
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span v-if="good.requiredLevel" class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                需 Lv.{{ good.requiredLevel }}
              </span>
              <span
                v-if="affordability(good.balance, good.price.count) === false"
                class="rounded bg-red-50 px-1.5 py-0.5 text-red-600 dark:bg-red-950/40 dark:text-red-300"
              >
                {{ good.price.name }}不足
              </span>
              <span
                v-else-if="affordability(good.balance, good.price.count) === null"
                class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40"
              >
                余额未确认
              </span>
              <span v-if="!good.available" class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40">本期不可兑换</span>
            </div>

            <div class="mt-3 flex flex-wrap items-end gap-2">
              <BaseInput
                v-model="counts[good.id]"
                type="number"
                label="数量"
                class="w-20"
                :min="1"
                :max="good.remaining === null ? undefined : maxCount(good)"
              />
              <BaseButton variant="primary" size="sm" :disabled="!canExchange(good)" @click="requestExchange(good)">
                兑换
              </BaseButton>
            </div>
          </div>
        </div>
      </div>

      <div v-if="orphanGoods.length" class="space-y-2">
        <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
          未归架商品
        </p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          <div
            v-for="good in orphanGoods"
            :key="good.id"
            class="border border-dashed border-gray-200 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <p class="truncate text-sm font-medium">
              {{ itemLine(good.reward) }}
            </p>
            <p class="mt-0.5 truncate text-xs text-gray-500">
              {{ formatQuantity(good.price.count) }} {{ good.price.name }} · 货架位 {{ good.slot }}
            </p>
            <BaseButton variant="secondary" size="sm" class="mt-2" :disabled="!good.available" @click="requestExchange(good)">
              兑换
            </BaseButton>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
