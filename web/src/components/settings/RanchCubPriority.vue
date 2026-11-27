<script setup lang="ts">
import type { RanchItem } from '@/utils/ranch'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useStatusStore } from '@/stores/status'
import { formatQuantity, RANCH_ENDPOINT } from '@/utils/ranch'

/**
 * 背包幼崽放养优先顺序。
 *
 * 只在「养殖策略 = 按背包库存」时生效：后端 services/ranch/automation.ts 的 placeCubs
 * 会先按这份顺序放养背包里的幼崽，顺序里没有的排在后头（再按等级从高到低）。
 * 数组里只允许出现对应设施的幼崽，后端 normalizeRanchSetting 会二次校验。
 *
 * 上游这份组件直接用 Naive UI 的 NButton 与 axios；本项目改成 BaseButton + 统一 api 封装，
 * 样式跟随 ui-card / ui-subtle-panel 的变量体系。
 */
const props = withDefaults(defineProps<{ accountId: string, connected?: boolean }>(), { connected: undefined })

// 默认从状态 store 读在线状态；也允许显式传入 connected 以便复用在自定义场景。
const statusStore = useStatusStore()
const { status: accountStatus, currentStatusReady } = storeToRefs(statusStore)
const online = computed(() => props.connected ?? (currentStatusReady.value && accountStatus.value?.connection?.connected === true))

const automation = defineModel<Record<string, any>>({ required: true })

const GROUPS = [
  { housing: '窝', key: 'ranch_coop_cub_priority' },
  { housing: '棚', key: 'ranch_shed_cub_priority' },
] as const

type PriorityKey = typeof GROUPS[number]['key']

interface CubStack extends RanchItem {
  animalId: number | null
  husbandryType: string | null
  locked: boolean
}

const inventory = ref<CubStack[]>([])
const loading = ref(false)
const error = ref('')
const status = ref('')
const refreshRevision = ref(0)
const dragging = ref<{ key: PriorityKey, id: number } | null>(null)

watch([() => props.accountId, online, refreshRevision], async ([accountId, connected], _, onCleanup) => {
  inventory.value = []
  loading.value = connected && !!accountId
  error.value = ''
  status.value = ''
  dragging.value = null
  if (!accountId || !connected)
    return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  try {
    // 只读背包段落：与牧场页共用同一个接口，不额外触发写操作。
    const { data } = await api.get(RANCH_ENDPOINT, {
      params: { view: 'bag' },
      headers: { 'x-account-id': accountId },
      signal: controller.signal,
      timeout: 45000,
      skipErrorToast: true,
    } as any)
    if (controller.signal.aborted)
      return
    if (!data?.ok || !data.data?.unlocked) {
      error.value = data?.error || data?.data?.reason || '读取背包失败'
      return
    }
    inventory.value = data.data.bag || []
  }
  catch (cause: any) {
    if (!controller.signal.aborted)
      error.value = cause?.response?.data?.error || cause?.message || '读取背包失败'
  }
  finally {
    if (!controller.signal.aborted)
      loading.value = false
  }
}, { immediate: true })

/** 同 id 的幼崽可能分成多批下发，先按 id 合并库存再排序，否则会出现重复条目。 */
const sorted = computed(() => {
  const stock = new Map<number, CubStack>()
  for (const item of inventory.value) {
    if (!item.animalId || item.locked || safeCount(item.count) <= 0n)
      continue
    const key = Number(item.itemId || item.id)
    const previous = stock.get(key)
    stock.set(key, { ...item, count: ((previous ? safeCount(previous.count) : 0n) + safeCount(item.count)).toString() })
  }
  return GROUPS.map((group) => {
    // 配置里的顺序是 id 数组；断成 number[] 才能给 map 回调推出口参类型。
    const order: number[] = automation.value[group.key] ?? []
    const ranks = new Map(order.map((id, index) => [id, index]))
    const cubs = [...stock.values()].filter(item => item.husbandryType === group.housing)
    // 已配置的按配置顺序，未配置的排在末尾再按等级、编号稳定排列。
    cubs.sort((a, b) => (ranks.get(Number(a.itemId)) ?? order.length) - (ranks.get(Number(b.itemId)) ?? order.length)
      || (b.animalId ?? 0) - (a.animalId ?? 0) || Number(a.itemId) - Number(b.itemId))
    return { ...group, cubs }
  })
})

function safeCount(value: unknown) {
  return /^\d+$/.test(String(value ?? '')) ? BigInt(String(value)) : 0n
}

