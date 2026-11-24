<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCurrencyAmountByLabel, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { items, loading: bagLoading, originalItems } = storeToRefs(bagStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)

const imageErrors = ref<Record<string | number, boolean>>({})
const bagLoaded = ref(false)

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '果实', value: 'fruit' },
  { label: '种子', value: 'seed' },
  { label: '道具', value: 'tool' },
  { label: '其他', value: 'other' },
] as const

type CategoryValue = typeof CATEGORY_OPTIONS[number]['value']

const selectedCategory = ref<CategoryValue>('fruit')

function itemImage(item: any) {
  return item?.image || (Number(item?.id) === 6001 ? '/activity/wish-sign/firework.png' : '')
}

function itemType(item: any) {
  return Number(item?.itemType) || (Number(item?.id) === 6001 ? 23 : 0)
}

function getItemCategory(item: any): CategoryValue {
  if (item?.category === 'seed')
    return 'seed'
  if (item?.category === 'fruit')
    return 'fruit'
  const type = itemType(item)
  if (type === 17 || type === 6)
    return 'fruit'
  if (type === 5)
    return 'seed'
  if (type === 11 || Number(item?.id) === 6001)
    return 'tool'
  return 'other'
}

const filteredItems = computed(() => {
  if (selectedCategory.value === 'all')
    return items.value
  return items.value.filter((item: any) => getItemCategory(item) === selectedCategory.value)
})

const categoryCounts = computed(() => {
  const counts: Record<CategoryValue, number> = { all: items.value.length, fruit: 0, seed: 0, tool: 0, other: 0 }
  for (const item of items.value) {
    const cat = getItemCategory(item)
    counts[cat]++
  }
  return counts
})

const confirmModal = ref({
  show: false,
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  loading: false,
  action: '' as 'sell' | 'use' | 'batchSell' | 'lock',
  item: null as any,
  selectedItems: [] as any[],
  uids: [] as number[],
  locked: false,
})

const batchMode = ref(false)
const selectedForBatch = ref<Set<number>>(new Set())
const batchSellResult = ref<{ gold: number, goldBean: number } | null>(null)

/** 锁定管理按背包堆栈 uid 操作，与自动出售共用同一批后端校验。 */
const lockMode = ref(false)
const selectedLockUids = ref<Set<number>>(new Set())

const selectedSellableCount = computed(() => {
  return selectedForBatch.value.size
})

const selectedLockCount = computed(() => selectedLockUids.value.size)

/** 当前分类下可锁定的堆栈数，用于在没有可选对象时禁用全选。 */
const lockableCount = computed(() => filteredItems.value.filter((item: any) => canLock(item)).length)

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-400 dark:text-amber-300'
  if (priceId === 1002)
    return 'text-sky-400 dark:text-sky-300'
  return 'text-gray-400'
}

function canSell(item: any) {
  const itemType = Number(item?.itemType || 0)
  return Boolean(item?.sellable) || itemType === 17 || itemType === 6
}

function canBatchSell(item: any) {
  return canSell(item) && Number(item.count || 0) > 0
}

function canUse(item: any) {
  return Boolean(item?.usable) || itemType(item) === 11 || Number(item?.id) === 6001
}

/** 后端只允许锁定果实、变异果实与种子；这里按同一批类型判断，真正的拒绝仍由后端给出。 */
function canLock(item: any) {
  const type = itemType(item)
  const category = getItemCategory(item)
  return Number(item?.uid || 0) > 0
    && (type === 17 || type === 6 || type === 5 || category === 'fruit' || category === 'seed')
}

function handleSellClick(item: any) {
  if (batchMode.value) {
    const isSelected = selectedForBatch.value.has(Number(item.id))
    if (isSelected) {
      selectedForBatch.value.delete(Number(item.id))
    }
    else {
      selectedForBatch.value.add(Number(item.id))
    }
    return
  }
  const totalPrice = (Number(item.count) || 0) * (Number(item.price) || 0)
  const priceUnit = item.priceUnit || '金'
  const messages = [
    `确定要出售全部${item.name || `物品${item.id}`}吗?`,
    `数量：${item.count || 0}`,
  ]
  if (totalPrice > 0) {
    messages.push(`售出总金币：${formatCurrencyAmountByLabel(totalPrice, priceUnit)}${priceUnit}`)
  }
  confirmModal.value = {
    show: true,
    title: '确认出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'sell',
    item,
    selectedItems: [],
    uids: [],
    locked: false,
  }
}

