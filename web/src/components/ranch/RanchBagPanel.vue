<script setup lang="ts">
import type { RanchRequest, RanchState } from '@/utils/ranch'
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { formatQuantity, formatSeconds, PEN_TYPE, sortFacilities } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

/** 幼崽按适用设施分成窝、棚两类，窝在前，避免混在一个「幼崽」里分不清能放哪。 */
type BagFilter = 'all' | 'coop' | 'shed' | 'can' | 'product'

const FILTERS: Array<{ value: BagFilter, label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'coop', label: '窝幼崽' },
  { value: 'shed', label: '棚幼崽' },
  { value: 'can', label: '罐头' },
  { value: 'product', label: '可出售产物' },
]

/** 排序权重：产物在前，其次窝幼崽、棚幼崽，最后罐头；同组内再按等级、编号稳定排列。 */
const RANK: Record<BagFilter, number> = { product: 0, coop: 1, shed: 2, can: 3, all: 4 }

const filter = ref<BagFilter>('all')
const counts = ref<Record<string, string | number>>({})
const ranchTargets = ref<Record<string, string | number>>({})

const items = computed(() => props.state?.bag || [])
/**
 * 一键出售只针对产物（type 106/107）。后端 canSell 是「有有效报价」的通用判定，
 * 幼崽与罐头同样可能有报价，直接用 canSell 会把它们一起卖掉。
 */
const PRODUCT_TYPES = [106, 107]
// 锁定批次数不进「一键出售」的份数：服务端本来就会跳过它们，界面上报多了会让人以为能卖。
const sellable = computed(() => items.value.filter(item => item.canSell && !item.locked && PRODUCT_TYPES.includes(Number(item.type))))
const ranches = computed(() => sortFacilities((props.state?.facilities || []).filter(facility => facility.isRanch)))
const ranchOptions = computed(() => ranches.value.map(facility => ({
  value: facility.id,
  // 全角空格是排版用的宽间隔，写成转义避免触发 no-irregular-whitespace。
  label: `${facility.name} Lv.${facility.level}\u3000${facility.summary.animalText}`,
})))

/** 分类只看后端下发的功能位（can / animalId / canSell），不按物品 type 数字猜语义。 */
function kindOf(item: any): BagFilter {
  if (item.animalId !== null)
    return item.husbandryType === '棚' ? 'shed' : 'coop'
  if (item.can)
    return 'can'
  if (item.canSell)
    return 'product'
  return 'all'
}

/** 服务器返回的背包顺序不固定：按分类排列，同组内幼崽高等级在前，刷新后位置不变。 */
const sorted = computed(() => [...items.value].sort((a: any, b: any) => RANK[kindOf(a)] - RANK[kindOf(b)]
  || (Number(b.animalId) || 0) - (Number(a.animalId) || 0)
  || Number(a.itemId) - Number(b.itemId)
  || String(a.uid).localeCompare(String(b.uid))))

function matches(item: any) {
  return filter.value === 'all' || kindOf(item) === filter.value
}

const visible = computed(() => sorted.value.filter(matches))

function countOf(item: any) {
  const stock = Number(item.count)
  const raw = Number(counts.value[item.uid])
  const max = Number.isFinite(stock) && stock > 0 ? stock : 1
  if (!Number.isFinite(raw) || raw <= 0)
    return Math.min(1, max)
  return Math.min(raw, max)
}

function requestUseCan(item: any) {
  const count = countOf(item)
  const seconds = Number(item.can?.speed_up_secs)
  emit('request', {
    action: 'useCan',
    input: { uid: item.uid, count },
    title: `添加罐头：${item.name} ×${count}`,
    note: Number.isFinite(seconds)
      ? `每个罐头为${item.can?.feed_type === '有机罐头' ? '有机' : '普通'}罐头桶增加 ${formatSeconds(seconds)}，投喂动物时按秒消耗。`
      : undefined,
  })
}

function requestSell(item: any) {
  const count = countOf(item)
  emit('request', {
    action: 'sell',
    input: { uid: item.uid, count },
    title: `出售${item.name} ×${count}`,
  })
}

function requestSellAll() {
  emit('request', {
    action: 'sell',
    input: { all: true },
    title: `一键出售全部产物（${sellable.value.length} 批）`,
    note: '服务端按当前背包重新筛选可出售产物，已锁定或有出售条件的批次不会被卖出。',
  })
}

