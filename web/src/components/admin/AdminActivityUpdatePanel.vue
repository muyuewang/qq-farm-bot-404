<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useToastStore } from '@/stores/toast'

interface ActivityUpdateReport {
  scannedAt: number
  appId: string
  status: 'unavailable' | 'update-found' | 'up-to-date'
  source: null | { version: string, modifiedAt: number, wasmSize: number }
  candidateCount: number
  incompleteCandidates: Array<{ version: string, missing: string[] }>
  detectedActivityIds: number[]
  unknownActivityIds: number[]
  caches: Array<{ cacheListModifiedAt: number, bundles: string[] }>
  warnings: string[]
  localScanEnabled?: boolean
  sourceChanged?: boolean
  previousSourceVersion?: string | null
  analysis?: {
    candidateGroups: Array<{ date: string, ids: number[] }>
    requiresProtocolSample: boolean
    safeToAutoApply: boolean
    summary: string
  }
  online?: {
    available: boolean
    accountName?: string
    scannedAt?: number
    error?: string
    activities: Array<{
      id: number
      parentId?: number
      title: string
      type?: number
      status?: number
      startTime?: number
      endTime?: number
      visible?: boolean
      enabled?: boolean
      sort?: number
    }>
    groups: Array<{
      id: number
      parentId?: number
      title?: string
      type?: number
      status?: number
      startTime?: number
      endTime?: number
      visible?: boolean
      enabled?: boolean
      features?: ActivityFeatures
      children?: ActivityGroup[]
      payload?: Record<string, unknown> | null
      error?: string
    } & ActivityGroup>
    unknownActivityIds: number[]
    probes?: { attempted: number, matched: number, activityGroups?: number }
  } | null
  localEvidence?: {
    enabled: boolean
    unknownActivityIds: number[]
    detectedActivityIds: number[]
    source: null | { version: string, modifiedAt: number, wasmSize: number }
    caches: Array<{ cacheListModifiedAt: number, bundles: string[] }>
    warnings: string[]
  }
}

interface ActivityFeatures {
  randomShop?: boolean
  exchangeShop?: boolean
  draw?: boolean
  starRecord?: boolean
  qixiBridge?: boolean
  qixiGift?: boolean
  weatherTasks?: boolean
  weatherResearch?: boolean
}

interface ActivityGroup {
  id: number
  parentId?: number
  title?: string
  type?: number
  status?: number
  startTime?: number
  endTime?: number
  visible?: boolean
  enabled?: boolean
  sort?: number
  features?: ActivityFeatures
  children?: ActivityGroup[]
  payload?: Record<string, unknown> | null
  error?: string
}

const toast = useToastStore()
const loading = ref(false)
const report = ref<ActivityUpdateReport | null>(null)
const error = ref('')
const intervalMs = ref(0)
const nextScanAt = ref(0)
const activityStatusFilter = ref<'all' | 'active' | 'upcoming' | 'ended' | 'disabled' | 'unknown'>('all')
const selectedActivityId = ref<number | null>(null)

const discoveredGroups = computed(() => report.value?.online?.groups || [])
const unknownActivityIds = computed(() => new Set(report.value?.online?.unknownActivityIds || []))

const allActivityGroups = computed(() => {
  const nodes = (report.value?.online?.activities || []).map(item => ({ ...item, children: [] as ActivityGroup[] }))
  const byId = new Map(nodes.map(item => [Number(item.id), item]))
  const roots: ActivityGroup[] = []
  for (const node of nodes) {
    const parent = byId.get(Number(node.parentId))
    if (parent)
      parent.children?.push(node)
    else
      roots.push(node)
  }
  for (const node of nodes)
    node.children?.sort((left, right) => Number(left.sort || 0) - Number(right.sort || 0) || left.id - right.id)
  return roots.sort((left, right) => {
    const leftDate = Number(left.startTime || left.endTime || 0)
    const rightDate = Number(right.startTime || right.endTime || 0)
    return rightDate - leftDate || right.id - left.id
  })
})

