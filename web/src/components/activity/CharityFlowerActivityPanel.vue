<script setup lang="ts">
import type { CharityFlowerActivityData } from '@/stores/activity'

defineProps<{ activity: CharityFlowerActivityData | null, loading: boolean }>()
defineEmits<{ refresh: [] }>()
function pct(value: number, target: number) {
  return target > 0 ? Math.min(100, Math.max(0, value / target * 100)) : 0
}

function time(value?: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function rewardText(items: CharityFlowerActivityData['share']['rewards']) {
  return items.map(item => `${item.itemName || '活动道具'} ×${item.itemCount}`).join('、')
}
</script>

<template>
  <section class="space-y-4">
    <div class="overflow-hidden rounded-xl from-rose-500 via-pink-500 to-orange-400 bg-gradient-to-br p-6 text-white shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm text-white/75">
            QQ 农场公益活动
          </p><h1 class="mt-1 text-3xl font-semibold">
            {{ activity?.title || '公益小红花' }}
          </h1><p class="mt-2 text-sm text-white/80">
            {{ time(activity?.startTime) }} — {{ time(activity?.endTime) }}
          </p>
        </div>
        <button class="rounded-lg bg-white/20 px-3 py-2 text-sm disabled:opacity-50" :disabled="loading" @click="$emit('refresh')">
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
      <div class="grid grid-cols-3 mt-6 gap-3 text-center">
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            可送爱心
          </div><div class="mt-1 text-2xl font-semibold">
            {{ activity?.love?.count || 0 }}
          </div>
        </div>
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            个人爱心值
          </div><div class="mt-1 text-2xl font-semibold">
            {{ activity?.love?.personalScore || 0 }}
          </div>
        </div>
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            结算奖励资格
          </div><div class="mt-1 text-sm font-medium">
            {{ activity?.finalReward?.eligible ? '已取得' : '未取得' }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading && !activity" class="rounded-xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800">
      正在读取活动状态…
    </div>
    <template v-else-if="activity">
      <section class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
        <div class="flex justify-between text-sm">
          <span class="font-medium">全服爱心进度（个）</span><span>{{ activity.global.score.toLocaleString() }} / {{ activity.global.target.toLocaleString() }}</span>
        </div>
        <div class="mt-3 h-3 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-950">
          <div class="h-full rounded-full bg-rose-500" :style="{ width: `${pct(activity.global.score, activity.global.target)}%` }" />
        </div>
        <p class="mt-3 text-xs text-gray-500">
          活动结束时间：{{ time(activity.endTime) }}
        </p>
      </section>
      <section class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
        <h2 class="text-base font-semibold">
          个人爱心奖励
        </h2>
        <div class="grid mt-4 gap-3 lg:grid-cols-5 sm:grid-cols-2">
          <div v-for="tier in activity.personalRewards" :key="tier.needScore" class="border rounded-lg p-3" :class="tier.claimed ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20' : tier.reached ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/20' : 'border-gray-200 dark:border-gray-700'">
            <div class="text-xs text-gray-500">
              {{ tier.needScore }} 爱心
            </div><div class="mt-2 text-sm font-medium">
              {{ rewardText(tier.rewards) || '以服务端结算为准' }}
            </div><div class="mt-2 text-xs">
              {{ tier.claimed ? '已领取' : tier.claimable ? '可领取' : tier.reached ? '已达成待领取' : '未达成' }}
            </div>
          </div>
        </div>
      </section>
      <section class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800">
          <div class="text-xs text-gray-500">
            每日分享礼包
          </div><div class="mt-2 text-sm font-medium">
            {{ activity.share.claimed ? '已领取' : activity.share.claimable ? '可领取' : '未完成分享' }}
          </div><div class="mt-1 text-xs text-gray-500">
            {{ rewardText(activity.share.rewards) || '礼包内容以服务端结算为准' }}
          </div>
        </div>
        <div class="rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800">
          <div class="text-xs text-gray-500">
            结算奖励条件
          </div><div class="mt-2 text-sm font-medium">
            {{ activity.finalReward.eligible ? '已取得结算资格' : `个人需捐满 ${activity.finalReward.threshold} 爱心` }}
          </div><div class="mt-1 text-xs text-gray-500">
            {{ rewardText(activity.finalReward.rewards) || '结算奖励以服务端为准' }}
          </div>
        </div>
        <div class="rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800">
          <div class="text-xs text-gray-500">
            公益金发放
          </div><div class="mt-2 text-sm font-medium">
            {{ activity.publicFund ? time(activity.publicFund.date) : '暂无发放记录' }}
          </div><div class="mt-1 text-xs text-gray-500">
            发放状态码 {{ activity.publicFund?.statusCode || '—' }}（服务端未提供文字释义）
          </div>
        </div>
      </section>
    </template>
    <div v-else class="rounded-xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800">
      当前账号暂无活动数据
    </div>
  </section>
</template>
