<script setup lang="ts">
import type { InteractionAttempt, InteractionItem } from '@/stores/interaction'
import { computed, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useInteractionStore } from '@/stores/interaction'
import { useToastStore } from '@/stores/toast'

/**
 * 特殊互动道具操作面板。
 *
 * - mode="friend"：作用于指定好友农场，按 targetKind 分为选地块与整场两种。
 * - mode="self"：作用于自己的农场，同样按地块批量使用。
 *
 * 库存、可作用地块与逐地块结果全部来自后端，前端只负责选择与展示。
 * 自动化流程复用同一批后端校验，页面不额外放宽任何前置条件。
 */
const props = withDefaults(defineProps<{
  accountId: string
  mode?: 'self' | 'friend'
  gid?: string
  lands?: any[]
  defaultExpanded?: boolean
}>(), {
  mode: 'self',
  gid: '',
  lands: () => [],
  defaultExpanded: false,
})

const emit = defineEmits<{
  (e: 'used'): void
}>()

const interactionStore = useInteractionStore()
const toastStore = useToastStore()

const expanded = ref(props.defaultExpanded)
const selectedItemId = ref('')
const selectedLandIds = ref<Set<string>>(new Set())
const results = ref<InteractionAttempt[]>([])
const resultMessage = ref('')
const confirm = ref({
  show: false,
  itemName: '',
  count: 0,
  mode: 'land' as 'land' | 'farm',
  itemId: '',
})

const isFriendMode = computed(() => props.mode === 'friend')

const items = computed<InteractionItem[]>(() => (isFriendMode.value ? interactionStore.friendItems : interactionStore.selfItems))
const loading = computed(() => (isFriendMode.value ? interactionStore.friendItemsLoading : interactionStore.selfItemsLoading))
const loadError = computed(() => (isFriendMode.value ? interactionStore.friendItemsError : interactionStore.selfItemsError))

const selectedItem = computed<InteractionItem | null>(() => items.value.find(item => item.itemId === selectedItemId.value) || null)

/** 可点选的地块：未解锁与主人占用的地块后端会拒绝，这里不显示以免误导。 */
const landOptions = computed(() => {
  const list = Array.isArray(props.lands) ? props.lands : []
  return list
    .filter((land: any) => land?.unlocked && !land?.occupiedByMaster)
    .map((land: any) => ({
      id: String(land?.id ?? ''),
      label: land?.plantName || land?.phaseName || `地块 ${land?.id ?? ''}`,
      hasPlant: Boolean(land?.plantName || land?.plantImage || land?.status),
    }))
    .filter((land: any) => land.id !== '')
})

const selectedCount = computed(() => selectedLandIds.value.size)

const maxCount = computed(() => Math.max(0, Number(selectedItem.value?.count) || 0))

function selectItem(item: InteractionItem) {
  selectedItemId.value = item.itemId
  selectedLandIds.value.clear()
  results.value = []
  resultMessage.value = ''
}

function toggleLand(landId: string) {
  if (selectedLandIds.value.has(landId))
    selectedLandIds.value.delete(landId)
  else
    selectedLandIds.value.add(landId)
}

function selectAllLands() {
  const limit = maxCount.value > 0 ? maxCount.value : landOptions.value.length
  selectedLandIds.value.clear()
  for (const land of landOptions.value.slice(0, limit))
    selectedLandIds.value.add(land.id)
}

function clearLands() {
  selectedLandIds.value.clear()
}

function openConfirm() {
  const item = selectedItem.value
  if (!item)
    return
  if (item.targetKind === 'farm') {
    confirm.value = {
      show: true,
      itemName: item.name,
      count: 1,
      mode: 'farm',
      itemId: item.itemId,
    }
    return
  }
  if (selectedLandIds.value.size === 0) {
    toastStore.warning('请先选择要使用的地块')
    return
  }
  confirm.value = {
    show: true,
    itemName: item.name,
    count: selectedLandIds.value.size,
    mode: 'land',
    itemId: item.itemId,
  }
}

