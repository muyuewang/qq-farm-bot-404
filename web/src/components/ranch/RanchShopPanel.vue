<script setup lang="ts">
import type { RanchRequest, RanchState } from '@/utils/ranch'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { affordability, formatQuantity, itemLine } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{
  request: [payload: RanchRequest]
  shopId: [shopId: number]
}>()

/** shopId 5=幼崽商店、6=牧草商店，与后台自动补栏/补草用的是同两个店（automation.ts:117、133）。 */
const SHOP_TABS = [
  { value: 5, label: '幼崽商店' },
  { value: 6, label: '牧草商店' },
]

const counts = ref<Record<string, string | number>>({})
const autoPlace = ref<Record<string, boolean>>({})

const shopId = computed(() => props.state?.shop?.shopId ?? 5)
const goods = computed(() => props.state?.shop?.goods || [])

function countOf(id: string, max: number) {
  const raw = Number(counts.value[id])
  if (!Number.isFinite(raw) || raw <= 0)
    return 1
  return Math.min(raw, max)
}

function maxCount(good: any) {
  const limit = good.remaining === null ? good.maxCount : Math.min(good.maxCount, good.remaining)
  return limit > 0 ? limit : 0
}

/** 余额未确认（null）或不足时都不可购买，避免把未知余额当成可支付。 */
function canBuy(good: any) {
  return good.available === true && maxCount(good) > 0 && affordability(good.balance, good.price.count) === true
}

/** 单价是 int64 十进制字符串，按 BigInt 相乘再格式化，避免大额金额经 Number 后失真。 */
function unitTotal(good: any, count: number) {
  const price = String(good?.price?.count ?? '')
  if (!/^\d+$/.test(price))
    return formatQuantity(price)
  return formatQuantity((BigInt(price) * BigInt(Math.max(1, Math.floor(count)))).toString())
}

function requestBuy(good: any) {
  const count = countOf(good.id, maxCount(good))
  const input: Record<string, any> = { goodsId: good.id, count, shopId: good.shopId }
  if (good.animal && autoPlace.value[good.id])
    input.autoPlace = true
  // 总消耗按「单价 × 数量」当场算给用户看，报价弹窗里再用服务端核算值复核一次。
  const total = unitTotal(good, count)
  emit('request', {
    action: 'buy',
    input,
    title: `购买${good.reward.name} ×${count}`,
    note: [
      `总消耗 ${total} ${good.price.name}。`,
      good.animal && input.autoPlace ? '购买后直接放养到空位，空位不足时服务端会拒绝整笔购买。' : '',
    ].filter(Boolean).join(''),
  })
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!state?.shop" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      商店数据未下发，请点击刷新或在上方切到「牧场商店」重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="tab in SHOP_TABS"
            :key="tab.value"
            class="min-w-24 rounded-md px-3 text-sm font-medium transition"
            :class="shopId === tab.value ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="shopId === tab.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="emit('shopId', tab.value)"
          >
            {{ tab.label }}
          </button>
        </div>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          共 {{ goods.length }} 件商品
        </span>
      </div>

      <div v-if="!goods.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
        该商店暂无商品。
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        <div
          v-for="good in goods"
          :key="good.id"
          class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          :class="good.available ? '' : 'opacity-70'"
        >
          <div class="flex items-start gap-2">
            <img v-if="good.reward.image" :src="good.reward.image" :alt="good.reward.name" class="h-11 w-11 shrink-0 rounded object-contain">
            <div v-else class="i-carbon-currency h-11 w-11 shrink-0 text-2xl text-gray-300" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ itemLine(good.reward) }}
              </p>
              <p class="mt-0.5 truncate text-xs text-gray-500">
                {{ formatQuantity(good.price.count) }} {{ good.price.name }}
                <span v-if="good.remaining !== null" class="text-gray-400">· 限购余 {{ good.remaining }}</span>
                <span v-else class="text-gray-400">· 不限购</span>
              </p>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span v-if="good.requiredLevel !== null" class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
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
            <span v-if="!good.available" class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40">已售罄/未解锁</span>
          </div>

          <div class="mt-3 flex flex-wrap items-end gap-2">
            <BaseInput
              v-model="counts[good.id]"
              type="number"
              label="数量"
              class="w-20"
              :min="1"
              :max="maxCount(good)"
            />
            <BaseButton variant="primary" size="sm" :disabled="!canBuy(good)" @click="requestBuy(good)">
              购买
            </BaseButton>
            <span class="rounded-md bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
              共 {{ unitTotal(good, countOf(good.id, maxCount(good))) }} {{ good.price.name }}
            </span>
          </div>

          <BaseSwitch
            v-if="good.animal"
            v-model="autoPlace[good.id]"
            label="购买后立即放养"
            class="mt-2"
          />
        </div>
      </div>
    </template>
  </div>
</template>
