<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NCard } from 'naive-ui/es/card'
import { NInputNumber } from 'naive-ui/es/input-number'
import { NModal } from 'naive-ui/es/modal'
import { NProgress } from 'naive-ui/es/progress'
import { NTab, NTabs } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAccountStore } from '@/stores/account'
import { useIllustratedStore } from '@/stores/illustrated'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const illustratedStore = useIllustratedStore()
const toast = useToastStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { data, loading, error } = storeToRefs(illustratedStore)
const currentType = ref<'crop' | 'mutant'>('crop')
const currentMutantGroup = ref('gold')
const detailsOpen = ref(false)
const claiming = ref(false)
const rewardList = ref<HTMLElement | null>(null)
let claimRevision = 0
const purchaseDialogOpen = ref(false)
const selectedSeedItem = ref<any>(null)
const purchaseCount = ref(1)
const purchasingSeedId = ref<number | null>(null)

const book = computed(() => data.value?.[currentType.value] || null)
const isConnected = computed(() => !!currentAccount.value?.running)
const collectedCount = computed(() => (Array.isArray(book.value?.items) ? book.value.items : []).filter((item: any) => item.unlocked).length)
const illustratedBuffs = computed(() => Array.isArray(book.value?.buffs) ? book.value.buffs : [])
const currentIllustratedBuffs = computed(() => Array.isArray(book.value?.currentBuffs) ? book.value.currentBuffs : [])
const illustratedLevelMap = computed(() => new Map(
  (Array.isArray(book.value?.levels) ? book.value.levels : []).map((level: any) => [Number(level?.level) || 0, level]),
))
function formatBuffValue(bonus: any) {
  const value = Number(bonus?.value) || 0
  return bonus?.valueType === 'probability' ? `触发概率 ${value / 10}%` : `数量 +${value}`
}
function formatBuffLevelState(bonus: any) {
  if (Number(bonus?.level) <= Number(book.value?.level || 0))
    return '已达成'
  const level = illustratedLevelMap.value.get(Number(bonus?.level) || 0) as any
  return level?.progress ? `${level.progress} 进度` : '未达成'
}
const mutantGroups = computed(() => {
  const items = Array.isArray(book.value?.items) ? [...book.value.items].sort((a: any, b: any) => Number(a.sort || 0) - Number(b.sort || 0)) : []
  return [
    { key: 'gold', label: '黄金果实', items: items.filter((item: any) => item.group === 'gold') },
    { key: 'decoration', label: '装扮果实', items: items.filter((item: any) => item.group === 'decoration') },
    { key: 'activity', label: '活动果实', items: items.filter((item: any) => item.group === 'activity') },
  ] as const
})
const selectedMutantGroup = computed(() => mutantGroups.value.find(group => group.key === currentMutantGroup.value) || mutantGroups.value[0])

function progressPercent(value: any, next: any) {
  const current = Math.max(0, Number(value) || 0)
  const target = Math.max(current, Number(next) || 0)
  return target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0
}

function openSeedPurchase(item: any) {
  selectedSeedItem.value = item
  purchaseCount.value = 1
  purchaseDialogOpen.value = true
}

async function purchaseSeed() {
  const item = selectedSeedItem.value
  const seed = item?.shopSeed
  if (!currentAccountId.value || !seed?.goodsId || purchasingSeedId.value !== null)
    return
  const count = Math.max(1, Math.min(seed.remainingPurchaseCount || 9999, Math.floor(Number(purchaseCount.value) || 1)))
  purchasingSeedId.value = item.seedId
  try {
    const response = await api.post('/api/seeds/purchase', { goodsId: seed.goodsId, count }, {
      headers: { 'x-account-id': String(currentAccountId.value) },
      skipErrorToast: true,
    } as any)
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data, '种子购买失败'))
    toast.success(`种子购买成功：${item.name}`)
    purchaseDialogOpen.value = false
    selectedSeedItem.value = null
    await refresh()
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '种子购买失败'))
  }
  finally {
    purchasingSeedId.value = null
  }
}

