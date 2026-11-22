<script setup lang="ts">
import type { RanchFacility } from '@/utils/ranch'
import type { RuntimeLogEntry } from '@/utils/runtime-log'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import RanchCareerPanel from '@/components/ranch/RanchCareerPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useStatusStore } from '@/stores/status'
import { formatQuantity, formatSeconds, RANCH_BUCKET_IDS } from '@/utils/ranch'
import { normalizeRuntimeLog } from '@/utils/runtime-log'

/**
 * 牧场总览。
 *
 * 牧场在协议上是独立的 game_scene_id=2：等级、经验、货币、罐头桶和栏舍全部来自
 * GET /api/ranch 的基础快照，与农场 Dashboard 依赖的 status 字段没有交集，
 * 因此这里不复用农场那套卡片。
 *
 * 也不套 RanchSceneHost：那个壳自带标题栏和一条合并的资源条，而总览页本身就要把
 * 货币和库存拆成两张卡，套上去同一批数值会重复出现。但场景约定照旧——每次读快照
 * 都要临时切场景，所以不做定时轮询，只在挂载、页面重新可见和切账号时拉取。
 */
const accountStore = useAccountStore()
const ranchStore = useRanchStore()
const statusStore = useStatusStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { state, loading, loaded, error } = storeToRefs(ranchStore)
const { logs: statusLogs } = storeToRefs(statusStore)

/** 后端 snapshot 的 currencies 固定为 [1007 金券, 1002 点券, 1005 金豆豆, 1008 松果, 7002 便便]。 */
const ASSET_ITEM_IDS = [1007, 1002, 1005, 1008]
const GRASS_ITEM_ID = 7001
const MANURE_ITEM_ID = 7002
const LOG_LIMIT = 30

const unlocked = computed(() => state.value?.unlocked === true)
const resources = computed(() => state.value?.resources || [])
const facilities = computed(() => state.value?.facilities || [])
const ranches = computed(() => facilities.value.filter((facility: RanchFacility) => facility.isRanch))
const grassMachines = computed(() => facilities.value.filter((facility: RanchFacility) => facility.isGrassMachine))
const pendingOperations = computed(() => state.value?.pending || [])

const displayName = computed(() => {
  const account = currentAccount.value
  return account?.nick || account?.name || '未命名牧场'
})

const avatarUrl = computed(() => String(currentAccount.value?.avatarUrl || currentAccount.value?.avatar || ''))

/** 等级经验：neededExp 为 null 表示配置表里没有下一级，此时不能拿 0 当分母显示 0%。 */
const expInfo = computed(() => {
  const snapshot = state.value
  if (!snapshot)
    return { percent: 0, current: '—', needed: '—', remain: '', capped: false }
  if (snapshot.neededExp === null)
    return { percent: 100, current: formatQuantity(snapshot.currentExp), needed: '—', remain: '已达当前最高等级', capped: true }
  return {
    percent: snapshot.progressPercent,
    current: formatQuantity(snapshot.currentExp),
    needed: formatQuantity(snapshot.neededExp),
    remain: `距 Lv.${snapshot.level + 1} 还需 ${formatQuantity(expRemain(snapshot.currentExp, snapshot.neededExp))} 经验`,
    capped: false,
  }
})

/** 经验是十进制字符串，直接相减，避免超过 2^53 后失真。 */
function expRemain(current: string, needed: string) {
  try {
    const remain = BigInt(needed) - BigInt(current)
    return remain > 0n ? remain.toString() : '0'
  }
  catch {
    return '0'
  }
}

const assets = computed(() =>
  resources.value.filter(resource => ASSET_ITEM_IDS.includes(resource.itemId)),
)

function findResource(itemId: number) {
  return resources.value.find(resource => resource.itemId === itemId) || null
}

const grassResource = computed(() => findResource(GRASS_ITEM_ID))
const manureResource = computed(() => findResource(MANURE_ITEM_ID))
const normalBucket = computed(() => findResource(RANCH_BUCKET_IDS.normal))
const organicBucket = computed(() => findResource(RANCH_BUCKET_IDS.organic))

