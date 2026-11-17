<script setup lang="ts">
import type { RanchRequest, RanchState } from '@/utils/ranch'
import { computed, ref } from 'vue'
import RanchDailyBenefitCard from '@/components/ranch/RanchDailyBenefitCard.vue'
import RanchDailyShareCard from '@/components/ranch/RanchDailyShareCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { itemListLine } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

const TABS = [
  { value: 'all', label: '全部' },
  { value: 'daily', label: '日常任务' },
  { value: 'growth', label: '成长任务' },
] as const

const tab = ref<'all' | 'daily' | 'growth'>('all')
const useMultiplier = ref(true)

const tasks = computed(() => props.state?.tasks || [])
const share = computed(() => props.state?.dailyShare ?? null)
const benefit = computed(() => props.state?.dailyBenefit ?? null)
const claimable = computed(() => tasks.value.filter(task => task.canClaim))
const visible = computed(() => tasks.value.filter(task => tab.value === 'all' || task.category === tab.value))
const guide = computed(() => tasks.value.find(task => task.entry === 'friends') || null)

function statusOf(task: any) {
  if (!task.unlocked)
    return { label: '未解锁', tone: 'idle' }
  if (task.claimed)
    return { label: '已领取', tone: 'idle' }
  if (task.canClaim)
    return { label: '可领取', tone: 'ready' }
  return { label: '进行中', tone: 'active' }
}

function claimOne(task: any) {
  emit('request', {
    action: 'claimTasks',
    input: { taskId: task.id, double: useMultiplier.value },
    title: `领取任务奖励：${task.desc}`,
    note: noteOf(task),
  })
}

function claimAll() {
  emit('request', {
    action: 'claimTasks',
    input: { all: true, double: useMultiplier.value },
    title: `一键领取 ${claimable.value.length} 个任务`,
    note: '服务端按领取时的任务状态重新挑选可领取任务，读取后刚完成的也会一并领取。',
  })
}

function reportEntry() {
  emit('request', {
    action: 'reportEntry',
    input: { entry: 'friends' },
    title: '完成好友牧场引导任务',
    note: '该入口由服务端上报进度，若已满足条件会直接变成可领取；其它引导入口后端尚未验证，页面不提供。',
  })
}

/** 分享倍数由服务端下发，关闭后按单倍领取，用来避免误耗掉翻倍次数。 */
function noteOf(task: any) {
  if (!useMultiplier.value)
    return '已选择按单倍领取。'
  return task.shareMultiple > 1 ? `服务端下发的分享倍数为 ${task.shareMultiple}×，按倍数发奖。` : '该任务当前分享倍数为 1×。'
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!state?.tasks" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      任务数据未下发，请点击刷新重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="row in TABS"
            :key="row.value"
            class="min-w-20 rounded-md px-3 text-sm font-medium transition"
            :class="tab === row.value ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="tab === row.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="tab = row.value"
          >
            {{ row.label }}
          </button>
        </div>
        <BaseSwitch v-model="useMultiplier" label="按分享倍数翻倍领取" />
        <BaseButton variant="primary" size="sm" :disabled="!claimable.length" @click="claimAll">
          一键领取 {{ claimable.length }} 个
        </BaseButton>
      </div>

      <RanchDailyBenefitCard :benefit="benefit" />
      <RanchDailyShareCard :share="share" @request="payload => emit('request', payload)" />

      <div
        v-if="guide && !guide.claimed"
        class="flex flex-wrap items-center gap-2 border border-gray-200 rounded-xl bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40"
      >
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">
            {{ guide.desc }}
          </p>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            进度 {{ guide.known ? `${guide.progress} / ${guide.total}` : '分母未下发' }} · 需要进入好友牧场完成的引导任务
          </p>
        </div>
        <BaseButton variant="secondary" size="sm" @click="reportEntry">
          上报引导进度
        </BaseButton>
      </div>

      <div v-if="!visible.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
        该分类下暂无牧场任务。
      </div>

      <div class="space-y-2">
        <div
          v-for="task in visible"
          :key="task.id"
          class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">
                {{ task.desc }}
              </p>
              <div class="mt-1.5 flex items-center gap-2">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div class="h-full rounded-full" :style="{ width: `${task.percent}%`, backgroundColor: 'var(--theme-primary)' }" />
                </div>
                <span class="shrink-0 text-[11px] text-gray-500">
                  {{ task.known ? `${task.progress} / ${task.total}` : `${task.progress} / 分母未下发` }}
                </span>
              </div>
            </div>
            <span
              class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium"
              :class="{
                idle: 'bg-gray-100 text-gray-500 dark:bg-gray-900/40',
                ready: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',
                active: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
              }[statusOf(task).tone]"
            >
              {{ statusOf(task).label }}
            </span>
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex flex-1 flex-wrap items-center gap-1.5">
              <img v-if="task.rewards[0]?.image" :src="task.rewards[0].image" :alt="task.rewards[0].name" class="h-5 w-5 rounded object-contain">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">
                奖励 {{ itemListLine(task.rewards) }}
                <span v-if="task.shareMultiple > 1" class="text-gray-400">· 分享倍数 {{ task.shareMultiple }}×</span>
              </span>
            </div>
            <BaseButton variant="primary" size="sm" :disabled="!task.canClaim" @click="claimOne(task)">
              领取
            </BaseButton>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