async function execute() {
  const item = selectedItem.value
  if (!item || !props.accountId) {
    confirm.value.show = false
    return
  }

  try {
    const landIds = Array.from(selectedLandIds.value)
    let data = null
    if (isFriendMode.value) {
      data = confirm.value.mode === 'farm'
        ? await interactionStore.useFriendFarmItem(props.accountId, props.gid, item.itemId)
        : await interactionStore.useFriendLandBatch(props.accountId, props.gid, item.itemId, landIds)
    }
    else {
      data = await interactionStore.useSelfLandBatch(props.accountId, item.itemId, landIds)
    }

    results.value = Array.isArray(data?.results) ? data.results : []
    resultMessage.value = String(data?.message || '')
    const successCount = Number(data?.successCount) || 0
    if (successCount > 0)
      toastStore.success(resultMessage.value || `已使用 ${successCount} 个${item.name}`)
    else
      toastStore.error(resultMessage.value || `${item.name} 未能成功使用`)

    selectedLandIds.value.clear()
    // 使用后库存与地块都会变化，通知父级刷新土地快照。
    emit('used')
  }
  catch (error: any) {
    toastStore.error(String(error?.response?.data?.error || error?.message || '使用失败'))
  }
  finally {
    confirm.value.show = false
  }
}

async function refresh() {
  if (!props.accountId)
    return
  if (isFriendMode.value)
    await interactionStore.fetchFriendItems(props.accountId)
  else
    await interactionStore.fetchSelfItems(props.accountId)
}

watch(expanded, (value) => {
  if (value && items.value.length === 0 && !loading.value)
    refresh()
})

watch(() => props.accountId, (value) => {
  selectedItemId.value = ''
  selectedLandIds.value.clear()
  results.value = []
  if (value && expanded.value)
    refresh()
})

watch(() => props.gid, () => {
  selectedItemId.value = ''
  selectedLandIds.value.clear()
  results.value = []
})