type ActivityLifecycleStatus = 'active' | 'upcoming' | 'ended' | 'disabled' | 'unknown'

function activityLifecycleStatus(group: ActivityGroup): ActivityLifecycleStatus {
  const now = Date.now() / 1000
  if (!group.startTime && !group.endTime)
    return 'unknown'
  if (group.startTime && now < group.startTime)
    return 'upcoming'
  if (group.endTime && now > group.endTime)
    return 'ended'
  if (!flattenGroup(group).some(node => node.enabled !== false))
    return 'disabled'
  return 'active'
}

const activityStatusFilters: Array<{ key: typeof activityStatusFilter.value, label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'upcoming', label: '未开始' },
  { key: 'ended', label: '已结束' },
  { key: 'disabled', label: '未启用' },
  { key: 'unknown', label: '时间未知' },
]

const filteredActivityGroups = computed(() => activityStatusFilter.value === 'all'
  ? allActivityGroups.value
  : allActivityGroups.value.filter(group => activityLifecycleStatus(group) === activityStatusFilter.value))
const selectedActivityGroup = computed(() => allActivityGroups.value.find(group => group.id === selectedActivityId.value) || null)

function lifecycleLabel(status: ActivityLifecycleStatus) {
  return {
    active: '进行中',
    upcoming: '未开始',
    ended: '已结束',
    disabled: '未启用',
    unknown: '时间未知',
  }[status]
}

function lifecycleClass(status: ActivityLifecycleStatus) {
  return {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    upcoming: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    ended: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    disabled: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    unknown: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  }[status]
}

function groupHasUnknownNode(group: ActivityGroup) {
  return flattenGroup(group).some(node => unknownActivityIds.value.has(node.id))
}

const statusLabel = computed(() => {
  if (!report.value)
    return '尚未扫描'
  if (report.value.status === 'update-found')
    return '发现候选更新'
  if (report.value.status === 'up-to-date')
    return '未发现未知活动'
  return '扫描环境不可用'
})

const statusClass = computed(() => {
  if (report.value?.status === 'update-found')
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  if (report.value?.status === 'up-to-date')
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
})

function formatTime(value?: number) {
  return value ? new Date(value).toLocaleString() : '—'
}

function formatActivityDate(value?: number) {
  if (!value)
    return '时间待服务端确认'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value * 1000))
}

function activityStatus(group: ActivityGroup) {
  const now = Date.now() / 1000
  if (group.startTime && now < group.startTime)
    return '未开始'
  if (group.endTime && now > group.endTime)
    return '已结束'
  if (group.enabled === false)
    return '未启用'
  return '进行中'
}

function flattenGroup(group: ActivityGroup): ActivityGroup[] {
  return [group, ...(group.children || []).flatMap(flattenGroup)]
}

function featureSummary(group: ActivityGroup) {
  const nodes = flattenGroup(group)
  const exchange = nodes.filter(node => node.features?.exchangeShop).length
  const randomShop = nodes.filter(node => node.features?.randomShop).length
  const draw = nodes.filter(node => node.features?.draw).length
  const starRecord = nodes.filter(node => node.features?.starRecord).length
  return { nodes: nodes.length, exchange, randomShop, draw, starRecord }
}

function contentSummary(group: ActivityGroup) {
  const summary = featureSummary(group)
  const parts = [`节点 ${summary.nodes}`]
  if (summary.exchange)
    parts.push(`兑换 ${summary.exchange}`)
  if (summary.randomShop)
    parts.push(`刷新店 ${summary.randomShop}`)
  if (summary.draw)
    parts.push(`抽奖 ${summary.draw}`)
  if (summary.starRecord)
    parts.push(`图鉴 ${summary.starRecord}`)
  return parts.join(' · ')
}

function plainActivityText(value: unknown) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim()
}

