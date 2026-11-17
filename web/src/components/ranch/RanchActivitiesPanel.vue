<script setup lang="ts">
import type { RanchRequest, RanchState } from '@/utils/ranch'
import { computed } from 'vue'
import RanchDailyShareCard from '@/components/ranch/RanchDailyShareCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { activityStatus, formatDateTime } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

const activities = computed(() => props.state?.activities || [])

/** 排序：进行中优先，其次按开始时间倒序，结束时间缺失排在最后。 */
const sorted = computed(() => activities.value.slice().sort((a, b) => {
  const rank = { active: 0, upcoming: 1, ended: 2, unknown: 3 } as Record<string, number>
  const delta = (rank[a.status.state] ?? 3) - (rank[b.status.state] ?? 3)
  return delta !== 0 ? delta : b.startTime - a.startTime
}))

function statusTone(state: string) {
  if (state === 'active')
    return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
  if (state === 'upcoming')
    return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
  if (state === 'ended')
    return 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'
  return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
}

/** 活动接口只给列表；单个活动的商店、任务等操作仍由各活动页面负责。 */
function isCurrent(activity: any) {
  return activityStatus(activity, props.state?.serverTime).state === 'active'
}
</script>

<template>
  <div class="space-y-3">
    <RanchDailyShareCard :share="state?.dailyShare ?? null" @request="payload => emit('request', payload)" />

    <div v-if="!state?.activities" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      活动列表未下发，请点击刷新重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          牧场登记了 {{ activities.length }} 个活动
        </span>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          服务端时钟 {{ formatDateTime(state.serverTime) }}
        </span>
      </div>

      <div v-if="!activities.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
        当前牧场没有活动。
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        <div
          v-for="activity in sorted"
          :key="activity.id"
          class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          :class="isCurrent(activity) ? '' : 'opacity-70'"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="min-w-0 flex-1 truncate text-sm font-medium">
              {{ activity.name }}
            </p>
            <span class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium" :class="statusTone(activity.status.state)">
              {{ activity.status.label }}
            </span>
          </div>
          <p class="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
            活动 ID {{ activity.id }}
          </p>
          <dl class="mt-2 text-xs text-gray-600 space-y-1 dark:text-gray-300">
            <div class="flex items-center gap-2">
              <dt class="w-8 shrink-0 text-gray-400">
                开始
              </dt>
              <dd class="min-w-0 flex-1 truncate">
                {{ activity.startTime ? formatDateTime(activity.startTime) : '未下发' }}
              </dd>
            </div>
            <div class="flex items-center gap-2">
              <dt class="w-8 shrink-0 text-gray-400">
                结束
              </dt>
              <dd class="min-w-0 flex-1 truncate">
                {{ activity.endTime ? formatDateTime(activity.endTime) : '未下发' }}
              </dd>
            </div>
          </dl>
          <BaseButton to="/activity" variant="secondary" size="sm" class="mt-2 w-full">
            前往活动页
          </BaseButton>
        </div>
      </div>
    </template>
  </div>
</template>