if (props.defaultExpanded)
  refresh()
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white dark:border-gray-700 dark:bg-gray-800">
    <button
      class="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-2 text-sm text-gray-700 font-medium dark:text-gray-200">
        <span class="i-carbon-magic-wand text-base text-amber-500" />
        互动道具
        <span v-if="items.length" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          {{ items.length }}
        </span>
      </span>
      <span class="flex items-center gap-2 text-xs text-gray-400">
        <span v-if="loading" class="i-svg-spinners-90-ring-with-bg" />
        <span class="i-carbon-chevron-down transition" :class="expanded ? 'rotate-180' : ''" />
      </span>
    </button>

    <div v-if="expanded" class="border-t border-gray-100 p-4 dark:border-gray-700">
      <div v-if="loading" class="flex justify-center py-6">
        <span class="i-svg-spinners-90-ring-with-bg text-2xl text-blue-500" />
      </div>

      <div v-else-if="loadError" class="flex flex-col items-center gap-2 py-4 text-center text-sm text-red-500">
        <span>{{ loadError }}</span>
        <button class="rounded bg-gray-100 px-3 py-1.5 text-xs text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600" @click="refresh">
          重试
        </button>
      </div>

      <div v-else-if="items.length === 0" class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {{ isFriendMode ? '背包中暂无可用于好友农场的互动道具' : '背包中暂无可对自己农场使用的互动道具' }}
      </div>

      <template v-else>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="item in items"
            :key="item.itemId"
            class="flex items-center gap-2 border rounded-lg px-2.5 py-2 text-left transition"
            :class="selectedItemId === item.itemId
              ? 'border-amber-500 bg-amber-50 dark:border-amber-500 dark:bg-amber-900/20'
              : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700/40 hover:border-amber-300 dark:hover:border-amber-600'"
            @click="selectItem(item)"
          >
            <img v-if="item.image" :src="item.image" :alt="item.name" class="h-8 w-8 object-contain" loading="lazy">
            <span v-else class="h-8 w-8 flex items-center justify-center rounded bg-gray-100 text-xs text-gray-400 dark:bg-gray-600">
              {{ item.name.slice(0, 1) }}
            </span>
            <span class="min-w-0">
              <span class="block max-w-36 truncate text-sm text-gray-700 dark:text-gray-200">{{ item.name }}</span>
              <span class="block text-xs text-gray-400">
                ×{{ item.count }}
                <span v-if="item.targetKind === 'farm'"> · 整场</span>
                <span v-else> · 选地块</span>
              </span>
            </span>
          </button>
        </div>

        <div v-if="selectedItem" class="mt-3 border-t border-gray-100 pt-3 space-y-3 dark:border-gray-700">
          <p v-if="selectedItem.description" class="text-xs text-gray-500 dark:text-gray-400">
            {{ selectedItem.description }}
          </p>

          <template v-if="selectedItem.targetKind === 'land'">
            <div class="flex flex-wrap items-center gap-2">
              <button class="rounded bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600" @click="selectAllLands">
                全选地貌
              </button>
              <button class="rounded bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600" @click="clearLands">
                清空
              </button>
              <span class="text-xs text-gray-400">已选 {{ selectedCount }} / 库存 {{ maxCount }}</span>
            </div>

            <div v-if="landOptions.length === 0" class="text-xs text-gray-400">
              暂无可选地块，请先展开该农场的地块数据。
            </div>
            <div v-else class="flex flex-wrap gap-1.5">
              <button
                v-for="land in landOptions"
                :key="land.id"
                class="border rounded px-2 py-1 text-xs transition"
                :class="selectedLandIds.has(land.id)
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-300 hover:border-amber-400'"
                :title="land.label"
                @click="toggleLand(land.id)"
              >
                #{{ land.id }}
              </button>
            </div>
          </template>

          <div class="flex items-center gap-2">
            <button
              class="rounded bg-amber-500 px-3 py-2 text-sm text-white transition dark:bg-amber-600 hover:bg-amber-600 disabled:opacity-50 dark:hover:bg-amber-700"
              :disabled="interactionStore.submitting || (selectedItem.targetKind === 'land' && selectedCount === 0)"
              @click="openConfirm"
            >
              {{ interactionStore.submitting ? '提交中…' : selectedItem.targetKind === 'farm' ? '使用到该农场' : `使用到 ${selectedCount} 块地` }}
            </button>
            <button
              class="rounded bg-gray-100 px-3 py-2 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600"
              @click="refresh"
            >
              刷新库存
            </button>
          </div>
        </div>

        <div v-if="results.length > 0" class="mt-3 border-t border-gray-100 pt-3 space-y-1 dark:border-gray-700">
          <p v-if="resultMessage" class="text-xs text-gray-500 dark:text-gray-400">
            {{ resultMessage }}
          </p>
          <p
            v-for="(result, index) in results"
            :key="`${result.landId}-${index}`"
            class="text-xs"
            :class="result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'"
          >
            {{ result.landId ? `#${result.landId} ` : '' }}{{ result.message }}
          </p>
        </div>
      </template>
    </div>

    <ConfirmModal
      :show="confirm.show"
      title="确认使用互动道具"
      :message="confirm.mode === 'farm'
        ? `确定对${isFriendMode ? '该好友的农场' : '自己的农场'}使用 1 个${confirm.itemName}？`
        : `确定对选中的 ${confirm.count} 块地依次使用${confirm.itemName}？\n每块地消耗 1 个，失败地块会被跳过。`"
      type="primary"
      :loading="interactionStore.submitting"
      confirm-text="确认使用"
      @confirm="execute"
      @close="confirm.show = false"
      @cancel="confirm.show = false"
    />
  </div>
</template>
