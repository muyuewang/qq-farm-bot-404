<script setup lang="ts">
import type { RainPoemActivityData } from '@/stores/activity'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = defineProps<{ activity?: RainPoemActivityData | null, loading?: boolean }>()
defineEmits<{ refresh: [] }>()

const completedResearchCount = computed(() => props.activity?.research.stages.filter(stage => stage.completed).length || 0)
const totalResearchCount = computed(() => props.activity?.research.stages.length || 0)
const collectionLimit = computed(() => props.activity?.collection.dailyUseLimit || 0)
const collectionRemaining = computed(() => props.activity?.collection.remainingUseCount || 0)
const collectionUsed = computed(() => Math.max(0, collectionLimit.value - collectionRemaining.value))
const collectionProgress = computed(() => collectionLimit.value ? Math.min(100, collectionUsed.value / collectionLimit.value * 100) : 0)

function taskProgress(task: RainPoemActivityData['tasks'][number]) {
  if (!task.target)
    return task.progress > 0 ? 100 : 0
  return Math.min(100, Math.max(0, task.progress / task.target * 100))
}

function formatDateTime(seconds?: number) {
  if (!seconds)
    return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(seconds * 1000))
}
</script>

<template>
  <section class="space-y-4">
    <header class="storm-header relative overflow-hidden rounded-lg p-4 text-white shadow-sm sm:p-5">
      <img src="/activity/rain-poem/day-rain-bg.jpg" alt="" class="pointer-events-none absolute inset-0 h-full w-full object-cover object-center">
      <div class="pointer-events-none absolute inset-0 from-[#081824]/90 via-[#102b3c]/72 to-[#173445]/45 bg-gradient-to-r" />
      <div class="relative flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-xs text-cyan-100/80">
            <span class="inline-flex items-center gap-1.5 font-medium"><span class="i-carbon-events" />限时天气活动</span>
            <span v-if="activity?.endTime" class="text-white/55">至 {{ formatDateTime(activity.endTime) }}</span>
          </div>
          <h2 class="mt-1 text-2xl font-semibold">
            {{ activity?.title || '雨落成诗' }}
          </h2>
        </div>
        <BaseButton size="sm" variant="secondary" :loading="loading" aria-label="刷新活动数据" @click="$emit('refresh')">
          <span v-if="!loading" class="i-carbon-renew text-base" />
          <span class="ml-1.5 hidden sm:inline">刷新</span>
        </BaseButton>
      </div>

      <div class="relative grid grid-cols-2 mt-4 gap-2 sm:grid-cols-4">
        <div class="status-tile col-span-2 sm:col-span-1">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/10">
            <span :class="activity?.weather?.rainstorm ? 'i-carbon-rain-heavy text-cyan-200' : 'i-carbon-cloud text-white/70'" class="text-2xl" />
          </div>
          <div class="min-w-0">
            <div class="status-label">
              当前天气
            </div>
            <div class="truncate font-semibold">
              {{ activity?.weather?.rainstorm ? '雷雨中' : '非雷雨' }}
            </div>
            <div v-if="activity?.weather?.endTime" class="truncate text-[11px] text-white/55">
              至 {{ formatDateTime(activity.weather.endTime) }}
            </div>
          </div>
        </div>
        <div class="status-tile">
          <img src="/activity/rain-poem/weather-collection-bottle.png" class="h-10 w-10 shrink-0 object-contain" alt="">
          <div>
            <div class="status-label">
              采集瓶
            </div><div class="text-lg font-semibold">
              {{ activity?.items.collectionBottles || 0 }}
            </div>
          </div>
        </div>
        <div class="status-tile">
          <img src="/activity/rain-poem/rainstorm-summon-bottle.png" class="h-10 w-10 shrink-0 object-contain" alt="">
          <div>
            <div class="status-label">
              召唤瓶
            </div><div class="text-lg font-semibold">
              {{ activity?.items.summonBottles || 0 }}
            </div>
          </div>
        </div>
        <div class="status-tile">
          <img src="/activity/rain-poem/lightning-badge.svg" class="h-10 w-10 shrink-0 object-contain" alt="">
          <div>
            <div class="status-label">
              雷电徽章
            </div><div class="text-lg font-semibold">
              {{ activity?.items.badges || 0 }}
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      <article class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800 sm:p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-gray-900 font-semibold dark:text-white">
              今日雷雨采集
            </h3>
            <p class="mt-0.5 text-xs text-gray-500">
              使用采集瓶后可获得 {{ activity?.collection.reward.itemName || '雷雨召唤瓶' }}
            </p>
          </div>
          <strong class="shrink-0 text-xl text-gray-900 dark:text-white">{{ collectionRemaining }}<span class="text-sm text-gray-400 font-normal">/{{ collectionLimit }}</span></strong>
        </div>
        <div class="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div class="h-full rounded-full bg-cyan-500 transition-all" :style="{ width: `${collectionProgress}%` }" />
        </div>
        <div class="mt-2 flex justify-between text-xs text-gray-500">
          <span>已采集 {{ collectionUsed }} 次</span>
          <span>单次奖励 ×{{ activity?.collection.reward.itemCount || 0 }}</span>
        </div>
      </article>

      <article class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-gray-900 font-semibold dark:text-white">
              每日补给
            </h3>
            <p class="mt-0.5 text-xs text-gray-500">
              天气采集瓶每日限购 {{ activity?.shop.dailyLimit || 0 }} 个
            </p>
          </div>
          <span
            class="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
            :class="activity?.shop.purchasedToday ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : activity?.shop.available ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700'"
          >
            <span :class="activity?.shop.purchasedToday ? 'i-carbon-checkmark-filled' : 'i-carbon-time'" />
            {{ activity?.shop.purchasedToday ? '今日已购买' : activity?.shop.available ? '今日可购买' : '暂不可购买' }}
          </span>
        </div>
        <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-sm dark:border-gray-700">
          <span class="text-gray-500">持有数量</span>
          <strong class="text-gray-900 dark:text-white">{{ activity?.items.collectionBottles || 0 }}</strong>
        </div>
      </article>
    </div>

    <article class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800 sm:p-5">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-gray-900 font-semibold dark:text-white">
          气象任务
        </h3>
        <span class="text-xs text-gray-500">每日进度</span>
      </div>
      <div class="grid mt-3 gap-3 md:grid-cols-3">
        <div v-for="task in activity?.tasks || []" :key="task.id" class="min-h-32 border border-gray-200 rounded-lg p-4 dark:border-gray-700">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 text-gray-900 font-medium dark:text-white">
              {{ task.desc }}
            </div>
            <span v-if="taskProgress(task) >= 100" class="i-carbon-checkmark-filled shrink-0 text-lg text-emerald-500" aria-label="已完成" />
          </div>
          <div class="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div class="h-full rounded-full transition-all" :class="taskProgress(task) >= 100 ? 'bg-emerald-500' : 'bg-cyan-500'" :style="{ width: `${taskProgress(task)}%` }" />
          </div>
          <div class="mt-2 flex items-center justify-between gap-2 text-xs">
            <span class="text-gray-500">{{ task.progress }}<template v-if="task.target">/{{ task.target }}</template></span>
            <span class="truncate text-amber-600 dark:text-amber-400">{{ task.reward.itemName }} ×{{ task.reward.itemCount }}</span>
          </div>
        </div>
        <div v-if="!activity?.tasks?.length" class="border border-gray-200 rounded-lg border-dashed p-6 text-center text-sm text-gray-500 dark:border-gray-700">
          暂无任务状态
        </div>
      </div>
    </article>

    <article class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800 sm:p-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 class="text-gray-900 font-semibold dark:text-white">
            气象研究
          </h3>
          <p class="mt-0.5 text-xs text-gray-500">
            按顺序解锁研究节点，获得对应阶段奖励
          </p>
        </div>
        <span class="rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{{ completedResearchCount }}/{{ totalResearchCount }} 已解锁</span>
      </div>
      <div class="grid mt-5 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="(stage, index) in activity?.research.stages || []"
          :key="stage.id"
          class="research-stage relative border rounded-lg p-3.5"
          :class="stage.completed ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20' : stage.available ? 'border-cyan-400 bg-cyan-50 ring-2 ring-cyan-100 dark:border-cyan-600 dark:bg-cyan-950/20 dark:ring-cyan-950' : 'border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30'"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium" :class="stage.completed ? 'text-emerald-700 dark:text-emerald-300' : stage.available ? 'text-cyan-700 dark:text-cyan-300' : 'text-gray-400'">阶段 {{ index + 1 }}</span>
            <span :class="stage.completed ? 'i-carbon-checkmark-filled text-emerald-500' : stage.available ? 'i-carbon-unlocked text-cyan-600' : 'i-carbon-locked text-gray-400'" />
          </div>
          <div class="mt-3 flex items-center gap-2.5">
            <div class="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-white shadow-sm dark:bg-gray-800">
              <img v-if="stage.reward.image" :src="stage.reward.image" class="h-9 w-9 object-contain" alt="">
              <span v-else class="i-carbon-gift text-xl text-gray-400" />
            </div>
            <div class="min-w-0">
              <div class="truncate text-sm text-gray-900 font-medium dark:text-white">
                {{ stage.reward.itemName }}
              </div>
              <div class="text-xs text-gray-500">
                奖励 ×{{ stage.reward.itemCount }}
              </div>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between border-t border-black/5 pt-2.5 text-xs dark:border-white/10">
            <span class="text-gray-500">消耗 {{ stage.cost.itemName }} ×{{ stage.cost.itemCount }}</span>
            <span class="font-medium" :class="stage.completed ? 'text-emerald-600' : stage.available ? 'text-cyan-600' : 'text-gray-400'">{{ stage.completed ? '已解锁' : stage.available ? '当前可解锁' : '需解锁前置节点' }}</span>
          </div>
        </div>
        <div v-if="!activity?.research.stages?.length" class="border border-gray-200 rounded-lg border-dashed p-6 text-center text-sm text-gray-500 dark:border-gray-700">
          暂无研究状态
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.storm-header {
  background-color: #173445;
}

.status-tile {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.625rem;
  min-height: 3.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.08);
  padding: 0.5rem 0.625rem;
}

.status-label {
  color: rgba(207, 250, 254, 0.7);
  font-size: 0.6875rem;
  line-height: 1rem;
}

@media (min-width: 1280px) {
  .research-stage:not(:last-child)::after {
    position: absolute;
    top: 50%;
    right: -0.8125rem;
    z-index: 2;
    width: 0.625rem;
    height: 2px;
    background: #cbd5e1;
    content: '';
  }
}
</style>
