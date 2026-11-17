<script setup lang="ts">
import type { RanchAnimal, RanchRequest, RanchState } from '@/utils/ranch'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { formatQuantity, itemListLine } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{
  request: [payload: RanchRequest]
  hostGid: [hostGid: string]
}>()

const keyword = ref('')

const friends = computed(() => props.state?.friends || [])
const ranch = computed(() => props.state?.friendRanch ?? null)
const visibleFriends = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text)
    return friends.value
  return friends.value.filter(friend => friend.name.toLowerCase().includes(text) || friend.gid.includes(text))
})

function requestStealAll() {
  if (!ranch.value)
    return
  emit('request', {
    action: 'steal',
    input: { hostGid: ranch.value.gid },
    title: `偷取${ranch.value.name}的牧场产物`,
    note: '服务端按进入牧场那一刻的可偷货架执行，可能少于页面显示的数量；每位好友每天可偷次数由服务端控制。',
  })
}

function requestCleanFriend() {
  if (!ranch.value)
    return
  emit('request', {
    action: 'cleanFriend',
    input: { hostGid: ranch.value.gid },
    title: `清理${ranch.value.name}的栏舍`,
    note: '只清理他人投放且允许清理的危险物，自己放的蚊子不会被清除。',
  })
}

function requestStroke(ranchId: string, animal: RanchAnimal) {
  if (!ranch.value)
    return
  emit('request', {
    action: 'stroke',
    input: { hostGid: ranch.value.gid, ranchId, animalId: animal.id },
    title: `抚摸${animal.name}`,
    note: '抚摸有概率触发巨大变异，每日次数由服务端下发。',
  })
}

function requestMosquito(ranchId: string, label: string) {
  if (!ranch.value)
    return
  emit('request', {
    action: 'putMosquito',
    input: { hostGid: ranch.value.gid, ranchId },
    title: `向${ranch.value.name}的${label}放蚊子`,
    note: '会影响好友的牧场产出，属于对抗性操作，每日次数与每栏上限由服务端控制。',
    danger: true,
  })
}

function shelfText(shelf: any) {
  return shelf.products.length ? itemListLine(shelf.products) : '货架已空'
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!state?.friends && !state?.friendRanch" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      好友牧场数据未下发，请点击刷新重新读取。
    </div>

    <template v-if="ranch">
      <div class="flex flex-wrap items-center gap-2 border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <BaseButton variant="ghost" size="sm" @click="emit('hostGid', '')">
          ← 返回列表
        </BaseButton>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">
            {{ ranch.name }} · Lv.{{ ranch.level }}
          </p>
          <p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            GID {{ ranch.gid }} · 可偷货架 {{ ranch.stealableShelves }} 个 · 可清理危险物 {{ ranch.cleanableHazards }} 个
          </p>
        </div>
        <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          今日抚摸剩余 {{ ranch.strokeRemaining ?? '未下发' }} 次
        </span>
        <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          今日放蚊剩余 {{ ranch.mosquitoRemaining ?? '未下发' }} 次
        </span>
        <BaseButton variant="primary" size="sm" :disabled="!ranch.canSteal" @click="requestStealAll">
          一键偷取
        </BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="!ranch.cleanableHazards" @click="requestCleanFriend">
          一键清理
        </BaseButton>
      </div>

      <p class="text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        进入好友牧场本身即是一次真实访问：报价阶段服务端已进入并离开过对方牧场，操作结果以再次进入后的回包为准。
      </p>

      <div v-if="!ranch.ranches.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
        该好友尚未建造窝或棚。
      </div>

      <div class="grid gap-3 lg:grid-cols-2">
        <div
          v-for="row in ranch.ranches"
          :key="row.id"
          class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-center gap-2">
            <span class="i-fa-solid-paw h-4 w-4 shrink-0" :style="{ color: 'var(--theme-primary)' }" />
            <p class="min-w-0 flex-1 truncate text-sm font-medium">
              {{ row.name }}
            </p>
            <span class="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
              蚊子 {{ row.mosquitoes }} / {{ row.mosquitoLimit || '未配置' }}
            </span>
            <BaseButton
              variant="outline"
              size="sm"
              :disabled="!(row.mosquitoRoom > 0) || ranch.mosquitoRemaining === 0"
              @click="requestMosquito(row.id, row.name)"
            >
              放蚊子
            </BaseButton>
          </div>

          <div v-if="row.shelves.length" class="mt-2 space-y-1.5">
            <div
              v-for="shelf in row.shelves"
              :key="`${row.id}-${shelf.slot}`"
              class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-900/40"
            >
              <span class="shrink-0 text-gray-500">架 {{ shelf.slot }}</span>
              <span class="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{{ shelfText(shelf) }}</span>
              <span
                v-if="shelf.canSteal"
                class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              >
                可偷
              </span>
            </div>
          </div>
          <p v-else class="mt-2 text-xs text-gray-500">
            该栏舍暂无产物货架。
          </p>

          <div v-if="row.animals.length" class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] mt-3 gap-2">
            <div
              v-for="animal in row.animals"
              :key="`${row.id}-${animal.id}`"
              class="border border-gray-200 rounded-lg px-2 py-1.5 dark:border-gray-700"
            >
              <p class="truncate text-xs font-medium">
                {{ animal.name }}
              </p>
              <p class="truncate text-[11px] text-gray-500">
                {{ animal.stageName }} · 产物 {{ formatQuantity(animal.produceCount) }}
              </p>
              <BaseButton
                variant="secondary"
                size="sm"
                class="mt-1.5 w-full"
                :disabled="!animal.canStroke || animal.stroked || ranch.strokeRemaining === 0"
                @click="requestStroke(row.id, animal)"
              >
                {{ animal.stroked ? '今日已抚摸' : '抚摸' }}
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="state?.friends">
      <div class="flex flex-wrap items-center gap-2">
        <BaseInput v-model="keyword" placeholder="搜索好友昵称或 GID" class="w-56" clearable />
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          共 {{ friends.length }} 位好友
        </span>
      </div>

      <div v-if="!friends.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
        没有可访问的好友。
      </div>
      <div v-else-if="!visibleFriends.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
        没有匹配 {{ keyword }} 的好友。
      </div>

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        <div
          v-for="friend in visibleFriends"
          :key="friend.gid"
          class="flex items-center gap-2 border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <img v-if="friend.avatarUrl" :src="friend.avatarUrl" :alt="friend.name" class="h-9 w-9 shrink-0 rounded-full object-cover">
          <div v-else class="i-carbon-user-avatar h-9 w-9 shrink-0 text-xl text-gray-300" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {{ friend.name }}
            </p>
            <p class="truncate text-[11px] text-gray-500">
              {{ friend.gid }}
            </p>
          </div>
          <BaseButton variant="secondary" size="sm" @click="emit('hostGid', friend.gid)">
            进入
          </BaseButton>
        </div>
      </div>
    </template>
  </div>
</template>
