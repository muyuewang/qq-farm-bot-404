<script setup lang="ts">
import type { QixiActivityData, QixiFriend } from '@/stores/activity'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

const props = defineProps<{
  activity?: QixiActivityData | null
  friends: QixiFriend[]
  buildLoading?: boolean
  giftLoading?: boolean
  dewLoading?: boolean
}>()
const emit = defineEmits<{ build: [], dew: [], gift: [friendGid: number, count: number] }>()
const friendGid = ref<string | number>('')
const giftCount = ref(1)
const friendOptions = computed(() => props.friends.map(friend => ({
  label: `${friend.name}${friend.level ? ` · Lv.${friend.level}` : ''}`,
  value: friend.gid,
})))
function formatTime(value?: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '-'
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div v-for="item in [activity?.items.feather, activity?.items.dew, activity?.items.sachet]" :key="item?.itemId" class="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800">
        <img v-if="item?.image" :src="item.image" alt="" class="h-11 w-11 object-contain">
        <div>
          <div class="text-xs text-gray-500">
            {{ item?.itemName || '活动道具' }}
          </div><div class="text-xl text-gray-900 font-bold dark:text-white">
            {{ Number(item?.itemCount || 0).toLocaleString() }}
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
      <div>
        <h3 class="text-gray-900 font-semibold dark:text-white">
          使用鹊羽灵露
        </h3><p class="mt-1 text-xs text-gray-500">
          {{ activity?.dewUsage.limitReached ? `今日已达使用上限（${activity.dewUsage.dailyLimit}/${activity.dewUsage.dailyLimit}）` : `自动选择尚有作物的自有土地，每日最多使用 ${activity?.dewUsage.dailyLimit || 15} 次` }}
        </p>
      </div>
      <BaseButton :loading="dewLoading" :disabled="!activity?.items.dew.itemCount || activity?.dewUsage.limitReached" @click="emit('dew')">
        自动使用
      </BaseButton>
    </div>

    <div class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-gray-900 font-semibold dark:text-white">
            驻建鹊桥
          </h3>
          <p class="mt-1 text-xs text-gray-500">
            已完成 {{ activity?.bridge.completedCount || 0 }}/{{ activity?.bridge.stages.length || 0 }} 阶段
          </p>
        </div>
        <BaseButton :loading="buildLoading" :disabled="!activity?.bridge.canBuild" @click="emit('build')">
          驻建下一阶段
        </BaseButton>
      </div>
      <div v-if="activity?.bridge.nextStage" class="mt-4 rounded-lg bg-violet-50 p-4 text-sm dark:bg-violet-900/20">
        当前阶段：{{ activity.items.feather.itemCount }}/{{ activity.bridge.nextStage.cost.itemCount }} {{ activity.bridge.nextStage.cost.itemName }}
        <div class="mt-2 text-xs text-gray-500">
          奖励：{{ activity.bridge.nextStage.rewards.map(item => `${item.itemName} ×${item.itemCount}`).join('、') || '以服务端结算为准' }}
        </div>
      </div>
      <div v-else class="mt-4 text-sm text-emerald-600">
        鹊桥阶段已全部完成
      </div>
    </div>

    <div class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
      <div class="mb-4">
        <h3 class="text-gray-900 font-semibold dark:text-white">
          香囊相赠
        </h3>
        <p class="mt-1 text-xs text-gray-500">
          今日已赠 {{ activity?.gift.sentCount || 0 }}/{{ activity?.gift.maxCount || 0 }}，名单外好友不会被自动选择
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-[1fr_160px_auto] md:items-end">
        <BaseSelect v-model="friendGid" label="赠送好友" :options="friendOptions" placeholder="请选择好友" />
        <BaseInput v-model.number="giftCount" label="赠送数量" type="number" min="1" :max="activity?.gift.remainingCount || 1" />
        <BaseButton :loading="giftLoading" :disabled="!friendGid || !activity?.gift.remainingCount || !activity?.items.sachet.itemCount" @click="emit('gift', Number(friendGid), Number(giftCount) || 1)">
          赠送香囊
        </BaseButton>
      </div>
    </div>

    <div class="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900/30">
      活动时间：{{ formatTime(activity?.startTime) }} — {{ formatTime(activity?.endTime) }}。每日任务由自动任务模块处理，本页不重复展示。
    </div>
  </div>
</template>
