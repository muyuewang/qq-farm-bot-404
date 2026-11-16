<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import CollectionsPanel from '@/components/illustrated/CollectionsPanel.vue'
import IllustratedItemCard from '@/components/illustrated/IllustratedItemCard.vue'
import RanchIllustratedPanel from '@/components/ranch/RanchIllustratedPanel.vue'
import RanchSceneHost from '@/components/ranch/RanchSceneHost.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { CROP_ILLUSTRATED_TYPE, MUTANT_ILLUSTRATED_TYPE, useIllustratedStore } from '@/stores/illustrated'
import { useSceneStore } from '@/stores/scene'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const illustratedStore = useIllustratedStore()
const sceneStore = useSceneStore()
const toast = useToastStore()

const { currentAccountId } = storeToRefs(accountStore)
const { scene } = storeToRefs(sceneStore)
const { loaded, loading, claiming, error, refreshRequired } = storeToRefs(illustratedStore)

/** 藏品册走 /api/collections，与 /api/illustrated 是两套后端快照，用独立的页签值区分。 */
const COLLECTIONS_TAB = 'collections'

/**
 * 牧场图鉴挂在 game_scene_id=2 的牧场快照上，和农场图鉴不是同一份数据，
 * 因此这一页跟随顶部栏的全局场景切换，而不是在牧场入口再复制一个图鉴页。
 */

const filter = ref<'all' | 'unlocked' | 'locked'>('all')
/** 后端一次请求同时返回两本图鉴，这里的切换只是本地展示维度 */
const illustratedType = ref<number | typeof COLLECTIONS_TAB>(CROP_ILLUSTRATED_TYPE)

const isCollections = computed(() => illustratedType.value === COLLECTIONS_TAB)
const activeBook = computed(() => (typeof illustratedType.value === 'number' ? illustratedStore.bookByType[illustratedType.value] : null))
const items = computed(() => activeBook.value?.items || [])
const claimableLevels = computed(() => (activeBook.value?.levels || []).filter(level => level.canClaim))

const filteredItems = computed(() => {
  if (filter.value === 'unlocked')
    return items.value.filter(item => item.unlocked)
  if (filter.value === 'locked')
    return items.value.filter(item => !item.unlocked)
  return items.value
})

const unlockedCount = computed(() => items.value.filter(item => item.unlocked).length)
const lockedCount = computed(() => Math.max(0, items.value.length - unlockedCount.value))

const typeTabs: Array<{ value: number | typeof COLLECTIONS_TAB, label: string }> = [
  { value: CROP_ILLUSTRATED_TYPE, label: '作物图鉴' },
  { value: MUTANT_ILLUSTRATED_TYPE, label: '变异图鉴' },
  { value: COLLECTIONS_TAB, label: '蓝晶藏品' },
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
    return item.reward ? `收录奖励 ${item.reward.name} x${item.reward.count}` : '已获得收录奖励'
  if (illustratedType.value === CROP_ILLUSTRATED_TYPE && item.shopSeed && !item.shopSeed.locked && !item.shopSeed.soldOut)
    return '可在商城种子商店购买该种子'
  return '未达到收录条件'
}

function getProgressHint(item: any) {
  if (item.isNew)
    return '本次新增收录'
  return item.unlocked ? '已收录' : '尚未收录'
}

function getItemStatusLabel(item: any) {
  return item.unlocked ? '已收录' : '未收录'
}

async function refresh() {
  // 牧场场景只读牧场快照，这份农场图鉴数据没有消费方，切回农场时再拉取。
  if (!currentAccountId.value || scene.value === 'ranch')
    return
  await illustratedStore.fetchSnapshot(currentAccountId.value)
}

async function claimLevelRewards() {
  if (!currentAccountId.value || !activeBook.value?.claimable || typeof illustratedType.value !== 'number')
    return
  const result = await illustratedStore.claimRewards(currentAccountId.value, illustratedType.value)
  if (result.ok) {
    const rewards = result.data?.rewards || []
    const claimed = result.data?.claimedLevels?.length || 0
    toast.success(`已领取 ${claimed} 个图鉴等级奖励${rewards.length ? `：${rewards.map((r: any) => `${r.name} x${r.count}`).join('、')}` : ''}`)
    if (result.data?.refreshRequired)
      await refresh()
  }
  else {
    toast.error(result.error || '领取图鉴奖励失败')
  }
}

watch(currentAccountId, () => {
  illustratedStore.clearIllustratedData()
  refresh()
})

watch(scene, () => {
  refresh()
})

onMounted(() => {
  refresh()
})
</script>

<template>
  <section class="space-y-4">
    <div v-if="scene === 'farm'" class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <div class="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <div class="i-carbon-book text-2xl text-emerald-500" />
            <h1 class="text-xl font-bold">
              图鉴
            </h1>
          </div>
          <div v-if="!isCollections" class="flex flex-wrap items-center gap-2 text-sm">
            <span class="h-8 flex items-center rounded-lg bg-emerald-50 px-3 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              {{ unlockedCount }}/{{ items.length }} 已解锁
            </span>
            <span class="h-8 flex items-center rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
              {{ lockedCount }}/{{ items.length }} 未解锁
            </span>
            <span class="h-8 flex items-center rounded-lg bg-amber-50 px-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Lv.{{ activeBook?.level ?? 0 }}
            </span>
            <span class="h-8 flex items-center rounded-lg bg-blue-50 px-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              可领取 {{ claimableLevels.length }} 个等级
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
          <div v-if="!isCollections" class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
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
          <BaseButton
            v-if="!isCollections"
            class="w-32"
            variant="primary"
            :loading="claiming"
            :disabled="!currentAccountId || !activeBook?.claimable"
            @click="claimLevelRewards"
          >
            领取等级奖励
          </BaseButton>
          <BaseButton v-if="!isCollections" class="w-24" variant="primary" :loading="loading" @click="refresh">
            刷新
          </BaseButton>
        </div>
      </div>

      <CollectionsPanel v-if="isCollections" />

      <div v-else-if="!currentAccountId" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        请先选择账号，再查看图鉴。
      </div>

      <div v-else-if="loading && !loaded" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        正在加载图鉴数据...
      </div>

      <div v-else-if="error && !loaded" class="rounded-lg bg-red-50 p-8 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ error }}
      </div>

      <div v-else-if="!loaded" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        暂无图鉴数据，请点击刷新重新读取。
      </div>

      <div v-else class="space-y-4">
        <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ error }}
        </div>
        <div v-if="refreshRequired" class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          奖励已领取，但后端未能返回最新图鉴快照，请点击刷新确认进度。
        </div>
        <div v-if="filteredItems.length === 0" class="border border-gray-200 rounded-lg border-dashed bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
          暂无图鉴项目
        </div>

        <div class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3">
          <IllustratedItemCard
            v-for="item in filteredItems"
            :key="item.seedId"
            :item="item"
            :status-label="getItemStatusLabel(item)"
            :progress-hint="getProgressHint(item)"
            :unlock-hint="getUnlockHint(item)"
          />
        </div>
      </div>
    </div>

    <RanchSceneHost v-else view="illustrated" title="牧场图鉴" icon="i-carbon-book">
      <template #default="{ state, onRequest }">
        <RanchIllustratedPanel :state="state" @request="onRequest" />
      </template>
    </RanchSceneHost>
  </section>
</template>
