<script setup lang="ts">
import { ref } from 'vue'
import RanchActivitiesPanel from '@/components/ranch/RanchActivitiesPanel.vue'
import RanchAnimalsPanel from '@/components/ranch/RanchAnimalsPanel.vue'
import RanchFacilitiesPanel from '@/components/ranch/RanchFacilitiesPanel.vue'
import RanchSceneHost from '@/components/ranch/RanchSceneHost.vue'
import RanchTasksPanel from '@/components/ranch/RanchTasksPanel.vue'
import { formatDateTime, formatQuantity, RANCH_VIEW_LABELS } from '@/utils/ranch'
import type { RanchView } from '@/utils/ranch'

/**
 * 牧场专属分区。
 * 背包、商店、罐头、市场、图鉴和好友这些农场也有的子系统，已经改成在各自页面里用
 * 「农场｜牧场」场景切换承载，这里只留牧场独有的内容，避免同一个子系统长两份页面。
 */
const TABS = (['animals', 'facilities', 'tasks', 'activities'] as const)
  .map(value => ({ value, label: RANCH_VIEW_LABELS[value] }))

const view = ref<RanchView>('animals')

function segmentedButtonClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}
</script>

<template>
  <RanchSceneHost :view="view" title="牧场">
    <template #badges="{ state, unlocked }">
      <div v-if="unlocked" class="flex flex-wrap items-center gap-2 text-sm">
        <span class="h-8 flex items-center rounded-lg bg-emerald-50 px-3 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
          牧场等级 Lv.{{ state?.level }}
        </span>
        <span class="h-8 flex items-center rounded-lg bg-blue-50 px-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          经验 {{ formatQuantity(state?.currentExp) }}<template v-if="state?.neededExp"> / {{ formatQuantity(state?.neededExp) }}</template>
        </span>
        <span class="h-8 flex items-center rounded-lg bg-amber-50 px-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          服务端时间 {{ formatDateTime(state?.serverTime) }}
        </span>
      </div>
    </template>

    <template #tabs>
      <div class="flex flex-wrap items-center gap-3">
        <div class="h-9 inline-flex flex-wrap overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="item in TABS"
            :key="item.value"
            class="min-w-24 rounded-md px-3 text-sm font-medium transition"
            :class="segmentedButtonClasses(view === item.value)"
            :style="view === item.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="view = item.value"
          >
            {{ item.label }}
          </button>
        </div>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          背包、商店、市场、图鉴和好友都在各自页面里切到牧场场景查看。
        </span>
      </div>
    </template>

    <template #default="{ state, onRequest, activeView }">
      <RanchAnimalsPanel v-if="activeView === 'animals'" :state="state" @request="onRequest" />
      <RanchFacilitiesPanel v-else-if="activeView === 'facilities'" :state="state" @request="onRequest" />
      <RanchTasksPanel v-else-if="activeView === 'tasks'" :state="state" @request="onRequest" />
      <RanchActivitiesPanel v-else-if="activeView === 'activities'" :state="state" @request="onRequest" />
    </template>
  </RanchSceneHost>
</template>
