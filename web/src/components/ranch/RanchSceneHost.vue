<script setup lang="ts">
import type { RanchRequest, RanchView } from '@/utils/ranch'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RanchQuoteDialog from '@/components/ranch/RanchQuoteDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useToastStore } from '@/stores/toast'
import { formatDateTime, formatQuantity, RANCH_VIEW_LABELS } from '@/utils/ranch'

/**
 * 牧场场景的页面壳。
 *
 * 牧场在协议上是独立的 game_scene_id=2：每次读取都会占用串行自动化锁、临时切场景再切回来
 * （core/src/services/ranch/transport.ts 的 inScene），所以这里刻意不做定时轮询，只在
 * 挂载、页面重新可见、切账号、切分区和手工操作之后拉取。
 *
 * 背包、商店、图鉴和好友在两个场景里各有一套，因此把牧场侧协议共用的部分——场景门控、
 * 待核对账本、资源条和 quote→execute 弹窗——收在这里，页面只负责自己的页签和面板。
 */
const props = withDefaults(defineProps<{
  view: RanchView
  params?: Record<string, any>
  title?: string
  icon?: string
}>(), {
  params: undefined,
  title: '牧场',
  icon: 'i-carbon-wheat',
})

const accountStore = useAccountStore()
const ranchStore = useRanchStore()
const toast = useToastStore()

const { currentAccountId } = storeToRefs(accountStore)
const { state, activeView, loading, loaded, error, refreshRequired } = storeToRefs(ranchStore)

const request = ref<RanchRequest | null>(null)

const resources = computed(() => state.value?.resources || [])
const pending = computed(() => state.value?.pending || [])
const unlocked = computed(() => state.value?.unlocked === true)
const viewLabel = computed(() => RANCH_VIEW_LABELS[activeView.value])

/** 分区参数由页面拼，对象字面量每次渲染都是新引用，按序列化结果比较才不会反复触发请求。 */
const paramsKey = computed(() => JSON.stringify(props.params ?? {}))

function refresh(view: RanchView = props.view, params: Record<string, any> = props.params ?? {}) {
  if (!currentAccountId.value)
    return
  void ranchStore.fetchView(currentAccountId.value, view, params)
}

function switchView(view: RanchView = props.view, params: Record<string, any> = props.params ?? {}) {
  if (!currentAccountId.value)
    return
  void ranchStore.switchView(currentAccountId.value, view, params)
}

function onRequest(payload: RanchRequest) {
  request.value = payload
}

function onDialogDone(result: { ok: boolean, message?: string, error?: string }) {
  request.value = null
  if (result.ok)
    toast.success(result.message || '牧场操作已完成')
  else
    toast.error(result.error || '牧场操作失败')
}

async function acknowledge(id: string) {
  if (!currentAccountId.value)
    return
  const result = await ranchStore.acknowledge(currentAccountId.value, id)
  if (result.ok) {
    toast.success(result.message || '已解除该操作的资源预留')
    refresh()
  }
  else {
    toast.error(result.error || '解除待核对保护失败')
  }
}

/** 后端在待核对账本里直接下发物品名；缺失时退回本页资源条，再对不上就保留原始 key，不猜名字。 */
function costText(cost: { resourceKey: string, amount: string, name: string }) {
  if (cost.name)
    return `${cost.name} ×${formatQuantity(cost.amount)}`
  const itemId = Number(cost.resourceKey.replace('item:', ''))
  const label = Number.isFinite(itemId)
    ? resources.value.find(resource => resource.itemId === itemId)?.label || `物品${itemId}`
    : cost.resourceKey
  return `${label} ×${formatQuantity(cost.amount)}`
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible')
    refresh()
}

watch(currentAccountId, () => {
  ranchStore.clearRanchData()
  request.value = null
  refresh()
})

watch(() => [props.view, paramsKey.value] as const, ([view, key], previous) => {
  if (!previous || (previous[0] === view && previous[1] === key))
    return
  const params = JSON.parse(key) as Record<string, any>
  // 只切页签时沿用 store 的缓存判定，命中就不必再进一次场景；换了参数必须重新读。
  if (previous[1] === key)
    switchView(view, params)
  else
    refresh(view, params)
})

