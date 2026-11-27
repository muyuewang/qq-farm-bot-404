<script setup lang="ts">
import type { LedgerCurrency, LedgerEntry } from '@/stores/currency-ledger'
import { computed } from 'vue'
import { useCurrencyLedgerStore } from '@/stores/currency-ledger'
import { formatWanAmount } from '@/utils/number-format'

// 纯展示组件：拉取、刷新、时间范围由页面统一调度，这里只处理货币筛选
const store = useCurrencyLedgerStore()

const CURRENCIES: Array<{ value: LedgerCurrency, label: string, icon: string }> = [
  { value: 'gold', label: '金币', icon: '/game-config/resource-icons/gold.png' },
  { value: 'coupon', label: '点券', icon: '/game-config/resource-icons/coupon.png' },
  { value: 'diamond', label: '钻石', icon: '/game-config/resource-icons/diamond.png' },
  { value: 'goldBean', label: '金豆', icon: '/game-config/resource-icons/gold-bean.png' },
]
const CURRENCY_OPTIONS: Array<{ value: LedgerCurrency | '', label: string, icon: string }> = [
  { value: '', label: '全部', icon: '' },
  ...CURRENCIES,
]
const CURRENCY_META = Object.fromEntries(CURRENCIES.map(c => [c.value, c]))

function currencyLabel(c: string) {
  return CURRENCY_META[c]?.label ?? c
}

function currencyIcon(c: string) {
  return CURRENCY_META[c]?.icon ?? ''
}

function segmentedClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}

const summaryCards = computed(() => CURRENCIES
  .filter(c => !store.currency || store.currency === c.value)
  .map((c) => {
    const s = store.summary[c.value]
    return s ? { currency: c.value, label: c.label, icon: c.icon, ...s, reasons: s.reasons.slice(0, 3) } : null
  })
  .filter((card): card is NonNullable<typeof card> => !!card))

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${formatWanAmount(value)}`
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

// 跨天查询时只显示时分会产生歧义，统一带上日期
function formatTime(ts: number) {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function entryTitle(entry: LedgerEntry) {
  const lines = [`${entry.balanceBefore} → ${entry.balanceAfter}`]
  // 未登记中文名的方法 reason 就等于 method，避免提示框里重复同一段文字
  if (entry.method && entry.method !== entry.reason)
    lines.push(`请求: ${entry.method}`)
  if (entry.candidates?.length)
    lines.push(`同时进行: ${entry.candidates.join(', ')}`)
  return lines.join('\n')
}
</script>

<template>
  <div class="space-y-4">
    <div class="h-9 max-w-full inline-flex overflow-x-auto border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
      <button
        v-for="opt in CURRENCY_OPTIONS"
        :key="opt.value"
        class="flex shrink-0 items-center gap-1 rounded-md px-3 text-sm font-medium transition"
        :class="segmentedClasses(store.currency === opt.value)"
        :style="store.currency === opt.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
        @click="store.setCurrency(opt.value)"
      >
        <img v-if="opt.icon" :src="opt.icon" :alt="opt.label" class="h-4 w-4 object-contain">
        {{ opt.label }}
      </button>
    </div>

    <div v-if="summaryCards.length" class="grid gap-2 lg:grid-cols-4 sm:grid-cols-2">
      <div
        v-for="card in summaryCards"
        :key="card.currency"
        class="border border-gray-200 rounded-xl bg-white px-3 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <img :src="card.icon" :alt="card.label" class="h-4 w-4 object-contain">
          {{ card.label }}
          <span class="ml-auto text-gray-400">{{ card.count }} 笔</span>
        </div>
        <div class="mt-1 text-lg font-bold" :class="card.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">
          {{ signed(card.net) }}
        </div>
        <div class="text-xs text-gray-400 dark:text-gray-500">
          收入 {{ formatWanAmount(card.income) }} · 支出 {{ formatWanAmount(card.expense) }}
        </div>
        <div v-if="card.reasons.length" class="mt-2 border-t border-gray-100 pt-1.5 space-y-0.5 dark:border-gray-700">
          <div v-for="reason in card.reasons" :key="reason.reasonKey" class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-gray-500 dark:text-gray-400">{{ reason.reason }}</span>
            <span class="shrink-0 tabular-nums" :class="reason.income >= reason.expense ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">
              {{ signed(reason.income - reason.expense) }}
            </span>
          </div>
        </div>
      </div>
    </div>

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
      暂无货币流水，运行后每笔金币、点券、钻石、金豆变化会自动记录。
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="entry in store.entries"
        :key="entry.id"
        class="flex items-center justify-between gap-3 border border-gray-200 rounded-lg bg-white px-3 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <div class="min-w-0 flex items-center gap-2.5">
          <img :src="currencyIcon(entry.currency)" :alt="currencyLabel(entry.currency)" class="h-5 w-5 shrink-0 object-contain">
          <div class="min-w-0">
            <div class="truncate text-sm" :title="entryTitle(entry)">
              {{ entry.reason }}
            </div>
            <div class="text-xs text-gray-400">
              {{ formatTime(entry.ts) }}
            </div>
          </div>
        </div>
        <div class="shrink-0 text-right">
          <div class="text-sm font-semibold tabular-nums" :class="entry.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">
            {{ signed(entry.delta) }}
          </div>
          <div class="text-xs text-gray-400 tabular-nums">
            余 {{ formatWanAmount(entry.balanceAfter) }}
          </div>
        </div>
      </div>

      <div v-if="store.hasMore" class="flex justify-center pt-1">
        <button
          class="flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-4 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
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