/** 栏舍动物总数：只有 isRanch 设施带 ranch 段，牧草机不计入。 */
const animalTotals = computed(() => {
  return ranches.value.reduce((totals, facility) => {
    totals.count += facility.ranch?.count || 0
    totals.capacity += facility.ranch?.capacity || 0
    return totals
  }, { count: 0, capacity: 0 })
})

/**
 * 待处理统计只累加后端已给出的布尔判据：
 * harvestReady / needProduce / hazardCount 来自设施摘要；
 * 可喂养按动物动作位的 enabled 统计，它已经把「罐头桶是否为空」算进去了，
 * 因此不会出现「显示可喂养但点了必然失败」的情况。
 */
const todo = computed(() => {
  let harvest = 0
  let produce = 0
  let feed = 0
  let hazard = 0
  for (const facility of ranches.value) {
    harvest += facility.summary.harvestReady
    produce += facility.summary.needProduce
    hazard += facility.summary.hazardCount
    for (const animal of facility.ranch?.animals || []) {
      if (animal.actions.some(action => action.action === 'feed' && action.enabled))
        feed += 1
    }
  }
  return { harvest, produce, feed, hazard }
})

const hasTodo = computed(() => todo.value.harvest + todo.value.produce + todo.value.feed + todo.value.hazard > 0)

/**
 * 牧场日志的统一判据是 event 前缀 `ranch_`。
 * 后端 automation.ts 写 module: 'ranch'，而 daily.ts 写的是 module: 'task'，
 * 只按 module 过滤会漏掉任务领取和每日分享这几条，因此两者取并集。
 */
function isRanchLog(log: RuntimeLogEntry) {
  return log.module === 'ranch' || log.event.startsWith('ranch_')
}

