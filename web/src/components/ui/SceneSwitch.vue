<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSceneStore } from '@/stores/scene'

/**
 * 全局场景开关。
 *
 * 农场（game_scene_id=1）和牧场（game_scene_id=2）是同一个账号下的两个场景，背包、商店、
 * 图鉴、好友在两边各有一套协议。这里切的是整个应用的浏览场景：菜单、标题和页面内容一起换，
 * 不在每个页面里各放一个开关——否则在商店切到牧场、到好友页看到的还是农场好友。
 * 后端没有可长期停留的场景，每次请求都要重新进场景再切回来，所以这里只登记浏览偏好，
 * 不发任何请求，也不能被当成服务端状态读。
 */
const sceneStore = useSceneStore()
const { scene } = storeToRefs(sceneStore)

const target = computed(() => (scene.value === 'farm'
  ? { value: 'ranch' as const, label: '去牧场', icon: 'i-carbon-wheat' }
  : { value: 'farm' as const, label: '去农场', icon: 'i-carbon-sprout' }))
</script>

<template>
  <button
    type="button"
    class="h-11 flex flex-none items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
    :style="{ color: 'var(--theme-primary)' }"
    :title="target.label"
    @click="sceneStore.setScene(target.value)"
  >
    <div :class="target.icon" class="text-lg" />
    <span>{{ target.label }}</span>
  </button>
</template>