function activityRuleImage(value: unknown) {
  if (!value || typeof value !== 'object')
    return ''
  return plainActivityText((value as Record<string, unknown>).imageUrl)
}

function activityRuleSections(group: ActivityGroup) {
  return flattenGroup(group).flatMap((node) => {
    const payload = node.payload as Record<string, unknown> | null | undefined
    const tipsValue = payload && typeof payload === 'object'
      ? payload.tips
      : null
    if (!tipsValue || typeof tipsValue !== 'object')
      return []
    const tips = tipsValue as Record<string, unknown>
    const lines = Array.isArray(tips.txt)
      ? tips.txt
          .filter(value => typeof value === 'string' || typeof value === 'number')
          .map(plainActivityText)
          .filter(Boolean)
      : []
    const images = Array.isArray(tips.txt)
      ? tips.txt.map(activityRuleImage).filter(Boolean)
      : []
    if (!lines.length && !images.length)
      return []
    return [{
      id: node.id,
      title: plainActivityText(tips.title) || '活动说明',
      uid: plainActivityText(payload?.uid),
      lines,
      images,
    }]
  })
}

function activityNodeLabel(node: ActivityGroup) {
  if (node.features?.weatherTasks)
    return '活动任务'
  if (node.features?.weatherResearch)
    return '阶段研究'
  if (node.features?.qixiBridge)
    return '阶段建设'
  if (node.features?.qixiGift)
    return '好友赠礼'
  if (node.features?.exchangeShop)
    return '活动商店'
  if (node.features?.randomShop)
    return '随机商店'
  if (node.features?.draw)
    return '抽取或次数玩法'
  if (node.features?.starRecord)
    return '收集图鉴'
  return '关联功能'
}

function activityNodeDescription(node: ActivityGroup) {
  if (node.type === 15)
    return '包含 QiXiActivity 活动标识及完整玩法规则，是鹊羽获取、筑桥和奖励适配的主要入口。'
  if (node.type === 16)
    return '当前在线接口仅返回基础元数据；可能关联香囊赠礼或情谊记录，具体字段仍需活动开放后的协议样本确认。'
  return node.parentId ? '服务端活动树中的功能子节点。' : '活动组根节点，负责活动入口和起止时间。'
}

async function scanUpdates() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.post('/api/activity/update/scan')
    if (!data.ok)
      throw new Error(data.error || '活动更新扫描失败')
    report.value = data.report
    intervalMs.value = Number(data.intervalMs) || intervalMs.value
    nextScanAt.value = Number(data.nextScanAt) || nextScanAt.value
    if (data.report?.status === 'update-found')
      toast.warning(`发现 ${data.report.unknownActivityIds.length} 个候选活动 ID`)
    else
      toast.success('活动更新扫描完成')
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err.message || '活动更新扫描失败'
  }
  finally {
    loading.value = false
  }
}

async function loadUpdateStatus() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get('/api/activity/update/status')
    if (!data.ok)
      throw new Error(data.error || '读取活动更新状态失败')
    report.value = data.report || null
    intervalMs.value = Number(data.intervalMs) || 0
    nextScanAt.value = Number(data.nextScanAt) || 0
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err.message || '读取活动更新状态失败'
  }
  finally {
    loading.value = false
  }
}

onMounted(loadUpdateStatus)
</script>

