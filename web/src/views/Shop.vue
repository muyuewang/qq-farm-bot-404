<script setup lang="ts">
import type { RanchView } from '@/utils/ranch'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import RanchCansPanel from '@/components/ranch/RanchCansPanel.vue'
import RanchMarketPanel from '@/components/ranch/RanchMarketPanel.vue'
import RanchSceneHost from '@/components/ranch/RanchSceneHost.vue'
import RanchShopPanel from '@/components/ranch/RanchShopPanel.vue'
import DecorationGoodsCard from '@/components/shop/DecorationGoodsCard.vue'
import MysteryGoodsCard from '@/components/shop/MysteryGoodsCard.vue'
import PurchaseQuantityModal from '@/components/shop/PurchaseQuantityModal.vue'
import SeedGoodsCard from '@/components/shop/SeedGoodsCard.vue'
import ShopAccountHeader from '@/components/shop/ShopAccountHeader.vue'
import ShopEmptyState from '@/components/shop/ShopEmptyState.vue'
import ShopTabToolbar from '@/components/shop/ShopTabToolbar.vue'
import { createShopAvailability } from '@/composables/shop/useShopAvailability'
import { useAccountStore } from '@/stores/account'
import { useSceneStore } from '@/stores/scene'
import { COUPON_ITEM_ID, DIAMOND_ITEM_ID, GOLD_BEAN_ITEM_ID, GOLD_ITEM_ID, useShopStore } from '@/stores/shop'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCurrencyAmountByLabel } from '@/utils/number-format'
import { RANCH_VIEW_LABELS } from '@/utils/ranch'

const accountStore = useAccountStore()
const shopStore = useShopStore()
const statusStore = useStatusStore()
const sceneStore = useSceneStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { scene } = storeToRefs(sceneStore)
const { status } = storeToRefs(statusStore)
const {
  seeds,
  propsGoods,
  mysteryOffer,
  loading,
  propsLoading,
  mysteryLoading,
  error,
  propsError,
  mysteryError,
  seedsFromLocalConfig,
} = storeToRefs(shopStore)

const tab = ref<'seed' | 'decoration' | 'mystery'>('seed')
const ascending = ref(true)
const SHOP_TABS = new Set(['seed', 'decoration', 'mystery'])
const mysteryAutoBuyEnabled = ref(false)

const sortedSeeds = computed(() => {
  return [...seeds.value].sort((a, b) => ascending.value ? a.seedLevel - b.seedLevel : b.seedLevel - a.seedLevel)
})

/**
 * 商城同样分属两个场景：农场商城走 /api/shop/*，牧场的商店、罐头商城和交易市场挂在
 * game_scene_id=2 的牧场快照上，购买还要经过 quote → execute。场景由顶部栏全局切换，
 * 两套请求与限购校验都由各自的 store 负责，不互相兜底。
 */
const RANCH_SHOP_VIEWS = (['shop', 'cans', 'market'] as const).map(value => ({ value, label: RANCH_VIEW_LABELS[value] }))
const ranchView = ref<RanchView>('shop')
const ranchShopId = ref<number | null>(null)
const ranchCansSlot = ref<number | null>(null)

const ranchParams = computed(() => {
  if (ranchView.value === 'shop' && ranchShopId.value !== null)
    return { shopId: ranchShopId.value }
  if (ranchView.value === 'cans' && ranchCansSlot.value !== null)
    return { shopId: ranchCansSlot.value }
  return {}
})

function onRanchShopId(shopId: number) {
  ranchShopId.value = shopId
}

function onRanchCansSlot(slotType: number) {
  ranchCansSlot.value = slotType
}

function segmentedButtonClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}

const showConfirm = ref(false)
const confirmTitle = ref('确认购买')
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<null | (() => Promise<void>)>(null)
const quantityModal = ref({
  show: false,
  item: null as any,
  mode: 'seed' as 'seed' | 'props',
  currencyLabel: '',
  balance: null as number | null,
  maxQuantity: 99,
})

