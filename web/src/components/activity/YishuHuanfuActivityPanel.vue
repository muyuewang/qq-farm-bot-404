<script setup lang="ts">
/**
 * 以薯换福面板：Activity.vue 统一入口下的活动详情页。
 * 样式沿用本项目 Panel 惯例（UnoCSS 原子类 + BaseButton/BaseSelect + 主题渐变头图），
 * 不引入上游的 Naive UI 或独立页面壳。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useYishuHuanfuStore, type YshfFriendShop } from '@/stores/yishuhuanfu'
import { useToastStore } from '@/stores/toast'

const emit = defineEmits<{ back: [] }>()

const accountStore = useAccountStore()
const toast = useToastStore()
const store = useYishuHuanfuStore()
const accountId = computed(() => String(accountStore.currentAccount?.id ?? ''))
const activity = computed(() => store.state)

type TabKey = 'shop' | 'store' | 'compare'
const tab = ref<TabKey>('shop')
const tabs: { key: TabKey, label: string }[] = [
  { key: 'shop', label: '红薯小铺' },
  { key: 'store', label: '兑换商店' },
  { key: 'compare', label: '好友比价' },
]

const sellCount = ref('')
const targetGid = ref('')
const manualGid = ref('')
const manualQuote = ref<YshfFriendShop | null>(null)
const manualNote = ref('')
const queryingQuote = ref(false)
const exchangeCount = ref('1')
const busy = computed(() => !!store.pending || store.loading || store.loadingCatalog || store.loadingRecords || store.loadingFriends)
const sweetPotatoCount = computed(() => store.sweetPotatoCount)
const luckCoin = computed(() => store.luckCoinBalance)
const price = computed(() => activity.value?.shop.estimatedPrice || activity.value?.shop.price || '0')
const bonus = computed(() => activity.value?.shop.bonus || '0')
const canSell = computed(() => !!activity.value?.actions.sell.enabled && sweetPotatoCount.value > 0)
const canExchange = computed(() => !!activity.value?.actions.exchange.enabled && catalog.value.length > 0)
const catalog = computed(() => store.catalog)
const friendOptions = computed(() => [
  { label: '卖给自己的铺子', value: '' },
  ...store.friendShops
    .filter((shop: YshfFriendShop) => !shop.own && shop.canSell !== false && Number(shop.quota) > 0)
    .map((shop: YshfFriendShop) => ({
      label: `${shop.name || `铺子 ${shop.gid}`} · 单价 ${shop.totalPrice}`,
      value: shop.gid,
    })),
])

function num(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}
function fmt(value: string | number | null | undefined) {
  const n = num(value)
  return n.toLocaleString('zh-CN')
}
function time(value: number | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}
function quotaPercent() {
  const used = num(activity.value?.shop.quotaUsed)
  const cap = num(activity.value?.shop.quotaCap)
  return cap > 0 ? Math.min(100, Math.max(0, used / cap * 100)) : 0
}
function recordTime(value: string) {
  const seconds = num(value)
  return seconds ? new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
}

async function refresh() {
  if (!accountId.value || busy.value) return
  const ok = await store.load(accountId.value, true)
  if (!ok) toast.error(store.error || '刷新失败')
}
async function claimSeed() {
  if (busy.value) return
  const ok = await store.operate('seed/claim', {}, accountId.value)
  toast[ok ? 'success' : 'error'](ok ? '红薯种子已领取' : (store.error || '领取失败'))
}
async function share() {
  if (busy.value) return
  const wasShared = !!activity.value?.daily.shared
  const ok = await store.operate('share', {}, accountId.value)
  if (!ok) { toast.error(store.error || '分享失败'); return }
  // 已分享过再点，只为补回没落盘的标识：服务端不会再给暴击和种子。
  toast.success(wasShared ? '分享标识已补回' : '铺子分享完成')
}
async function sell() {
  if (!canSell.value || busy.value) return
  // type=number 的输入在部分浏览器/组件下会把值转成 number，直接 .trim() 会抛
  // "trim is not a function"，这里统一转字符串再判断空值。
  const rawCount = String(sellCount.value ?? '').trim()
  const count = rawCount === '' ? null : Number(rawCount)
  if (count !== null && (!Number.isInteger(count) || count <= 0)) {
    toast.error('出售数量必须是正整数')
    return
  }
  const payload: Record<string, unknown> = {}
  if (targetGid.value) payload.friendGid = targetGid.value
  if (count !== null) payload.count = count
  const ok = await store.operate('sell', payload, accountId.value)
  toast[ok ? 'success' : 'error'](ok ? '蜜薯已出售' : (store.error || '出售失败'))
  if (ok) {
    sellCount.value = ''
    if (/^\d+$/.test(manualGid.value.trim())) void queryManualQuote()
  }
}
async function exchange(index: number) {
  if (!canExchange.value || busy.value) return
  const count = Number(exchangeCount.value)
  if (!Number.isInteger(count) || count <= 0) {
    toast.error('兑换数量必须是正整数')
    return
  }
  const ok = await store.operate('exchange', { index, count }, accountId.value)
  if (ok) {
    // 兑换会改变该档「累计已兑次数」，而目录来自独立命令 cmd 97，不在活动快照里：
    // 重拉一次让全表剩余量对齐，否则界面还停在兑换前的「限购 x/y」。
    await store.loadCatalog(accountId.value)
  }
  toast[ok ? 'success' : 'error'](ok ? '兑换成功' : (store.error || '兑换失败'))
}
async function claimCommission() {
  if (busy.value) return
  const ok = await store.operate('commission/claim', {}, accountId.value)
  toast[ok ? 'success' : 'error'](ok ? '提成已领取' : (store.error || '领取失败'))
}
/** 手填 GID 查行情：蜜薯可卖给陌生人，不必先加好友；改号后旧回执自动丢弃。 */
async function queryManualQuote() {
  const gid = manualGid.value.trim()
  manualQuote.value = null
  manualNote.value = ''
  if (!/^\d+$/.test(gid)) { toast.error('请填写有效的铺子主人 GID'); return }
  if (!accountId.value || queryingQuote.value) return
  queryingQuote.value = true
  try {
    const quote = await store.queryShopQuote(accountId.value, gid)
    if (!quote) { manualNote.value = '查不到这个铺子的行情，请确认 GID'; return }
    manualQuote.value = quote
    manualNote.value = `可收 ${quote.unlimited ? '不限' : fmt(quote.quota)}，单价 ${fmt(quote.totalPrice)}`
  } finally { queryingQuote.value = false }
}

