<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import IllustratedItemCard from '@/components/illustrated/IllustratedItemCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useIllustratedStore } from '@/stores/illustrated'
import { useToastStore } from '@/stores/toast'
import { formatGoldAmount } from '@/utils/number-format'

const accountStore = useAccountStore()
const illustratedStore = useIllustratedStore()
const toast = useToastStore()

const { currentAccountId } = storeToRefs(accountStore)
const { items, summary, loading, buying, error, userLevel } = storeToRefs(illustratedStore)

const filter = ref<'all' | 'unlocked' | 'locked'>('all')
const illustratedType = ref(1)

const showConfirm = ref(false)
const confirmTitle = ref('确认购买')
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<null | (() => Promise<void>)>(null)

const filteredItems = computed(() => {
  if (filter.value === 'unlocked')
    return items.value.filter(item => item.unlocked)
  if (filter.value === 'locked')
    return items.value.filter(item => !item.unlocked)
  return items.value
})

const lockedCount = computed(() => Math.max(0, summary.value.total - summary.value.unlocked))

const typeTabs = [
  { value: 1, label: '作物图鉴' },
  { value: 2, label: '变异图鉴' },
]

const filterTabs: Array<{ value: 'all' | 'unlocked' | 'locked', label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unlocked', label: '已解锁' },
  { value: 'locked', label: '未解锁' },
]

function segmentedButtonClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}

function getUnlockHint(item: any) {
  if (item.unlocked)
    return '已收录'
  const diff = Math.max(0, Number(item.level || 0) - Number(userLevel.value || 0))
  if (diff > 0)
    return `差 ${diff} 级`
  return '等级已满足'
}

function getProgressHint(item: any) {
  if (item.unlocked)
    return '已解锁'
  if (item.canBuy && item.goodsId)
    return '可购买补录'
  if (Number(item.level || 0) > Number(userLevel.value || 0))
    return '等级不足'
  return '待种植或收获'
}

function getItemStatusLabel(item: any) {
  if (item.unlocked)
    return '已解锁'
  if (item.canBuy && item.goodsId)
    return '可购买补录'
  return '待解锁'
}

function openConfirm(title: string, message: string, action: () => Promise<void>) {
  confirmTitle.value = title
  confirmMessage.value = message
  pendingAction.value = action
  showConfirm.value = true
}

async function runConfirmedAction() {
  if (!pendingAction.value)
    return
  confirmLoading.value = true
  try {
    await pendingAction.value()
    showConfirm.value = false
  }
  finally {
    confirmLoading.value = false
    pendingAction.value = null
  }
}

function closeConfirm() {
  if (confirmLoading.value)
    return
  showConfirm.value = false
  pendingAction.value = null
}

async function refreshList(force = true) {
  if (!currentAccountId.value)
    return
  await illustratedStore.fetchList(currentAccountId.value, force, illustratedType.value)
}

async function buySeed(item: any) {
  if (!currentAccountId.value || !item.goodsId)
    return
  const result = await illustratedStore.buySeed(currentAccountId.value, item.goodsId, item.price || 0)
  if (result?.ok) {
    toast.success(`已购买 ${item.name}`)
    await refreshList(true)
  }
  else {
    toast.error(result?.error || '购买失败')
  }
}

async function buyAll() {
  if (!currentAccountId.value)
    return
  const result = await illustratedStore.buyAllSeeds(currentAccountId.value, illustratedType.value)
  if (result?.ok) {
    const data = result.data || {}
    toast.success(`一键购买完成：成功 ${data.successCount || 0}，失败 ${data.failCount || 0}`)
    await refreshList(true)
  }
  else {
    toast.error(result?.error || '一键购买失败')
  }
}

function confirmBuySeed(item: any) {
  openConfirm(
    '确认购买',
    `确定购买 ${item.name} 吗？\n价格：${formatGoldAmount(item.price || 0)} 金币`,
    () => buySeed(item),
  )
}

function confirmBuyAll() {
  openConfirm(
    '确认一键购买',
    `将尝试购买当前图鉴中所有可购买项目。\n可购买数量：${summary.value.canBuy}`,
    () => buyAll(),
  )
}

watch([currentAccountId, illustratedType], () => {
  if (currentAccountId.value)
    illustratedStore.clearIllustratedData()
  refreshList(false)
})

onMounted(() => {
  refreshList(false)
})
</script>

<template>
  <section class="space-y-4">
    <div class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <div class="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <div class="i-carbon-book text-2xl text-emerald-500" />
            <h1 class="text-xl font-bold">
              图鉴
            </h1>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="h-8 flex items-center rounded-lg bg-emerald-50 px-3 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              {{ summary.unlocked }}/{{ summary.total }} 已解锁
            </span>
            <span class="h-8 flex items-center rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
              {{ lockedCount }}/{{ summary.total }} 未解锁
            </span>
            <span class="h-8 flex items-center rounded-lg bg-blue-50 px-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {{ summary.canBuy }} 可购买
            </span>
            <span class="h-8 flex items-center rounded-lg bg-amber-50 px-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Lv.{{ userLevel }}
            </span>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
            <button
              v-for="item in typeTabs"
              :key="item.value"
              class="min-w-20 rounded-md px-3 text-sm font-medium transition"
              :class="segmentedButtonClasses(illustratedType === item.value)"
              :style="illustratedType === item.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="illustratedType = item.value"
            >
              {{ item.label }}
            </button>
          </div>
          <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
            <button
              v-for="item in filterTabs"
              :key="item.value"
              class="min-w-16 rounded-md px-3 text-sm font-medium transition"
              :class="segmentedButtonClasses(filter === item.value)"
              :style="filter === item.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="filter = item.value"
            >
              {{ item.label }}
            </button>
          </div>
          <BaseButton class="w-28" variant="primary" :loading="buying" :disabled="summary.canBuy <= 0" @click="confirmBuyAll">
            一键购买
          </BaseButton>
          <BaseButton class="w-24" variant="primary" :loading="loading" @click="refreshList(true)">
            刷新
          </BaseButton>
        </div>
      </div>

      <div v-if="error" class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ error }}
      </div>

      <div v-if="!currentAccountId" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        请先选择账号，再查看图鉴。
      </div>

      <div v-else-if="loading && filteredItems.length === 0" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        正在加载图鉴数据...
      </div>

      <div v-else class="space-y-4">
        <div v-if="filteredItems.length === 0" class="border border-gray-200 rounded-lg border-dashed bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
          暂无图鉴项目
        </div>

        <div class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3">
          <IllustratedItemCard
            v-for="item in filteredItems"
            :key="item.seedId"
            :item="item"
            :buying="buying"
            :status-label="getItemStatusLabel(item)"
            :progress-hint="getProgressHint(item)"
            :unlock-hint="getUnlockHint(item)"
            @buy="confirmBuySeed"
          />
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="showConfirm"
      :title="confirmTitle"
      :message="confirmMessage"
      :loading="confirmLoading"
      @confirm="runConfirmedAction"
      @close="closeConfirm"
      @cancel="closeConfirm"
    />
  </section>
</template>
