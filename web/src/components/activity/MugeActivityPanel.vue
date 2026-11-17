/**
 * 牧歌初启（2026111700）活动面板。
 *
 * 四个子活动共用一份活动组快照，所以用页签而不是四张并列卡片：
 * 服务端一次 List 就返回全部段落，并列展示会让同一批档位信息重复出现。
 *
 * 档位状态码语义（与 proto 的 MugeTier.status 一致）：
 * 1 进行中、2 可领取、3 已领取、4 未解锁。
 */
<script setup lang="ts">
import type { MugeQuestion, MugeTask, MugeTier } from '@/stores/muge'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { MUGE_TASK_LOCKED, MUGE_TIER_CLAIMED, MUGE_TIER_READY, useMugeStore } from '@/stores/muge'
import { formatQuantity } from '@/utils/ranch'

const emit = defineEmits<{ back: [] }>()

const SECTIONS = [
  { value: 'celebration', label: '全服庆贺', icon: 'i-carbon-trophy' },
  { value: 'friends', label: '好友同游', icon: 'i-carbon-user-multiple' },
  { value: 'handbook', label: '成长手册', icon: 'i-carbon-notebook' },
  { value: 'personality', label: '牧歌人格', icon: 'i-carbon-user-avatar' },
] as const

type SectionKey = typeof SECTIONS[number]['value']

const REFRESH_INTERVAL_MS = 30_000

const accountStore = useAccountStore()
const mugeStore = useMugeStore()
const { currentAccountId } = storeToRefs(accountStore)
const { state, loading, pending, error, needsRefresh } = storeToRefs(mugeStore)

const section = ref<SectionKey>('celebration')
const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const active = computed(() => state.value?.active === true)
const busy = computed(() => !!pending.value)

/** 档位与任务都按「阈值 / 目标」判进度，分母为 0 时不画进度条，避免除零得出 NaN。 */
function percentOf(value: number, target: number) {
  if (!target || target <= 0)
    return 0
  return Math.min(100, Math.max(0, Math.round((value / target) * 100)))
}

function tierText(tier: MugeTier) {
  if (tier.status === MUGE_TIER_CLAIMED)
    return '已领取'
  if (tier.status === MUGE_TIER_READY)
    return '可领取'
  return '未达成'
}

function taskText(task: MugeTask) {
  if (task.status === MUGE_TIER_CLAIMED)
    return '已领取'
  if (task.status === MUGE_TIER_READY)
    return '可领取'
  if (task.status === MUGE_TASK_LOCKED)
    return `第 ${task.unlockDay} 天解锁`
  return '进行中'
}

const celebrationClaimable = computed(() => state.value?.celebration?.tiers.some(tier => tier.status === MUGE_TIER_READY) ?? false)
const friendsClaimable = computed(() => state.value?.friends?.tiers.some(tier => tier.status === MUGE_TIER_READY) ?? false)
const handbookClaimable = computed(() => state.value?.handbook?.tiers.some(tier => tier.status === MUGE_TIER_READY) ?? false)
const taskClaimable = computed(() => state.value?.handbook?.tasks.some(task => task.status === MUGE_TIER_READY) ?? false)

/** 每个页签右上角的待办角标，只标真正可领取的数量。 */
const sectionBadges = computed<Record<SectionKey, number>>(() => ({
  celebration: state.value?.celebration?.tiers.filter(tier => tier.status === MUGE_TIER_READY).length ?? 0,
  friends: state.value?.friends?.tiers.filter(tier => tier.status === MUGE_TIER_READY).length ?? 0,
  handbook: (state.value?.handbook?.tiers.filter(tier => tier.status === MUGE_TIER_READY).length ?? 0)
    + (state.value?.handbook?.tasks.filter(task => task.status === MUGE_TIER_READY).length ?? 0),
  personality: state.value?.personality?.personalityId ? 0 : 1,
}))

const remainingText = computed(() => {
  const end = Number(state.value?.endTime || 0)
  if (!end)
    return '结束时间未下发'
  const seconds = Math.floor((end - nowMs.value) / 1000)
  if (seconds <= 0)
    return '活动已结束'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0)
    return `${days} 天 ${hours} 小时后结束`
  if (hours > 0)
    return `${hours} 小时 ${minutes} 分后结束`
  return `${minutes} 分钟后结束`
})

