<script setup lang="ts">
import type { LedgerMetrics, LedgerTone, LedgerViewEntry, MetricKey } from '@/utils/operation-ledger-view'
import { computed, ref } from 'vue'
import { useOperationLedgerStore } from '@/stores/operation-ledger'
import { formatWanAmount } from '@/utils/number-format'
import {
  dayLabel,
  describeEntry,
  describeRow,
  groupLedgerEntries,
  metricsOf,
  toneOf,
  topSources,
} from '@/utils/operation-ledger-view'

// 纯展示组件：拉取、切换场景、刷新都由页面统一调度。
// 农作物与牧场同一结构：指标卡 → 动作筛选 → 按天分组的明细，口径由后端归一化。
const props = defineProps<{ scene: 'farm' | 'ranch' }>()

const store = useOperationLedgerStore()

// 桌面端露出的筛选标签数；手机端横向滚动，全部可见
const CHIP_LIMIT = 10

const TONE_CLASSES: Record<LedgerTone, string> = {
  income: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  expense: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  exp: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  none: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

interface Line {
  id: string
  group: boolean
  expanded: boolean
  nested: boolean
  time: string
  label: string
  tone: LedgerTone
  title: string
  count: number
  detail: string
  metrics: LedgerMetrics
}

const chipsExpanded = ref(false)
const expandedGroups = ref(new Set<string>())

const summary = computed(() => store.summary)
const actions = computed(() => summary.value?.actions ?? [])
const expLabel = computed(() => summary.value?.expLabel ?? (props.scene === 'ranch' ? '牧场经验' : '经验'))
const currencyName = computed(() => summary.value?.currency?.name ?? (props.scene === 'ranch' ? '金券' : '金币'))
const standardIds = computed(() => new Set(summary.value?.standardItemIds ?? []))
const showSummary = computed(() => !!summary.value && (summary.value.total.times > 0 || !!store.op))

const emptyText = computed(() => {
  if (store.op)
    return '所选动作在当前时间范围内没有记录。'
  return props.scene === 'farm'
    ? '暂无农作物流水，运行后买种子、种植、施肥、收获、出售会自动记录。'
    : '暂无牧场流水，购买、添加罐头、投喂、生产、收获、出售会自动记录。'
})

function signedGain(value: number) {
  return value > 0 ? `+${formatWanAmount(value)}` : '0'
}

function sourceText(metric: MetricKey, sign: string) {
  const list = topSources(actions.value, metric)
  return list.length ? list.map(item => `${item.label} ${sign}${formatWanAmount(item.value)}`).join(' · ') : '暂无'
}

const kpis = computed(() => {
  const data = summary.value
  if (!data)
    return []
  const { exp, income, expense, times } = data.total
  const net = income - expense
  return [
    { key: 'exp', label: expLabel.value, dot: 'bg-blue-500', value: signedGain(exp), unit: '', valueClass: exp > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400', sub: sourceText('exp', '+') },
    { key: 'income', label: `${currencyName.value}收入`, dot: 'bg-emerald-500', value: signedGain(income), unit: '', valueClass: income > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400', sub: sourceText('income', '+') },
    { key: 'expense', label: `${currencyName.value}支出`, dot: 'bg-red-500', value: expense > 0 ? `-${formatWanAmount(expense)}` : '0', unit: '', valueClass: expense > 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-400', sub: sourceText('expense', '-') },
    {
      key: 'net',
      label: '净收益',
      dot: 'bg-gray-400',
      value: net > 0 ? `+${formatWanAmount(net)}` : formatWanAmount(net),
      unit: currencyName.value,
      valueClass: net > 0 ? 'text-emerald-600 dark:text-emerald-400' : net < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-400',
      sub: `共 ${times} 次操作`,
    },
  ]
})

function chipHiddenOnDesktop(index: number, key: string) {
  return !chipsExpanded.value && index >= CHIP_LIMIT && key !== store.op
}

const hiddenChipCount = computed(() => actions.value.filter((action, index) => chipHiddenOnDesktop(index, action.key)).length)

function selectOp(key: string) {
  store.setOp(key && store.op === key ? '' : key)
}

function toggleGroup(id: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  expandedGroups.value = next
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function clock(ts: number) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function timeRange(earliest: number, latest: number) {
  const from = clock(earliest)
  const to = clock(latest)
  return from === to ? to : `${from}–${to}`
}

// 筛选单一动作时不合并，否则整天的记录会被并成一行
const dayBlocks = computed(() => {
  const ids = standardIds.value
  return groupLedgerEntries(store.entries as LedgerViewEntry[], !store.op).map((day) => {
    const lines: Line[] = []
    for (const row of day.rows) {
      const group = row.entries.length > 1
      const expanded = group && expandedGroups.value.has(row.id)
      const text = describeRow(row, ids, formatWanAmount)
      lines.push({
        id: row.id,
        group,
        expanded,
        nested: false,
        time: group ? timeRange(row.earliestTs, row.latestTs) : clock(row.latestTs),
        label: row.label,
        tone: toneOf(row.metrics),
        title: text.title,
        count: group ? row.entries.length : 0,
        detail: text.detail,
        metrics: row.metrics,
      })
      if (!expanded)
        continue
      for (const entry of row.entries) {
        const metrics = metricsOf(entry.metrics)
        const child = describeEntry(entry, ids, formatWanAmount)
        lines.push({
          id: `${row.id}:${entry.id}`,
          group: false,
          expanded: false,
          nested: true,
          time: clock(entry.ts),
          label: entry.actionLabel || row.label,
          tone: toneOf(metrics),
          title: child.title,
          count: 0,
          detail: child.detail,
          metrics,
        })
      }
    }
    const loaded = day.rows.reduce((sum, row) => sum + row.entries.length, 0)
    return { day: day.day, label: dayLabel(day.day, store.today), count: store.dayCounts[day.day] ?? loaded, lines }
  })
})
</script>

<template>
  <div class="space-y-3">
    <template v-if="showSummary && summary">
      <!-- 标准指标：与货币页汇总卡同风格 -->
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div
          v-for="card in kpis"
          :key="card.key"
          class="min-w-0 border border-gray-200 rounded-xl bg-white px-3 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span class="h-2 w-2 shrink-0 rounded-full" :class="card.dot" />
            <span class="truncate">{{ card.label }}</span>
          </div>
          <div class="mt-1 truncate text-lg font-bold tabular-nums" :class="card.valueClass">
            {{ card.value }}<span v-if="card.unit" class="ml-1 text-xs text-gray-400 font-normal">{{ card.unit }}</span>
          </div>
          <div class="truncate text-xs text-gray-400 dark:text-gray-500">
            {{ card.sub }}
          </div>
        </div>
      </div>

      <!-- 动作筛选：桌面端换行并折叠超出部分，手机端横向滚动 -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        <button
          class="h-8 flex shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition"
          :class="store.op === '' ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
          :style="store.op === '' ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="selectOp('')"
        >
          全部 <span :class="store.op === '' ? 'text-white/80' : 'text-gray-400'">{{ summary.total.times }}</span>
        </button>
        <button
          v-for="(action, index) in actions"
          :key="action.key"
          class="h-8 flex shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition"
          :class="[
            store.op === action.key ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
            chipHiddenOnDesktop(index, action.key) ? 'sm:hidden' : '',
          ]"
          :style="store.op === action.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="selectOp(action.key)"
        >
          {{ action.label }} <span :class="store.op === action.key ? 'text-white/80' : 'text-gray-400'">{{ action.times }}</span>
        </button>
        <button
          v-if="actions.length > CHIP_LIMIT"
          class="hidden h-8 shrink-0 items-center border border-gray-300 rounded-full border-dashed px-3 text-xs text-gray-500 sm:inline-flex dark:border-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
          @click="chipsExpanded = !chipsExpanded"
        >
          {{ chipsExpanded ? '收起 ▴' : `更多 ${hiddenChipCount} ▾` }}
        </button>
      </div>
    </template>

    <!-- 状态 -->
    <div v-if="store.loading && store.entries.length === 0" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>
    <div v-else-if="store.error" class="rounded-lg bg-red-50 p-8 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
      {{ store.error }}
      <button class="ml-2 underline" @click="store.fetch()">
        重试
      </button>
    </div>
    <div v-else-if="store.isEmpty" class="border border-gray-200 rounded-lg border-dashed bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
      {{ emptyText }}
    </div>

    <!-- 明细：按天分组，一条一行；连续同类记录合并，可展开 -->
    <div v-else class="space-y-2">
      <div class="overflow-hidden border border-gray-200 rounded-xl bg-white dark:border-gray-700 dark:bg-gray-800">
        <template v-for="day in dayBlocks" :key="day.day">
          <div class="flex items-center justify-between bg-gray-50 px-3 py-1 text-xs text-gray-400 dark:bg-gray-900/40 dark:text-gray-500">
            <span>{{ day.label }}</span>
            <span>{{ day.count }} 条</span>
          </div>
          <component
            :is="line.group ? 'button' : 'div'"
            v-for="line in day.lines"
            :key="line.id"
            :type="line.group ? 'button' : undefined"
            class="grid grid-cols-[minmax(0,1fr)_auto] w-full items-center gap-x-3 gap-y-0.5 border-t border-gray-100 px-3 py-2 text-left sm:grid-cols-[6rem_4.5rem_minmax(0,1fr)_auto] dark:border-gray-700/60"
            :class="[
              line.nested ? 'bg-gray-50/70 pl-6 dark:bg-gray-900/30' : '',
              line.group ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40' : '',
            ]"
            @click="line.group && toggleGroup(line.id)"
          >
            <span class="hidden text-xs text-gray-400 tabular-nums sm:block">{{ line.time }}</span>
            <span class="hidden sm:block">
              <span class="whitespace-nowrap rounded px-1.5 py-0.5 text-xs" :class="TONE_CLASSES[line.tone]">{{ line.label }}</span>
            </span>
            <div class="min-w-0 flex items-center gap-1.5">
              <span class="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs sm:hidden" :class="TONE_CLASSES[line.tone]">{{ line.label }}</span>
              <span class="min-w-0 truncate text-sm">
                {{ line.title }}
                <span v-if="line.count" class="ml-1 border border-gray-200 rounded-full px-1.5 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">×{{ line.count }} {{ line.expanded ? '▴' : '▾' }}</span>
                <span v-if="line.detail" class="hidden text-xs text-gray-400 sm:inline"> · {{ line.detail }}</span>
              </span>
            </div>
            <div class="row-span-2 flex flex-col items-end gap-0.5 whitespace-nowrap text-right tabular-nums sm:row-span-1 sm:flex-row sm:items-center sm:gap-2">
              <span v-if="line.metrics.income > 0" class="text-sm text-emerald-600 font-semibold dark:text-emerald-400">+{{ formatWanAmount(line.metrics.income) }} {{ currencyName }}</span>
              <span v-if="line.metrics.expense > 0" class="text-sm text-red-500 font-semibold dark:text-red-400">-{{ formatWanAmount(line.metrics.expense) }} {{ currencyName }}</span>
              <span v-if="line.metrics.exp > 0" class="text-xs text-blue-600 dark:text-blue-400">+{{ formatWanAmount(line.metrics.exp) }} 经验</span>
            </div>
            <div class="min-w-0 truncate text-xs text-gray-400 tabular-nums sm:hidden">
              {{ line.time }}<template v-if="line.detail">
                · {{ line.detail }}
              </template>
            </div>
          </component>
        </template>
      </div>

      <div v-if="store.hasMore" class="flex justify-center pt-1">
        <button
          class="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-4 py-2 text-sm text-gray-600 dark:border-gray-700 hover:border-blue-400 dark:bg-gray-800 dark:text-gray-300 hover:text-blue-600 disabled:opacity-50"
          :disabled="store.loadingMore"
          @click="store.fetchMore()"
        >
          <span v-if="store.loadingMore" class="i-svg-spinners-ring-resize" />
          {{ store.loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
      <p v-if="store.loadMoreError" class="text-center text-xs text-red-500">
        {{ store.loadMoreError }}
      </p>
    </div>
  </div>
</template>
