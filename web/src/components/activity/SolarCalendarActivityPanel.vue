<script setup lang="ts">
import type { SolarCalendar, SolarCalendarEvent, SolarCalendarSeason, SolarReward } from './solar-calendar-types'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import SolarCalendarEventCard from './SolarCalendarEventCard.vue'

defineEmits<{ back: [] }>()
const { currentAccountId } = storeToRefs(useAccountStore())
const toast = useToastStore()

const calendar = ref<SolarCalendar | null>(null)
const busy = ref(false)
const submitting = ref(false)
const error = ref('')
let generation = 0
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined

const answerTarget = ref<SolarCalendarEvent | null>(null)
const chosenOption = ref<number | null>(null)

const eventsById = computed(() => new Map((calendar.value?.events || []).map(e => [e.id, e])))
// 未被任何季度归组的节令单独陈列，避免官方新增季度分组滞后时漏展示。
const groupedIds = computed(() => new Set((calendar.value?.seasons || []).flatMap(s => s.eventIds)))
const ungroupedEvents = computed(() => (calendar.value?.events || []).filter(e => !groupedIds.value.has(e.id)))

function seasonEvents(season: SolarCalendarSeason) {
  return season.eventIds.map(id => eventsById.value.get(id)).filter((e): e is SolarCalendarEvent => !!e)
}

async function refresh() {
  if (disposed || busy.value || !currentAccountId.value)
    return
  const version = generation
  busy.value = true
  try {
    const { data } = await api.get('/api/activity/solar-calendar')
    if (version !== generation)
      return
    calendar.value = data.calendar
    error.value = ''
  }
  catch (e: any) {
    if (version === generation)
      error.value = e.response?.data?.error || e.message || '节令日历读取失败'
  }
  finally {
    busy.value = false
    if (version !== generation && currentAccountId.value)
      refresh()
  }
}

async function operate(payload: Record<string, any>, successText: string) {
  if (disposed || submitting.value || !currentAccountId.value)
    return false
  const version = generation
  submitting.value = true
  try {
    const { data } = await api.post('/api/activity/solar-calendar/operate', payload)
    if (version !== generation)
      return false
    if (!data.ok)
      throw new Error(data.error || '操作失败')
    if (data.calendar)
      calendar.value = data.calendar
    else if (data.refreshRequired)
      toast.info(`${successText}，但状态刷新失败，请手动刷新`)
    const rewards: SolarReward[] = data.rewards || []
    toast.success(rewards.length ? `${successText}：${rewards.map(r => `${r.name}x${r.count}`).join(' / ')}` : successText)
    return true
  }
  catch (e: any) {
    if (version === generation)
      toast.error(e.response?.data?.error || e.message)
    return false
  }
  finally {
    submitting.value = false
  }
}

function claimEvent(event: SolarCalendarEvent) {
  operate({ action: 'claim', id: event.id }, `已领取「${event.name}」节令赠礼`)
}

function claimSeason(season: SolarCalendarSeason) {
  operate({ action: 'season', id: season.id }, `已领取「${season.name || season.id}」季度奖励`)
}

function openAnswer(event: SolarCalendarEvent) {
  answerTarget.value = event
  chosenOption.value = null
}

function closeAnswer() {
  answerTarget.value = null
  chosenOption.value = null
}

async function submitAnswer() {
  const event = answerTarget.value
  if (!event || chosenOption.value === null)
    return
  const ok = await operate(
    { action: 'answer', id: event.id, optionIndex: chosenOption.value, expectedQuestion: event.question },
    '答题完成',
  )
  if (ok)
    closeAnswer()
}

function visibility() {
  if (document.visibilityState === 'visible')
    refresh()
}

watch(currentAccountId, async () => {
  generation++
  calendar.value = null
  error.value = ''
  closeAnswer()
  await refresh()
})

onMounted(() => {
  refresh()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible')
      refresh()
  }, 30_000)
  document.addEventListener('visibilitychange', visibility)
})

onUnmounted(() => {
  disposed = true
  generation++
  clearInterval(timer)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="$emit('back')">
        <span class="i-carbon-arrow-left" />返回活动列表
      </button>
      <button class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm disabled:opacity-50 dark:bg-gray-800" :disabled="busy || submitting || !currentAccountId" @click="refresh">
        {{ busy ? '加载中…' : '刷新' }}
      </button>
    </div>
    <h2 class="text-xl font-semibold">节令日历</h2>

    <p v-if="!currentAccountId" class="text-sm text-gray-500">请先选择账号</p>
    <p v-else-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
    <p v-else-if="!calendar" class="text-sm text-gray-500">{{ busy ? '正在读取节令日历…' : '暂无节令数据' }}</p>

    <template v-else>
      <div v-if="calendar.seasons.length" class="space-y-4">
        <article v-for="season in calendar.seasons" :key="season.id" class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <h3 class="truncate text-base font-semibold">{{ season.name || `季度 ${season.id}` }}</h3>
              <p class="mt-0.5 text-xs text-gray-500">{{ season.description }}</p>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="rounded-lg bg-gray-50 px-2.5 py-1 dark:bg-gray-900/40">点亮 {{ season.litCount }}/{{ season.totalCount }}</span>
              <BaseButton v-if="season.canClaim" variant="primary" :loading="submitting" @click="claimSeason(season)">领取季度奖励</BaseButton>
              <span v-else-if="season.claimed" class="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">季度奖励已领取</span>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SolarCalendarEventCard
              v-for="event in seasonEvents(season)"
              :key="event.id"
              :event="event"
              @claim="claimEvent"
              @answer="openAnswer"
            />
          </div>
        </article>
      </div>

      <article v-if="ungroupedEvents.length" class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h3 class="text-base font-semibold">其他节令</h3>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SolarCalendarEventCard v-for="event in ungroupedEvents" :key="event.id" :event="event" @claim="claimEvent" @answer="openAnswer" />
        </div>
      </article>
    </template>

    <div v-if="answerTarget" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="closeAnswer">
      <div class="w-full max-w-md rounded-xl bg-white p-5 shadow-lg dark:bg-gray-800">
        <h4 class="text-base font-semibold">{{ answerTarget.name }} · 节令问答</h4>
        <p class="mt-2 text-sm text-gray-700 dark:text-gray-200">{{ answerTarget.question }}</p>
        <ul class="mt-3 space-y-2">
          <li v-for="(option, index) in answerTarget.options" :key="index">
            <label
              class="flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              :class="[
                chosenOption === index ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-gray-700',
                answerTarget.wrongOptions.includes(index) ? 'opacity-50' : '',
              ]"
            >
              <span class="min-w-0">
                <input type="radio" name="solar-answer" :value="index" :disabled="answerTarget.wrongOptions.includes(index)" class="mr-2" @change="chosenOption = index">
                {{ option }}
              </span>
              <span v-if="answerTarget.answerIndex === index" class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">正确答案</span>
            </label>
          </li>
        </ul>
        <p v-if="answerTarget.errorTips" class="mt-2 text-xs text-gray-500">答错提示：{{ answerTarget.errorTips }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" @click="closeAnswer">取消</button>
          <BaseButton variant="primary" :loading="submitting" :disabled="chosenOption === null" @click="submitAnswer">提交答案</BaseButton>
        </div>
      </div>
    </div>
  </section>
</template>