const currentLevel = computed(() => status.value?.status?.level || 0)
const currentGold = computed(() => status.value?.status?.gold || 0)
const headerGold = computed(() => shopStore.currencyBalance(GOLD_ITEM_ID) ?? currentGold.value)
const headerCoupon = computed(() => shopStore.currencyBalance(COUPON_ITEM_ID))
const headerDiamond = computed(() => shopStore.currencyBalance(DIAMOND_ITEM_ID))
const headerGoldBean = computed(() => shopStore.currencyBalance(GOLD_BEAN_ITEM_ID))
const isAnyLoading = computed(() => loading.value || propsLoading.value || mysteryLoading.value)
const activeIsEmpty = computed(() => {
  if (tab.value === 'seed')
    return sortedSeeds.value.length === 0
  if (tab.value === 'decoration')
    return propsGoods.value.length === 0
  return !mysteryOffer.value
})
const activeError = computed(() => {
  if (tab.value === 'seed')
    return error.value
  if (tab.value === 'decoration')
    return propsError.value
  return mysteryError.value
})
const activeEmptyMessage = computed(() => {
  switch (tab.value) {
    case 'seed':
      return '暂无种子商品，先刷新商城数据。'
    case 'decoration':
      return '暂无道具商品。'
    default:
      return '神秘商人暂未出现，请稍后刷新看看。'
  }
})

const {
  canAffordSeed,
  canAffordProps,
  getSeedHint,
  getPropsHint,
  getSeedStatusLabel,
  getPropsStatusLabel,
} = createShopAvailability({
  currentLevel: () => currentLevel.value,
  currentGold: () => currentGold.value,
})

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

function closeQuantityModal() {
  if (confirmLoading.value)
    return
  quantityModal.value.show = false
  quantityModal.value.item = null
}

async function refreshAll() {
  // 牧场场景读的是牧场快照，农场商城的价格与限购等切回农场再拉。
  if (!currentAccountId.value || scene.value === 'ranch')
    return
  await shopStore.refreshAll(currentAccountId.value)
}

async function refreshMysteryAutoBuyStatus() {
  if (!currentAccountId.value) {
    mysteryAutoBuyEnabled.value = false
    return
  }
  if (scene.value === 'ranch')
    return
  const requestedAccountId = String(currentAccountId.value)
  try {
    const { data } = await api.get('/api/settings', {
      headers: { 'x-account-id': requestedAccountId },
    })
    if (String(currentAccountId.value || '') !== requestedAccountId)
      return
    mysteryAutoBuyEnabled.value = data?.data?.automation?.mystery_shop_auto_buy === true
  }
  catch {
    if (String(currentAccountId.value || '') === requestedAccountId)
      mysteryAutoBuyEnabled.value = false
  }
}

function openMysteryAutoBuySettings() {
  router.push({ path: '/settings', query: { tab: 'automation' } })
}

function syncTabFromRouteQuery() {
  const queryTab = String(route.query.tab || '')
  if (SHOP_TABS.has(queryTab))
    tab.value = queryTab as typeof tab.value
}

async function buySeed(item: any, quantity = 1) {
  if (!currentAccountId.value)
    return
  const result = await shopStore.purchaseSeed(currentAccountId.value, item.id, quantity)
  if (result.ok) {
    toast.success(`已购买 ${item.name} x${quantity}`)
    await shopStore.fetchSeeds(currentAccountId.value)
  }
  else {
    toast.error(result.error || '购买失败')
  }
}

async function buyProps(item: any, quantity = 1) {
  if (!currentAccountId.value)
    return
  // 复用后端的价格/内容漂移校验：expectedOffer 必须与最近一次 GET 的商品一致。
  const result = await shopStore.purchasePropsGoods(
    currentAccountId.value,
    item.id,
    quantity,
    item.expectedOffer,
  )
  if (result.ok) {
    toast.success(`已购买 ${item.name} x${quantity}`)
    if (result.data?.refreshRequired)
      await shopStore.fetchPropsShop(currentAccountId.value)
  }
  else {
    toast.error(result.error || '购买失败')
  }
}

async function buyMysteryGoods(offer: any) {
  if (!currentAccountId.value)
    return
  const result = await shopStore.purchaseMysteryOffer(currentAccountId.value, offer.npcId)
  if (result.ok) {
    toast.success(`已从神秘商人处购买 ${offer.itemName} x${offer.itemCount}`)
  }
  else {
    toast.error(result.error || '购买失败')
  }
}

