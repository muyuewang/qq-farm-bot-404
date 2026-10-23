<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ActivityHeader from '@/components/activity/ActivityHeader.vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import QixiActivityView from '@/components/activity/gameplays/qixi/QixiActivityView.vue'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore } from '@/stores/activity-center'
import { useFriendStore } from '@/stores/friend'
import { useActivityClock } from './useActivityClock'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const friendStore = useFriendStore()
const { currentAccountId } = storeToRefs(accountStore)
const { qixi, loading, error, actionError, notice, pendingActions } = storeToRefs(activityStore)
const { friends, loading: friendsLoading } = storeToRefs(friendStore)
const { remaining } = useActivityClock()
const remainingText = remaining(computed(() => qixi.value?.endTime))

function accountId() {
  return String(currentAccountId.value || '')
}
function refreshActivity() {
  return activityStore.loadDetails(accountId(), 'qixi')
}
function refreshFriends() {
  if (currentAccountId.value)
    return friendStore.fetchFriends(String(currentAccountId.value), true)
}
</script>

<template>
  <ActivityShell theme="day">
    <div class="activity-center">
      <ActivityHeader
        :title="qixi?.title || '鹊桥寄情'"
        :remaining="remainingText"
        :balance="qixi?.balances.known ? (qixi.balances.feather || '0') : '--'"
        :currency-image="qixi?.feather.image"
        :currency-name="qixi?.feather.name || '鹊羽'"
        :loading="loading"
        show-refresh
        @back="emit('back')"
        @refresh="refreshActivity"
      />
      <div v-if="!currentAccountId" class="activity-state detail-state">
        <strong>请先选择账号</strong><span>活动数据按当前账号加载</span>
      </div>
      <div v-else-if="loading && !qixi" class="activity-state detail-state">
        <div class="activity-spinner" /><strong>正在加载鹊桥活动</strong>
      </div>
      <template v-else>
        <div v-if="error || actionError || notice" class="activity-message" :class="{ success: notice && !error && !actionError }" role="status">
          <span>{{ actionError || error || notice }}</span><button v-if="error" type="button" :disabled="loading" @click="refreshActivity">
            重试
          </button>
        </div>
        <main class="activity-content gameplay-content">
          <QixiActivityView
            :activity="qixi"
            :friends="friends"
            :friends-loading="friendsLoading"
            :pending-bridge="pendingActions.claimQixiBridge"
            :pending-gift="pendingActions.giftQixiSachet"
            @claim-bridge="activityStore.claimQixiBridgeRewards(accountId())"
            @gift="activityStore.giftQixiSachet(accountId(), $event)"
            @refresh-friends="refreshFriends"
          />
        </main>
      </template>
    </div>
  </ActivityShell>
</template>