function handleUseClick(item: any) {
  const count = Number(item.id) === 6001 ? 1 : Number(item.count || 1)
  confirmModal.value = {
    show: true,
    title: '确认使用',
    message: `确定要使用${Number(item.id) === 6001 ? '一枚' : '全部'} ${item.name || `物品${item.id}`} 吗?\n数量：${count}`,
    type: 'primary',
    loading: false,
    action: 'use',
    item,
    selectedItems: [],
    uids: [],
    locked: false,
  }
}

async function handleConfirm() {
  const { action, item, selectedItems, uids, locked } = confirmModal.value
  if (!currentAccountId.value)
    return

  confirmModal.value.loading = true
  try {
    if (action === 'sell' && item) {
      const sellItems = originalItems.value
        .filter((it: any) => Number(it.id) === Number(item.id))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (sellItems.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(currentAccountId.value, sellItems)
      if (res.ok) {
        toastStore.success(`已出售 ${item.name || `物品${item.id}`}`)
        await loadBag()
      }
      else {
        toastStore.error(`出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'batchSell' && selectedItems) {
      const itemsToSell = originalItems.value
        .filter((it: any) => selectedItems.some((si: any) => Number(si.id) === Number(it.id)))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (itemsToSell.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(currentAccountId.value, itemsToSell)
      if (res.ok) {
        let totalGold = 0
        let totalGoldBean = 0
        for (const si of selectedItems) {
          const fi = filteredItems.value.find((f: any) => Number(f.id) === Number(si.id))
          if (fi) {
            const price = Number(fi.price) || 0
            const count = Number(fi.count) || 0
            const priceId = Number(fi.priceId) || 0
            if (priceId === 1005) {
              totalGoldBean += price * count
            }
            else {
              totalGold += price * count
            }
          }
        }
        batchSellResult.value = { gold: totalGold, goldBean: totalGoldBean }
        toastStore.success(`已批量出售 ${selectedItems.length} 种物品，获得 ${formatGoldAmount(totalGold)} 金币, ${formatGoldBeanAmount(totalGoldBean)} 金豆豆`)
        selectedForBatch.value.clear()
        batchMode.value = false
        await loadBag()
      }
      else {
        toastStore.error(`批量出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'lock' && uids.length > 0) {
      const res = await bagStore.setItemsLocked(currentAccountId.value, uids, locked)
      if (res.ok) {
        const changed = Number(res.data?.changed ?? uids.length)
        toastStore.success(`${locked ? '已锁定' : '已解锁'} ${changed} 个物品堆栈`)
        selectedLockUids.value.clear()
        lockMode.value = false
        await loadBag()
      }
      else {
        toastStore.error(`${locked ? '锁定' : '解锁'}失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'use' && item) {
      const sourceItem = originalItems.value.find((it: any) => Number(it.id) === Number(item.id))
      const res = await bagStore.useItem(
        currentAccountId.value,
        Number(item.id),
        Number(item.id) === 6001 ? 1 : Number(item.count || 1),
        Number(sourceItem?.uid || 0),
      )
      if (res.ok) {
        toastStore.success(res.data?.message || `已使用 ${item.name || `物品${item.id}`}`)
        await loadBag()
      }
      else {
        toastStore.error(`使用失败: ${res.error || '未知错误'}`)
      }
    }
  }
  catch (e: any) {
    toastStore.error(`操作失败: ${e.message || '未知错误'}`)
  }
  finally {
    confirmModal.value.loading = false
    confirmModal.value.show = false
  }
}

function handleCancel() {
  confirmModal.value.show = false
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) {
    selectedForBatch.value.clear()
    batchSellResult.value = null
  }
}

function selectAllSellable() {
  selectedForBatch.value.clear()
  for (const item of filteredItems.value) {
    if (canBatchSell(item)) {
      selectedForBatch.value.add(Number(item.id))
    }
  }
}

function toggleLockMode() {
  lockMode.value = !lockMode.value
  if (lockMode.value) {
    batchMode.value = false
    selectedForBatch.value.clear()
  }
  selectedLockUids.value.clear()
}

function toggleLockSelection(item: any) {
  if (!canLock(item))
    return
  const uid = Number(item.uid)
  if (selectedLockUids.value.has(uid))
    selectedLockUids.value.delete(uid)
  else
    selectedLockUids.value.add(uid)
}

function selectAllLockable(locked: boolean) {
  selectedLockUids.value.clear()
  for (const item of filteredItems.value) {
    if (canLock(item) && Boolean(item.locked) === locked)
      selectedLockUids.value.add(Number(item.uid))
  }
}

function handleLockClick(locked: boolean) {
  const uids = Array.from(selectedLockUids.value)
  if (uids.length === 0) {
    toastStore.warning(locked ? '请先选择要锁定的物品' : '请先选择要解锁的物品')
    return
  }
  confirmModal.value = {
    show: true,
    title: locked ? '确认锁定' : '确认解锁',
    message: `${locked ? '锁定' : '解锁'}选中的 ${uids.length} 个物品堆栈？\n锁定后自动出售与自动使用都会跳过这些物品。`,
    type: locked ? 'primary' : 'danger',
    loading: false,
    action: 'lock',
    item: null,
    selectedItems: [],
    uids,
    locked,
  }
}

async function handleBatchSellClick() {
  const sellableItems = filteredItems.value.filter((item: any) => canBatchSell(item))
  if (sellableItems.length === 0) {
    toastStore.warning('没有可批量出售的物品')
    return
  }
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning('请先选择要出售的物品')
    return
  }

  const itemsToSell = originalItems.value
    .filter((it: any) => selectedList.includes(Number(it.id)))
    .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

  let totalGold = 0
  let totalGoldBean = 0
  for (const it of itemsToSell) {
    const item = filteredItems.value.find((f: any) => Number(f.id) === Number(it.id))
    if (item) {
      const price = Number(item.price) || 0
      const count = Number(item.count) || 0
      const priceId = Number(item.priceId) || 0
      if (priceId === 1005) {
        totalGoldBean += price * count
      }
      else {
        totalGold += price * count
      }
    }
  }

  const messages = [
    `确定要批量出售选中的 ${selectedList.length} 种物品吗?`,
  ]
  if (totalGold > 0) {
    messages.push(`金币：${formatGoldAmount(totalGold)}`)
  }
  if (totalGoldBean > 0) {
    messages.push(`金豆豆：${formatGoldBeanAmount(totalGoldBean)}`)
  }

  confirmModal.value = {
    show: true,
    title: '批量出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'batchSell',
    item: null,
    selectedItems: itemsToSell,
    uids: [],
    locked: false,
  }
}

async function loadBag() {
  if (!currentAccountId.value)
    return

  const acc = currentAccount.value
  if (!acc)
    return

  try {
    if (!realtimeConnected.value)
      await statusStore.fetchStatus(currentAccountId.value)

    if (acc.running)
      await bagStore.fetchBag(currentAccountId.value)
  }
  finally {
    bagLoaded.value = true
  }

  imageErrors.value = {}
}

const showInitialLoading = computed(() =>
  !bagLoaded.value && (bagLoading.value || statusLoading.value),
)

watch(currentAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    bagLoaded.value = false
    bagStore.clearBag()
    statusStore.clearAccountScopedData()
  }
  loadBag()
}, { immediate: true })

watch(() => currentAccount.value?.running, () => {
  loadBag()
})

useIntervalFn(loadBag, 60000)
</script>

<template>
  <div class="space-y-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-inventory-management" />
        背包
      </h2>
      <div v-if="items.length" class="text-sm text-gray-500">
        共 {{ items.length }} 种物品
      </div>
    </div>

    <div v-if="showInitialLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError && items.length === 0" class="border border-red-200 rounded-lg bg-red-50 p-8 text-center text-red-500 shadow dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="currentStatusReady && !status?.connection?.connected && items.length === 0" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="items.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      无可展示物品
    </div>

    <div v-else>
      <div class="mb-4 space-y-3">
        <div class="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 p-1 dark:bg-gray-900/40">
          <button
            v-for="cat in CATEGORY_OPTIONS"
            :key="cat.value"
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="selectedCategory === cat.value
              ? 'text-white shadow-sm'
              : 'text-gray-600 hover:bg-white hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-white'"
            :style="selectedCategory === cat.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="selectedCategory = cat.value"
          >
            {{ cat.label }}
            <span class="ml-1 text-xs opacity-70">({{ categoryCounts[cat.value] || 0 }})</span>
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <template v-if="selectedCategory === 'fruit' || selectedCategory === 'all'">
            <BaseButton
              size="sm"
              :variant="batchMode ? 'primary' : 'secondary'"
              :aria-pressed="batchMode"
              @click="toggleBatchMode"
            >
              <div v-if="batchMode" class="i-carbon-close mr-1 inline-block" />
              {{ batchMode ? '取消批量' : '批量出售' }}
            </BaseButton>
            <template v-if="batchMode">
              <BaseButton size="sm" variant="secondary" @click="selectAllSellable">
                全选
              </BaseButton>
              <BaseButton size="sm" variant="danger" :disabled="selectedSellableCount === 0" @click="handleBatchSellClick">
                出售 ({{ selectedSellableCount }})
              </BaseButton>
            </template>
          </template>

          <template v-if="lockableCount > 0">
            <BaseButton
              size="sm"
              :variant="lockMode ? 'primary' : 'secondary'"
              :aria-pressed="lockMode"
              @click="toggleLockMode"
            >
              <div v-if="lockMode" class="i-carbon-close mr-1 inline-block" />
              {{ lockMode ? '退出锁定' : '锁定管理' }}
            </BaseButton>
            <template v-if="lockMode">
              <BaseButton size="sm" variant="secondary" @click="selectAllLockable(true)">
                全选未锁
              </BaseButton>
              <BaseButton size="sm" variant="secondary" @click="selectAllLockable(false)">
                全选已锁
              </BaseButton>
              <BaseButton size="sm" variant="primary" :disabled="selectedLockCount === 0" @click="handleLockClick(true)">
                锁定 ({{ selectedLockCount }})
              </BaseButton>
              <BaseButton size="sm" variant="success" :disabled="selectedLockCount === 0" @click="handleLockClick(false)">
                解锁 ({{ selectedLockCount }})
              </BaseButton>
            </template>
          </template>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 2xl:grid-cols-7 lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-3 xl:grid-cols-6">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          class="group relative flex flex-col items-center border border-gray-200 rounded-xl bg-white p-3 text-center transition dark:border-gray-700 hover:border-blue-300 dark:bg-gray-800 hover:shadow-md dark:hover:border-blue-700"
          :class="{
            'ring-2 ring-orange-500 dark:ring-orange-400': batchMode && selectedForBatch.has(Number(item.id)),
            'ring-2 ring-amber-500 dark:ring-amber-400': lockMode && selectedLockUids.has(Number(item.uid)),
            'cursor-pointer': lockMode && canLock(item),
            'opacity-50': (batchMode && canBatchSell(item) && !selectedForBatch.has(Number(item.id)))
              || (lockMode && !canLock(item)),
          }"
          @click="lockMode ? toggleLockSelection(item) : (batchMode && canBatchSell(item) && handleSellClick(item))"
        >
          <div class="absolute left-2 top-2 text-[10px] text-gray-400 font-mono">
            #{{ item.id }}
          </div>

          <div
            v-if="item.locked"
            class="absolute right-2 top-2 flex items-center gap-0.5 border border-amber-300 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 font-semibold leading-none dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            title="已锁定：自动出售与自动使用会跳过该堆栈"
          >
            <div class="i-carbon-locked text-[10px]" />
            已锁
          </div>

          <div class="order-last mt-auto w-full flex gap-1.5 pt-1">
            <template v-if="lockMode">
              <div
                v-if="canLock(item)"
                class="mx-auto h-6 w-6 flex items-center justify-center border-2 rounded transition"
                :class="selectedLockUids.has(Number(item.uid))
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700'"
              >
                <div v-if="selectedLockUids.has(Number(item.uid))" class="i-carbon-checkmark text-xs" />
              </div>
            </template>
            <template v-else-if="!batchMode">
              <button
                v-if="canUse(item)"
                type="button"
                class="h-8 flex-1 rounded-lg text-xs text-white font-medium shadow-sm transition hover:brightness-105"
                style="background: var(--theme-primary)"
                :title="Number(item.id) === 6001 ? '使用一枚' : '使用全部'"
                @click.stop="handleUseClick(item)"
              >
                {{ Number(item.id) === 6001 ? '用1枚' : '使用' }}
              </button>
              <button
                v-if="canSell(item)"
                type="button"
                class="h-8 flex-1 border border-gray-200 rounded-lg bg-white/70 text-xs text-gray-600 font-medium transition dark:border-gray-600 dark:bg-gray-700/50 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                title="出售全部"
                @click.stop="handleSellClick(item)"
              >
                出售
              </button>
            </template>
            <div
              v-else-if="canBatchSell(item)"
              class="mx-auto h-6 w-6 flex items-center justify-center border-2 rounded transition"
              :class="selectedForBatch.has(Number(item.id))
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700'"
            >
              <div v-if="selectedForBatch.has(Number(item.id))" class="i-carbon-checkmark text-xs" />
            </div>
          </div>

          <div
            class="thumb-wrap mb-2 mt-7 h-[72px] w-[72px] flex items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-700/50"
            :data-fallback="(item.name || '物').slice(0, 1)"
          >
            <img
              v-if="itemImage(item) && !imageErrors[item.id]"
              :src="itemImage(item)"
              :alt="item.name"
              class="max-h-full max-w-full object-contain"
              loading="lazy"
              @error="imageErrors[item.id] = true"
            >
            <div v-else class="text-2xl text-gray-400 font-bold uppercase">
              {{ (item.name || '物').slice(0, 1) }}
            </div>
          </div>

          <div class="mb-1 w-full flex items-center justify-center gap-1 px-2 text-center text-sm font-semibold" :title="item.name">
            <span class="truncate">{{ item.name || `物品${item.id}` }}</span>
            <span
              v-if="getItemCategory(item) === 'seed' && Number(item.plantSize) === 2"
              class="shrink-0 border border-emerald-300 rounded bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700 font-semibold leading-none dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              title="四格作物，占用 2×2 土地"
            >
              &lt;2x2&gt;
            </span>
          </div>

          <div class="mb-1 flex flex-col items-center gap-0.5 text-[11px] text-gray-400">
            <span v-if="item.uid">UID: {{ item.uid }}</span>
            <span>
              类型: {{ itemType(item) }}
              <span v-if="getItemCategory(item) === 'seed' && Number(item.rarity) >= 2"> · 稀有</span>
              <span v-else-if="item.level > 0"> · Lv{{ item.level }}</span>
              <span v-if="item.price > 0" :class="getPriceClass(item)"> · {{ item.price }}{{ item.priceUnit || '金' }}</span>
            </span>
          </div>

          <div class="mb-2 text-base font-semibold tabular-nums" :class="item.hoursText ? 'text-blue-500' : 'text-gray-700 dark:text-gray-200'">
            {{ item.hoursText || `×${item.count || 0}` }}
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="confirmModal.show"
      :title="confirmModal.title"
      :message="confirmModal.message"
      :type="confirmModal.type"
      :loading="confirmModal.loading"
      :confirm-text="confirmModal.action === 'sell'
        ? '确认出售'
        : confirmModal.action === 'batchSell'
          ? '确认出售'
          : confirmModal.action === 'lock'
            ? (confirmModal.locked ? '确认锁定' : '确认解锁')
            : '确认使用'"
      @confirm="handleConfirm"
      @close="handleCancel"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
</style>