function move(key: PriorityKey, id: number, target: number, control?: EventTarget | null) {
  const cubs = sorted.value.find(group => group.key === key)?.cubs ?? []
  const from = cubs.findIndex(cub => Number(cub.itemId) === id)
  if (from < 0 || target < 0 || target >= cubs.length || target === from)
    return
  const order = cubs.map(cub => Number(cub.itemId))
  order.splice(from, 1)
  order.splice(target, 0, id)
  // 缺货幼崽保留已保存的位置，补货后仍按原优先级放养。
  const visible = new Set(order)
  let position = 0
  const merged = (automation.value[key] ?? []).map((item: number) => visible.has(item) ? order[position++]! : item)
  automation.value = { ...automation.value, [key]: [...merged, ...order.slice(position)] }
  status.value = `${cubs[from]!.name}已移到第 ${target + 1} 位`
  if (control instanceof HTMLElement) {
    void nextTick(() => {
      if (control.isConnected)
        control.focus({ preventScroll: true })
    })
  }
}

function startDrag(key: PriorityKey, id: number, event: DragEvent) {
  if (!event.dataTransfer)
    return
  dragging.value = { key, id }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(id))
}

function dragOver(key: PriorityKey, event: DragEvent) {
  if (dragging.value?.key === key)
    event.preventDefault()
}

function drop(key: PriorityKey, target: number) {
  if (dragging.value?.key === key)
    move(key, dragging.value.id, target)
  dragging.value = null
}
</script>

<template>
  <div class="cub-priority">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h5 class="text-sm text-gray-800 font-semibold dark:text-gray-200">
        背包幼崽放养顺序
      </h5>
      <div class="flex items-center gap-2">
        <span class="text-xs" :style="{ color: 'var(--muted-text)' }">
          拖动或用箭头调整，保存策略后生效
        </span>
        <BaseButton variant="secondary" size="sm" :disabled="!online || loading" @click="refreshRevision++">
          {{ loading ? '读取中…' : '刷新库存' }}
        </BaseButton>
      </div>
    </div>

    <p v-if="!online" class="cub-priority__state" role="status">
      账号未在线，暂时无法读取背包库存；已有顺序不会丢失。
    </p>
    <p v-else-if="loading" class="cub-priority__state" role="status">
      正在读取背包幼崽…
    </p>
    <p v-else-if="error" class="cub-priority__state text-red-600 dark:text-red-400" role="alert">
      {{ error }}
    </p>
    <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div v-for="group in sorted" :key="group.key" class="cub-priority__group">
        <h6 class="mb-2 text-sm text-gray-700 font-medium dark:text-gray-300">
          {{ group.housing }}
        </h6>
        <p v-if="group.cubs.length === 0" class="cub-priority__state">
          暂无可用{{ group.housing }}幼崽
        </p>
        <ol v-else class="m-0 list-none p-0 space-y-1.5" :aria-label="`${group.housing}的幼崽优先顺序`">
          <li
            v-for="(cub, index) in group.cubs"
            :key="cub.itemId"
            class="cub-priority__item"
            :class="{ 'opacity-60': dragging?.id === Number(cub.itemId) }"
            :draggable="group.cubs.length > 1"
            @dragstart="startDrag(group.key, Number(cub.itemId), $event)"
            @dragend="dragging = null"
            @dragover="dragOver(group.key, $event)"
            @drop.prevent="drop(group.key, index)"
          >
            <span class="cub-priority__index" aria-hidden="true">{{ index + 1 }}</span>
            <img v-if="cub.image" :src="cub.image" :alt="cub.name" class="h-8 w-8 shrink-0 rounded object-contain" draggable="false">
            <span v-else class="i-carbon-pet-image-o h-8 w-8 shrink-0 text-xl text-gray-300" />
            <div class="min-w-0 flex-1">
              <p class="break-words text-sm font-medium">
                {{ cub.name }}
              </p>
              <p class="cub-priority__state">
                库存 {{ formatQuantity(cub.count) }}
              </p>
            </div>
            <div v-if="group.cubs.length > 1" class="flex shrink-0 items-center gap-1">
              <BaseButton
                variant="secondary"
                size="sm"
                :disabled="index === 0"
                :aria-label="`上移${cub.name}`"
                @click="move(group.key, Number(cub.itemId), index - 1, $event.currentTarget)"
              >
                上移
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                :disabled="index === group.cubs.length - 1"
                :aria-label="`下移${cub.name}`"
                @click="move(group.key, Number(cub.itemId), index + 1, $event.currentTarget)"
              >
                下移
              </BaseButton>
            </div>
          </li>
        </ol>
      </div>
    </div>
    <p class="sr-only" role="status">
      {{ status }}
    </p>
  </div>
</template>

<style scoped>
.cub-priority {
  display: grid;
  gap: 8px;
}

.cub-priority__group,
.cub-priority__item {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--ui-border, rgb(229 231 235));
  border-radius: 10px;
}

.cub-priority__group {
  background: var(--ui-surface-soft, rgb(249 250 251));
}

.cub-priority__item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--ui-surface, #fff);
}

.cub-priority__item[draggable='true'] {
  cursor: grab;
}

.cub-priority__index,
.cub-priority__state {
  color: var(--muted-text, var(--ui-muted, #6b7280));
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