function confirmBuyMysteryGoods(offer: any) {
  const balanceText = offer.balance === null ? '余额未确认' : `${formatCurrencyAmountByLabel(offer.price, offer.currencyName)} ${offer.currencyName}`
  openConfirm(
    '确认购买神秘商品',
    `确定购买 ${offer.itemName} x${offer.itemCount} 吗？
价格：${balanceText}
购买完成后神秘商人将离开。`,
    () => buyMysteryGoods(offer),
  )
}

function getSeedMaxQuantity(item: any, balance: number) {
  const price = Number(item?.price || 0)
  const byBalance = price > 0 ? Math.floor(Number(balance || 0) / price) : 99
  const remaining = Number(item?.remainingPurchaseCount ?? -1)
  const byLimit = remaining >= 0 ? remaining : 99
  return Math.max(1, Math.min(99, byBalance, byLimit))
}

function getPropsMaxQuantity(item: any) {
  const price = Number(item?.price || 0)
  const balance = item?.balance === null || item?.balance === undefined ? null : Number(item.balance)
  const byBalance = balance === null || price <= 0 ? 99 : Math.floor(balance / price)
  const remaining = Number(item?.remainingPurchaseCount ?? -1)
  const byLimit = remaining >= 0 ? remaining : 99
  return Math.max(1, Math.min(99, byBalance, byLimit))
}

function openQuantityModal(item: any, mode: 'seed' | 'props', currencyLabel: string, balance: number | null, maxQuantity: number) {
  quantityModal.value = {
    show: true,
    item,
    mode,
    currencyLabel,
    balance,
    maxQuantity,
  }
}

async function runQuantityPurchase(quantity: number) {
  const target = quantityModal.value.item
  if (!target)
    return
  confirmLoading.value = true
  try {
    if (quantityModal.value.mode === 'props')
      await buyProps(target, quantity)
    else
      await buySeed(target, quantity)
    closeQuantityModal()
  }
  finally {
    confirmLoading.value = false
  }
}

function confirmBuySeedGoods(item: any) {
  openQuantityModal(item, 'seed', '金币', currentGold.value, getSeedMaxQuantity(item, currentGold.value))
}

function confirmBuyPropsGoods(item: any) {
  openQuantityModal(item, 'props', item.currencyName || '货币', item.balance, getPropsMaxQuantity(item))
}

watch(currentAccountId, () => {
  shopStore.clearShopData()
  refreshAll()
  refreshMysteryAutoBuyStatus()
})

watch(
  () => route.query.tab,
  () => syncTabFromRouteQuery(),
)

watch(scene, () => {
  refreshAll()
  refreshMysteryAutoBuyStatus()
})

onMounted(() => {
  syncTabFromRouteQuery()
  refreshAll()
  refreshMysteryAutoBuyStatus()
})
</script>