onMounted(() => {
  // 挂载时按页面要求的分区读取，不能沿用 store 里上一页留下的 activeView。
  refresh(props.view)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

defineExpose({ refresh, switchView })
</script>

<template>
  <section class="space-y-4">
    <div class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <div class="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <div class="text-2xl" :class="[icon]" :style="{ color: 'var(--theme-primary)' }" />
            <h1 class="text-xl font-bold">
              {{ title }}
            </h1>
          </div>
          <slot
            name="badges"
            :state="state"
            :unlocked="unlocked"
            :resources="resources"
          />
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <slot name="actions" :loading="loading" :disabled="!currentAccountId" />
          <BaseButton class="w-24" variant="primary" :loading="loading" :disabled="!currentAccountId" @click="refresh()">
            刷新
          </BaseButton>
        </div>
      </div>

      <div v-if="!currentAccountId" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        请先选择账号，再查看{{ title }}。
      </div>

      <div v-else-if="loading && !loaded" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        正在进入牧场场景读取{{ viewLabel }}数据…
      </div>

      <div v-else-if="error && !loaded" class="rounded-lg bg-red-50 p-8 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ error }}
      </div>

      <div v-else-if="!loaded" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        暂无{{ title }}数据，请点击刷新重新读取。
      </div>

      <div v-else-if="state && !unlocked" class="rounded-lg bg-amber-50 p-8 text-center text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
        {{ state.reason || '牧场尚未解锁，请先在游戏中完成开启条件。' }}
      </div>

      <template v-else>
        <div v-if="error" class="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ error }}
        </div>

        <div v-if="refreshRequired" class="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          操作已完成，但后端未能回读最新牧场快照，请点击刷新核对结果。
        </div>

        <div
          v-if="pending.length"
          class="mb-3 border border-amber-200 rounded-xl bg-amber-50 px-4 py-3 space-y-2 dark:border-amber-900/60 dark:bg-amber-900/20"
        >
          <p class="text-sm text-amber-800 font-medium dark:text-amber-200">
            {{ pending.length }} 笔操作结果待核对
          </p>
          <p class="text-xs text-amber-700 leading-5 dark:text-amber-300">
            这些操作已发出但未获得可确认的回包，后端会持续预留对应资源并拒绝同类操作。请先在游戏里确认结果，再解除保护。
          </p>
          <div v-for="row in pending" :key="row.id" class="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs dark:bg-gray-800">
            <span class="font-medium">{{ row.label }}</span>
            <span class="text-gray-500">{{ row.costs.map(costText).join('、') || '无资源消耗' }}</span>
            <span class="text-gray-400">{{ formatDateTime(row.createdAt) }}</span>
            <span class="min-w-0 flex-1 truncate text-gray-500">{{ row.message }}</span>
            <BaseButton size="sm" variant="secondary" @click="acknowledge(row.id)">
              已核对
            </BaseButton>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5 text-xs">
          <div
            v-for="resource in resources"
            :key="resource.key"
            class="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
          >
            <img v-if="resource.image" :src="resource.image" :alt="resource.label" class="h-4 w-4 rounded object-contain">
            <span>{{ resource.label }}</span>
            <span class="font-medium">{{ resource.value }}</span>
            <span v-if="resource.locked" class="text-gray-400">（锁定 {{ formatQuantity(resource.locked) }}）</span>
          </div>
        </div>

        <div v-if="$slots.tabs" class="mt-4">
          <slot
            name="tabs"
            :active-view="activeView"
          />
        </div>

        <div class="mt-3">
          <div v-if="loading" class="mb-3 rounded-lg bg-gray-50 px-4 py-2 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
            正在读取{{ viewLabel }}分区…
          </div>

          <slot
            :state="state"
            :active-view="activeView"
            :on-request="onRequest"
            :refresh="refresh"
          />
        </div>
      </template>
    </div>

    <RanchQuoteDialog
      :show="!!request"
      :account-id="currentAccountId"
      :request="request"
      @close="request = null"
      @done="onDialogDone"
    />
  </section>
</template>
