<script setup lang="ts">
import type { CollectionItemDto } from '@/utils/collections'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import CollectionItemCard from '@/components/illustrated/CollectionItemCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useCollectionsStore } from '@/stores/collections'
import { useToastStore } from '@/stores/toast'
import {
  buildDisplayBody,
  buildUpgradeBody,
  collectionsProgress,
  costLine,
  describeItemAction,
} from '@/utils/collections'

const accountStore = useAccountStore()
const collectionsStore = useCollectionsStore()
const toast = useToastStore()

const { currentAccountId } = storeToRefs(accountStore)
const { loading, loaded, acting, error, catalogError, refreshRequired, snapshot, catalog } = storeToRefs(collectionsStore)

type SeriesFilter = 'all' | 'upgradeable' | 'activated' | 'locked'

const filter = ref<SeriesFilter>('all')
const expanded = ref<Record<number, boolean>>({})
/** 待确认的操作：upgrade 会真实消耗藏品本体与材料，display 会改写展台，都要先看清单再提交。 */
const pending = ref<{ kind: 'upgrade' | 'display', item: CollectionItemDto, body: Record<string, unknown>, displayed?: boolean } | null>(null)

const filterTabs: Array<{ value: SeriesFilter, label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'upgradeable', label: '可升星' },
  { value: 'activated', label: '已激活' },
  { value: 'locked', label: '未解锁' },
]

const progress = computed(() => collectionsProgress(snapshot.value))
const seriesList = computed(() => snapshot.value?.series || [])
const displayedName = computed(() => {
  const id = snapshot.value?.display?.itemId
  if (!id)
    return ''
  return seriesList.value.flatMap(s => s.items).find(item => String(item.id) === id)?.name || `藏品 ${id}`
})

const visibleSeries = computed(() => seriesList.value
  .map(series => ({
    ...series,
    items: series.items.filter((item) => {
      if (filter.value === 'all')
        return true
      if (filter.value === 'activated')
        return item.activated
      if (filter.value === 'locked')
        return !item.unlocked
      return item.canUpgrade
    }),
  }))
  .filter(series => series.items.length > 0))

/** 过滤后一个都不剩时给出原因，避免整页空白看起来像读取失败。 */
const emptyByFilter = computed(() => seriesList.value.length > 0 && visibleSeries.value.length === 0)

const dialogTitle = computed(() => {
  const request = pending.value
  if (!request)
    return ''
  if (request.kind === 'upgrade')
    return request.item.activated ? '确认升星' : '确认激活藏品'
  return request.displayed ? '确认设为展示藏品' : '确认取消展示'
})

const dialogMessage = computed(() => {
  const request = pending.value
  if (!request)
    return ''
  if (request.kind === 'upgrade') {
    const costs = request.item.nextStarCosts.map(cost => costLine(cost)).join('、') || '后端未下发材料'
    const target = Math.min(request.item.starLevel + 1, request.item.maxStarLevel)
    return `将消耗：${costs}。星级由 ${request.item.starLevel} 变为 ${target}，材料或星级在这期间发生变化时后端会拒绝执行，需要重新确认。`
  }
  return `确认把「${request.item.name}」${request.displayed ? '放上展台' : '从展台取下'}吗？展台同一时间只展示一件藏品。`
})

function milestoneState(milestone: { claimed: boolean, reached: boolean }) {
  if (milestone.claimed)
    return 'claimed'
  return milestone.reached ? 'claimable' : 'locked'
}

function seriesOpen(id: number) {
  return expanded.value[id] !== false
}

function toggleSeries(id: number) {
  expanded.value = { ...expanded.value, [id]: !seriesOpen(id) }
}

async function refresh() {
  if (!currentAccountId.value)
    return
  await collectionsStore.fetchSnapshot(currentAccountId.value)
}

async function claimMilestones() {
  if (!currentAccountId.value || acting.value)
    return
  const result = await collectionsStore.operate(currentAccountId.value, 'claim')
  if (!result.ok)
    return toast.error(result.error || '领取收藏分数奖励失败')
  if (result.status === 'skipped')
    return toast.info(result.message || '当前没有可达成的分数档位')
  toast.success(result.message || '收藏分数奖励已领取')
}

function askUpgrade(item: CollectionItemDto) {
  const body = buildUpgradeBody(item)
  if (!body) {
    toast.error(describeItemAction(item, snapshot.value?.display?.itemId ?? null).reason || '该藏品当前不可升星')
    return
  }
  pending.value = { kind: 'upgrade', item, body }
}

function askDisplay(item: CollectionItemDto, displayed: boolean) {
  const body = buildDisplayBody(item, displayed, snapshot.value)
  if (!body) {
    toast.error('请先激活藏品，再设置展台展示')
    return
  }
  pending.value = { kind: 'display', item, body, displayed }
}