/** 牧场自动化写运行日志时带 result 位，这里直接折成徽标，模板不再重复算三次。 */
function logBadge(log: RuntimeLogEntry) {
  const result = String(log.meta?.result || '')
  if (result === 'ok')
    return { text: '完成', class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' }
  if (result === 'skipped')
    return { text: '跳过', class: 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300' }
  if (result === 'error')
    return { text: '失败', class: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
  return null
}

const ranchLogs = computed(() => {
  return (statusLogs.value || [])
    .map((log: any) => normalizeRuntimeLog(log))
    .filter(isRanchLog)
    .slice(-LOG_LIMIT)
    .map(log => ({ log, badge: logBadge(log) }))
})

function refresh() {
  if (!currentAccountId.value)
    return
  // overview 视图在基础快照之外多带一份牧场生涯统计；animals / facilities 两段本来就在
  // 基础快照里，所以总览要的字段一个不少，不必再多读一次设施分区。
  void ranchStore.fetchView(currentAccountId.value, 'overview')
}

async function loadLogs() {
  if (!currentAccountId.value)
    return
  await statusStore.fetchLogs(currentAccountId.value, { limit: 200 })
}

function refreshAll() {
  refresh()
  loadLogs()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible')
    refreshAll()
}

function assetIcon(resource: { itemId: number }) {
  const icons: Record<number, string> = {
    1002: 'i-carbon-ticket',
    1005: 'i-carbon-currency-yen',
    1007: 'i-carbon-ticket',
    1008: 'i-carbon-tree',
  }
  return icons[resource.itemId] || 'i-carbon-circle-dash'
}

function facilityFillPercent(facility: RanchFacility) {
  const capacity = facility.ranch?.capacity || 0
  const count = facility.ranch?.count || 0
  if (!capacity)
    return 0
  return Math.min(100, Math.max(0, count / capacity * 100))
}

function grassFillPercent(facility: RanchFacility) {
  const capacity = Number(facility.capacity) || 0
  const count = Number(facility.feed?.count ?? 0) || 0
  if (!capacity)
    return 0
  return Math.min(100, Math.max(0, count / capacity * 100))
}

function formatLogTime(log: RuntimeLogEntry) {
  if (!log.time)
    return ''
  const parts = log.time.split(' ')
  return parts.length > 1 ? parts[1] : log.time
}

function logRowClass(log: RuntimeLogEntry) {
  if (log.level === 'error')
    return 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20'
  if (log.level === 'warn')
    return 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
  return 'border-transparent hover:bg-white/55 dark:hover:bg-gray-800/45'
}

// 切账号后旧快照属于上一个牧场，先清空再重读，避免把 A 的等级和库存留在 B 的页面上。
watch(currentAccountId, (newId, oldId) => {
  if (oldId === undefined || newId === oldId)
    return
  ranchStore.clearRanchData()
  refreshAll()
})

onMounted(() => {
  refreshAll()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="flex flex-col gap-5 pt-1 md:h-full md:min-h-0 md:overflow-hidden md:pt-2">
    <div v-if="!currentAccountId" class="ui-card min-h-40 flex flex-col items-center justify-center gap-2 rounded-lg p-6 text-center">
      <div class="i-carbon-user-avatar text-3xl text-gray-300" />
      <div class="text-sm text-gray-600 font-medium dark:text-gray-300">
        请先选择账号
      </div>
      <div class="text-xs text-gray-400">
        选择账号后会读取牧场快照，显示等级、资产、库存和栏舍状态。
      </div>
    </div>

    <div v-else-if="loading && !loaded" class="ui-card min-h-40 flex flex-col items-center justify-center gap-2 rounded-lg p-6 text-center">
      <div class="i-carbon-renew animate-spin text-3xl text-gray-300" />
      <div class="text-sm text-gray-500">
        正在进入牧场场景读取总览…
      </div>
    </div>

    <div v-else-if="error && !loaded" class="ui-card min-h-40 flex flex-col items-center justify-center gap-2 rounded-lg p-6 text-center">
      <div class="i-carbon-warning-alt text-3xl text-red-400" />
      <div class="text-sm text-red-600 dark:text-red-400">
        {{ error }}
      </div>
      <BaseButton variant="secondary" size="sm" @click="refreshAll">
        重新读取
      </BaseButton>
    </div>

    <div v-else-if="loaded && !unlocked" class="ui-card min-h-40 flex flex-col items-center justify-center gap-2 rounded-lg p-6 text-center">
      <div class="i-carbon-locked text-3xl text-amber-400" />
      <div class="text-sm text-amber-700 dark:text-amber-300">
        {{ state?.reason || '牧场尚未解锁，请先在游戏中完成开启条件。' }}
      </div>
    </div>

    <div v-else-if="!loaded" class="ui-card min-h-40 flex flex-col items-center justify-center gap-2 rounded-lg p-6 text-center">
      <div class="i-carbon-document-blank text-3xl text-gray-300" />
      <div class="text-sm text-gray-500">
        暂无牧场数据，点击刷新重新读取。
      </div>
      <BaseButton variant="secondary" size="sm" @click="refreshAll">
        读取牧场
      </BaseButton>
    </div>

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <div class="i-carbon-wheat" />
            牧场 Lv.{{ state?.level ?? 0 }}
          </span>
          <span class="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <div class="i-carbon-store" />
            栏舍 {{ animalTotals.count }} / {{ animalTotals.capacity }}
          </span>
          <span v-if="pendingOperations.length" class="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <div class="i-carbon-warning-alt" />
            {{ pendingOperations.length }} 笔待核对
          </span>
          <span v-if="loading" class="flex items-center gap-1 text-gray-400">
            <div class="i-carbon-renew animate-spin" />
            读取中
          </span>
        </div>
        <BaseButton variant="secondary" size="sm" :loading="loading" @click="refreshAll">
          <div class="i-carbon-renew mr-1" />
          刷新
        </BaseButton>
      </div>

      <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ error }}
      </div>

      <div
        v-if="pendingOperations.length"
        class="border border-amber-200 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-700 leading-5 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300"
      >
        有 {{ pendingOperations.length }} 笔操作结果待核对，后端会继续预留对应资源并拒绝同类操作。请到「个人 → 设施」确认后再解除保护。
      </div>

      <div class="grid grid-cols-1 shrink-0 gap-4 lg:grid-cols-3 sm:grid-cols-2">
        <div class="ui-card metric-card min-h-[168px] flex flex-col rounded-lg p-5">
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <div class="h-9 w-9 shrink-0 overflow-hidden border border-gray-200 rounded-full dark:border-gray-700">
                <img v-if="avatarUrl" :src="avatarUrl" :alt="displayName" class="h-full w-full object-cover">
                <div v-else class="h-full w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                  <div class="i-carbon-user-avatar text-lg text-gray-400" />
                </div>
              </div>
              <div class="min-w-0">
                <div class="truncate text-base font-bold" :title="displayName">
                  {{ displayName }}
                </div>
                <div class="flex items-center gap-1 text-xs text-gray-400">
                  <div class="h-1.5 w-1.5 rounded-full bg-green-500" />
                  牧场 Lv.{{ state?.level ?? 0 }}
                </div>
              </div>
            </div>
            <div class="shrink-0 rounded-lg bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              孵养 {{ animalTotals.count }}/{{ animalTotals.capacity }}
            </div>
          </div>

          <div class="mt-auto">
            <div class="mb-1 flex justify-between text-xs text-gray-500">
              <div class="flex items-center gap-1">
                <div class="i-carbon-growth text-emerald-500" />
                <span>牧场经验</span>
              </div>
              <span>{{ expInfo.current }} / {{ expInfo.needed }}<span v-if="!expInfo.capped"> · {{ expInfo.percent }}%</span></span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div
                class="h-full rounded-full bg-emerald-500 transition-all duration-500"
                :style="{ width: `${expInfo.percent}%` }"
              />
            </div>
            <div class="mt-2 truncate text-xs text-gray-400" :title="expInfo.remain">
              {{ expInfo.remain }}
            </div>
          </div>
        </div>

        <div class="ui-card metric-card min-h-[168px] flex flex-col justify-between rounded-lg p-5">
          <div class="mb-2 flex items-center gap-1.5 text-sm text-gray-500">
            <div class="i-carbon-wallet" />
            资产
          </div>
          <div v-if="!assets.length" class="flex flex-1 items-center justify-center text-xs text-gray-400">
            牧场未下发货币余额
          </div>
          <div v-else class="grid grid-cols-2 gap-3">
            <div v-for="asset in assets" :key="asset.key" class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500">
                <img v-if="asset.image" :src="asset.image" :alt="asset.label" class="h-5 w-5 shrink-0 object-contain">
                <div v-else class="shrink-0 text-base text-amber-500" :class="[assetIcon(asset)]" />
                <span class="truncate">{{ asset.label }}</span>
              </div>
              <div class="truncate text-xl text-amber-600 font-bold dark:text-amber-400" :title="asset.value">
                {{ asset.value }}
              </div>
              <div v-if="asset.locked && asset.locked !== '0'" class="truncate text-[10px] text-gray-400">
                锁定 {{ formatQuantity(asset.locked) }}
              </div>
            </div>
          </div>
        </div>

        <div class="ui-card metric-card min-h-[168px] flex flex-col justify-between rounded-lg p-5">
          <div class="mb-2 flex items-center gap-1.5 text-sm text-gray-500">
            <div class="i-carbon-inventory-management" />
            牧场库存
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500">
                <div class="i-carbon-wheat shrink-0 text-base text-lime-500" />
                牧草
              </div>
              <div class="truncate text-xl font-bold" :title="grassResource?.value ?? '—'">
                {{ grassResource?.value ?? '—' }}
              </div>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500">
                <div class="i-carbon-renew shrink-0 text-base text-amber-600" />
                便便
              </div>
              <div class="truncate text-xl font-bold" :title="manureResource?.value ?? '—'">
                {{ manureResource?.value ?? '—' }}
              </div>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500">
                <div class="i-carbon-container-software shrink-0 text-base text-blue-500" />
                普通罐头
              </div>
              <div class="truncate text-sm font-bold" :title="normalBucket?.value ?? '—'">
                {{ normalBucket?.value ?? '—' }}
              </div>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500">
                <div class="i-carbon-container-software shrink-0 text-base text-emerald-500" />
                有机罐头
              </div>
              <div class="truncate text-sm font-bold" :title="organicBucket?.value ?? '—'">
                {{ organicBucket?.value ?? '—' }}
              </div>
            </div>
            <!-- 沙漏只在服务端下发了该项时才出现：未下发与「确实是 0 秒」不是一回事。 -->
            <div v-if="state.hourglassSeconds !== null" class="min-w-0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500">
                <div class="i-carbon-hourglass shrink-0 text-base text-purple-500" />
                沙漏
              </div>
              <div class="truncate text-sm font-bold" :title="formatSeconds(state.hourglassSeconds)">
                {{ formatSeconds(state.hourglassSeconds) }}
              </div>
            </div>
          </div>
        </div>

        <!-- 生涯是四张卡里唯一带列表的，占满整行才不会把产物名挤成省略号。 -->
        <div v-if="state.career" class="lg:col-span-3 sm:col-span-2">
          <RanchCareerPanel :career="state.career" />
        </div>
      </div>

      <div class="flex flex-1 flex-col items-stretch gap-5 md:min-h-0 md:flex-row">
        <div class="flex flex-1 flex-col gap-5 md:min-h-0 md:w-3/4">
          <div class="ui-card-elevated flex flex-1 flex-col rounded-lg p-3 md:min-h-0 md:overflow-hidden sm:p-5">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 class="flex items-center gap-2 text-lg font-medium">
                <div class="i-carbon-document" />
                <span>牧场日志</span>
                <span class="text-xs text-gray-400 font-normal">{{ ranchLogs.length }} 条</span>
              </h3>
              <BaseButton variant="secondary" size="sm" :loading="loading" @click="loadLogs">
                <div class="i-carbon-renew mr-1" />
                刷新
              </BaseButton>
            </div>

            <div class="ui-subtle-panel relative max-h-[50vh] min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-lg p-1.5 text-sm md:max-h-none sm:p-2">
              <div v-if="!ranchLogs.length" class="py-8 text-center">
                <div class="i-carbon-document-blank mx-auto mb-3 text-3xl text-gray-300" />
                <div class="text-sm text-gray-500 dark:text-gray-400">
                  暂无牧场日志
                </div>
                <div class="mt-1 text-xs text-gray-400">
                  牧场自动化执行巡查、购买、投喂和交友动作后，会在这里追加记录。
                </div>
              </div>
              <div
                v-for="entry in ranchLogs"
                :key="entry.log.id"
                class="grid grid-cols-1 mb-0.5 gap-x-2 gap-y-1 border rounded-md px-2.5 py-1.5 transition-colors sm:grid-cols-[auto_1fr] sm:gap-y-0"
                :class="logRowClass(entry.log)"
              >
                <span class="select-none whitespace-nowrap pt-0.5 text-xs text-gray-400 font-mono">{{ formatLogTime(entry.log) }}</span>
                <div class="min-w-0 flex flex-wrap items-start gap-1">
                  <span
                    v-if="entry.badge"
                    class="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold"
                    :class="entry.badge.class"
                  >
                    {{ entry.badge.text }}
                  </span>
                  <span class="min-w-0 break-words leading-5" :class="entry.log.level === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'">
                    {{ entry.log.msg }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-4 md:min-h-0 md:w-1/4 md:overflow-hidden">
          <div class="ui-card flex shrink-0 flex-col rounded-lg p-3.5">
            <h3 class="mb-3 flex items-center gap-2 text-base font-medium 2xl:text-lg">
              <div class="i-carbon-task-complete" />
              <span>待处理</span>
            </h3>
            <div v-if="!hasTodo" class="ui-subtle-panel flex flex-col items-center justify-center gap-1 rounded-lg p-4 text-center">
              <div class="i-carbon-checkmark-filled text-2xl text-emerald-400" />
              <div class="text-xs text-gray-500 dark:text-gray-400">
                暂无待处理事项
              </div>
            </div>
            <div v-else class="grid grid-cols-2 gap-2">
              <div class="ui-subtle-panel min-w-0 flex items-center justify-between rounded-lg px-2 py-1.5">
                <div class="min-w-0 flex items-center gap-1.5">
                  <div class="i-carbon-crop-growth shrink-0 text-base text-emerald-500" />
                  <span class="truncate text-xs text-gray-500">可收获</span>
                </div>
                <span class="text-sm font-bold">{{ todo.harvest }}</span>
              </div>
              <div class="ui-subtle-panel min-w-0 flex items-center justify-between rounded-lg px-2 py-1.5">
                <div class="min-w-0 flex items-center gap-1.5">
                  <div class="i-carbon-arrow-up-right shrink-0 text-base text-blue-500" />
                  <span class="truncate text-xs text-gray-500">可生产</span>
                </div>
                <span class="text-sm font-bold">{{ todo.produce }}</span>
              </div>
              <div class="ui-subtle-panel min-w-0 flex items-center justify-between rounded-lg px-2 py-1.5">
                <div class="min-w-0 flex items-center gap-1.5">
                  <div class="i-carbon-flash shrink-0 text-base text-amber-500" />
                  <span class="truncate text-xs text-gray-500">可喂养</span>
                </div>
                <span class="text-sm font-bold">{{ todo.feed }}</span>
              </div>
              <div class="ui-subtle-panel min-w-0 flex items-center justify-between rounded-lg px-2 py-1.5">
                <div class="min-w-0 flex items-center gap-1.5">
                  <div class="i-carbon-clean shrink-0 text-base text-red-400" />
                  <span class="truncate text-xs text-gray-500">待清理</span>
                </div>
                <span class="text-sm font-bold">{{ todo.hazard }}</span>
              </div>
            </div>
          </div>

          <div class="ui-card min-h-0 flex flex-1 flex-col overflow-hidden rounded-lg p-4">
            <h3 class="mb-3 flex items-center gap-2 text-base font-medium 2xl:text-lg">
              <div class="i-carbon-building" />
              <span>牧场设施</span>
            </h3>
            <div v-if="!ranches.length && !grassMachines.length" class="ui-subtle-panel flex flex-col items-center justify-center gap-2 rounded-lg p-5 text-center">
              <div class="i-carbon-building text-3xl text-gray-300" />
              <div class="text-sm text-gray-600 font-medium dark:text-gray-300">
                暂未读取到设施
              </div>
              <div class="text-xs text-gray-400">
                到「个人 → 设施」可查看升级与投喂详情。
              </div>
            </div>
            <div v-else class="min-h-0 flex-1 overflow-y-auto space-y-2">
              <div
                v-for="facility in ranches"
                :key="facility.id"
                class="ui-subtle-panel rounded-lg px-2.5 py-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-xs text-gray-600 font-medium dark:text-gray-300">{{ facility.name }}</span>
                  <span class="shrink-0 text-xs text-gray-400">Lv.{{ facility.level }}</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2">
                  <span class="text-sm font-bold">{{ facility.ranch?.count ?? 0 }} / {{ facility.ranch?.capacity ?? 0 }}</span>
                  <span v-if="facility.summary.hazardCount" class="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 dark:bg-red-950/40 dark:text-red-300">
                    {{ facility.summary.hazardCount }} 待清理
                  </span>
                </div>
                <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${facilityFillPercent(facility)}%` }" />
                </div>
              </div>

              <div
                v-for="facility in grassMachines"
                :key="facility.id"
                class="ui-subtle-panel rounded-lg px-2.5 py-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-xs text-gray-600 font-medium dark:text-gray-300">{{ facility.name }}</span>
                  <span class="shrink-0 text-xs text-gray-400">Lv.{{ facility.level }}</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2">
                  <span class="text-sm font-bold">{{ formatQuantity(facility.feed?.count) }} / {{ formatQuantity(facility.capacity) }}</span>
                  <span class="shrink-0 text-[10px] text-gray-400">{{ formatSeconds(facility.feed?.remainingSec) }}</span>
                </div>
                <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div class="h-full rounded-full bg-lime-500" :style="{ width: `${grassFillPercent(facility)}%` }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
