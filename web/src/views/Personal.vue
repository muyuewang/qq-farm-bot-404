<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'
import RanchBagPanel from '@/components/ranch/RanchBagPanel.vue'
import RanchSceneHost from '@/components/ranch/RanchSceneHost.vue'
import SceneSwitch from '@/components/ui/SceneSwitch.vue'

const currentTab = ref<'farm' | 'bag' | 'task'>('farm')

/**
 * 背包在农场和牧场是两个场景各有一套：农场走 /api/bag，牧场要进 game_scene_id=2 再读快照，
 * 物品、数量和可执行操作也完全不同。做成同页场景切换，而不是在菜单里再挂一个「牧场背包」。
 */
const bagScene = ref<'farm' | 'ranch'>('farm')
</script>

<template>
  <div class="h-full flex flex-col p-4">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div class="flex space-x-2">
        <button
          class="rounded-lg px-4 py-2 font-medium transition-colors"
          :class="currentTab === 'farm'
            ? 'text-white shadow-md'
            : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="currentTab === 'farm' ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="currentTab = 'farm'"
        >
          <div class="flex items-center space-x-2">
            <div class="i-carbon-sprout text-lg" />
            <span>我的农场</span>
          </div>
        </button>
        <button
          class="rounded-lg px-4 py-2 font-medium transition-colors"
          :class="currentTab === 'bag'
            ? 'text-white shadow-md'
            : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="currentTab === 'bag' ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="currentTab = 'bag'"
        >
          <div class="flex items-center space-x-2">
            <div class="i-carbon-box text-lg" />
            <span>我的背包</span>
          </div>
        </button>
        <button
          class="rounded-lg px-4 py-2 font-medium transition-colors"
          :class="currentTab === 'task'
            ? 'text-white shadow-md'
            : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="currentTab === 'task' ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="currentTab = 'task'"
        >
          <div class="flex items-center space-x-2">
            <div class="i-carbon-task text-lg" />
            <span>我的任务</span>
          </div>
        </button>
      </div>

      <SceneSwitch v-if="currentTab === 'bag'" v-model="bagScene" farm-label="农场背包" ranch-label="牧场背包" />
    </div>

    <div class="flex-1 overflow-hidden overflow-y-auto">
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
          v-if="currentTab === 'bag' && bagScene === 'ranch'"
          key="ranch-bag"
          view="bag"
          title="牧场背包"
          icon="i-carbon-inventory-management"
        >
          <template #default="{ state, onRequest }">
            <RanchBagPanel :state="state" @request="onRequest" />
          </template>
        </RanchSceneHost>
        <component
          :is="currentTab === 'farm' ? FarmPanel : (currentTab === 'bag' ? BagPanel : TaskPanel)"
          v-else
          key="farm"
        />
      </Transition>
    </div>
  </div>
</template>
