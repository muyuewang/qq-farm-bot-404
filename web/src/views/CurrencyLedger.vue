<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import CurrencyLedgerPanel from '@/components/ledger/CurrencyLedgerPanel.vue'
import OperationLedgerPanel from '@/components/ledger/OperationLedgerPanel.vue'
import { useAccountStore } from '@/stores/account'
import { useCurrencyLedgerStore } from '@/stores/currency-ledger'
import { useOperationLedgerStore } from '@/stores/operation-ledger'

type TabKey = 'currency' | 'farm' | 'ranch'

const TABS: Array<{ key: TabKey, label: string }> = [
  { key: 'currency', label: '货币' },
  { key: 'farm', label: '农作物' },
  { key: 'ranch', label: '牧场' },
]

const DAY_OPTIONS = [
  { value: 1, label: '今日' },
  { value: 3, label: '3 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
]

const accountStore = useAccountStore()
const currencyStore = useCurrencyLedgerStore()
const operationStore = useOperationLedgerStore()

const activeTab = ref<TabKey>('currency')

const currentDays = computed(() =>
  activeTab.value === 'currency' ? currencyStore.days : operationStore.days,
)

const isLoading = computed(() =>
  activeTab.value === 'currency' ? currencyStore.loading : operationStore.loading,
)

function segmentedClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}

function switchTab(key: TabKey) {
  if (activeTab.value === key)
    return
  activeTab.value = key
  if (key === 'currency') {
    currencyStore.fetch()
  }
  else {
    operationStore.open(key)
  }
}

function setDays(value: number) {
  if (activeTab.value === 'currency')
    currencyStore.setDays(value)
  else
    operationStore.setDays(value)
}

function refresh() {
  if (activeTab.value === 'currency')
    currencyStore.fetch()
  else
    operationStore.fetch()
}

let visibilityHandler: () => void

watch(() => accountStore.currentAccountId, () => {
  currencyStore.fetch()
  operationStore.fetch()
})

onMounted(() => {
  currencyStore.fetch()
  visibilityHandler = () => {
    if (!document.hidden)
      refresh()
  }
  document.addEventListener('visibilitychange', visibilityHandler)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', visibilityHandler)
})
</script>

<template>
  <section class="space-y-4">
    <div class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <!-- 标题行 -->
      <div class="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex items-center gap-2">
          <div class="i-carbon-receipt text-2xl" :style="{ color: 'var(--theme-primary)' }" />
          <h1 class="text-xl font-bold">
            流水
          </h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- 页签切换 -->
          <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
            <button
              v-for="tab in TABS"
              :key="tab.key"
              class="min-w-20 rounded-md px-3 text-sm font-medium transition"
              :class="segmentedClasses(activeTab === tab.key)"
              :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="switchTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- 时间范围 -->
          <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
            <button
              v-for="d in DAY_OPTIONS"
              :key="d.value"
              class="min-w-14 rounded-md px-3 text-sm font-medium transition"
              :class="segmentedClasses(currentDays === d.value)"
              :style="currentDays === d.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="setDays(d.value)"
            >
              {{ d.label }}
            </button>
          </div>

          <!-- 刷新 -->
          <button
            class="h-9 flex items-center gap-1.5 border border-gray-200 rounded-lg bg-white px-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
            :disabled="isLoading"
            @click="refresh"
          >
            <span :class="isLoading ? 'i-svg-spinners-ring-resize' : 'i-carbon-renew'" />
            刷新
          </button>
        </div>
      </div>

      <!-- 货币流水 -->
      <CurrencyLedgerPanel v-if="activeTab === 'currency'" />

      <!-- 农作物流水 -->
      <OperationLedgerPanel v-else-if="activeTab === 'farm'" scene="farm" />

      <!-- 牧场流水 -->
      <OperationLedgerPanel v-else-if="activeTab === 'ranch'" scene="ranch" />
    </div>
  </section>
</template>
