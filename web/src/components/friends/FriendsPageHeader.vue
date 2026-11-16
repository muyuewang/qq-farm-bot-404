<script setup lang="ts">
import type { FriendTabKey } from './FriendsTabs.vue'

defineProps<{
  activeTab: FriendTabKey
  friendsCount: number
  filteredFriendsCount: number
  blacklistCount: number
  interactRecordsCount: number
  filteredInteractRecordsCount: number
}>()

const searchKeyword = defineModel<string>('searchKeyword', { required: true })
</script>

<template>
  <div class="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-user-multiple" />
        好友
      </h2>
    </div>
    <div class="flex items-center gap-3">
      <div v-if="activeTab === 'friends'" class="relative">
        <div class="i-carbon-search absolute left-3 top-1/2 text-gray-400 -translate-y-1/2" />
        <input
          v-model="searchKeyword"
          type="text"
          placeholder="搜索好友..."
          class="w-full border border-gray-300 rounded-lg bg-white py-2 pl-10 pr-4 text-sm sm:w-64 dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
      </div>
      <div v-if="activeTab === 'friends' && friendsCount" class="text-sm text-gray-500">
        共 {{ filteredFriendsCount }}/{{ friendsCount }} 名好友
      </div>
      <div v-if="activeTab === 'blacklist'" class="text-sm text-gray-500">
        共 {{ blacklistCount }} 人
      </div>
      <div v-if="activeTab === 'visitors' && interactRecordsCount" class="text-sm text-gray-500">
        共 {{ filteredInteractRecordsCount }}/{{ interactRecordsCount }} 条记录
      </div>
    </div>
  </div>
</template>
