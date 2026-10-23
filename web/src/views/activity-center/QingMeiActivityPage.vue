<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ActivityHeader from '@/components/activity/ActivityHeader.vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import { QingMeiBrewTab } from '@/components/activity/gameplays/qingmei'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore } from '@/stores/activity-center'
import { useActivityClock } from './useActivityClock'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const { currentAccountId } = storeToRefs(accountStore)
const { qingMei, loading, error, actionError, notice, pendingActions } = storeToRefs(activityStore)
const { remaining } = useActivityClock()
const remainingText = remaining(computed(() => qingMei.value?.endTime))

function accountId() {
  return String(currentAccountId.value || '')
}
function refreshActivity() {
  return activityStore.loadDetails(accountId(), 'qingmei')
}
</script>

<template>
  <ActivityShell theme="day">
    <div class="activity-center">
      <ActivityHeader
        :title="qingMei?.title || '青梅换万金'"
        :remaining="remainingText"
        :balance="qingMei?.balanceKnown ? (qingMei.balance || '0') : '--'"
        :currency-image="qingMei?.ingredient.image"
        :currency-name="qingMei?.ingredient.name || '青梅'"
        :loading="loading"
        show-refresh
        @back="emit('back')"
        @refresh="refreshActivity"
      />
      <div v-if="!currentAccountId" class="activity-state detail-state">
        <strong>请先选择账号</strong><span>活动数据按当前账号加载</span>
      </div>
      <div v-else-if="loading && !qingMei" class="activity-state detail-state">
        <div class="activity-spinner" /><strong>正在加载青梅活动</strong>
      </div>
      <template v-else>
        <div v-if="error || actionError || notice" class="activity-message" :class="{ success: notice && !error && !actionError }" role="status">
          <span>{{ actionError || error || notice }}</span><button v-if="error" type="button" :disabled="loading" @click="refreshActivity">
            重试
          </button>
        </div>
        <main class="activity-content gameplay-content">
          <QingMeiBrewTab
            :activity="qingMei"
            :pending-seed="pendingActions.claimQingMeiSeed"
            :pending-start="pendingActions.startQingMeiBrew"
            :pending-continue="pendingActions.continueQingMeiBrew"
            :pending-sell="pendingActions.settleQingMeiBrew"
            @claim-seed="activityStore.claimQingMeiDailySeed(accountId())"
            @start="activityStore.startQingMeiBrew(accountId(), $event)"
            @continue="activityStore.continueQingMeiBrew(accountId())"
            @settle="activityStore.settleQingMeiBrew(accountId())"
          />
        </main>
      </template>
    </div>
  </ActivityShell>
</template>
