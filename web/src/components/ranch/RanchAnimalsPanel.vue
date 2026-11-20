<script setup lang="ts">
import type { RanchAnimal, RanchDirectRequest, RanchFacility, RanchRequest, RanchState } from '@/utils/ranch'
import { computed, onBeforeUnmount, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { batchTargets, formatSeconds, isRanchDirectAction, sortFacilities } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{
  request: [payload: RanchRequest]
  direct: [payload: RanchDirectRequest]
  refresh: []
}>()

/** 窝固定排在棚前面：服务器返回顺序不固定，直接渲染会让同一账号每次刷新位置都在变。 */
const ranches = computed(() => sortFacilities((props.state?.facilities || []).filter((facility: RanchFacility) => facility.isRanch)))
const cleanable = computed(() => batchTargets(props.state, 'clean'))
const harvestAll = computed(() => batchTargets(props.state, 'harvest'))
const produceAll = computed(() => batchTargets(props.state, 'produce'))

/** 顶部按窝/棚汇总，方便一眼看出哪类栏舍还空着。 */
const penSummary = computed(() => [
  { housing: '窝', type: 6 },
  { housing: '棚', type: 7 },
].map(({ housing, type }) => {
  const pens = ranches.value.filter(facility => Number(facility.moduleType) === type)
  return {
    housing,
    count: pens.length,
    free: pens.reduce((sum, facility) => sum + Math.max(0, (facility.ranch?.capacity ?? 0) - (facility.ranch?.count ?? 0)), 0),
  }
}).filter(row => row.count > 0))

/**
 * 生产确认（TriggerProduce）与货架上架是两个时点：服务端下发 deliveringUntilMs，到期后才真正上架。
 * 到点自动刷新一次，免得用户盯着「催产成功」却看不到新货。
 */
let deliveryTimer: ReturnType<typeof setTimeout> | null = null
const deliveryAt = computed(() => {
  const times = ranches.value
    .flatMap(facility => facility.ranch?.animals || [])
    .map(animal => animal.deliveringUntilMs)
    .filter((time): time is number => typeof time === 'number' && time > 0)
  return times.length ? Math.min(...times) : null
})

function clearDeliveryTimer() {
  if (deliveryTimer !== null) {
    clearTimeout(deliveryTimer)
    deliveryTimer = null
  }
}

watch(deliveryAt, (target) => {
  clearDeliveryTimer()
  if (target === null)
    return
  // 已经过期的时点不再排期：挂载时直接刷新一次没有意义，只会白白多进一次牧场场景。
  const remaining = target - Date.now()
  if (remaining <= 0)
    return
  // 多留 2 秒余量：客户端时钟与服务器时钟存在偏差，卡着毫秒刷新容易读到「还没上架」。
  deliveryTimer = setTimeout(() => {
    deliveryTimer = null
    emit('refresh')
  }, remaining + 2000)
}, { immediate: true })

onBeforeUnmount(clearDeliveryTimer)

/** 一键动作让后端自己挑目标（input.all），页面不复制它的筛选条件，避免两边判据不一致。 */
function batchDirect(action: 'harvest' | 'produce' | 'clean', count: number) {
  const titles = { harvest: '一键收获全部产物', produce: '一键催产全部可生产动物', clean: '一键清理全部栏舍' }
  emit('direct', { action, input: { all: true }, title: `${titles[action]}（${count} 项）` })
}

/** 单只动作：能直投的直接执行，放生这类不可逆动作仍走报价确认。 */
function animalAct(animal: RanchAnimal, entry: RanchAnimal['actions'][number]) {
  const title = `${entry.label}：${animal.name}`
  if (isRanchDirectAction(entry.action)) {
    emit('direct', { action: entry.action, input: entry.input, title })
    return
  }
  emit('request', {
    action: entry.action,
    input: entry.input,
    title,
    danger: entry.danger,
    note: entry.action === 'release' ? '放生后动物离开栏舍，已产出的产物保留；服务端会再次核对状态。' : undefined,
  })
}

function stageText(animal: RanchAnimal) {
  const countdown = animal.countdown === null ? '' : ` · ${formatSeconds(animal.countdown)} 后变化`
  return `${animal.stageName}${countdown}`
}

/**
 * 禁用原因做成人话提示：后端只下发布尔位，页面不猜规则，只说「为什么点不了」。
 * 缺草是常见卡点，单独一句，避免用户以为是界面坏了。
 */
const harvestHint = computed(() => harvestAll.value.total ? '' : '当前没有可收获的产物或货架')
const produceHint = computed(() => produceAll.value.animals ? '' : '当前没有可催产的动物')
const cleanHint = computed(() => cleanable.value.hazards ? '' : '当前栏舍没有危险物')
const grassBlockedCount = computed(() => ranches.value
  .flatMap(facility => facility.ranch?.animals || [])
  .filter(animal => animal.grassBlocked)
  .length)
</script>

<template>
  <div class="space-y-3">
    <div v-if="!state" class="rounded-lg bg-gray-50 px-6 py-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
      尚未读到牧场数据，请先点击上方「刷新」。
    </div>

    <div v-else-if="!ranches.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      当前没有已建造的窝或棚，请在设施分区建造或升级栏舍。
    </div>

    <div v-if="state" class="flex flex-wrap items-center gap-2">
      <span
        v-for="row in penSummary"
        :key="row.housing"
        class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
      >
        {{ row.housing }} {{ row.count }} 座 · 空位 {{ row.free }}
      </span>
      <span v-if="grassBlockedCount" class="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        {{ grassBlockedCount }} 只因缺草受阻
      </span>
    </div>

    <div v-if="state" class="flex flex-wrap gap-2">
      <BaseButton
        variant="primary"
        size="sm"
        :disabled="!harvestAll.total"
        :title="harvestHint || '一键收获全部产物'"
        @click="batchDirect('harvest', harvestAll.total)"
      >
        一键收获 {{ harvestAll.animals + harvestAll.shelves }} 项
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="!produceAll.animals"
        :title="produceHint || '一键催产全部可生产动物'"
        @click="batchDirect('produce', produceAll.animals)"
      >
        一键催产 {{ produceAll.animals }} 只
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="!cleanable.hazards"
        :title="cleanHint || '一键清理全部栏舍'"
        @click="batchDirect('clean', cleanable.hazards)"
      >
        一键清理 {{ cleanable.hazards }} 处危险物
      </BaseButton>
    </div>

    <div
      v-for="facility in ranches"
      :key="facility.id"
      class="border border-gray-200 rounded-xl bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">{{ facility.name }}</span>
          <span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Lv.{{ facility.level }}</span>
          <span class="text-xs text-gray-500">{{ facility.summary.animalText }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span v-if="facility.summary.hazardCount" class="rounded bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            危险物 {{ facility.summary.hazardCount }}
          </span>
          <span class="rounded bg-gray-50 px-2 py-1 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">{{ facility.summary.shelfText }}</span>
        </div>
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] mt-3 gap-3">
        <div
          v-for="animal in facility.ranch?.animals || []"
          :key="animal.id"
          class="border border-gray-200 rounded-lg p-3 dark:border-gray-700"
          :class="animal.grassBlocked ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'bg-gray-50/60 dark:bg-gray-900/30'"
        >
          <div class="flex items-center gap-2">
            <img v-if="animal.image" :src="animal.image" :alt="animal.name" class="h-9 w-9 shrink-0 rounded object-contain">
            <div v-else class="i-carbon-ai-status h-9 w-9 shrink-0 text-2xl text-gray-300" />
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">
                {{ animal.name }}
              </p>
              <p class="truncate text-[11px] text-gray-500" :title="stageText(animal)">
                {{ stageText(animal) }}
              </p>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap gap-1 text-[11px] text-gray-500">
            <span class="rounded bg-white px-1.5 py-0.5 dark:bg-gray-800">产物 {{ animal.produceCount }}{{ animal.maxProduceCount ? ` / ${animal.maxProduceCount}` : '' }}</span>
            <span v-if="animal.mutation" class="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">巨大变异</span>
            <span v-if="animal.limitedCanUsed" class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">限有机罐头</span>
            <span v-if="animal.grassBlocked" class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">缺草</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="entry in animal.actions"
              :key="entry.action"
              class="border rounded px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50"
              :class="entry.danger
                ? 'border-red-200 text-red-600 dark:border-red-900 dark:text-red-300'
                : 'border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700'"
              :disabled="!entry.enabled"
              :title="entry.reason || entry.label"
              @click="animalAct(animal, entry)"
            >
              {{ entry.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="!facility.ranch?.animals.length" class="mt-3 rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500 dark:bg-gray-900/40">
        该{{ facility.name }}为空，可在同一页的「我的背包」里选中幼崽后放养。
      </div>
    </div>
  </div>
</template>
