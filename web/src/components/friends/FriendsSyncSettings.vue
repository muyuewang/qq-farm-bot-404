<script setup lang="ts">
defineProps<{
  knownFriendGidCount: number
  unsyncedGidCount: number
  loading: boolean
  saving: boolean
}>()

defineEmits<{
  (e: 'openGidList'): void
  (e: 'refreshSettings'): void
  (e: 'saveSettings'): void
  (e: 'openBatchAdd'): void
}>()

const knownFriendGidSyncCooldownSec = defineModel<number>('knownFriendGidSyncCooldownSec', { required: true })
const friendsListCacheTtlSec = defineModel<number>('friendsListCacheTtlSec', { required: true })
</script>

<template>
  <div class="mb-4 border border-amber-200 rounded-lg bg-white p-4 shadow dark:border-amber-700/50 dark:bg-gray-800">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div class="flex items-center gap-2">
          <div class="i-carbon-user-profile text-lg text-amber-500" />
          <h3 class="text-lg text-gray-700 font-semibold dark:text-gray-200">
            QQ 好友自动同步
          </h3>
          <button
            class="cursor-pointer rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-900/50"
            @click="$emit('openGidList')"
          >
            {{ knownFriendGidCount }}
          </button>
        </div>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          QQ 新好友接口依赖已知 GID。系统会自动从最近访客补充，进入好友农场明确失败时自动移除失效 GID。
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <button
          class="rounded bg-amber-100 px-3 py-1.5 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 disabled:opacity-50 dark:hover:bg-amber-900/50"
          :disabled="loading"
          @click="$emit('refreshSettings')"
        >
          <div v-if="loading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
          刷新
        </button>
        <button
          class="rounded bg-green-100 px-3 py-1.5 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 disabled:opacity-50 dark:hover:bg-green-900/50"
          :disabled="saving"
          @click="$emit('saveSettings')"
        >
          <div v-if="saving" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
          保存设置
        </button>
        <button
          class="rounded bg-blue-100 px-3 py-1.5 text-sm text-blue-700 transition dark:bg-blue-900/30 hover:bg-blue-200 dark:text-blue-400 disabled:opacity-50 dark:hover:bg-blue-900/50"
          @click="$emit('openBatchAdd')"
        >
          批量新增 GID
        </button>
      </div>
    </div>

    <div class="grid mt-4 gap-3 lg:grid-cols-2">
      <div>
        <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">访客检测入库冷却(秒)</label>
        <input
          v-model.number="knownFriendGidSyncCooldownSec"
          type="number"
          class="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
      </div>
      <div>
        <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">好友列表缓存(秒)</label>
        <input
          v-model.number="friendsListCacheTtlSec"
          type="number"
          class="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
      </div>
    </div>

    <div class="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      {{ unsyncedGidCount > 0 ? `当前已知 GID 中还有 ${unsyncedGidCount} 个未同步进好友列表，适合先排查是否已失效。` : '当前已知 GID 都已同步进好友列表，可主要依赖最近访客继续补充。' }}
    </div>
  </div>
</template>