function seedAvailability(item: any) {
  const seed = item.shopSeed
  if (!seed)
    return ''
  if (seed.unknownMeta)
    return '活动/其他途径获取'
  if (seed.locked)
    return seed.requiresUnlockCard ? '需要种子解锁卡' : (seed.requiredLevel ? `${seed.requiredLevel}级解锁` : '需要其他解锁条件')
  if (seed.soldOut)
    return '已达到限购数量'
  return '当前无法购买'
}

async function refresh() {
  if (currentAccountId.value && isConnected.value)
    await illustratedStore.fetch(currentAccountId.value)
}

async function claimRewards() {
  if (claiming.value || loading.value || !book.value?.claimable || !isConnected.value)
    return
  const accountId = currentAccountId.value
  const revision = ++claimRevision
  claiming.value = true
  try {
    const response = await api.post('/api/illustrated/claim', { type: currentType.value === 'crop' ? 1 : 2 }, { headers: { 'x-account-id': accountId }, skipErrorToast: true } as any)
    if (revision !== claimRevision)
      return
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data, '图鉴奖励领取失败'))
    const result = response.data.data
    const message = result.rewards?.map((item: any) => `${item.name} ×${item.count}`).join('、') || '领取成功'
    illustratedStore.reset()
    if (result.snapshot)
      data.value = result.snapshot
    if (result.refreshRequired)
      toast.warning(`${message}。请刷新确认最新进度`)
    else toast.success(message)
  }
  catch (cause) {
    if (revision === claimRevision) {
      toast.error(getApiErrorMessage(cause, '图鉴奖励领取失败'))
      await refresh()
    }
  }
  finally {
    if (revision === claimRevision)
      claiming.value = false
  }
}
async function scrollToNextReward() {
  await nextTick()
  const target = rewardList.value?.querySelector<HTMLElement>('[data-next="true"]')
  if (target && rewardList.value)
    rewardList.value.scrollTop = target.offsetTop - rewardList.value.offsetTop
}

watch([currentAccountId, isConnected], () => {
  claimRevision++
  claiming.value = false
  detailsOpen.value = false
}, { flush: 'sync' })

onMounted(refresh)
watch(currentAccountId, () => {
  illustratedStore.reset()
  void refresh()
})
watch(isConnected, refresh)
</script>

