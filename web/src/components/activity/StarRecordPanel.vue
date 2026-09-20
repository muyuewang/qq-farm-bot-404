<script setup lang="ts">
import type { StarActivityData } from '@/stores/activity'
import BaseButton from '@/components/ui/BaseButton.vue'

defineProps<{
  record?: StarActivityData['starRecord'] | null
  loading?: boolean
}>()

defineEmits<{
  claim: []
}>()

function stateLabel(item: StarActivityData['starRecord']['records'][number]) {
  if (item.claimed)
    return '已点亮'
  if (item.claimable)
    return '可点亮'
  return '未开放'
}
</script>

<template>
  <section class="rounded-lg bg-white shadow-sm dark:bg-gray-800">
    <div class="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
      <div>
        <h2 class="text-base text-gray-900 font-semibold dark:text-gray-100">
          观星礼录
        </h2>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          二十八星宿逐日开放，点亮后领取当日馈赠
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-300">
          已点亮 {{ record?.claimedCount || 0 }} / {{ record?.totalCount || 28 }}
        </span>
        <BaseButton
          class="w-28"
          variant="primary"
          :loading="loading"
          :disabled="!record?.claimableCount"
          @click="$emit('claim')"
        >
          一键点亮领取
        </BaseButton>
      </div>
    </div>

    <div v-if="!record?.records?.length" class="p-10 text-center text-sm text-gray-500 dark:text-gray-400">
      暂无星宿数据
    </div>
    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3 p-4">
      <article
        v-for="item in record.records"
        :key="item.id"
        class="relative min-h-44 min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg p-3 dark:border-gray-700"
        :class="item.claimable ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-gray-900/30'"
      >
        <img
          src="/activity/star-festival/constellation-glow.png"
          alt=""
          class="pointer-events-none absolute h-28 w-28 object-contain transition -right-8 -top-8"
          :class="item.claimed || item.claimable ? 'opacity-35' : 'grayscale opacity-10'"
        >
        <div class="relative flex items-center justify-between gap-2">
          <span class="text-sm text-gray-900 font-semibold dark:text-gray-100">{{ item.title }}</span>
          <span
            class="rounded px-1.5 py-0.5 text-[10px]"
            :class="item.claimed
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : item.claimable
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300'"
          >
            {{ stateLabel(item) }}
          </span>
        </div>
        <div class="relative mt-1 text-xs text-sky-600 dark:text-sky-300">
          {{ item.category || '二十八星宿' }}
        </div>
        <p class="relative line-clamp-4 mt-2 text-xs text-gray-500 leading-5 dark:text-gray-400">
          {{ item.explain }}
        </p>
        <div v-if="item.rewards?.length" class="relative mt-auto flex flex-wrap gap-1 pt-3">
          <span
            v-for="reward in item.rewards"
            :key="`${item.id}-${reward.itemId}`"
            class="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <img v-if="reward.image" :src="reward.image" :alt="reward.itemName" class="h-4 w-4 object-contain">
            {{ reward.itemName }} ×{{ reward.itemCount }}
          </span>
        </div>
      </article>
    </div>
  </section>
</template>