/**
 * 道具锁定。
 *
 * 后端只对「已锁定」或保护类型（106/107）的物品放行，判定结果通过 lockable 下发，
 * 页面不自己按 type 数字猜。批量模式只在当前分类内选，切分类要清空选择，
 * 否则会把看不见的批次一起提交。
 */
const batchLockMode = ref(false)
const selectedUids = ref<string[]>([])

const hasLockable = computed(() => items.value.some((item: any) => item.lockable === true))
const selectedLockables = computed(() => visible.value.filter((item: any) => item.lockable === true && selectedUids.value.includes(item.uid)))

function toggleBatchLockMode() {
  batchLockMode.value = !batchLockMode.value
  selectedUids.value = []
}

function requestLock(item: any) {
  emit('request', {
    action: 'setItemLock',
    input: { uid: item.uid, locked: !item.locked },
    title: `${item.locked ? '解锁' : '上锁'}：${item.name}`,
    note: item.locked ? undefined : '上锁后这批物品不会被一键出售带走，需要时可以再解锁。',
  })
}

function submitBatchLock(locked: boolean) {
  const itemUids = selectedLockables.value.filter((item: any) => item.locked !== locked).map((item: any) => item.uid)
  if (!itemUids.length)
    return
  emit('request', {
    action: 'setItemLock',
    input: { itemUids, locked },
    title: `${locked ? '批量上锁' : '批量解锁'} ${itemUids.length} 批物品`,
  })
}

watch(filter, () => {
  selectedUids.value = []
})

/**
 * 同一批物品可以同时有多个动作：幼崽既能放养也能卖，罐头既能入桶也能卖。
 * 之前按分类只给一个动作，导致背包里的幼崽与罐头根本卖不掉。
 */
type BagActionKey = 'useCan' | 'place' | 'sell'

function actionsFor(item: any): Array<{ key: BagActionKey, label: string, primary: boolean }> {
  if (item.locked || Number(item.count) <= 0)
    return []
  const actions: Array<{ key: BagActionKey, label: string, primary: boolean }> = []
  if (item.can)
    actions.push({ key: 'useCan', label: '加入罐头桶', primary: true })
  else if (item.animalId)
    actions.push({ key: 'place', label: '放养', primary: true })
  if (item.canSell)
    actions.push({ key: 'sell', label: '出售', primary: actions.length === 0 })
  return actions
}

function onAction(item: any, key: BagActionKey) {
  if (key === 'place')
    requestPlace(item)
  else if (key === 'useCan')
    requestUseCan(item)
  else
    requestSell(item)
}

/** 放养只能选对应设施：窝幼崽只列窝、棚幼崽只列棚；未知类型才放开全部栏舍。 */
const activeTargets = computed(() => {
  const result: Record<string, Array<{ label: string, value: any }>> = {}
  for (const item of items.value) {
    const type = item.husbandryType ? PEN_TYPE[item.husbandryType] : undefined
    result[item.uid] = type === undefined
      ? ranchOptions.value
      : ranchOptions.value.filter((option: any) => {
          const facility = ranches.value.find(entry => entry.id === option.value)
          return Number(facility?.moduleType) === type
        })
  }
  return result
})

function targetOptions(item: any) {
  return activeTargets.value[item.uid] || []
}

function requestPlace(item: any) {
  const count = countOf(item)
  const destination = ranchTargets.value[item.uid] || targetOptions(item)[0]?.value || ''
  emit('request', {
    action: 'place',
    input: { ranchId: destination, itemId: item.id, count },
    title: `放养${item.name} ×${count}`,
    note: `幼崽只能放进${item.husbandryType || '对应栏舍'}，栏舍空位不足时服务端会拒绝本次放养。`,
  })
}

