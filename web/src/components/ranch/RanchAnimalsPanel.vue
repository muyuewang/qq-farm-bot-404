<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { batchTargets, formatSeconds } from '@/utils/ranch'
import type { RanchAnimal, RanchFacility, RanchRequest, RanchState } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

const ranches = computed(() => (props.state?.facilities || []).filter((facility: RanchFacility) => facility.isRanch))
const cleanable = computed(() => batchTargets(props.state, 'clean'))
const harvestAll = computed(() => batchTargets(props.state, 'harvest'))
const produceAll = computed(() => batchTargets(props.state, 'produce'))

/** 一键动作让后端自己挑目标（input.all），页面不复制它的筛选条件，避免两边判据不一致。 */
function batchRequest(action: 'harvest' | 'produce' | 'clean', count: number) {
  const titles = { harvest: '一键收获全部产物', produce: '一键催产全部可生产动物', clean: '一键清理全部栏舍' }
  const notes = {
    harvest: '服务端按当前状态挑选可收获的产物与货架，中途成熟的也会一并处理。',
    produce: '服务端按当前状态挑选可生产的动物，缺少牧草的不会被强行触发。',
    clean: '清理自家全部栏舍的危险物。',
  }
  emit('request', { action, input: { all: true }, title: `${titles[action]}（${count} 项）`, note: notes[action] })
}

function animalRequest(animal: RanchAnimal, entry: RanchAnimal['actions'][number]) {
  emit('request', {
    action: entry.action,
    input: entry.input,
    title: `${entry.label}：${animal.name}`,
    danger: entry.danger,
    note: entry.action === 'release' ? '放生后动物离开栏舍，已产出的产物保留；服务端会再次核对状态。' : undefined,
  })
}

function stageText(animal: RanchAnimal) {
  const countdown = animal.countdown === null ? '' : ` · ${formatSeconds(animal.countdown)} 后变化`
  return `${animal.stageName}${countdown}`
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!ranches.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      当前没有已建造的窝或棚，请在设施分区建造或升级栏舍。
    </div>

    <div v-if="state" class="flex flex-wrap gap-2">
      <BaseButton
        variant="primary"
        size="sm"
        :disabled="!harvestAll.total"
        @click="batchRequest('harvest', harvestAll.total)"
      >
        一键收获 {{ harvestAll.animals + harvestAll.shelves }} 项
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="!produceAll.animals"
        @click="batchRequest('produce', produceAll.animals)"
      >
        一键催产 {{ produceAll.animals }} 只
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="!cleanable.hazards"
        @click="batchRequest('clean', cleanable.hazards)"
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

      <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
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
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="entry in animal.actions"
              :key="entry.action"
              class="rounded border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50"
              :class="entry.danger
                ? 'border-red-200 text-red-600 dark:border-red-900 dark:text-red-300'
                : 'border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700'"
              :disabled="!entry.enabled"
              :title="entry.reason || entry.label"
              @click="animalRequest(animal, entry)"
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
