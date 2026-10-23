<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ActivityHeader from '@/components/activity/ActivityHeader.vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import { CharityRedFlowerView } from '@/components/activity/gameplays/charity'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore } from '@/stores/activity-center'
import { useActivityClock } from './useActivityClock'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const { currentAccountId } = storeToRefs(accountStore)
const { charity, loading, error, actionError, notice, pendingActions } = storeToRefs(activityStore)
const { remaining } = useActivityClock()
const remainingText = remaining(computed(() => charity.value?.endTime))

function accountId() {
  return String(currentAccountId.value || '')
}
function refreshActivity() {
  return activityStore.loadDetails(accountId(), 'charity')
}
</script>

<template>
  <ActivityShell theme="day">
    <div class="activity-center">
      <ActivityHeader
        :title="charity?.title || '公益小红花'"
        :remaining="remainingText"
        :balance="charity?.loveBalance || '0'"
        :currency-image="charity?.love.image"
        :currency-name="charity?.love.name || '爱心'"
        :loading="loading"
        show-refresh
        @back="emit('back')"
        @refresh="refreshActivity"
      />
      <div v-if="!currentAccountId" class="activity-state detail-state">
        <strong>请先选择账号</strong><span>活动数据按当前账号加载</span>
      </div>
      <div v-else-if="loading && !charity" class="activity-state detail-state">
        <div class="activity-spinner" /><strong>正在加载公益小红花活动</strong>
      </div>
      <template v-else>
        <div v-if="error || actionError || notice" class="activity-message" :class="{ success: notice && !error && !actionError }" role="status">
          <span>{{ actionError || error || notice }}</span><button v-if="error" type="button" :disabled="loading" @click="refreshActivity">
            重试
          </button>
        </div>
        <main class="activity-content gameplay-content">
          <CharityRedFlowerView
            :activity="charity"
            :pending-seeds="pendingActions.claimCharitySeeds"
            :pending-donate="pendingActions.donateCharityLove"
            :pending-daily-gift="pendingActions.claimCharityDailyGift"
            :pending-progress="pendingActions.claimCharityProgress"
            @claim-seeds="activityStore.claimCharityRedFlowerSeeds(accountId())"
            @donate-love="activityStore.donateCharityRedFlowerLove(accountId())"
            @claim-daily-gift="activityStore.claimCharityRedFlowerDailyGift(accountId())"
            @claim-progress="activityStore.claimCharityRedFlowerProgressReward(accountId(), $event)"
          />
        </main>
      </template>
    </div>
  </ActivityShell>
</template>
