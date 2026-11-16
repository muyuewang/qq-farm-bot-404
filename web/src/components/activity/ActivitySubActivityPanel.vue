<script setup lang="ts">
import type { ActivityLabels } from './types'
import type { HeluSubActivity } from '@/stores/activity'

defineProps<{
  activity: HeluSubActivity
  labels: ActivityLabels
}>()

function formatTime(value?: number) {
  const raw = Number(value || 0)
  if (!raw)
    return '-'
  const ms = raw > 1000000000000 ? raw : raw * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime()))
    return '-'
  return date.toLocaleString()
}

function statusText(activity: HeluSubActivity) {
  if (!activity.available)
    return '未返回'
  if (!activity.enabled)
    return '未启用'
  if (!activity.visible)
    return '隐藏'
  if (activity.status)
    return `状态 ${activity.status}`
  return '可见'
}
</script>

<template>
  <section class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0 flex items-center gap-3">
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300">
          <div :class="activity.icon" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-base text-gray-900 font-semibold dark:text-gray-100">
            {{ activity.title }}
          </h2>
        </div>
      </div>
      <span
        class="inline-flex rounded-lg px-2.5 py-1 text-xs"
        :class="activity.available ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-gray-50 text-gray-500 dark:bg-gray-900/40 dark:text-gray-300'"
      >
        {{ statusText(activity) }}
      </span>
    </div>

    <div class="grid mt-4 gap-3 md:grid-cols-3">
      <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          ID
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ activity.id || '-' }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          开始时间
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ formatTime(activity.startTime) }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          结束时间
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ formatTime(activity.endTime) }}
        </div>
      </div>
    </div>
  </section>
</template>