async function scan(force = false) {
  if (!accountId.value || busy.value) return
  const ok = await store.scanFriendShops(accountId.value, force)
  if (!ok) toast.error(store.notes.friends || '好友比价失败')
}

// 移出比价：第一次点击进入确认态，再点一次才执行，避免手滑把铺子删掉。
const removingGid = ref('')
async function removeShop(shop: YshfFriendShop) {
  if (shop.own || busy.value) return
  if (removingGid.value !== shop.gid) {
    removingGid.value = shop.gid
    return
  }
  const ok = await store.forgetShareKey(shop.gid, accountId.value)
  removingGid.value = ''
  toast[ok ? 'success' : 'error'](ok ? '已移出比价列表' : (store.error || '移出失败'))
}

// 手动导入标识：面板外的真人好友不会自动落盘，只能贴一次对方的分享链接。
const showImportKey = ref(false)
const importGid = ref('')
const importText = ref('')
const importing = ref(false)
async function submitImportKey() {
  if (importing.value) return
  const gid = importGid.value.trim()
  if (!/^\d+$/.test(gid)) { toast.error('请填写有效的铺主 GID'); return }
  if (!importText.value.trim()) { toast.error('请粘贴对方的分享链接或标识'); return }
  importing.value = true
  try {
    const ok = await store.importShareKey(gid, importText.value, accountId.value)
    if (!ok) { toast.error(store.error || '导入分享标识失败'); return }
    toast.success(`已记录 ${gid} 今日的分享标识`)
    importText.value = ''
    showImportKey.value = false
  } finally { importing.value = false }
}

