<script setup lang="ts">
import type { ActivityTab } from '@/components/activity/BottomNav.vue'
import type { ShopGoodsDto } from '@/stores/activity-center'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import ActivityHeader from '@/components/activity/ActivityHeader.vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import BottomNav from '@/components/activity/BottomNav.vue'
import { ConstellationTab, SolarTermsTab, StarSandExchangeDialog, StarSandShopTab, TravelPassTab } from '@/components/activity/gameplays/stellar'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore } from '@/stores/activity-center'
import { useActivityClock } from './useActivityClock'

const props = defineProps<{ entryTab: ActivityTab }>()
const emit = defineEmits<{ back: [] }>()

const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const { currentAccountId } = storeToRefs(accountStore)
const { season, shop, solarTerms, constellation, actions, tabBadges, loading, error, pendingActions } = storeToRefs(activityStore)
const activeTab = ref<ActivityTab>(props.entryTab)
const selectedShopGoods = ref<ShopGoodsDto | null>(null)
const { serverNow, remaining } = useActivityClock()

const currentData = computed(() => activeTab.value === 'shop' ? shop.value : activeTab.value === 'solar' ? solarTerms.value : activeTab.value === 'constellation' ? constellation.value : season.value)
const pageTitle = computed(() => currentData.value?.title || season.value?.title || '—')
const theme = computed(() => activeTab.value === 'solar' ? 'day' : 'night')
const endTime = computed(() => {
  if (activeTab.value === 'shop')
    return shop.value?.endTime
  if (activeTab.value === 'constellation')
    return constellation.value?.endTime || season.value?.endTime
  return season.value?.endTime
})
const remainingText = remaining(endTime)
const balanceVisible = computed(() => activeTab.value === 'travel' || activeTab.value === 'shop')

function accountId() {
  return String(currentAccountId.value || '')
}
function refreshActivity() {
  return activityStore.loadDetails(accountId(), 'stellar')
}
function selectShopGoods(goods: ShopGoodsDto) {
  selectedShopGoods.value = goods
}
function closeExchangeDialog() {
  if (!pendingActions.value.exchange)
    selectedShopGoods.value = null
}
async function exchangeShopGoods(goodsId: string, count: number) {
  const succeeded = await activityStore.exchangeStarSandGoods(accountId(), goodsId, count)
  if (succeeded)
    selectedShopGoods.value = null
}

watch(activeTab, (tab) => {
  if (tab !== 'shop' && !pendingActions.value.exchange)
    selectedShopGoods.value = null
})
</script>

<template>
  <ActivityShell :theme="theme">
    <div class="activity-center">
      <ActivityHeader :title="pageTitle" :remaining="remainingText" :balance="balanceVisible ? (shop?.balanceKnown ? (shop.balance ?? '0') : '--') : undefined" :currency-image="shop?.currency.image" :currency-name="shop?.currency.name" :loading="loading" :show-refresh="activeTab !== 'constellation'" @back="emit('back')" @refresh="refreshActivity" />
      <div v-if="!currentAccountId" class="activity-state">
        <strong>请先选择账号</strong><span>活动数据按当前账号加载</span>
      </div>
      <div v-else-if="loading && !season && !shop && !solarTerms && !constellation" class="activity-state">
        <div class="activity-spinner" /><strong>正在加载活动</strong>
      </div>
      <template v-else>
        <div v-if="error" class="activity-message" role="status">
          <span>{{ error }}</span><button type="button" :disabled="loading" @click="refreshActivity">
            重试
          </button>
        </div>
        <main class="activity-content" :class="{ 'activity-content--travel': activeTab === 'travel' }">
          <TravelPassTab v-if="activeTab === 'travel'" :season="season" :enabled="actions.claimPass.enabled" :pending="pendingActions.claimPass" @claim="activityStore.claimPass(accountId())" />
          <ConstellationTab v-else-if="activeTab === 'constellation'" :constellation="constellation" :enabled="actions.lightConstellation.enabled" :pending="pendingActions.lightConstellation" @light="activityStore.lightConstellation(accountId())" />
          <StarSandShopTab v-else-if="activeTab === 'shop'" :shop="shop" :enabled="actions.exchange.enabled" :pending="pendingActions.exchange" @select="selectShopGoods" />
          <SolarTermsTab v-else :solar="solarTerms" :now="serverNow" :pending="pendingActions.claimSolar" @claim="activityStore.claimSolarTerm(accountId(), $event)" />
        </main>
      </template>
      <BottomNav v-model="activeTab" :badges="tabBadges" />
      <StarSandExchangeDialog
        :open="!!selectedShopGoods"
        :goods="selectedShopGoods"
        :shop="shop"
        :pending="pendingActions.exchange"
        @close="closeExchangeDialog"
        @confirm="exchangeShopGoods"
      />
    </div>
  </ActivityShell>
</template>
