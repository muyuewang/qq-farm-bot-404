<script setup lang="ts">
import type { RanchRequest, RanchState } from '@/utils/ranch'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { affordability, formatQuantity, itemListLine } from '@/utils/ranch'

/**
 * 罐头商城与礼包商城在后端是同一个协议分页（state.ts: ranchMallCatalog），
 * 差别只有两点：礼包商城额外放行沙漏（1006），购买动作分别是 buyCan / buyMall。
 * 所以这里用一份组件按 catalog 切换，避免两套几乎一样的列表各改一遍。
 */
const props = withDefaults(defineProps<{ state: RanchState | null, catalog?: 'cans' | 'mall' }>(), {
  catalog: 'cans',
})

const emit = defineEmits<{
  request: [payload: RanchRequest]
  slotType: [slotType: number]
}>()

/**
 * 服务端只允许 slot_type 6 / 7，且没有下发分页名称。
 * 罐头商城按编号展示；礼包商城沿用游戏里「礼包 / 特惠」的说法。
 */
const SLOT_TABS = computed(() => props.catalog === 'mall'
  ? [{ value: 6, label: '礼包商城' }, { value: 7, label: '特惠商城' }]
  : [{ value: 6, label: '罐头商城 6' }, { value: 7, label: '罐头商城 7' }])

const isMall = computed(() => props.catalog === 'mall')
const counts = ref<Record<string, string | number>>({})

const slotType = computed(() => (isMall.value ? props.state?.mall?.slotType : props.state?.canShop?.slotType) ?? 6)
const goods = computed(() => (isMall.value ? props.state?.mall?.goods : props.state?.canShop?.goods) || [])
const buckets = computed(() => isMall.value
  ? []
  : (props.state?.resources || []).filter(resource => resource.key.startsWith('bucket:')))

function countOf(good: any) {
  const raw = Number(counts.value[good.id])
  const max = good.remaining === null ? good.maxCount : Math.min(good.maxCount, good.remaining)
  if (!Number.isFinite(raw) || raw <= 0)
    return 1
  return Math.min(raw, max > 0 ? max : 0)
}

function maxCount(good: any) {
  const limit = good.remaining === null ? good.maxCount : Math.min(good.maxCount, good.remaining)
  return limit > 0 ? limit : 0
}

function requestBuy(good: any) {
  const count = countOf(good)
  emit('request', {
    action: isMall.value ? 'buyMall' : 'buyCan',
    input: { goodsId: good.id, count, slotType: good.slotType },
    title: `${good.free ? '领取' : '购买'}${good.name} ×${count}`,
    note: isMall.value
      ? undefined
      : '罐头买完只是进背包，仍需在背包里「加入罐头桶」才会换算成加速时长。',
  })
}

function secondsOf(good: any) {
  return itemListLine(good.rewards)
}
</script>

<template>
  <div class="space-y-3">
    <!-- 罐头桶余额只在罐头商城有用；礼包商城卖的是沙漏和礼包，不需要这排桶快照。 -->
    <div v-if="!isMall" class="grid grid-cols-2 gap-2 lg:grid-cols-6 sm:grid-cols-3">
      <div
        v-for="bucket in buckets"
        :key="bucket.key"
        class="border border-gray-200 rounded-xl bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <p class="text-[11px] text-gray-500 dark:text-gray-400">
          {{ bucket.label }}
        </p>
        <p class="mt-0.5 truncate text-sm font-semibold" :style="{ color: 'var(--theme-primary)' }">
          {{ bucket.value }}
        </p>
      </div>
      <div class="col-span-2 border border-gray-200 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-500 leading-5 lg:col-span-4 sm:col-span-4 dark:border-gray-700 dark:bg-gray-900/40">
        罐头桶记录的是可加速总时长：投喂动物时只扣除它当前阶段的剩余生长时间，精确到秒；限制罐头的动物只能用有机罐头。
      </div>
    </div>

    <div v-if="isMall ? !state?.mall : !state?.canShop" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      {{ isMall ? '礼包商城' : '罐头商城' }}数据未下发，请点击刷新或在上方切回该分页重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="tab in SLOT_TABS"
            :key="tab.value"
            class="min-w-28 rounded-md px-3 text-sm font-medium transition"
            :class="slotType === tab.value ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="slotType === tab.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="emit('slotType', tab.value)"
          >
            {{ tab.label }}
          </button>
        </div>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          共 {{ goods.length }} 件可购{{ isMall ? '商品' : '罐头' }}
        </span>
      </div>

      <div v-if="!goods.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
        该分页暂无可购买的商品{{ isMall ? '' : '（只展示服务端确认的罐头奖励商品）' }}。
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
        <div
          v-for="good in goods"
          :key="good.id"
          class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          :class="good.available ? '' : 'opacity-70'"
        >
          <div class="flex items-start gap-2">
            <img v-if="good.rewards[0]?.image" :src="good.rewards[0].image" :alt="good.name" class="h-11 w-11 shrink-0 rounded object-contain">
            <div v-else class="i-carbon-timer h-11 w-11 shrink-0 text-2xl text-gray-300" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ good.name }}
              </p>
              <p class="mt-0.5 truncate text-xs text-gray-500">
                {{ secondsOf(good) }}
              </p>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
              {{ good.free ? '限免领取' : `${formatQuantity(good.price.count)} ${good.price.name}` }}
            </span>
            <span v-if="good.remaining !== null" class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
              限购余 {{ good.remaining }}
            </span>
            <span
              v-if="!good.free && affordability(good.balance, good.price.count) === false"
              class="rounded bg-red-50 px-1.5 py-0.5 text-red-600 dark:bg-red-950/40 dark:text-red-300"
            >
              {{ good.price.name }}不足
            </span>
            <span
              v-else-if="!good.free && affordability(good.balance, good.price.count) === null"
              class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40"
            >
              余额未确认
            </span>
            <span v-if="!good.available" class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40">已拥有/不可购</span>
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
            <BaseButton variant="primary" size="sm" :disabled="!good.available || maxCount(good) <= 0" @click="requestBuy(good)">
              {{ good.free ? '领取' : '购买' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