/** 比价行里的标识展示：整串太长时中间省略，完整值仍在 title 里。 */
function shortShareKey(value: string): string {
  const key = String(value || '')
  if (key.length <= 18) return key
  return `${key.slice(0, 8)}…${key.slice(-8)}`
}

watch(accountId, (id) => {
  manualQuote.value = null
  manualNote.value = ''
  if (id) void store.load(id)
  else store.clear()
}, { immediate: true })

let timer: ReturnType<typeof setInterval> | null = null
function visibilityChanged() {
  if (document.visibilityState === 'visible' && accountId.value) void store.load(accountId.value)
}
onMounted(() => {
  document.addEventListener('visibilitychange', visibilityChanged)
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && accountId.value) void store.load(accountId.value)
  }, 60_000)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', visibilityChanged)
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="space-y-4">
    <div class="overflow-hidden rounded-xl from-amber-500 via-orange-500 to-rose-400 bg-gradient-to-br p-6 text-white shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <button class="rounded-lg bg-white/20 px-3 py-2 text-sm transition hover:bg-white/30" @click="emit('back')">
            <span class="i-carbon-arrow-left" />返回
          </button>
          <div>
            <p class="text-sm text-white/75">
              QQ 农场限时活动
            </p>
            <h1 class="mt-1 text-2xl font-semibold sm:text-3xl">
              {{ activity?.name || '以薯换福' }}
            </h1>
            <p class="mt-1 text-xs text-white/80 sm:text-sm">
              {{ time(activity?.startTime ?? null) }} — {{ time(activity?.endTime ?? null) }}
            </p>
          </div>
        </div>
        <BaseButton variant="secondary" size="sm" :loading="store.loading" @click="refresh">
          刷新
        </BaseButton>
      </div>
      <div class="grid grid-cols-2 mt-6 gap-3 text-center sm:grid-cols-4">
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            今日收购价
          </div>
          <div class="mt-1 text-xl font-semibold">
            {{ fmt(price) }}
          </div>
          <div class="text-xs text-white/70">
            基础 {{ fmt(activity?.shop.price) }} + 暴击 {{ fmt(bonus) }}
          </div>
        </div>
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            福气币
          </div>
          <div class="mt-1 text-xl font-semibold">
            {{ activity?.luckCoin.balanceKnown ? fmt(luckCoin) : '—' }}
          </div>
          <div v-if="activity?.balanceError" class="text-xs text-red-100" :title="activity.balanceError">
            读取失败
          </div>
        </div>
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            背包蜜薯
          </div>
          <div class="mt-1 text-xl font-semibold">
            {{ activity?.sweetPotato.balanceKnown ? fmt(sweetPotatoCount) : '—' }}
          </div>
          <div v-if="!activity?.actions.sell.enabled" class="text-xs text-white/70">
            暂不可出售
          </div>
        </div>
        <div class="rounded-lg bg-white/15 p-3">
          <div class="text-xs text-white/70">
            可领提成
          </div>
          <div class="mt-1 text-xl font-semibold">
            {{ fmt(activity?.commission.pending) }}
          </div>
          <BaseButton v-if="activity?.commission.claimable" variant="secondary" size="sm" class="mt-1" :loading="store.pending === 'commission/claim'" @click="claimCommission">
            领取
          </BaseButton>
        </div>
      </div>
    </div>

    <div v-if="!accountId" class="rounded-xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800">
      请先选择账号，再查看活动数据。
    </div>
    <div v-else-if="store.loading && !activity" class="rounded-xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800">
      正在读取活动状态…
    </div>
    <div v-else-if="store.error && !activity" class="rounded-xl bg-white p-10 text-center text-sm text-red-500 shadow-sm dark:bg-gray-800">
      {{ store.error }}
    </div>
    <template v-else-if="activity">
      <div v-if="activity.balanceStale" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        背包余额暂时读不到，展示的是上次成功读取的数值，请勿据此重复提交。
      </div>

      <div class="flex gap-2 rounded-xl bg-white p-1.5 shadow-sm dark:bg-gray-800">
        <button
          v-for="item in tabs" :key="item.key"
          class="flex-1 rounded-lg px-3 py-2 text-sm transition"
          :class="tab === item.key ? 'bg-[var(--theme-primary)] text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
          @click="tab = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <!-- 红薯小铺 -->
      <div v-if="tab === 'shop'" class="space-y-4">
        <section class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
          <h2 class="text-base font-semibold">
            今日小铺
          </h2>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p class="text-xs text-gray-500">
                今日蜜薯收购价
              </p>
              <p class="mt-1 text-2xl font-semibold text-orange-600 dark:text-orange-400">
                {{ fmt(price) }}
              </p>
              <p class="mt-1 text-xs text-gray-500">
                基础 {{ fmt(activity.shop.price) }} + 分享暴击 {{ fmt(bonus) }}
              </p>
            </div>
            <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p class="text-xs text-gray-500">
                小铺今日接收额度
              </p>
              <div class="mt-2 h-3 overflow-hidden rounded-full bg-orange-100 dark:bg-orange-950">
                <div class="h-full rounded-full bg-orange-500" :style="{ width: `${quotaPercent()}%` }" />
              </div>
              <p class="mt-2 text-xs text-gray-500">
                已收 {{ fmt(activity.shop.quotaUsed) }} / {{ fmt(activity.shop.quotaCap) }}
                <span v-if="activity.shop.quota !== null"> · 还可收 {{ fmt(activity.shop.quota) }}</span>
              </p>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <BaseButton variant="primary" size="sm" :disabled="activity.daily.seedClaimed || !activity.actions.claimSeed.enabled" :loading="store.pending === 'seed/claim'" @click="claimSeed">
              {{ activity.daily.seedClaimed ? '今日种子已领' : '领取红薯种子' }}
            </BaseButton>
            <BaseButton variant="secondary" size="sm" :disabled="!activity.actions.share.enabled" :loading="store.pending === 'share'" @click="share">
              {{ activity.daily.shared
                ? (activity.daily.shareKeySaved ? '今日已分享' : '补分享标识')
                : '分享铺子拿暴击' }}
            </BaseButton>
          </div>
        </section>

        <section class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
          <h2 class="text-base font-semibold">
            出售蜜薯
          </h2>
          <p class="mt-1 text-xs text-gray-500">
            不填数量默认卖出背包全部；卖给好友会占用对方今日额度，自家铺子不限额。
          </p>
          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <BaseSelect v-model="targetGid" label="收购铺子" :options="friendOptions" placeholder="卖给自己的铺子" />
            <BaseInput v-model="sellCount" label="出售数量" placeholder="留空为全部" type="number" min="1" />
            <div class="flex items-end">
              <BaseButton variant="primary" :disabled="!canSell" :loading="store.pending === 'sell'" block @click="sell">
                卖出蜜薯
              </BaseButton>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
            <BaseInput v-model="manualGid" label="目标 GID（非好友也可）" placeholder="填铺子主人 QQ 号" type="number" class="min-w-48 flex-1" />
            <BaseButton variant="secondary" size="sm" :loading="queryingQuote" @click="queryManualQuote">查行情</BaseButton>
            <BaseButton v-if="manualQuote" variant="text" size="sm" @click="targetGid = manualQuote!.gid; tab = 'shop'">选它出售</BaseButton>
          </div>
          <p v-if="manualNote" class="mt-2 text-xs text-gray-500">{{ manualNote }}</p>
          <p v-if="activity.actions.sell.reason" class="mt-2 text-xs text-gray-500">
            {{ activity.actions.sell.reason }}
          </p>
        </section>

        <section class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">
              小铺收购记录
            </h2>
            <BaseButton variant="text" size="sm" :loading="store.loadingRecords" @click="store.loadRecords(accountId, true)">
              刷新记录
            </BaseButton>
          </div>
          <div v-if="!store.recordsList.length" class="mt-4 rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500 dark:bg-gray-900">
            暂无收购记录，好友把蜜薯卖进你的铺子后会产生提成。
          </div>
          <div v-else class="mt-4 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-xs text-gray-500">
                <tr><th class="py-2">时间</th><th>好友</th><th>数量</th><th>成交额</th><th>我的提成</th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in store.recordsList" :key="`${row.timestamp}-${row.gid}-${index}`" class="border-t border-gray-100 dark:border-gray-700">
                  <td class="py-2 text-xs">{{ recordTime(row.timestamp) }}</td>
                  <td>{{ row.name || `GID ${row.gid}` }}</td>
                  <td>{{ fmt(row.count) }}</td>
                  <td>{{ fmt(row.total) }}</td>
                  <td class="font-medium text-orange-600 dark:text-orange-400">+{{ fmt(row.commission) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="store.notes.records" class="mt-2 text-xs text-gray-500">{{ store.notes.records }}</p>
        </section>
      </div>

      <!-- 兑换商店 -->
      <section v-else-if="tab === 'store'" class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">
              福气兑换
            </h2>
            <p class="mt-1 text-xs text-gray-500">
              当前福气币 {{ activity.luckCoin.balanceKnown ? fmt(luckCoin) : '—' }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">数量</span>
            <BaseInput v-model="exchangeCount" type="number" min="1" class="w-20" />
          </div>
        </div>
        <div v-if="!catalog.length" class="mt-4 rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900">
          {{ store.loadingCatalog ? '正在读取兑换目录…' : (store.notes.catalog || '兑换目录暂不可用') }}
        </div>
        <div v-else class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="entry in catalog" :key="entry.index" class="flex flex-col rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div class="text-sm font-medium">
              {{ entry.name || `第 ${entry.index} 档` }}
            </div>
            <div class="mt-2 text-xs text-gray-500">
              {{ fmt(entry.price) }} 福气币 · 限购 {{ fmt(entry.remaining) }}/{{ fmt(entry.limit) }}
            </div>
            <div class="mt-1 flex-1 text-xs" :class="entry.exchangeable ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'">
              {{ entry.exchangeable ? '可兑换' : '暂不可兑' }}
            </div>
            <BaseButton
              variant="primary" size="sm" class="mt-3"
              :disabled="!canExchange || !entry.exchangeable || luckCoin < num(entry.price)"
              :loading="store.pending === 'exchange'"
              @click="exchange(entry.index)"
            >
              兑换
            </BaseButton>
          </div>
        </div>
        <p v-if="activity.actions.exchange.reason" class="mt-3 text-xs text-gray-500">
          {{ activity.actions.exchange.reason }}
        </p>
      </section>

      <!-- 好友比价 -->
      <section v-else class="space-y-4">
        <div class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold">
                好友铺子比价
              </h2>
              <p class="mt-1 text-xs text-gray-500">
                按今日收购价从高到低排列，只查询不成交。
              </p>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton variant="secondary" size="sm" @click="showImportKey = !showImportKey">
                {{ showImportKey ? '收起' : '导入标识' }}
              </BaseButton>
              <BaseButton variant="primary" size="sm" :loading="store.loadingFriends" @click="scan(true)">
                {{ store.friendScanAt ? '重新比价' : '开始比价' }}
              </BaseButton>
            </div>
          </div>
          <p v-if="store.notes.friends" class="mt-2 text-xs text-gray-500">{{ store.notes.friends }}</p>
          <!-- 卖薯要带对方当天的分享标识，面板外的真人好友只能手动贴一次 -->
          <div v-if="showImportKey" class="mt-3 grid gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-[10rem_1fr_auto] dark:bg-gray-900">
            <BaseInput v-model="importGid" label="铺主 GID" placeholder="纯数字" />
            <BaseInput v-model="importText" label="分享链接或标识" placeholder="粘贴对方分享的卡片/链接，或 UUID" />
            <div class="flex items-end">
              <BaseButton variant="primary" size="sm" :loading="importing" @click="submitImportKey">
                导入
              </BaseButton>
            </div>
          </div>
        </div>
        <div v-if="!store.friendShops.length" class="rounded-xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800">
          还没有好友铺子行情，点「开始比价」查询。
        </div>
        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="shop in store.friendShops" :key="shop.gid"
            class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            :class="shop.own ? 'ring-1 ring-orange-300 dark:ring-orange-700' : ''"
          >
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium">
                {{ shop.name || `GID ${shop.gid}` }}
                <span v-if="shop.own" class="ml-1 text-xs text-orange-500">自家</span>
                <span v-else-if="shop.via === 'panel'" class="ml-1 text-xs text-violet-500">其它号好友</span>
              </div>
              <span class="text-xs text-gray-500">Lv.{{ fmt(shop.level) }}</span>
            </div>
            <div class="mt-3 text-2xl font-semibold text-orange-600 dark:text-orange-400">
              {{ fmt(shop.totalPrice) }}
            </div>
            <div class="mt-1 text-xs text-gray-500">
              基础 {{ fmt(shop.price) }} + 暴击 {{ fmt(shop.bonus) }}
            </div>
            <div class="mt-3 text-xs" :class="shop.canSell === false ? 'text-red-500' : 'text-gray-500'">
              {{ shop.unlimited ? '还可收 不限' : shop.canSell === false ? '当前不收薯' : `还可收 ${fmt(shop.quota)} / ${fmt(shop.quotaCap)}` }}
            </div>
            <!-- 2026-11-28 起卖薯要带对方当天的分享标识：没有标识就只能看价 -->
            <div class="mt-1 text-xs" :class="shop.shareKeyKnown ? 'text-gray-400' : 'text-amber-600 dark:text-amber-400'">
              {{ shop.shareKeyKnown
                ? (shop.shareKey ? `标识 ${shortShareKey(shop.shareKey)}` : '标识 今日未落盘')
                : '缺今日标识，只能看价' }}
            </div>
            <BaseButton
              variant="secondary" size="sm" class="mt-3" block
              :disabled="shop.canSell === false || !shop.shareKeyKnown || (!shop.unlimited && num(shop.quota) <= 0)"
              @click="targetGid = shop.gid; tab = 'shop'"
            >
              选它出售
            </BaseButton>
            <div v-if="!shop.own" class="mt-2 flex justify-end">
              <button
                type="button"
                class="text-xs"
                :class="removingGid === shop.gid ? 'text-red-500 font-medium' : 'text-gray-400 hover:text-red-500'"
                :title="shop.shareKey ? '移除本地标识后这家会从比价列表消失，对方下次分享会重新出现' : '从比价列表移除'"
                @click="removeShop(shop)"
              >
                {{ removingGid === shop.gid ? '确认移出？' : '移出比价' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activity.rules.length" class="rounded-xl bg-white p-5 shadow-sm dark:bg-gray-800">
        <h2 class="text-base font-semibold">
          活动规则
        </h2>
        <ul class="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-300">
          <li v-for="(rule, index) in activity.rules" :key="index">· {{ rule }}</li>
        </ul>
      </section>
    </template>
  </section>
</template>