function endTimeText() {
  const end = Number(state.value?.endTime || 0)
  if (!end)
    return '结束时间未下发'
  return new Date(end).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

/* ---------------- 牧歌人格问卷 ---------------- */

const answers = ref<Record<string, number>>({})
const surveyDirty = computed(() => Object.keys(answers.value).length > 0)

/** 服务端只按 question.id 校验答案，这里用字符串键与服务端 map<int64,int64> 对齐。 */
function chooseAnswer(question: MugeQuestion, value: number) {
  answers.value = { ...answers.value, [String(question.id)]: value }
}

function selectedAnswer(questionId: number) {
  return answers.value[String(questionId)]
}

const answeredCount = computed(() => {
  const questions = state.value?.questions || []
  return questions.filter(question => selectedAnswer(question.id) !== undefined).length
})

const surveyComplete = computed(() => {
  const questions = state.value?.questions || []
  return questions.length > 0 && answeredCount.value === questions.length
})

/** 面板重新读取后，用服务端已保存的答案覆盖本地草稿，避免显示上一次账号的勾选。 */
function syncAnswersFromServer() {
  const saved = state.value?.personality?.answers || {}
  answers.value = { ...saved }
}

async function saveAnswers() {
  if (!surveyDirty.value)
    return
  const ok = await mugeStore.operate('saveAnswers', { answers: answers.value, clear: false })
  if (ok)
    syncAnswersFromServer()
}

async function settle() {
  const ok = await mugeStore.operate('settle')
  if (ok)
    syncAnswersFromServer()
}

function retake() {
  answers.value = {}
  void mugeStore.operate('saveAnswers', { answers: {}, clear: true })
}

/* ---------------- 生命周期 ---------------- */

async function refresh() {
  const id = String(currentAccountId.value || '')
  if (!id)
    return
  await mugeStore.load(id)
  syncAnswersFromServer()
}

watch(currentAccountId, () => {
  answers.value = {}
  void refresh()
})

watch(() => state.value?.personality?.answers, (next) => {
  // 服务端答案变化时同步草稿；本地已改过的选项不覆盖，避免吞掉用户正在编辑的内容。
  if (!surveyDirty.value)
    answers.value = { ...(next || {}) }
}, { deep: true })

onMounted(() => {
  void refresh()
  timer = setInterval(() => {
    nowMs.value = Date.now()
    // 活动结束后停止轮询，避免继续打已经失效的接口。
    if (state.value && !state.value.active) {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      return
    }
    if (document.visibilityState === 'visible')
      void refresh()
  }, REFRESH_INTERVAL_MS)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
  timer = null
  mugeStore.clear()
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- 头部：标题、剩余时间、刷新 -->
    <div class="ui-card flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
      <BaseButton variant="ghost" size="sm" @click="emit('back')">
        ← 返回活动列表
      </BaseButton>
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-base font-bold">
          {{ state?.title || '牧歌初启' }}
        </h2>
        <p class="mt-0.5 text-xs" :style="{ color: 'var(--muted-text)' }">
          {{ remainingText }} · 截止 {{ endTimeText() }}
        </p>
      </div>
      <span
        v-if="state && !active"
        class="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
      >
        活动未开始或已结束
      </span>
      <BaseButton variant="secondary" size="sm" :loading="loading" :disabled="loading || busy" @click="refresh">
        刷新
      </BaseButton>
    </div>

    <p v-if="!currentAccountId" class="ui-subtle-panel rounded-lg px-4 py-6 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
      请先选择账号后再查看活动。
    </p>
    <p v-else-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300" role="alert">
      {{ error }}
    </p>
    <p v-else-if="needsRefresh" class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      上一次操作的结果未能完全确认，请先刷新再继续操作，避免重复提交。
    </p>
    <p v-else-if="loading && !state" class="ui-subtle-panel rounded-lg px-4 py-8 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
      正在读取活动数据…
    </p>

    <template v-else-if="state">
      <!-- 活动规则：服务端按行下发，无内容时不占位 -->
      <div v-if="state.rules.length" class="ui-subtle-panel rounded-xl px-4 py-3">
        <p class="mb-1 text-xs font-semibold" :style="{ color: 'var(--muted-text)' }">
          活动说明
        </p>
        <p v-for="(line, index) in state.rules" :key="index" class="text-xs leading-5" :style="{ color: 'var(--muted-text)' }">
          {{ line }}
        </p>
      </div>

      <!-- 页签：带待办角标 -->
      <div class="h-9 inline-flex shrink-0 overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
        <button
          v-for="row in SECTIONS"
          :key="row.value"
          class="inline-flex items-center gap-1.5 rounded-md px-3 text-sm font-medium transition"
          :class="section === row.value ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="section === row.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="section = row.value"
        >
          <span :class="row.icon" class="text-sm" />
          {{ row.label }}
          <span
            v-if="sectionBadges[row.value]"
            class="rounded-full px-1.5 text-[10px] font-bold leading-4"
            :class="section === row.value ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'"
          >
            {{ sectionBadges[row.value] }}
          </span>
        </button>
      </div>

      <!-- 全服庆贺 -->
      <div v-if="section === 'celebration'" class="flex flex-col gap-3">
        <div v-if="!state.celebration" class="ui-subtle-panel rounded-lg px-4 py-8 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
          全服庆贺数据未下发。
        </div>
        <template v-else>
          <div class="ui-card rounded-xl p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-sm font-semibold">
                全服庆贺进度
              </p>
              <span class="text-lg font-bold" :style="{ color: 'var(--theme-primary)' }">
                {{ formatQuantity(state.celebration.total) }}
              </span>
            </div>
            <p class="text-xs leading-5" :style="{ color: 'var(--muted-text)' }">
              全服累计达成后逐档解锁，档位奖励需手动领取。
            </p>
          </div>

          <div class="grid grid-cols-1 gap-2 lg:grid-cols-2 md:grid-cols-2">
            <div
              v-for="tier in state.celebration.tiers"
              :key="tier.id"
              class="ui-card flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">
                  达成 {{ formatQuantity(tier.threshold) }}
                </p>
                <div class="mt-1.5 flex items-center gap-2">
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div class="h-full rounded-full transition-all" :style="{ width: `${percentOf(state.celebration.total, tier.threshold)}%`, backgroundColor: 'var(--theme-primary)' }" />
                  </div>
                  <span class="shrink-0 text-[11px]" :style="{ color: 'var(--muted-text)' }">
                    {{ percentOf(state.celebration.total, tier.threshold) }}%
                  </span>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-1">
                  <template v-for="reward in tier.rewards" :key="`${tier.id}-${reward.id}`">
                    <img v-if="reward.image" :src="reward.image" :alt="reward.name" :title="`${reward.name} ×${formatQuantity(reward.count)}`" class="h-4 w-4 rounded object-contain">
                    <span class="text-[11px]" :style="{ color: 'var(--muted-text)' }">{{ reward.name }}×{{ formatQuantity(reward.count) }}</span>
                  </template>
                </div>
              </div>
              <span
                class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium"
                :class="tier.status === MUGE_TIER_CLAIMED
                  ? 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'
                  : tier.status === MUGE_TIER_READY
                    ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'"
              >
                {{ tierText(tier) }}
              </span>
            </div>
          </div>

          <div class="flex justify-end">
            <BaseButton variant="primary" size="sm" :loading="pending === 'claimCelebration'" :disabled="busy || !active || !celebrationClaimable" @click="mugeStore.operate('claimCelebration')">
              一键领取全服档位
            </BaseButton>
          </div>
        </template>
      </div>

      <!-- 好友同游 -->
      <div v-else-if="section === 'friends'" class="flex flex-col gap-3">
        <div v-if="!state.friends" class="ui-subtle-panel rounded-lg px-4 py-8 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
          好友同游数据未下发。
        </div>
        <template v-else>
          <div class="ui-card rounded-xl p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-sm font-semibold">
                已计数好友
              </p>
              <span class="text-lg font-bold" :style="{ color: 'var(--theme-primary)' }">
                {{ formatQuantity(state.friends.count) }}
              </span>
            </div>
            <p class="text-xs leading-5" :style="{ color: 'var(--muted-text)' }">
              好友进入活动即计入人数，档位奖励按人数逐档解锁，需手动领取。
            </p>
          </div>

          <div class="grid grid-cols-1 gap-2 lg:grid-cols-2 md:grid-cols-2">
            <div
              v-for="tier in state.friends.tiers"
              :key="tier.id"
              class="ui-card flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">
                  {{ formatQuantity(tier.threshold) }} 位好友
                </p>
                <div class="mt-1.5 flex items-center gap-2">
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div class="h-full rounded-full transition-all" :style="{ width: `${percentOf(state.friends.count, tier.threshold)}%`, backgroundColor: 'var(--theme-primary)' }" />
                  </div>
                  <span class="shrink-0 text-[11px]" :style="{ color: 'var(--muted-text)' }">
                    {{ formatQuantity(state.friends.count) }} / {{ formatQuantity(tier.threshold) }}
                  </span>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-1">
                  <template v-for="reward in tier.rewards" :key="`${tier.id}-${reward.id}`">
                    <img v-if="reward.image" :src="reward.image" :alt="reward.name" :title="`${reward.name} ×${formatQuantity(reward.count)}`" class="h-4 w-4 rounded object-contain">
                    <span class="text-[11px]" :style="{ color: 'var(--muted-text)' }">{{ reward.name }}×{{ formatQuantity(reward.count) }}</span>
                  </template>
                </div>
              </div>
              <span
                class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium"
                :class="tier.status === MUGE_TIER_CLAIMED
                  ? 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'
                  : tier.status === MUGE_TIER_READY
                    ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'"
              >
                {{ tierText(tier) }}
              </span>
            </div>
          </div>

          <div class="flex justify-end">
            <BaseButton variant="primary" size="sm" :loading="pending === 'claimFriends'" :disabled="busy || !active || !friendsClaimable" @click="mugeStore.operate('claimFriends')">
              一键领取好友档位
            </BaseButton>
          </div>
        </template>
      </div>

      <!-- 成长手册 -->
      <div v-else-if="section === 'handbook'" class="flex flex-col gap-3">
        <div v-if="!state.handbook" class="ui-subtle-panel rounded-lg px-4 py-8 text-center text-sm" :style="{ color: 'var(--muted-text)' }">
          成长手册数据未下发。
        </div>
        <template v-else>
          <div class="ui-card rounded-xl p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-sm font-semibold">
                手册积分
              </p>
              <span class="text-lg font-bold" :style="{ color: 'var(--theme-primary)' }">
                {{ formatQuantity(state.handbook.points) }}
              </span>
            </div>
            <p class="text-xs leading-5" :style="{ color: 'var(--muted-text)' }">
              完成任务累积积分，积分档位奖励与任务奖励需分别领取。
            </p>
          </div>

          <!-- 任务列表 -->
          <div class="ui-card rounded-xl p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-sm font-semibold">
                手册任务
              </p>
              <BaseButton variant="secondary" size="sm" :loading="pending === 'claimTask'" :disabled="busy || !active || !taskClaimable" @click="mugeStore.operate('claimTask')">
                领取已完成任务
              </BaseButton>
            </div>
            <div v-if="!state.handbook.tasks.length" class="py-6 text-center text-xs" :style="{ color: 'var(--muted-text)' }">
              暂无任务。
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="task in state.handbook.tasks"
                :key="task.id"
                class="border border-gray-200 rounded-lg px-2.5 py-2 dark:border-gray-700"
              >
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm leading-5">
                      {{ task.description }}
                    </p>
                    <div class="mt-1.5 flex items-center gap-2">
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                        <div class="h-full rounded-full" :style="{ width: `${percentOf(task.progress, task.target)}%`, backgroundColor: 'var(--theme-primary)' }" />
                      </div>
                      <span class="shrink-0 text-[11px]" :style="{ color: 'var(--muted-text)' }">
                        {{ formatQuantity(task.progress) }} / {{ formatQuantity(task.target) }}
                      </span>
                      <span v-if="task.points" class="shrink-0 text-[11px]" :style="{ color: 'var(--muted-text)' }">
                        +{{ task.points }} 积分
                      </span>
                    </div>
                    <div v-if="task.rewards.length" class="mt-1.5 flex flex-wrap items-center gap-1">
                      <template v-for="reward in task.rewards" :key="`${task.id}-${reward.id}`">
                        <img v-if="reward.image" :src="reward.image" :alt="reward.name" :title="`${reward.name} ×${formatQuantity(reward.count)}`" class="h-4 w-4 rounded object-contain">
                        <span class="text-[11px]" :style="{ color: 'var(--muted-text)' }">{{ reward.name }}×{{ formatQuantity(reward.count) }}</span>
                      </template>
                    </div>
                  </div>
                  <span
                    class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium"
                    :class="task.status === MUGE_TIER_CLAIMED
                      ? 'bg-gray-100 text-gray-500 dark:bg-gray-900/40'
                      : task.status === MUGE_TIER_READY
                        ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                        : task.status === MUGE_TASK_LOCKED
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'"
                  >
                    {{ taskText(task) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 积分档位 -->
          <div class="ui-card rounded-xl p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-sm font-semibold">
                积分档位
              </p>
              <BaseButton variant="primary" size="sm" :loading="pending === 'claimHandbook'" :disabled="busy || !active || !handbookClaimable" @click="mugeStore.operate('claimHandbook')">
                一键领取档位
              </BaseButton>
            </div>
            <div class="grid grid-cols-1 gap-2 lg:grid-cols-2 md:grid-cols-2">
              <div
                v-for="tier in state.handbook.tiers"
                :key="tier.id"
                class="flex items-center gap-3 rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-900/40"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm">
                    {{ formatQuantity(tier.threshold) }} 积分
                  </p>
                  <div class="mt-1 flex flex-wrap items-center gap-1">
                    <template v-for="reward in tier.rewards" :key="`${tier.id}-${reward.id}`">
                      <img v-if="reward.image" :src="reward.image" :alt="reward.name" :title="`${reward.name} ×${formatQuantity(reward.count)}`" class="h-4 w-4 rounded object-contain">
                      <span class="text-[11px]" :style="{ color: 'var(--muted-text)' }">{{ reward.name }}×{{ formatQuantity(reward.count) }}</span>
                    </template>
                  </div>
                </div>
                <span
                  class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                  :class="tier.status === MUGE_TIER_CLAIMED
                    ? 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    : tier.status === MUGE_TIER_READY
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'"
                >
                  {{ tierText(tier) }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 牧歌人格 -->
      <div v-else class="flex flex-col gap-3">
        <!-- 已生成结果 -->
        <div v-if="state.personality?.personalityId" class="ui-card rounded-xl p-4">
          <div class="flex flex-wrap items-center gap-4">
            <img
              v-if="state.personality.image"
              :src="state.personality.image"
              alt="牧歌人格形象"
              class="h-36 w-auto rounded-lg object-contain"
            >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold">
                你的牧歌人格已生成
              </p>
              <p class="mt-1 text-xs leading-5" :style="{ color: 'var(--muted-text)' }">
                人格编号 {{ state.personality.personalityId }} · 已结算 {{ formatQuantity(state.personality.settleCount) }} 次
              </p>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="pending === 'claimShare'"
                  :disabled="busy || !active || state.personality.shareRewardClaimed"
                  @click="mugeStore.operate('claimShare')"
                >
                  {{ state.personality.shareRewardClaimed ? '分享奖励已领取' : '领取首次分享奖励' }}
                </BaseButton>
                <BaseButton variant="secondary" size="sm" :disabled="busy || !active" @click="retake">
                  重新测试
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 问卷 -->
        <div class="ui-card rounded-xl p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-semibold">
              {{ state.personality?.personalityId ? '重新作答' : '回答问卷生成牧场人格' }}
            </p>
            <span class="text-xs" :style="{ color: 'var(--muted-text)' }">
              已答 {{ answeredCount }} / {{ state.questions.length }}
            </span>
          </div>

          <div v-if="!state.questions.length" class="py-6 text-center text-xs" :style="{ color: 'var(--muted-text)' }">
            题目未下发。
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="question in state.questions"
              :key="question.id"
              class="border border-gray-200 rounded-lg px-3 py-2.5 dark:border-gray-700"
            >
              <p class="text-sm font-medium leading-5">
                {{ question.id }}. {{ question.title }}
              </p>
              <div class="grid grid-cols-1 mt-2 gap-1.5 lg:grid-cols-2">
                <button
                  v-for="option in question.options"
                  :key="option.value"
                  type="button"
                  class="flex items-center gap-2 border rounded-lg px-2.5 py-1.5 text-left text-xs transition"
                  :class="selectedAnswer(question.id) === option.value
                    ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'"
                  @click="chooseAnswer(question, option.value)"
                >
                  <span
                    class="h-4 w-4 flex shrink-0 items-center justify-center border rounded-full text-[10px] font-bold"
                    :class="selectedAnswer(question.id) === option.value
                      ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white'
                      : 'border-gray-300 text-gray-400 dark:border-gray-600'"
                  >
                    {{ option.label }}
                  </span>
                  <span class="min-w-0 flex-1">{{ option.text }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="pending === 'saveAnswers'"
              :disabled="busy || !active || !surveyDirty"
              @click="saveAnswers"
            >
              保存答案
            </BaseButton>
            <BaseButton
              variant="primary"
              size="sm"
              :loading="pending === 'settle'"
              :disabled="busy || !active || !surveyComplete"
              @click="settle"
            >
              提交并生成人格
            </BaseButton>
          </div>
          <p v-if="!surveyComplete && state.questions.length" class="mt-2 text-right text-[11px]" :style="{ color: 'var(--muted-text)' }">
            需回答全部 {{ state.questions.length }} 题才能生成人格。
          </p>
        </div>
      </div>
    </template>
  </section>
</template>
