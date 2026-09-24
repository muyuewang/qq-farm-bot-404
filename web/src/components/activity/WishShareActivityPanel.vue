<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

interface ActivityItem {
  itemId?: number
  itemName?: string
  itemCount?: number
  image?: string
  dayId?: number
}

const props = defineProps<{ kind: 'wish' | 'share', activity: any | null, loading: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const ACTIVITY_ITEM_IMAGES: Record<number, string> = {
  6001: '/activity/wish-sign/firework.png',
  26030: '/activity/wish-sign/moon-beauty-seed.png',
  80002: '/activity/wish-sign/fertilizer-4h.png',
  80003: '/activity/wish-sign/fertilizer-8h.png',
  80004: '/activity/wish-sign/fertilizer-12h.png',
  80013: '/activity/wish-sign/organic-fertilizer-8h.png',
  80014: '/activity/wish-sign/organic-fertilizer-12h.png',
  1002: '/activity/wish-sign/coupon.png',
  20435: '/activity/wish-sign/lily-seed.png',
  204010: '/activity/wish-sign/moon-rabbit-skin.png',
  90042: '/activity/wish-sign/cute-bear-skin.png',
}

const FALLBACK_WISH_REWARDS: ActivityItem[] = [
  { dayId: 1, itemId: 6001, itemName: '烟花·玉兔望月', itemCount: 20, image: '/activity/wish-sign/firework.png' },
  { dayId: 2, itemId: 26030, itemName: '月下美人种子', itemCount: 48, image: '/activity/wish-sign/moon-beauty-seed.png' },
  { dayId: 3, itemId: 80003, itemName: '化肥(8小时)', itemCount: 2, image: '/activity/wish-sign/fertilizer-8h.png' },
  { dayId: 4, itemId: 26030, itemName: '月下美人种子', itemCount: 12, image: '/activity/wish-sign/moon-beauty-seed.png' },
  { dayId: 5, itemId: 80013, itemName: '有机化肥(8小时)', itemCount: 2, image: '/activity/wish-sign/organic-fertilizer-8h.png' },
  { dayId: 6, itemId: 26030, itemName: '月下美人种子', itemCount: 12, image: '/activity/wish-sign/moon-beauty-seed.png' },
  { dayId: 7, itemId: 80004, itemName: '化肥(12小时)', itemCount: 1, image: '/activity/wish-sign/fertilizer-12h.png' },
  { dayId: 8, itemId: 20435, itemName: '山丹丹种子', itemCount: 48, image: '/activity/wish-sign/lily-seed.png' },
  { dayId: 9, itemId: 6001, itemName: '烟花·玉兔望月', itemCount: 20, image: '/activity/wish-sign/firework.png' },
  { dayId: 10, itemId: 20435, itemName: '山丹丹种子', itemCount: 12, image: '/activity/wish-sign/lily-seed.png' },
  { dayId: 11, itemId: 1002, itemName: '点券', itemCount: 100, image: '/activity/wish-sign/coupon.png' },
  { dayId: 12, itemId: 20435, itemName: '山丹丹种子', itemCount: 12, image: '/activity/wish-sign/lily-seed.png' },
  { dayId: 13, itemId: 80014, itemName: '有机化肥(12小时)', itemCount: 1, image: '/activity/wish-sign/organic-fertilizer-12h.png' },
  { dayId: 14, itemId: 204010, itemName: '玉兔邀月', itemCount: 1, image: '/activity/wish-sign/moon-rabbit-skin.png' },
]

const isWish = computed(() => props.kind === 'wish')
const title = computed(() => props.activity?.title || (isWish.value ? '秋祈良愿' : '快乐不独享'))
const rewardPool = computed<ActivityItem[]>(() => props.activity?.rewardPool?.length ? props.activity.rewardPool : FALLBACK_WISH_REWARDS)
const tomorrowReward = computed<ActivityItem | null>(() => rewardPool.value.find(
  reward => reward.dayId === Number(props.activity?.activityDay || 0) + 1,
) || null)

interface ShareMilestone {
  id: number
  threshold: number
  state: number
  rewards: ActivityItem[]
}

const shareMilestones = computed<ShareMilestone[]>(() => [...(props.activity?.milestones || [])]
  .sort((a, b) => a.threshold - b.threshold))
const shareScore = computed(() => Math.max(0, Number(props.activity?.currentScore) || 0))
const shareTarget = computed(() => shareMilestones.value[shareMilestones.value.length - 1]?.threshold || 0)
const nextMilestone = computed(() => shareMilestones.value.find(tier => tier.threshold > shareScore.value))

function segmentProgress(index: number) {
  const start = shareMilestones.value[index - 1]?.threshold || 0
  const end = shareMilestones.value[index]?.threshold || 0
  if (end <= start)
    return shareScore.value >= end ? 100 : 0
  return Math.min(100, Math.max(0, (shareScore.value - start) / (end - start) * 100))
}

function time(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function itemText(item: ActivityItem) {
  const name = item.itemName || (item.itemId ? `物品#${item.itemId}` : '活动奖励')
  return `${name}${item.itemCount && item.itemCount !== 1 ? ` ×${item.itemCount}` : ''}`
}

function rewardImage(item: ActivityItem) {
  return item.image || ACTIVITY_ITEM_IMAGES[Number(item.itemId)] || ''
}

function milestoneState(state: number) {
  if (state === 3)
    return { label: '已领取', className: 'text-emerald-700 dark:text-emerald-300' }
  if (state === 2)
    return { label: '可领取', className: 'text-amber-700 dark:text-amber-300' }
  return { label: '未达成', className: 'text-gray-500 dark:text-gray-400' }
}
</script>

<template>
  <section class="space-y-5">
    <header
      class="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-7"
      :class="isWish ? 'bg-gradient-to-br from-[#7f4b16] via-[#bd721c] to-[#efad42]' : 'bg-gradient-to-br from-[#7b321f] via-[#bd5930] to-[#ef9a52]'"
    >
      <div class="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border-[24px] border-white/10" />
      <div class="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      <div class="relative flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-white/70">
            <span class="h-2 w-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.9)]" />
            {{ isWish ? '秋日祈愿季' : '快乐分享季' }}
          </div>
          <div class="mt-3 flex items-center gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl backdrop-blur-sm" :class="isWish ? 'i-carbon-sun' : 'i-carbon-share'" />
            <div>
              <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{{ title }}</h1>
              <p class="mt-1 text-sm text-white/80">{{ isWish ? '每日祈愿，收下属于你的秋日好愿' : '分享快乐，解锁活动档位奖励' }}</p>
            </div>
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75">
            <span>{{ time(activity?.startTime) }} — {{ time(activity?.endTime) }}</span>
            <span class="hidden h-1 w-1 rounded-full bg-white/50 sm:block" />
            <span>{{ isWish ? '祈愿进行中' : '分享活动进行中' }}</span>
          </div>
        </div>
        <BaseButton variant="secondary" size="sm" :loading="loading" :disabled="loading" aria-label="刷新活动数据" @click="emit('refresh')">刷新</BaseButton>
      </div>
      <div v-if="activity" class="relative mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3 backdrop-blur-sm">
          <div class="text-xs text-white/65">{{ isWish ? '今日剩余祈愿' : '当前快乐值' }}</div>
          <div class="mt-1 text-2xl font-semibold">{{ isWish ? activity.remainingCount : activity.currentScore }}</div>
          <div class="mt-1 text-xs text-white/60">{{ isWish ? '次机会' : '累计进度' }}</div>
        </div>
        <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3 backdrop-blur-sm">
          <div class="text-xs text-white/65">{{ isWish ? '当前活动日' : '已领取档位' }}</div>
          <div class="mt-1 text-2xl font-semibold">{{ isWish ? activity.activityDay : activity.milestones?.filter((tier: any) => tier.state === 3).length }}</div>
          <div class="mt-1 text-xs text-white/60">{{ isWish ? '每日签到' : '档位进度' }}</div>
        </div>
        <div class="col-span-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 backdrop-blur-sm sm:col-span-1">
          <div class="text-xs text-white/65">{{ isWish ? '今日状态' : '今日领取' }}</div>
          <div class="mt-2 text-sm font-medium">{{ isWish ? (activity.pending ? '奖励待领取' : activity.remainingCount > 0 ? '今日可祈愿' : '今日已完成') : (activity.daily?.rewardClaimed ? '已领取' : '待领取') }}</div>
        </div>
      </div>
    </header>

    <div v-if="loading && !activity" class="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">正在读取活动状态…</div>
    <div v-else-if="!activity" class="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">暂无活动数据，请稍后刷新。</div>

    <template v-else-if="isWish">
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section class="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-amber-900/30 dark:bg-gray-800 sm:p-6">
          <div class="flex items-center gap-2">
            <span class="i-carbon-sun text-lg text-amber-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">祈愿状态</h2>
          </div>
          <div v-if="activity.pending" class="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/25">
            <span class="i-carbon-gift mt-0.5 shrink-0 text-xl text-amber-600" />
            <div class="min-w-0">
              <p class="font-medium text-stone-800 dark:text-gray-100">第 {{ activity.pending.dayId }} 日 · {{ activity.choices?.find((choice: any) => choice.id === activity.pending.chooseId)?.name || '心愿' }}</p>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <template v-for="reward in activity.pending.rewards" :key="`${reward.itemId}-${reward.itemCount}`">
                  <img v-if="rewardImage(reward)" :src="rewardImage(reward)" :alt="reward.itemName" class="h-8 w-8 shrink-0 object-contain">
                  <span class="break-words text-sm text-stone-600 dark:text-gray-300">{{ itemText(reward) }}</span>
                </template>
              </div>
              <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">奖励待领取</p>
            </div>
          </div>
          <p v-else class="mt-4 text-sm text-gray-600 dark:text-gray-300">{{ activity.remainingCount > 0 ? '今日仍有祈愿机会' : '今日祈愿已完成' }}</p>
          <div class="mt-5 border-t border-gray-100 pt-4 dark:border-gray-700">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">祈愿池 · 六种心愿</p>
            <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div v-for="choice in activity.choices" :key="choice.id" class="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-300">
                <span class="block text-xs text-gray-400 dark:text-gray-500">愿望 {{ choice.id }}</span>
                <span class="mt-1 block font-medium">{{ choice.name }}</span>
              </div>
            </div>
          </div>
        </section>
        <section class="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-amber-900/30 dark:bg-gray-800 sm:p-6">
          <div class="flex items-center gap-2">
            <span class="i-carbon-gift text-lg text-amber-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">明日奖励</h2>
          </div>
          <div v-if="tomorrowReward" class="mt-5 flex items-center gap-4">
            <img v-if="tomorrowReward.image" :src="tomorrowReward.image" :alt="tomorrowReward.itemName" class="h-14 w-14 shrink-0 object-contain">
            <span v-else class="i-carbon-gift text-3xl text-amber-600" />
            <div class="min-w-0">
              <p class="text-xs text-amber-700 dark:text-amber-300">第 {{ tomorrowReward.dayId }} 日</p>
              <p class="mt-1 break-words font-semibold text-stone-800 dark:text-gray-100">{{ itemText(tomorrowReward) }}</p>
            </div>
          </div>
          <p v-else class="mt-5 text-sm text-gray-500 dark:text-gray-400">{{ activity.activityDay >= rewardPool.length ? '已是最后一个活动日' : '明日奖励暂未公布' }}</p>
        </section>
      </div>
      <section class="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-amber-900/30 dark:bg-gray-800 sm:p-6">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">每日奖励池</h2>
          <span class="text-xs text-gray-500">共 {{ rewardPool.length }} 日</span>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <div v-for="reward in rewardPool" :key="reward.dayId" class="flex min-w-0 items-center gap-2 rounded-xl border p-3" :class="reward.dayId === activity.activityDay ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : 'border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30'">
            <img v-if="reward.image" :src="reward.image" :alt="reward.itemName" class="h-9 w-9 shrink-0 object-contain">
            <span v-else class="i-carbon-gift text-xl text-gray-400" />
            <div class="min-w-0">
              <div class="text-[11px] text-gray-500 dark:text-gray-400">第 {{ reward.dayId }} 日</div>
              <div class="truncate text-xs font-medium text-gray-800 dark:text-gray-200" :title="itemText(reward)">{{ itemText(reward) }}</div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
        <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">今日进度</h2>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div v-for="entry in [
            { label: '每日快乐值', value: activity.daily?.rewardClaimed ? '已领取' : '待领取' },
            { label: '首次分享', value: activity.daily?.firstShareAwarded ? '已完成' : '待完成' },
            { label: '分享领取次数', value: `${activity.daily?.claimedCount ?? '—'} / ${activity.daily?.claimLimit || '—'}` },
          ]" :key="entry.label" class="rounded-xl bg-stone-50 p-4 dark:bg-gray-900/40">
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ entry.label }}</p>
            <p class="mt-2 font-semibold text-stone-800 dark:text-gray-200">{{ entry.value }}</p>
          </div>
        </div>
      </section>
      <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">快乐值档位</h2>
          <span v-if="shareTarget > 0" class="text-xs text-gray-500 dark:text-gray-400">
            {{ nextMilestone ? `距下一档还差 ${nextMilestone.threshold - shareScore} 快乐值` : '全部档位已达成' }}
          </span>
        </div>
        <div v-if="shareMilestones.length" class="mt-5 overflow-x-auto pb-2">
          <div class="min-w-[480px]">
            <div
              v-if="shareTarget > 0"
              role="progressbar"
              aria-label="快乐值档位进度"
              :aria-valuenow="Math.min(shareScore, shareTarget)"
              :aria-valuemin="0"
              :aria-valuemax="shareTarget"
              :aria-valuetext="`${shareScore} 快乐值，目标 ${shareTarget}`"
              class="sr-only"
            />
            <ol class="flex">
              <li v-for="(tier, index) in shareMilestones" :key="tier.id" class="min-w-[120px] flex-1">
                <div class="relative flex h-9 items-center" aria-hidden="true">
                  <div class="h-2 w-full overflow-hidden bg-gray-100 dark:bg-gray-700" :class="index === 0 ? 'rounded-l-full' : ''">
                    <div class="h-full bg-orange-500 transition-[width] duration-300 motion-reduce:transition-none" :style="{ width: `${segmentProgress(index)}%` }" />
                  </div>
                  <span
                    class="absolute right-0 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white text-sm dark:border-gray-800"
                    :class="tier.state === 3 ? 'bg-emerald-600 text-white' : tier.state === 2 ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400'"
                  >
                    <img v-if="tier.state !== 3 && rewardImage(tier.rewards?.[0] || {})" :src="rewardImage(tier.rewards?.[0] || {})" :alt="tier.rewards?.[0]?.itemName" class="h-6 w-6 object-contain">
                    <span v-else :class="tier.state === 3 ? 'i-carbon-checkmark' : 'i-carbon-gift'" />
                  </span>
                </div>
                <div class="pl-3 pt-3 text-right">
                  <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ tier.threshold }} <span class="text-xs font-normal text-gray-500 dark:text-gray-400">快乐值</span></p>
                  <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <template v-for="reward in tier.rewards" :key="`${reward.itemId}-${reward.itemCount}`">
                      <img v-if="rewardImage(reward)" :src="rewardImage(reward)" :alt="reward.itemName" class="h-8 w-8 shrink-0 object-contain">
                      <span class="break-words text-sm text-gray-700 dark:text-gray-200">{{ itemText(reward) }}</span>
                    </template>
                  </div>
                  <p class="mt-1.5 text-xs font-medium" :class="milestoneState(tier.state).className">{{ milestoneState(tier.state).label }}</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
        <p v-else class="mt-4 text-sm text-gray-500 dark:text-gray-400">暂无档位数据。</p>
      </section>
    </template>
  </section>
</template>
