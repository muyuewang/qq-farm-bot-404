<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import RanchAnimalsPanel from '@/components/ranch/RanchAnimalsPanel.vue'
import RanchBagPanel from '@/components/ranch/RanchBagPanel.vue'
import RanchFacilitiesPanel from '@/components/ranch/RanchFacilitiesPanel.vue'
import RanchSceneHost from '@/components/ranch/RanchSceneHost.vue'
import RanchTasksPanel from '@/components/ranch/RanchTasksPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'
import { useSceneStore } from '@/stores/scene'

const sceneStore = useSceneStore()
const { scene } = storeToRefs(sceneStore)

type FarmTab = 'farm' | 'bag' | 'task'
type RanchTab = 'animals' | 'facilities' | 'bag' | 'tasks'

const FARM_TABS: Array<{ value: FarmTab, label: string, icon: string }> = [
  { value: 'farm', label: '我的农场', icon: 'i-carbon-sprout' },
  { value: 'bag', label: '我的背包', icon: 'i-carbon-box' },
  { value: 'task', label: '我的任务', icon: 'i-carbon-task' },
]

/**
 * 个人页在两个场景里是两套内容：农场看地块、背包和任务，牧场看栏舍、设施、牧场背包和牧场任务。
 * 菜单里不再单列「牧场」入口，顶部栏切场景时这一页连同菜单一起换，避免同一个子系统长两份页面。
 */
const RANCH_TAB_META: Record<RanchTab, { label: string, icon: string }> = {
  animals: { label: '我的牧场', icon: 'i-carbon-wheat' },
  facilities: { label: '牧场设施', icon: 'i-carbon-building' },
  bag: { label: '我的背包', icon: 'i-carbon-box' },
  tasks: { label: '我的任务', icon: 'i-carbon-task' },
}

const RANCH_TABS = (['animals', 'facilities', 'bag', 'tasks'] as const)
  .map(value => ({ value, ...RANCH_TAB_META[value] }))

const farmTab = ref<FarmTab>('farm')
const ranchTab = ref<RanchTab>('animals')

const tabs = computed(() => (scene.value === 'ranch' ? RANCH_TABS : FARM_TABS))
const activeTab = computed(() => (scene.value === 'ranch' ? ranchTab.value : farmTab.value))
const ranchMeta = computed(() => RANCH_TAB_META[ranchTab.value])

function selectTab(value: string) {
  if (scene.value === 'ranch')
    ranchTab.value = value as RanchTab
  else
    farmTab.value = value as FarmTab
}
</script>

<template>
  <div class="h-full flex flex-col p-4">
    <div class="mb-4 flex-none">
      <div class="flex flex-wrap space-x-2">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="rounded-lg px-4 py-2 font-medium transition-colors"
          :class="activeTab === tab.value
            ? 'text-white shadow-md'
            : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="activeTab === tab.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="selectTab(tab.value)"
        >
          <div class="flex items-center space-x-2">
            <div :class="tab.icon" class="text-lg" />
            <span>{{ tab.label }}</span>
          </div>
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden overflow-y-auto">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform opacity-0 scale-95"
        enter-to-class="transform opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform opacity-100 scale-100"
        leave-to-class="transform opacity-0 scale-95"
      >
        <RanchSceneHost
          v-if="scene === 'ranch'"
          key="ranch"
          :view="ranchTab"
          :title="ranchMeta.label"
          :icon="ranchMeta.icon"
        >
          <template #default="{ state, onRequest, activeView }">
            <RanchAnimalsPanel v-if="activeView === 'animals'" :state="state" @request="onRequest" />
            <RanchFacilitiesPanel v-else-if="activeView === 'facilities'" :state="state" @request="onRequest" />
            <RanchBagPanel v-else-if="activeView === 'bag'" :state="state" @request="onRequest" />
            <RanchTasksPanel v-else-if="activeView === 'tasks'" :state="state" @request="onRequest" />
          </template>
        </RanchSceneHost>
        <component
          :is="farmTab === 'farm' ? FarmPanel : (farmTab === 'bag' ? BagPanel : TaskPanel)"
          v-else
          key="farm"
        />
      </Transition>
    </div>
  </div>
</template>
