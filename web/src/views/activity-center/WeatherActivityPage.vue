<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ActivityHeader from '@/components/activity/ActivityHeader.vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import { WeatherActivityView } from '@/components/activity/gameplays/weather'
import { useAccountStore } from '@/stores/account'
import { useActivityCenterStore } from '@/stores/activity-center'
import { useActivityClock } from './useActivityClock'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const activityStore = useActivityCenterStore()
const { currentAccountId } = storeToRefs(accountStore)
const { weather, loading, error, actionError, notice, pendingActions, weatherFriendsLoading, weatherFriendInspectingGid } = storeToRefs(activityStore)
const { remaining } = useActivityClock()
const remainingText = remaining(computed(() => weather.value?.endTime))

function accountId() {
  return String(currentAccountId.value || '')
}
async function refreshActivity() {
  await activityStore.loadDetails(accountId(), 'weather')
  await activityStore.loadWeatherFriends(accountId())
}
</script>

<template>
  <ActivityShell theme="day">
    <div class="activity-center">
      <ActivityHeader
        :title="weather?.title || '雨落成诗'"
        :remaining="remainingText"
        :balance="weather?.balances.known ? (weather.balances.badge || '0') : '--'"
        :currency-image="weather?.badge.image"
        :currency-name="weather?.badge.name || '雷电徽章'"
        :loading="loading"
        show-refresh
        @back="emit('back')"
        @refresh="refreshActivity"
      />
      <div v-if="error || actionError || notice" class="activity-message" :class="{ success: notice && !error && !actionError }" role="status">
        <span>{{ actionError || error || notice }}</span><button v-if="error" type="button" :disabled="loading" @click="refreshActivity">
          重试
        </button>
      </div>
      <main class="activity-content gameplay-content">
        <WeatherActivityView
          :activity="weather"
          :pending-research="pendingActions.lightWeatherResearch"
          :pending-buy="pendingActions.buyWeatherBottle"
          :pending-collect="pendingActions.collectWeatherBottle"
          :pending-summon="pendingActions.summonWeatherRain"
          :inspecting-gid="weatherFriendInspectingGid"
          :loading-friends="weatherFriendsLoading"
          @light="activityStore.lightWeatherResearch(accountId(), $event)"
          @buy="activityStore.buyWeatherBottle(accountId(), 1)"
          @inspect="activityStore.inspectWeatherFriend(accountId(), $event)"
          @collect="activityStore.collectWeatherBottle(accountId(), $event)"
          @summon="activityStore.summonWeatherRain(accountId())"
        />
      </main>
    </div>
  </ActivityShell>
</template>
