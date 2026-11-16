<script setup lang="ts">
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { formatQuantity, formatSeconds, grassRoom, itemListLine } from '@/utils/ranch'
import type { RanchFacility, RanchRequest, RanchState } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

const grassInputs = ref<Record<string, string>>({})

function facilities() {
  return props.state?.facilities || []
}

function grassDefault(facility: RanchFacility) {
  const room = grassRoom(facility)
  return room > 0n ? String(room) : '0'
}

function grassCount(facility: RanchFacility) {
  return grassInputs.value[facility.id] ?? grassDefault(facility)
}

/** 模板里不写 BigInt 字面量，判空与上限都从这里出。 */
function roomText(facility: RanchFacility) {
  return grassRoom(facility).toString()
}

function canAddGrass(facility: RanchFacility) {
  return grassRoom(facility) > 0n
}

function requestGrass(facility: RanchFacility) {
  const count = Number(grassCount(facility))
  emit('request', {
    action: 'addGrass',
    input: { facilityId: facility.id, count: Number.isFinite(count) && count > 0 ? count : 0 },
    title: `补充牧草：${facility.name}`,
    note: '消耗背包里的牧草，容量不足或数量超限时服务端会直接拒绝。',
  })
}

function requestUpgrade(facility: RanchFacility) {
  emit('request', {
    action: 'upgrade',
    input: { facilityId: facility.id },
    title: `升级${facility.name}至 Lv.${facility.next?.level ?? '?'}`,
    note: `升级耗时 ${formatSeconds(facility.next?.durationSec ?? 0)}，完成后需再点「完成升级」领取。`,
  })
}

function requestComplete(facility: RanchFacility) {
  emit('request', {
    action: 'completeUpgrade',
    input: { facilityId: facility.id },
    title: `完成升级：${facility.name}`,
  })
}

/** 后端判据：upgrade_state 为 2 视为完成待领取，其余值只有到点后才允许完成。 */
function completable(facility: RanchFacility) {
  if (!facility.upgradeState)
    return false
  return facility.upgradeState === 2 || facility.upgradeCountdown === 0
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!facilities().length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      暂未读取到牧场设施。
    </div>

    <div
      v-for="facility in facilities()"
      :key="facility.id"
      class="border border-gray-200 rounded-xl bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">{{ facility.name }}</span>
          <span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Lv.{{ facility.level }}</span>
          <span v-if="!facility.active" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-900/40">状态码 {{ facility.state }}</span>
        </div>
        <div class="text-xs text-gray-500">
          容量 {{ formatQuantity(facility.capacity) }}
        </div>
      </div>

      <!-- 牧草机 -->
      <div v-if="facility.isGrassMachine" class="mt-3 space-y-3">
        <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div class="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-900/40">
            <p class="text-gray-500">
              机内牧草
            </p>
            <p class="mt-1 font-medium">
              {{ formatQuantity(facility.feed?.count) }} / {{ formatQuantity(facility.capacity) }}
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-900/40">
            <p class="text-gray-500">
              可继续装入
            </p>
            <p class="mt-1 font-medium">
              {{ formatQuantity(roomText(facility)) }}
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-900/40">
            <p class="text-gray-500">
              机内剩余时长
            </p>
            <p class="mt-1 font-medium">
              {{ formatSeconds(facility.feed?.remainingSec) }}
            </p>
          </div>
        </div>
        <p class="text-[11px] text-gray-500">
          消耗速率 {{ facility.feed?.consumeRate ?? '—' }}、投喂状态码 {{ facility.feed?.status ?? '—' }}：服务端未提供单位与取值释义，此处原样展示。
        </p>
        <div class="flex flex-wrap items-end gap-2">
          <BaseInput
            v-model="grassInputs[facility.id]"
            type="number"
            label="补充数量"
            class="w-32"
            :min="0"
            :max="roomText(facility)"
            :placeholder="grassDefault(facility)"
          />
          <BaseButton variant="primary" size="sm" :disabled="!canAddGrass(facility)" @click="requestGrass(facility)">
            补充牧草
          </BaseButton>
        </div>
      </div>

      <!-- 升级信息 -->
      <div v-if="facility.next" class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs text-gray-600 dark:text-gray-300">
            下一级 Lv.{{ facility.next.level }} · 容量 {{ facility.next.capacity }} · 耗时 {{ formatSeconds(facility.next.durationSec) }}
            <span v-if="facility.next.requiredLevel !== null"> · 需牧场等级 {{ facility.next.requiredLevel }}</span>
          </div>
          <BaseButton variant="secondary" size="sm" :disabled="!facility.next.available" :title="facility.next.available ? '' : '等级不足或正在升级'" @click="requestUpgrade(facility)">
            升级
          </BaseButton>
        </div>
        <p v-if="facility.next.costs.length" class="mt-1 text-[11px] text-gray-500">
          升级消耗：{{ itemListLine(facility.next.costs) }}
        </p>
        <p v-else-if="facility.next.available" class="mt-1 text-[11px] text-amber-600">
          后端未确认升级费用，报价阶段仍会给出实际消耗。
        </p>
      </div>

      <div v-if="facility.upgradeState" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        <span>
          {{ completable(facility) ? '升级已完成，等待领取' : `升级中，约 ${formatSeconds(facility.upgradeCountdown)} 后完成` }}
        </span>
        <BaseButton variant="primary" size="sm" :disabled="!completable(facility)" @click="requestComplete(facility)">
          完成升级
        </BaseButton>
      </div>
    </div>
  </div>
</template>