<template>
  <section class="space-y-3">
    <div v-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      {{ error }}
    </div>

    <template v-if="report">
      <div class="flex flex-col gap-3 border border-gray-200 rounded-lg px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium" :class="statusClass">{{ statusLabel }}</span>
            <span class="text-sm text-gray-900 font-medium dark:text-white">
              {{ report.online?.accountName || '等待在线账号' }}
            </span>
            <span class="text-xs text-gray-500">{{ formatTime(report.online?.scannedAt || report.scannedAt) }}</span>
          </div>
          <p class="mt-1 truncate text-xs text-gray-500">
            {{ allActivityGroups.length }} 个活动 · {{ report.online?.activities.length || 0 }} 个节点 · 每 {{ Math.round(intervalMs / 60000) || 30 }} 分钟更新
          </p>
        </div>
        <BaseButton variant="primary" :loading="loading" @click="scanUpdates">
          <span class="i-carbon-search mr-2" />
          重新分析
        </BaseButton>
      </div>

      <div v-if="report.unknownActivityIds.length" class="flex flex-wrap items-center gap-2 border border-amber-200 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <span class="i-carbon-warning-alt shrink-0" />
        <strong>发现 {{ report.unknownActivityIds.length }} 个待适配节点</strong>
        <code v-for="id in report.unknownActivityIds" :key="id" class="rounded bg-white/70 px-1.5 py-0.5 text-xs dark:bg-gray-900/40">{{ id }}</code>
      </div>

      <ul v-if="report.warnings.length" class="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
        <li v-for="warning in report.warnings" :key="warning" class="flex gap-2">
          <span class="i-carbon-warning-alt mt-0.5 shrink-0" />{{ warning }}
        </li>
      </ul>

      <div v-if="!report.online?.available" class="border border-gray-200 rounded-lg border-dashed p-8 text-center dark:border-gray-700">
        <span class="i-carbon-unlink mx-auto text-3xl text-gray-300" />
        <p class="mt-2 text-sm text-gray-500">
          {{ report.online?.error || '启动并连接任意账号后，定时器会自动读取服务端活动列表。' }}
        </p>
      </div>

      <div v-else class="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div class="flex items-baseline gap-2">
              <h4 class="text-gray-900 font-semibold dark:text-white">
                全部活动
              </h4>
              <span class="text-xs text-gray-400">{{ allActivityGroups.length }} 个</span>
            </div>
            <p class="mt-0.5 text-xs text-gray-500">
              按开始日期倒序 · 点击卡片查看节点详情
            </p>
          </div>
          <div class="max-w-full inline-flex overflow-x-auto rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900" role="group" aria-label="活动状态筛选">
            <button
              v-for="filter in activityStatusFilters"
              :key="filter.key"
              class="shrink-0 rounded-md px-2.5 py-1 text-xs transition"
              :class="activityStatusFilter === filter.key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'"
              :aria-pressed="activityStatusFilter === filter.key"
              @click="activityStatusFilter = filter.key"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>
        <div v-if="filteredActivityGroups.length" class="grid mt-3 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="group in filteredActivityGroups"
            :key="group.id"
            class="dark:via-gray-850 relative overflow-hidden border rounded-lg from-white via-gray-50 to-slate-100 bg-gradient-to-br p-4 text-left shadow-sm transition dark:from-gray-800 dark:to-gray-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 hover:-translate-y-0.5"
            :class="[
              activityLifecycleStatus(group) === 'ended' && 'opacity-70',
              selectedActivityId === group.id ? 'border-cyan-500 ring-1 ring-cyan-500' : 'border-gray-200 dark:border-gray-700',
            ]"
            @click="selectedActivityId = selectedActivityId === group.id ? null : group.id"
          >
            <div class="flex items-start justify-between gap-3">
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" :class="lifecycleClass(activityLifecycleStatus(group))">
                <span :class="activityLifecycleStatus(group) === 'active' ? 'i-carbon-events' : activityLifecycleStatus(group) === 'upcoming' ? 'i-carbon-time' : activityLifecycleStatus(group) === 'ended' ? 'i-carbon-checkmark' : 'i-carbon-warning-alt'" />
                {{ lifecycleLabel(activityLifecycleStatus(group)) }}
              </span>
              <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="groupHasUnknownNode(group) ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200'">
                {{ groupHasUnknownNode(group) ? '待适配' : '已适配' }}
              </span>
            </div>
            <div class="mt-4">
              <h6 class="text-lg text-gray-900 font-semibold dark:text-white">
                {{ group.title || `活动 ${group.id}` }}
              </h6>
              <code class="mt-1 block text-xs text-gray-400">ID {{ group.id }}</code>
              <div class="mt-3 text-xs text-gray-600 space-y-1.5 dark:text-gray-300">
                <div class="flex items-start gap-2">
                  <span class="i-carbon-calendar mt-0.5 shrink-0 text-gray-400" />
                  <span>{{ formatActivityDate(group.startTime) }}</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="i-carbon-flag mt-0.5 shrink-0 text-gray-400" />
                  <span>{{ formatActivityDate(group.endTime) }}</span>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                <span class="rounded bg-white/80 px-2 py-1 dark:bg-gray-800">{{ contentSummary(group) }}</span>
              </div>
            </div>
            <span class="i-carbon-chevron-right absolute bottom-4 right-4 text-gray-300 transition" :class="selectedActivityId === group.id && 'rotate-90 text-cyan-500'" />
          </button>
        </div>
        <div v-else class="mt-3 border border-gray-200 rounded-lg border-dashed p-8 text-center text-sm text-gray-500 dark:border-gray-700">
          当前状态下暂无活动
        </div>

        <article v-if="selectedActivityGroup" class="mt-4 border border-cyan-200 rounded-lg bg-cyan-50/40 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h5 class="text-lg text-gray-900 font-semibold dark:text-white">
                  {{ selectedActivityGroup.title || `活动 ${selectedActivityGroup.id}` }}
                </h5>
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="lifecycleClass(activityLifecycleStatus(selectedActivityGroup))">
                  {{ lifecycleLabel(activityLifecycleStatus(selectedActivityGroup)) }}
                </span>
              </div>
              <p class="mt-1 text-xs text-gray-500">
                ID {{ selectedActivityGroup.id }} · {{ formatActivityDate(selectedActivityGroup.startTime) }} — {{ formatActivityDate(selectedActivityGroup.endTime) }}
              </p>
            </div>
            <button class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-white dark:hover:bg-gray-800" aria-label="关闭活动详情" @click="selectedActivityId = null">
              <span class="i-carbon-close" />
            </button>
          </div>

          <div v-if="selectedActivityGroup.children?.length" class="mt-4">
            <h6 class="mb-2 text-sm text-gray-900 font-semibold dark:text-white">
              功能节点
            </h6>
            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div
                v-for="node in selectedActivityGroup.children"
                :key="node.id"
                class="border border-gray-200 rounded-lg bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="text-sm text-gray-900 font-medium dark:text-white">{{ activityNodeLabel(node) }}</span>
                  <code class="shrink-0 text-xs text-gray-400">{{ node.id }}</code>
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span v-if="node.features?.exchangeShop" class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">兑换</span>
                  <span v-if="node.features?.randomShop" class="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200">刷新店</span>
                  <span v-if="node.features?.draw" class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">抽奖</span>
                  <span v-if="node.features?.starRecord" class="rounded bg-teal-50 px-1.5 py-0.5 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200">图鉴</span>
                  <span v-if="node.features?.weatherTasks" class="rounded bg-orange-50 px-1.5 py-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200">任务</span>
                  <span v-if="node.features?.weatherResearch" class="rounded bg-cyan-50 px-1.5 py-0.5 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200">研究</span>
                  <span v-if="node.features?.qixiBridge" class="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200">建设</span>
                  <span v-if="node.features?.qixiGift" class="rounded bg-pink-50 px-1.5 py-0.5 text-pink-700 dark:bg-pink-900/30 dark:text-pink-200">赠礼</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activityRuleSections(selectedActivityGroup).length" class="mt-4 border-t border-cyan-100 pt-4 dark:border-cyan-900">
            <section v-for="section in activityRuleSections(selectedActivityGroup)" :key="section.id">
              <h6 class="text-sm text-gray-900 font-semibold dark:text-white">
                {{ section.title }}
              </h6>
              <img v-for="image in section.images" :key="image" :src="image" :alt="section.title" class="mt-3 max-h-96 w-full rounded-lg bg-white object-contain dark:bg-gray-900">
              <div class="mt-2 text-sm text-gray-600 leading-6 space-y-1 dark:text-gray-300">
                <p v-for="(line, index) in section.lines" :key="`${section.id}-${index}`" class="whitespace-pre-line">
                  {{ line }}
                </p>
              </div>
            </section>
          </div>
        </article>
      </div>

      <div v-if="discoveredGroups.length" class="space-y-4">
        <article v-for="group in discoveredGroups" :key="`detail-${group.id}`" class="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 class="text-lg text-gray-900 font-semibold dark:text-white">
                {{ group.title || `活动 ${group.id}` }}
              </h4>
              <code class="mt-1 block text-sm text-gray-500">ID {{ group.id }}</code>
            </div>
            <span class="rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700 font-medium dark:bg-teal-900/30 dark:text-teal-200">
              {{ activityStatus(group) }}
            </span>
          </div>
          <div class="grid mt-4 gap-3 sm:grid-cols-3">
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500">
                开始时间
              </div>
              <div class="mt-1 text-gray-900 font-medium dark:text-white">
                {{ formatTime(group.startTime && group.startTime * 1000) }}
              </div>
            </div>
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500">
                结束时间
              </div>
              <div class="mt-1 text-gray-900 font-medium dark:text-white">
                {{ formatTime(group.endTime && group.endTime * 1000) }}
              </div>
            </div>
            <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500">
                内容摘要
              </div>
              <div class="mt-1 text-gray-900 font-medium dark:text-white">
                {{ contentSummary(group) }}
              </div>
            </div>
          </div>
          <div v-if="group.children?.length" class="mt-4">
            <div class="text-sm text-gray-900 font-semibold dark:text-white">
              活动节点 {{ group.children.length }}
            </div>
            <div class="grid mt-2 gap-2 sm:grid-cols-2">
              <div v-for="child in group.children" :key="child.id" class="border border-gray-100 rounded-lg px-3 py-2 dark:border-gray-700">
                <div class="flex justify-between gap-2 text-sm">
                  <span class="font-medium">{{ child.title || `节点 ${child.id}` }}</span>
                  <code class="text-xs text-gray-500">{{ child.id }}</code>
                </div>
                <div class="mt-1 text-xs text-gray-500">
                  {{ activityNodeLabel(child) }} · {{ contentSummary(child) }}
                </div>
                <p class="mt-2 text-xs text-gray-500 leading-5">
                  {{ activityNodeDescription(child) }}
                </p>
              </div>
            </div>
          </div>
          <div v-if="activityRuleSections(group).length" class="mt-5 border-t border-gray-100 pt-4 dark:border-gray-700">
            <h5 class="text-gray-900 font-semibold dark:text-white">
              玩法规则与完整活动说明
            </h5>
            <section
              v-for="section in activityRuleSections(group)"
              :key="section.id"
              class="mt-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-900/40"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h6 class="text-gray-900 font-medium dark:text-white">
                  {{ section.title }}
                </h6>
                <span class="text-xs text-gray-500">
                  节点 {{ section.id }}<template v-if="section.uid"> · {{ section.uid }}</template>
                </span>
              </div>
              <img v-for="image in section.images" :key="image" :src="image" :alt="section.title" class="mt-3 max-h-96 w-full rounded-lg bg-white object-contain dark:bg-gray-900">
              <div class="mt-3 text-sm text-gray-700 leading-6 space-y-2 dark:text-gray-300">
                <p v-for="(line, index) in section.lines" :key="`${section.id}-${index}`" class="whitespace-pre-line">
                  {{ line }}
                </p>
              </div>
            </section>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>