/** 一条物品可能有多个报价，全部拼出来；后端已保证多货币报价要么全有效要么整批作废。 */
function unitPrice(item: any) {
  return item.sellPrices.map((price: any) => `${price.name} ×${formatQuantity(price.count)}`).join(' + ')
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!state?.bag" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      后端本次未下发牧场背包段落，请点击刷新重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="row in FILTERS"
            :key="row.value"
            class="min-w-20 rounded-md px-3 text-sm font-medium transition"
            :class="filter === row.value ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="filter === row.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="filter = row.value"
          >
            {{ row.label }}
          </button>
        </div>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          共 {{ items.length }} 批物品
        </span>
        <BaseButton v-if="hasLockable" variant="secondary" size="sm" :aria-pressed="batchLockMode" @click="toggleBatchLockMode">
          {{ batchLockMode ? '退出批量' : '批量锁定' }}
        </BaseButton>
        <BaseButton v-if="!batchLockMode" variant="primary" size="sm" :disabled="!sellable.length" @click="requestSellAll">
          一键出售产物
        </BaseButton>
      </div>

      <div v-if="batchLockMode" class="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
        <span class="text-xs text-gray-600 dark:text-gray-300">已选 {{ selectedLockables.length }} 批</span>
        <BaseButton variant="secondary" size="sm" :disabled="!selectedLockables.some((item: any) => !item.locked)" @click="submitBatchLock(true)">
          批量上锁
        </BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="!selectedLockables.some((item: any) => item.locked)" @click="submitBatchLock(false)">
          批量解锁
        </BaseButton>
      </div>

      <div v-if="!items.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
        牧场背包是空的。
      </div>
      <div v-else-if="!visible.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
        该分类下暂无物品。
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        <div
          v-for="item in visible"
          :key="item.uid"
          class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-start gap-2">
            <img v-if="item.image" :src="item.image" :alt="item.name" class="h-11 w-11 shrink-0 rounded object-contain">
            <div v-else class="i-carbon-package h-11 w-11 shrink-0 text-2xl text-gray-300" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ item.name }} ×{{ formatQuantity(item.count) }}
              </p>
              <p v-if="item.sellPrices.length" class="mt-0.5 truncate text-xs text-gray-500">
                单价 {{ unitPrice(item) }}
              </p>
              <p v-else-if="item.can" class="mt-0.5 truncate text-xs text-gray-500">
                {{ item.can.feed_type }} · 每个 {{ formatSeconds(item.can.speed_up_secs) }}
              </p>
              <p v-else-if="item.product" class="mt-0.5 truncate text-xs text-gray-500">
                重 {{ item.product.weightKg }} kg · 品级 {{ item.product.tier }} · 价格系数 {{ item.product.priceRate }}
              </p>
            </div>
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span v-if="item.locked" class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40">已锁定</span>
            <span
              v-if="item.husbandryType"
              class="rounded px-1.5 py-0.5"
              :class="item.husbandryType === '棚'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'"
            >
              {{ item.husbandryType }}幼崽
            </span>
            <span v-if="item.giantCub" class="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">巨大幼崽</span>
            <span v-if="!actionsFor(item).length" class="rounded bg-gray-50 px-1.5 py-0.5 text-gray-500 dark:bg-gray-900/40">无牧场操作</span>
            <span v-if="item.canSell && !PRODUCT_TYPES.includes(Number(item.type))" class="rounded bg-sky-50 px-1.5 py-0.5 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">可单卖</span>
          </div>

          <!-- 锁定独立于业务动作：已锁定的物品本来就没有其它动作，混在一个 v-if 里会互相挡住 -->
          <div v-if="item.lockable" class="mt-3 flex flex-wrap items-center gap-2">
            <label v-if="batchLockMode" class="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                v-model="selectedUids"
                type="checkbox"
                :value="item.uid"
                :aria-label="`选择${item.name}`"
                class="h-4 w-4"
              >
              选择此项
            </label>
            <BaseButton v-else variant="secondary" size="sm" @click="requestLock(item)">
              {{ item.locked ? '解锁' : '上锁' }}
            </BaseButton>
          </div>

          <div v-if="!batchLockMode && actionsFor(item).length" class="mt-3 flex flex-wrap items-end gap-2">
            <BaseSelect
              v-if="item.animalId"
              v-model="ranchTargets[item.uid]"
              :options="targetOptions(item)"
              :placeholder="item.husbandryType ? `选择${item.husbandryType}` : '选择栏舍'"
              class="min-w-36 flex-1"
            />
            <BaseInput
              v-model="counts[item.uid]"
              type="number"
              :label="item.animalId ? '只数' : '个数'"
              class="w-20"
              :min="1"
              :max="Number(item.count) || 1"
            />
            <BaseButton
              v-for="row in actionsFor(item)"
              :key="row.key"
              size="sm"
              :variant="row.primary ? 'primary' : 'secondary'"
              :disabled="!!item.animalId && row.key === 'place' && !targetOptions(item).length"
              @click="onAction(item, row.key)"
            >
              {{ row.label }}
            </BaseButton>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
