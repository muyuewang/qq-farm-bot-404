<script setup lang="ts">
import type { FarmEntry, OperationEntry, RanchEntry, RanchSummary as RanchSummaryType } from '@/stores/operation-ledger'
import { computed } from 'vue'
import { useOperationLedgerStore } from '@/stores/operation-ledger'
import { formatWanAmount } from '@/utils/number-format'

// 纯展示组件：拉取、切换场景、刷新都由页面统一调度
const props = defineProps<{ scene: 'farm' | 'ranch' }>()

const store = useOperationLedgerStore()

const FARM_LABELS: Record<string, string> = {
  buy_seed: '买种子',
  plant: '种植',
  harvest: '收获',
  sell: '出售',
}

const emptyText = computed(() => props.scene === 'farm'
  ? '暂无农作物流水，运行后买种子、种植、收获、出售会自动记录。'
  : '暂无牧场流水，购买、投喂、生产、收获、出售会自动记录。')

const farmSummary = computed(() => {
  const data = store.summary as any
  return props.scene === 'farm' && data && 'buy_seed' in data ? data : null
})

const ranchSummary = computed(() => {
  const data = store.summary as any
  return props.scene === 'ranch' && data && 'actions' in data ? data as RanchSummaryType : null
})

const ranchTotalTimes = computed(() => (ranchSummary.value?.actions || []).reduce((sum, item) => sum + item.times, 0))

const farmCards = computed(() => {
  const data = farmSummary.value
  if (!data)
    return []
  return [
    { key: 'buy_seed', label: FARM_LABELS.buy_seed, times: data.buy_seed.times, value: `${data.buy_seed.quantity} 个`, hint: `花费 ${formatWanAmount(data.buy_seed.gold)} 金币` },
    { key: 'plant', label: FARM_LABELS.plant, times: data.plant.times, value: `${data.plant.quantity} 块`, hint: '已种植地块' },
    { key: 'harvest', label: FARM_LABELS.harvest, times: data.harvest.times, value: `${data.harvest.quantity} 块`, hint: `经验 +${formatWanAmount(data.harvest.exp)}` },
    { key: 'sell', label: FARM_LABELS.sell, times: data.sell.times, value: `${formatWanAmount(data.sell.quantity)} 个`, hint: `收入 ${formatWanAmount(data.sell.gold)} 金币` },
  ]
})

function entryLabel(entry: OperationEntry) {
  return 'op' in entry ? (FARM_LABELS[entry.op] ?? entry.op) : entry.label
}