<template>
  <div class="illustrated">
    <!-- 标题、类型切换与进度：桌面端吸顶，列表随页面滚动。 -->
    <div class="illustrated-head">
      <div class="illustrated-head__card">
        <div class="illustrated-head__top">
          <div class="min-w-0">
            <h3 class="illustrated-head__title">
              <span class="i-carbon-book" /> 图鉴
            </h3>
            <p class="illustrated-head__desc">
              作物收藏、超变果实与图鉴属性加成
            </p>
          </div>
          <NButton secondary :loading="loading" :disabled="!currentAccountId || !isConnected" @click="refresh">
            <template #icon>
              <span class="i-carbon-renew" />
            </template>
            刷新
          </NButton>
        </div>

        <NTabs v-model:value="currentType" type="segment" animated>
          <NTab name="crop">
            作物图鉴
          </NTab>
          <NTab name="mutant">
            超变图鉴
          </NTab>
        </NTabs>

        <section v-if="book && currentAccountId && isConnected && !error" class="illustrated-progress">
          <div class="illustrated-progress__badge">
            <b>{{ book.level || 0 }}</b><small>等级</small>
          </div>
          <div class="illustrated-progress__main">
            <div class="illustrated-progress__heading">
              <strong>{{ currentType === 'mutant' ? '超变图鉴进度' : '作物图鉴进度' }}</strong>
              <span class="illustrated-progress__value">{{ book.progress || 0 }} / {{ book.nextLevelProgress || '—' }}</span>
              <NButton class="illustrated-progress__details" size="tiny" secondary @click="detailsOpen = true">
                奖励详情
              </NButton>
            </div>
            <NProgress class="mt-2" type="line" status="success" :percentage="progressPercent(book.progress, book.nextLevelProgress)" :show-indicator="false" />
          </div>
        </section>
      </div>
    </div>

    <EmptyState v-if="!currentAccountId" title="请先选择账号" description="在左侧选择账号后查看图鉴进度" icon="i-carbon-user-avatar" />
    <EmptyState v-else-if="!isConnected" title="账号未运行" description="请先启动账号；启动后会读取图鉴进度" icon="i-carbon-connection-signal-off" />
    <div v-else-if="loading && !data" class="flex justify-center py-12">
      <span class="i-svg-spinners-90-ring-with-bg text-3xl text-green-600" />
    </div>
    <EmptyState v-else-if="error" tone="error" title="图鉴读取失败" :description="error" icon="i-carbon-warning-alt">
      <NButton secondary @click="refresh">
        重新读取
      </NButton>
    </EmptyState>
    <template v-else-if="book">
      <div v-if="currentType === 'mutant'" class="illustrated-collection cartoon-card rounded-2xl bg-white p-5 shadow-lg dark:bg-gray-800">
        <NTabs v-model:value="currentMutantGroup" class="shrink-0" type="line" animated>
          <NTab v-for="group in mutantGroups" :key="group.key" :name="group.key">
            {{ group.label }} <span class="ml-1 text-xs text-gray-400">{{ group.items.length }}</span>
          </NTab>
        </NTabs>
        <div :key="currentMutantGroup" class="illustrated-list custom-scrollbar" role="region" :aria-label="`${selectedMutantGroup.label}列表`" tabindex="0">
          <div v-if="selectedMutantGroup.items.length" class="illustrated-grid">
            <div v-for="item in selectedMutantGroup.items" :key="item.seedId" class="border rounded-xl p-3" :class="item.unlocked ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : 'border-gray-200 opacity-55 dark:border-gray-700'">
              <img v-if="item.image" :src="item.image" alt="" class="mx-auto h-10 w-10 object-contain sm:h-12 sm:w-12">
              <div class="illustrated-item__name mt-1 text-center text-xs font-medium" :title="item.name">
                {{ item.name }}
              </div>
              <div class="whitespace-nowrap text-center text-xs text-gray-500">
                {{ item.unlocked ? '已解锁' : '未解锁' }}
              </div>
            </div>
          </div>
          <EmptyState v-else bare title="暂无记录" :description="`当前没有${selectedMutantGroup.label}图鉴记录`" icon="i-carbon-book" />
        </div>
      </div>
      <div v-else class="illustrated-collection cartoon-card rounded-2xl bg-white p-5 shadow-lg dark:bg-gray-800">
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <h4 class="text-lg font-bold">
            作物图鉴
          </h4><span class="text-sm text-gray-500">已收藏 {{ collectedCount }} / {{ book.items?.length || 0 }}</span>
        </div>
        <div class="illustrated-list custom-scrollbar" role="region" aria-label="作物图鉴列表" tabindex="0">
          <div class="illustrated-grid">
            <div v-for="item in book.items" :key="item.seedId" class="border rounded-xl p-3" :class="item.unlocked ? 'border-green-300 bg-green-50/50 dark:bg-green-950/20' : 'border-gray-200 opacity-55 dark:border-gray-700'">
              <img v-if="item.image" :src="item.image" alt="" class="mx-auto h-10 w-10 object-contain sm:h-12 sm:w-12">
              <div class="illustrated-item__name mt-1 text-center text-xs font-medium" :title="item.name">
                {{ item.name }}
              </div>
              <div class="whitespace-nowrap text-center text-xs text-gray-500">
                {{ item.unlocked ? '已收藏' : '未收藏' }}
              </div>
              <div v-if="item.shopSeed?.goodsId && !item.shopSeed.locked && !item.shopSeed.soldOut && !item.shopSeed.unknownMeta" class="mt-2 flex justify-center">
                <NButton size="tiny" type="primary" :loading="purchasingSeedId === item.seedId" :disabled="purchasingSeedId !== null" @click="openSeedPurchase(item)">
                  购买
                </NButton>
              </div>
              <div v-else-if="seedAvailability(item)" class="mt-2 text-center text-[11px] text-gray-500 leading-4">
                {{ seedAvailability(item) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <NModal v-model:show="purchaseDialogOpen" :mask-closable="purchasingSeedId === null" :close-on-esc="purchasingSeedId === null">
        <NCard class="max-w-sm w-[calc(100vw-32px)]" :title="`购买${selectedSeedItem?.name || '种子'}`" closable @close="purchaseDialogOpen = false">
          <div class="space-y-4">
            <div class="text-sm text-gray-500">
              每批 {{ selectedSeedItem?.shopSeed?.itemCount || 1 }} 颗 · {{ selectedSeedItem?.shopSeed?.price || 0 }} 金
            </div>
            <div class="flex items-center justify-between gap-3">
              <span>购买批次</span>
              <NInputNumber v-model:value="purchaseCount" :min="1" :max="selectedSeedItem?.shopSeed?.remainingPurchaseCount || 9999" :disabled="purchasingSeedId !== null" />
            </div>
            <div class="flex items-center justify-between border-t pt-3 text-sm">
              <span>合计</span>
              <strong>{{ ((selectedSeedItem?.shopSeed?.price || 0) * purchaseCount).toLocaleString() }} 金</strong>
            </div>
            <div class="flex justify-end gap-2">
              <NButton secondary :disabled="purchasingSeedId !== null" @click="purchaseDialogOpen = false">
                取消
              </NButton>
              <NButton type="primary" :loading="purchasingSeedId !== null" @click="purchaseSeed">
                确认购买
              </NButton>
            </div>
          </div>
        </NCard>
      </NModal>

      <NModal v-model:show="detailsOpen" @after-enter="scrollToNextReward">
        <NCard :title="currentType === 'mutant' ? '超变图鉴属性加成' : '作物图鉴收藏奖励'" closable class="illustrated-rewards-modal max-w-3xl w-[calc(100vw-24px)]" @close="detailsOpen = false">
          <template v-if="currentType === 'mutant'">
            <div class="mb-4 rounded-xl bg-green-50 p-3 dark:bg-green-950/30">
              <div class="mb-2 text-sm font-semibold">
                当前加成
              </div>
              <div v-if="currentIllustratedBuffs.length" class="flex flex-wrap gap-2">
                <span v-for="bonus in currentIllustratedBuffs" :key="`current-buff-${bonus.id}`" class="rounded-lg bg-white px-2 py-1 text-sm dark:bg-gray-900">{{ bonus.name }}：{{ formatBuffValue(bonus) }}</span>
              </div>
              <div v-else class="text-sm text-gray-500">
                暂无当前加成
              </div>
            </div>
            <div v-if="illustratedBuffs.length" class="grid max-h-[60vh] gap-2 overflow-y-auto lg:grid-cols-3 sm:grid-cols-2">
              <div v-for="bonus in illustratedBuffs" :key="`all-buff-${bonus.id}`" class="border rounded-xl p-3" :class="bonus.level <= (book.level || 0) ? 'border-green-300 bg-green-50/50 dark:bg-green-950/20' : 'border-gray-200 dark:border-gray-700'">
                <div class="flex items-center justify-between text-sm">
                  <span class="font-semibold">Lv.{{ bonus.level }}</span>
                  <span :class="bonus.level <= (book.level || 0) ? 'text-green-600' : 'text-gray-400'">{{ formatBuffLevelState(bonus) }}</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span class="rounded bg-white/80 px-1.5 py-0.5 text-xs dark:bg-gray-900/50">{{ bonus.name }} · {{ formatBuffValue(bonus) }}</span>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-gray-500">
              暂无属性加成
            </div>
          </template>
          <div v-else class="mb-4 rounded-xl bg-green-50 p-3 dark:bg-green-950/30">
            <div class="mb-2 flex justify-between gap-3 font-semibold">
              <span>{{ book.level }}级</span><span>{{ book.progress }} / {{ book.nextLevelProgress || '—' }}</span>
            </div>
            <NProgress type="line" status="success" :percentage="progressPercent(book.progress, book.nextLevelProgress)" :show-indicator="false" />
          </div>
          <div v-if="currentType !== 'mutant'" ref="rewardList" class="illustrated-rewards-list" role="region" aria-label="收藏奖励" tabindex="0">
            <div v-for="level in book.levels" :key="level.level" :data-next="level.level === (book.levels.find((v: any) => !v.claimed)?.level)" class="illustrated-reward-row" :class="{ claimed: level.claimed, claimable: level.canClaim }">
              <div><strong>{{ level.level }}级</strong><small>{{ level.progress }} 进度</small></div>
              <div class="illustrated-reward-items">
                <span v-for="reward in level.rewards" :key="reward.itemId" :title="reward.name"><img :src="reward.image" :alt="reward.name">{{ reward.count }}</span>
              </div>
              <span class="reward-state">{{ level.claimed ? '已领取' : level.canClaim ? '可领取' : '未达成' }}</span>
            </div>
          </div>
          <template #footer>
            <NButton v-if="currentType === 'crop' || book.claimable" block type="primary" :loading="claiming" :disabled="!book.claimable || loading || claiming" @click="claimRewards">
              领取奖励
            </NButton>
          </template>
        </NCard>
      </NModal>
    </template>
  </div>
</template>

<style scoped>
.illustrated {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.illustrated-collection {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.illustrated-list {
  min-width: 0;
}
.illustrated-list:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
  border-radius: 6px;
}
.illustrated-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
}
.illustrated-item__name {
  display: -webkit-box;
  min-height: 2.8em;
  line-height: 1.4;
  text-wrap: balance;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
@media (min-width: 380px) {
  .illustrated-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 640px) {
  .illustrated-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (min-width: 768px) {
  .illustrated-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
@media (min-width: 1280px) {
  .illustrated-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
.illustrated-rewards-modal {
  max-height: calc(100dvh - 32px);
}
.illustrated-rewards-modal :deep(.n-card-content) {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.illustrated-rewards-modal :deep(.n-card-header),
.illustrated-rewards-modal :deep(.n-card__footer) {
  flex-shrink: 0;
}
.illustrated-rewards-list {
  min-height: 0;
  overflow-y: auto;
  max-height: 55vh;
  display: grid;
  gap: 10px;
}
.illustrated-reward-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px;
  border: 1px solid #d7dbc8;
  border-radius: 12px;
}
.illustrated-reward-row small {
  display: block;
  color: #888;
  margin-top: 4px;
}
.illustrated-reward-row.claimable {
  border-color: #71ad51;
  background: #d6eccc22;
}
.illustrated-reward-row.claimed {
  opacity: 0.6;
}
.illustrated-reward-items {
  display: flex;
  gap: 12px;
  margin-left: auto;
  flex-wrap: wrap;
}
.illustrated-reward-items span {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: 600;
}
.illustrated-reward-items img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.reward-state {
  font-size: 12px;
  white-space: nowrap;
}
.illustrated-head {
  flex-shrink: 0;
}
/* 桌面端标题与进度吸在 Tab 下方；手机端随内容滚走，给作物列表留出阅读空间。 */
@media (min-width: 1024px) {
  .illustrated-head {
    position: sticky;
    top: var(--sticky-top, 0px);
    z-index: 6;
    background: var(--chrome-bg);
  }
}
.illustrated-head__card {
  display: grid;
  gap: 16px;
  padding: 20px 22px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-table-head);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}
.illustrated-head__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.illustrated-head__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-ink);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
}
.illustrated-head__title span {
  color: var(--ui-warning);
  font-size: 20px;
}
.illustrated-head__desc {
  margin: 4px 0 0;
  color: var(--ui-muted);
  font-size: 13px;
}
.illustrated-progress {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding-top: 16px;
  border-top: 1px dashed var(--ui-border-strong);
  color: var(--ui-ink);
}
.illustrated-progress__badge {
  width: 52px;
  height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
.illustrated-progress__badge b {
  font-size: 22px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.illustrated-progress__badge small {
  margin-top: 3px;
  font-size: 10px;
  opacity: 0.8;
}
.illustrated-progress__main {
  min-width: 0;
}
.illustrated-progress__heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px 8px;
}
.illustrated-progress__main strong {
  color: var(--ui-ink);
  font-size: 14px;
}
.illustrated-progress__value {
  white-space: nowrap;
  color: var(--ui-muted);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 520px) {
  .illustrated-head__card {
    gap: 14px;
    padding: 16px;
  }
  .illustrated-progress {
    grid-template-columns: 46px minmax(0, 1fr);
    gap: 10px;
  }
  .illustrated-progress__badge {
    width: 46px;
    height: 46px;
  }
  .illustrated-progress__heading {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .illustrated-progress__heading strong {
    grid-area: 1 / 1;
  }
  .illustrated-progress__value {
    grid-area: 2 / 1;
  }
  .illustrated-progress__details {
    grid-area: 1 / 2 / 3 / 3;
  }
}
</style>