async function confirmPending() {
  const request = pending.value
  if (!request || !currentAccountId.value)
    return
  const result = await collectionsStore.operate(currentAccountId.value, request.kind, request.body)
  if (!result.ok) {
    toast.error(result.error || '藏品操作失败')
    return
  }
  pending.value = null
  if (result.status === 'skipped')
    toast.info(result.message || '藏品状态无需变更')
  else
    toast.success(result.message || '藏品已更新')
}

watch(currentAccountId, () => {
  collectionsStore.clearCollectionsData()
  pending.value = null
  refresh()
})

onMounted(() => {
  refresh()
  void collectionsStore.fetchCatalog()
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div class="min-w-0 flex flex-wrap items-center gap-2 text-sm">
        <span class="h-8 flex items-center rounded-lg bg-blue-50 px-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          {{ progress?.text || '收藏分未读取' }}
        </span>
        <span class="h-8 flex items-center rounded-lg bg-emerald-50 px-3 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
          已激活 {{ snapshot?.activatedCount ?? 0 }}/{{ snapshot?.totalCount ?? 0 }}
        </span>
        <span class="h-8 flex items-center rounded-lg bg-amber-50 px-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          可升星 {{ collectionsStore.upgradableCount }}
        </span>
        <span class="h-8 flex items-center rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          展台：{{ displayedName || '未设置' }}
        </span>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="tab in filterTabs"
            :key="tab.value"
            class="min-w-16 rounded-md px-3 text-sm font-medium transition"
            :class="filter === tab.value
              ? 'text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="filter === tab.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="filter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
        <BaseButton
          class="w-36"
          variant="primary"
          :loading="acting"
          :disabled="!currentAccountId || collectionsStore.claimableMilestones.length === 0"
          @click="claimMilestones"
        >
          领取分数奖励（{{ collectionsStore.claimableMilestones.length }}）
        </BaseButton>
        <BaseButton class="w-24" variant="primary" :loading="loading" @click="refresh">
          刷新
        </BaseButton>
      </div>
    </div>

    <div v-if="!currentAccountId" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
      请先选择账号，再查看蓝晶藏品册。
    </div>

    <div v-else-if="loading && !loaded" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
      正在读取藏品册…
    </div>

    <div v-else-if="error && !loaded" class="rounded-lg bg-red-50 p-8 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
      {{ error }}
    </div>

    <div v-else-if="!loaded" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
      暂无藏品数据，请点击刷新重新读取。
    </div>

    <div v-else class="space-y-4">
      <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ error }}
      </div>
      <div v-if="refreshRequired" class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
        后端未返回操作后的藏品快照，请点击刷新确认星级与分数，不要重复提交同一条操作。
      </div>

      <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
        <div class="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span>收藏分数进度</span>
          <span>{{ snapshot?.nextRewardScore === null ? '全部档位已达成' : `下一档 ${snapshot?.nextRewardScore ?? '—'} 分` }}</span>
        </div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900/50">
          <div class="h-full rounded-full bg-blue-500 transition-all" :style="{ width: `${progress?.percent ?? 0}%` }" />
        </div>

        <div class="mt-4 flex gap-2 overflow-x-auto pb-1">
          <div
            v-for="milestone in snapshot?.milestones || []"
            :key="milestone.level"
            class="min-w-[164px] shrink-0 border rounded-lg px-3 py-2 text-xs"
            :class="{
              'border-emerald-300 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-900/20': milestoneState(milestone) === 'claimed',
              'border-blue-400 bg-blue-50/70 dark:border-blue-600 dark:bg-blue-900/25': milestoneState(milestone) === 'claimable',
              'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30': milestoneState(milestone) === 'locked',
            }"
          >
            <div class="flex items-center justify-between">
              <span class="text-gray-900 font-semibold dark:text-gray-100">Lv.{{ milestone.level }} · {{ milestone.score }} 分</span>
              <span
                class="rounded px-1.5 py-0.5 text-[10px]"
                :class="{
                  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300': milestoneState(milestone) === 'claimed',
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300': milestoneState(milestone) === 'claimable',
                  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400': milestoneState(milestone) === 'locked',
                }"
              >
                {{ milestone.claimed ? '已领取' : milestone.reached ? '可领取' : '未达成' }}
              </span>
            </div>
            <div v-if="milestone.rewards.length" class="mt-1.5 text-gray-600 space-y-1 dark:text-gray-300">
              <div v-for="reward in milestone.rewards" :key="reward.itemId" class="truncate">
                {{ costLine(reward) }}
              </div>
            </div>
            <div v-if="milestone.buffs.length" class="mt-1.5 truncate text-blue-600 dark:text-blue-300">
              {{ milestone.buffs.map(buff => buff.description).join('、') }}
            </div>
          </div>
          <div v-if="!(snapshot?.milestones || []).length" class="text-xs text-gray-500 dark:text-gray-400">
            后端未下发收藏分数档位
          </div>
        </div>

        <div v-if="(snapshot?.currentBuffs || []).length" class="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span class="text-gray-500 dark:text-gray-400">生效中的藏品加成：</span>
          <span
            v-for="buff in snapshot?.currentBuffs || []"
            :key="buff.id"
            class="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
          >
            {{ buff.description }}
          </span>
        </div>
      </div>

      <div v-if="emptyByFilter" class="border border-gray-200 rounded-lg border-dashed bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
        当前筛选条件下没有藏品
      </div>

      <section
        v-for="series in visibleSeries"
        :key="series.id"
        class="border border-gray-200 rounded-xl bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      >
        <button class="w-full flex items-start justify-between gap-3 text-left" @click="toggleSeries(series.id)">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                {{ series.name }}
              </h3>
              <span class="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
                {{ series.rarityName }}
              </span>
              <span class="rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                {{ series.activatedCount }}/{{ series.totalCount }} 已激活
              </span>
            </div>
            <p v-if="series.description" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ series.description }}
            </p>
            <p v-if="series.requirements.length" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              系列解锁：{{ series.requirements.join('；') }}
            </p>
            <div v-if="series.mutationRules.length" class="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span
                v-for="rule in series.mutationRules"
                :key="rule.name"
                class="border border-gray-200 rounded px-1.5 py-0.5 dark:border-gray-700"
              >
                {{ rule.name }} {{ rule.probability }}%<template v-if="rule.guarantee"> · 保底 {{ rule.guarantee }}</template>
              </span>
            </div>
          </div>
          <span class="shrink-0 text-xs text-gray-400">{{ seriesOpen(series.id) ? '收起' : '展开' }}</span>
        </button>

        <div v-if="seriesOpen(series.id)" class="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] mt-3 gap-3">
          <CollectionItemCard
            v-for="item in series.items"
            :key="item.id"
            :item="item"
            :acting="acting"
            :action="describeItemAction(item, snapshot?.display?.itemId ?? null)"
            @upgrade="askUpgrade"
            @display="askDisplay"
          />
        </div>
      </section>

      <section v-if="(snapshot?.pedestals || []).length" class="border border-gray-200 rounded-xl bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h3 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
          展台
        </h3>
        <div class="mt-3 flex gap-2 overflow-x-auto pb-1">
          <div
            v-for="pedestal in snapshot?.pedestals || []"
            :key="pedestal.id"
            class="min-w-[112px] shrink-0 border rounded-lg px-3 py-2 text-center text-xs"
            :class="pedestal.owned
              ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30'
              : 'border-dashed border-gray-200 opacity-70 dark:border-gray-700'"
          >
            <img v-if="pedestal.image" :src="pedestal.image" :alt="pedestal.name" class="mx-auto h-10 w-10 object-contain">
            <div v-else class="grid mx-auto h-10 w-10 place-items-center rounded bg-white text-[10px] text-gray-400 dark:bg-gray-800">
              无图
            </div>
            <div class="mt-1 truncate text-gray-700 dark:text-gray-200">
              {{ pedestal.name }}
            </div>
            <div class="mt-0.5 text-[10px]" :class="pedestal.owned ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'">
              {{ pedestal.owned ? '已拥有' : '未获得' }}
            </div>
          </div>
        </div>
      </section>

      <section v-if="(catalog?.collections || []).length" class="border border-gray-200 rounded-xl bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
            官方公示的系列概率
          </h3>
          <span class="text-[11px] text-gray-500 dark:text-gray-400">来自客户端配置表，不含本账号进度</span>
        </div>
        <div v-if="catalogError" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {{ catalogError }}
        </div>
        <div class="grid mt-3 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="entry in catalog?.collections || []"
            :key="entry.id"
            class="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-900/30"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-gray-800 font-medium dark:text-gray-200">{{ entry.name }}</span>
              <span class="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">{{ entry.rarityName }}</span>
            </div>
            <div v-if="entry.mutationRules.length" class="mt-1 truncate text-gray-500 dark:text-gray-400">
              {{ entry.mutationRules.map(rule => `${rule.name} ${rule.probability}%`).join('、') }}
            </div>
            <div v-else class="mt-1 text-gray-400">
              官方未公示该系列概率
            </div>
          </div>
        </div>
      </section>
    </div>

    <ConfirmModal
      :show="!!pending"
      :title="dialogTitle"
      :message="dialogMessage"
      :loading="acting"
      type="primary"
      @confirm="confirmPending"
      @cancel="pending = null"
      @close="pending = null"
    />
  </div>
</template>