function tagClass(entry: OperationEntry) {
  if (!('op' in entry))
    return 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300'
  if (entry.op === 'sell')
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
  if (entry.op === 'buy_seed')
    return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
  if (entry.op === 'harvest')
    return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

function primaryText(entry: OperationEntry) {
  if (!('op' in entry)) {
    const ranch = entry as RanchEntry
    return ranch.completed > 1 ? `${ranch.label} ×${ranch.completed}` : ranch.label
  }
  const farm = entry as FarmEntry
  if (farm.op === 'buy_seed')
    return `${farm.seedName ?? `种子${farm.seedId}`} ×${farm.count ?? 0}`
  if (farm.op === 'plant')
    return `${farm.seedName ?? `种子${farm.seedId}`} 种下 ${farm.landCount ?? 0} 块`
  if (farm.op === 'harvest') {
    const names = Array.from(new Set((farm.harvestInfo || []).map(i => i.name).filter(Boolean)))
    const count = farm.harvestCount ?? 0
    return names.length ? `${names.slice(0, 3).join('、')} 共 ${count} 块` : `收获 ${count} 块`
  }
  const items = farm.items || []
  const total = items.reduce((sum, item) => sum + item.count, 0)
  return `${items.slice(0, 3).map(i => `${i.name}×${i.count}`).join('、')}${items.length > 3 ? ' 等' : ''} 共 ${total} 个`
}

function secondaryText(entry: OperationEntry) {
  if (!('op' in entry)) {
    const ranch = entry as RanchEntry
    const parts: string[] = []
    if (ranch.costs?.length)
      parts.push(`消耗 ${itemLine(ranch.costs)}`)
    if (ranch.rewards?.length)
      parts.push(`获得 ${itemLine(ranch.rewards)}`)
    return parts.join(' · ')
  }
  const farm = entry as FarmEntry
  if (farm.op === 'harvest') {
    const exp = (farm.harvestInfo || []).reduce((sum, item) => sum + (item.exp || 0), 0)
    return exp > 0 ? `经验 +${exp}` : ''
  }
  if (farm.op === 'plant' && farm.landIds?.length)
    return `地块 ${farm.landIds.join(', ')}`
  return ''
}

function amountText(entry: OperationEntry) {
  if (!('op' in entry))
    return ''
  const farm = entry as FarmEntry
  if (farm.op === 'buy_seed')
    return farm.totalCost ? `-${formatWanAmount(farm.totalCost)}` : ''
  if (farm.op === 'sell')
    return farm.goldEarned ? `+${formatWanAmount(farm.goldEarned)}` : ''
  return ''
}

function amountClass(entry: OperationEntry) {
  if (!('op' in entry))
    return ''
  return (entry as FarmEntry).op === 'sell'
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-amber-600 dark:text-amber-400'
}

function itemLine(items?: Array<{ name: string, count: number }>) {
  if (!items?.length)
    return ''
  return items.slice(0, 4).map(item => `${item.name}×${item.count}`).join('、')
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="space-y-4">
    <!-- 农场：四类动作汇总，同时充当筛选入口 -->
    <div v-if="scene === 'farm' && farmSummary" class="grid gap-2 lg:grid-cols-4 sm:grid-cols-2">
      <button
        v-for="card in farmCards"
        :key="card.key"
        class="border rounded-xl px-3 py-2.5 text-left shadow-sm transition"
        :class="[
          store.op === card.key ? 'text-white' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60',
        ]"
        :style="store.op === card.key ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)' } : {}"
        @click="store.setOp(store.op === card.key ? '' : card.key)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-xs" :class="store.op === card.key ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'">{{ card.label }}</span>
          <span class="shrink-0 text-xs" :class="store.op === card.key ? 'text-white/70' : 'text-gray-400'">{{ card.times }} 次</span>
        </div>
        <div class="mt-1 truncate text-lg font-bold">
          {{ card.value }}
        </div>
        <div class="truncate text-xs" :class="store.op === card.key ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'">
          {{ card.hint }}
        </div>
      </button>
    </div>

    <!-- 牧场：动作汇总 + 消耗/收益 -->
    <div v-if="scene === 'ranch' && ranchSummary" class="space-y-2">
      <div class="flex flex-wrap gap-2">
        <button
          class="h-9 flex items-center rounded-lg px-3 text-xs font-medium transition"
          :class="store.op === '' ? 'text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="store.op === '' ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="store.setOp('')"
        >
          全部 {{ ranchTotalTimes }} 次
        </button>
        <button
          v-for="item in ranchSummary.actions.slice(0, 8)"
          :key="item.action"
          class="h-9 flex items-center rounded-lg px-3 text-xs font-medium transition"
          :class="store.op === item.action ? 'text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="store.op === item.action ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="store.setOp(store.op === item.action ? '' : item.action)"
        >
          {{ item.label }} {{ item.times }}
        </button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="border border-gray-200 rounded-xl bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            累计消耗
          </div>
          <div class="mt-1 text-sm">
            {{ itemLine(ranchSummary.costs) || '—' }}
          </div>
        </div>
        <div class="border border-gray-200 rounded-xl bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            累计获得
          </div>
          <div class="mt-1 text-sm">
            {{ itemLine(ranchSummary.rewards) || '—' }}
          </div>
        </div>
      </div>
    </div>

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

    <!-- 明细 -->
    <div v-else class="space-y-2">
      <div
        v-for="entry in store.entries"
        :key="entry.id"
        class="flex items-start justify-between gap-3 border border-gray-200 rounded-lg bg-white px-3 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded px-1.5 py-0.5 text-xs" :class="tagClass(entry)">{{ entryLabel(entry) }}</span>
            <span class="text-sm">{{ primaryText(entry) }}</span>
          </div>
          <div v-if="secondaryText(entry)" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ secondaryText(entry) }}
          </div>
        </div>
        <div class="shrink-0 text-right">
          <div v-if="amountText(entry)" class="text-sm font-semibold" :class="amountClass(entry)">
            {{ amountText(entry) }}
          </div>
          <div class="text-xs text-gray-400">
            {{ formatTime(entry.ts) }}
          </div>
        </div>
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
