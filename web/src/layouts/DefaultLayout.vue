<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import MysteryMerchantBanner from '@/components/shop/MysteryMerchantBanner.vue'
import Sidebar from '@/components/Sidebar.vue'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import SceneSwitch from '@/components/ui/SceneSwitch.vue'
import { menuRoutes } from '@/router/menu'
import { useAppStore } from '@/stores/app'
import { SCENE_BRAND, useSceneStore } from '@/stores/scene'

const appStore = useAppStore()
const sceneStore = useSceneStore()
const router = useRouter()
const { loginPageConfig, sidebarOpen } = storeToRefs(appStore)
const { scene } = storeToRefs(sceneStore)

const brandTitle = computed(() => (scene.value === 'ranch'
  ? SCENE_BRAND.ranch.title
  : loginPageConfig.value.title || SCENE_BRAND.farm.title))

// 宠物和分析只有农场有，切到牧场场景后停在原路由会看到与场景对不上的页面，
// 所以跟着菜单一起回到两个场景都有的个人页。
const availablePaths = computed(() => new Set(
  menuRoutes
    .filter(item => !item.scenes || item.scenes.includes(scene.value))
    .map(item => item.path ? `/${item.path}` : '/'),
))

watch([() => router.currentRoute.value.path, scene] as const, ([path]) => {
  if (!availablePaths.value.has(path))
    router.replace('/personal')
}, { immediate: true })

onUnmounted(() => {
  // 清理逻辑
})
</script>

<template>
  <div class="w-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900" style="height: 100dvh;">
    <!-- Mobile Sidebar Overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-gray-950/55 backdrop-blur-md transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar />

    <main class="relative h-full min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
      <header class="glass-panel relative z-30 mx-2 mt-2 h-16 flex shrink-0 items-center justify-between rounded-lg px-4 md:mx-4 md:mt-4 md:px-5">
        <div class="min-w-0 flex items-center gap-3">
          <button
            aria-label="打开导航"
            :aria-expanded="sidebarOpen"
            class="h-11 w-11 flex items-center justify-center rounded-lg text-gray-500 transition lg:hidden hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            @click="appStore.toggleSidebar"
          >
            <div class="i-carbon-menu text-xl" />
          </button>
          <div class="h-8 w-8 flex flex-none items-center justify-center overflow-hidden rounded-full ring-1 ring-gray-200 dark:ring-gray-700">
            <img
              src="/icon.png"
              :alt="`${loginPageConfig.title || 'QQ农场智能助手'}图标`"
              class="h-full w-full object-cover"
            >
          </div>
          <div class="truncate text-base text-gray-900 font-semibold md:text-lg dark:text-gray-100">
            {{ brandTitle }}
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <SceneSwitch />
          <TopAccountMenu />
        </div>
      </header>

      <!-- Main Content Area -->
      <div class="min-h-0 flex flex-1 flex-col overflow-hidden">
        <MysteryMerchantBanner />
        <div class="custom-scrollbar min-h-0 flex flex-1 flex-col overflow-y-auto p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6 sm:p-4 md:pb-6 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <RouterView v-slot="{ Component, route }">
            <component :is="Component" :key="route.path" />
          </RouterView>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}

.custom-scrollbar {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
</style>