<template>
  <section class="space-y-4">
    <div v-if="scene === 'farm'" class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <div class="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <ShopAccountHeader
          :account-name="currentAccount?.name"
          :level="currentLevel"
          :gold="headerGold"
          :coupon="headerCoupon"
          :diamond="headerDiamond"
          :gold-bean="headerGoldBean"
        />

        <div class="flex flex-wrap items-center justify-end gap-2">
          <ShopTabToolbar
            v-model:tab="tab"
            :ascending="ascending"
            :loading="isAnyLoading"
            :disabled="!currentAccountId"
            @toggle-ascending="ascending = !ascending"
            @refresh="refreshAll"
          />
        </div>
      </div>

      <div v-if="!currentAccountId" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        请先选择账号，再查看商城。
      </div>

      <div v-else-if="isAnyLoading && activeIsEmpty" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        正在加载当前分区商品...
      </div>

      <div v-else-if="activeError && activeIsEmpty" class="rounded-lg bg-red-50 p-8 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ activeError }}
      </div>

      <div v-else-if="tab === 'seed'" class="space-y-4">
        <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ error }}
        </div>
        <div v-if="seedsFromLocalConfig" class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          后端未能读取到种子商店，以下条目来自本地配置，价格与限购均未知，无法在此购买。
        </div>
        <ShopEmptyState v-if="!sortedSeeds.length" :message="activeEmptyMessage" />
        <div class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3">
          <SeedGoodsCard
            v-for="item in sortedSeeds"
            :key="item.id"
            :item="item"
            :current-level="currentLevel"
            :can-afford="canAffordSeed(item)"
            :status-label="getSeedStatusLabel(item)"
            :hint="getSeedHint(item)"
            @buy="confirmBuySeedGoods"
          />
        </div>
      </div>

      <div v-else-if="tab === 'decoration'" class="space-y-4">
        <div v-if="propsError" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ propsError }}
        </div>
        <ShopEmptyState v-if="!propsGoods.length" :message="activeEmptyMessage" />
        <div class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3">
          <DecorationGoodsCard
            v-for="item in propsGoods"
            :key="item.id"
            :item="item"
            :can-afford="canAffordProps(item)"
            :status-label="getPropsStatusLabel(item)"
            :hint="getPropsHint(item)"
            @buy="confirmBuyPropsGoods"
          />
        </div>
      </div>

      <div v-else class="space-y-4">
        <div class="flex items-center justify-between gap-3 border border-gray-200 rounded-xl bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/30">
          <div class="min-w-0 flex items-center gap-2 text-sm">
            <span :class="mysteryAutoBuyEnabled ? 'i-carbon-checkmark-filled text-green-500' : 'i-carbon-pause-filled text-gray-400'" />
            <span class="text-gray-700 dark:text-gray-200">
              神秘商人自动购买{{ mysteryAutoBuyEnabled ? '已开启' : '未开启' }}
            </span>
          </div>
          <button class="shrink-0 text-sm text-blue-600 font-medium dark:text-blue-400 hover:underline" type="button" @click="openMysteryAutoBuySettings">
            前往设置
          </button>
        </div>
        <div v-if="mysteryError" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ mysteryError }}
        </div>
        <ShopEmptyState v-if="!mysteryOffer" :message="activeEmptyMessage" />
        <MysteryGoodsCard
          v-else
          :offer="mysteryOffer"
          :loading="confirmLoading"
          @buy="confirmBuyMysteryGoods"
        />
      </div>
    </div>

    <RanchSceneHost
      v-else
      :view="ranchView"
      :params="ranchParams"
      title="牧场商店"
      icon="i-carbon-store"
    >
      <template #tabs>
        <div class="h-9 inline-flex flex-wrap overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="item in RANCH_SHOP_VIEWS"
            :key="item.value"
            class="min-w-24 rounded-md px-3 text-sm font-medium transition"
            :class="segmentedButtonClasses(ranchView === item.value)"
            :style="ranchView === item.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="ranchView = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </template>

      <template #default="{ state, onRequest, activeView }">
        <RanchShopPanel v-if="activeView === 'shop'" :state="state" @request="onRequest" @shop-id="onRanchShopId" />
        <RanchCansPanel v-else-if="activeView === 'cans'" :state="state" @request="onRequest" @slot-type="onRanchCansSlot" />
        <RanchMarketPanel v-else-if="activeView === 'market'" :state="state" @request="onRequest" />
      </template>
    </RanchSceneHost>

    <ConfirmModal
      :show="showConfirm"
      :title="confirmTitle"
      :message="confirmMessage"
      :loading="confirmLoading"
      @confirm="runConfirmedAction"
      @close="closeConfirm"
      @cancel="closeConfirm"
    />
    <PurchaseQuantityModal
      :show="quantityModal.show"
      :item-name="quantityModal.item?.name || ''"
      :unit-price="Number(quantityModal.item?.price || 0)"
      :currency-label="quantityModal.currencyLabel"
      :balance="quantityModal.balance"
      :max-quantity="quantityModal.maxQuantity"
      :loading="confirmLoading"
      :is-free="!!quantityModal.item?.isFree"
      @confirm="runQuantityPurchase"
      @close="closeQuantityModal"
      @cancel="closeQuantityModal"
    />
  </section>
</template>
