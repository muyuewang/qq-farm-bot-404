/**
 * 以薯换福（活动组 2026111707 / 主活动 2026111708）store。
 *
 * 接口来自 core/src/services/activity-center/yishuhuanfu.ts：
 * - GET  /api/activity-center/yishuhuanfu                 活动快照（只读）
 * - GET  /api/activity-center/yishuhuanfu/catalog         兑换目录（cmd 97）
 * - GET  /api/activity-center/yishuhuanfu/records         收购记录（cmd 95）
 * - GET  /api/activity-center/yishuhuanfu/shop            本人铺子行情（cmd 92，只读）
 * - GET  /api/activity-center/yishuhuanfu/friends         好友铺子比价（cmd 92 批量）
 * - POST /api/activity-center/yishuhuanfu/{seed/claim,sell,exchange,quote/refresh,commission/claim,share}
 *
 * 与本项目其它活动 store 一致：用账号 + 代际双校验防陈旧响应；写操作失败后
 * 置 needsRefresh，必须重新读取才能继续提交。所有 int64 一律按字符串处理，
 * 只在渲染时转数字，避免 Long 精度丢失。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface YshfAction {
  enabled: boolean
  available: boolean
  availabilityKnown: boolean
  reason?: string
}

export interface YshfCatalogEntry {
  index: number
  itemId: string | null
  name: string
  nameKnown: boolean
  price: string
  status: number
  limit: string
  /** 累计已兑换次数（cmd 97 field 6）；剩余 = limit − exchanged。 */
  exchanged: string
  /** 剩余可兑换次数，后端按 limit − exchanged 算好下发，界面只认这个。 */
  remaining: string
  image: string
  exchangeable: boolean
}

export interface YshfFriendShop {
  gid: string
  name: string
  avatar: string
  level: string
  own: boolean
  price: string
  bonus: string
  totalPrice: string
  quota: string
  quotaCap: string
  quotaUsed: string
  canSell: boolean | null
  unlimited: boolean
  /** 是否拿到对方当天的分享标识。false = 只能看价、卖不进去（2026-11-28 起服务端校验）。 */
  shareKeyKnown: boolean
  /** 该铺子今天落盘的分享标识（自己那条也会下发，方便对照别人贴进来的链接）。 */
  shareKey: string
  /** 铺子来源：own=本人 / friend=本账号好友 / panel=其它账号好友 / manual=手填 GID。 */
  via?: string
  /** 来源账号名（via=panel 时用于标注其它号好友）。 */
  panelAccount?: string
}

export interface YshfRecord {
  timestamp: string
  gid: string
  count: string
  total: string
  name: string
  avatar: string
  level: string
  commission: string
}

export interface YshfActivity {
  groupId: string
  activityId: string
  name: string
  startTime: number | null
  endTime: number | null
  rules: string[]
  active: boolean
  serverTime: string
  shop: {
    gid: string
    price: string
    priceKnown: boolean
    quoteTime: string
    selfPrice: string
    bonus: string
    estimatedPrice: string | null
    quota: string | null
    quotaCap: string
    quotaUsed: string | null
  }
  seed: { id: string, name: string, image: string, balance: string | null, balanceKnown: boolean }
  sweetPotato: { id: string, name: string, image: string, balance: string | null, balanceKnown: boolean }
  luckCoin: { id: string, name: string, image: string, balance: string | null, balanceKnown: boolean }
  catalog: YshfCatalogEntry[]
  catalogLoaded: boolean
  commission: { pending: string, claimable: boolean, flag: string }
  balanceError: string
  balanceStale: boolean
  daily: { dateKey: string, seedClaimed: boolean, shared: boolean, sharedToday: boolean, shareKeySaved: boolean }
  actions: {
    claimSeed: YshfAction
    sell: YshfAction
    share: YshfAction
    exchange: YshfAction
  }
}

const ACTIVITY_API = '/api/activity-center/yishuhuanfu'

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function record(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {}
}
function records(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}
function text(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const s = String(value).trim()
    if (s) return s
  }
  return ''
}
function bool(...values: unknown[]): boolean {
  for (const value of values) {
    if (value === true || value === 1 || value === '1' || value === 'true') return true
    if (value === false || value === 0 || value === '0' || value === 'false') return false
  }
  return false
}
function finiteNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n < 1e12 ? n * 1000 : n
}
function normalizeAction(container: Record<string, any>, key: string): YshfAction {
  const value = record(container[key])
  return {
    enabled: bool(value.enabled),
    available: bool(value.available),
    availabilityKnown: bool(value.availabilityKnown, value.availability_known),
    reason: text(value.reason),
  }
}
function normalizeItem(value: unknown): { id: string, name: string, image: string } {
  const item = record(value)
  return { id: text(item.id, item.item_id), name: text(item.name), image: text(item.image) }
}
function normalizeCatalogEntry(entry: Record<string, any>): YshfCatalogEntry {
  return {
    index: finiteNumber(entry.index),
    itemId: entry.itemId === null || entry.itemId === undefined ? null : text(entry.itemId),
    name: text(entry.name),
    nameKnown: bool(entry.nameKnown, entry.name_known),
    price: text(entry.price),
    status: finiteNumber(entry.status),
    limit: text(entry.limit),
    exchanged: text(entry.exchanged, entry.exchangedToday, entry.exchanged_today, '0'),
    // 旧后端没有 remaining 时退化成 limit，避免界面显示 0。
    remaining: text(entry.remaining, entry.remainingCount, entry.remaining_count, '') || text(entry.limit),
    image: text(entry.image),
    // 后端没带 exchangeable 时按可兑处理，价格够不够由渲染层再判一次。
    exchangeable: entry.exchangeable === null || entry.exchangeable === undefined
      ? true
      : bool(entry.exchangeable),
  }
}
function normalizeActivity(value: unknown): YshfActivity | null {
  if (!isRecord(value)) return null
  const raw = value
  const shop = record(raw.shop)
  const daily = record(raw.daily)
  const commission = record(raw.commission)
  const seed = record(raw.seed)
  const potato = record(raw.sweetPotato)
  const coin = record(raw.luckCoin)
  const actions = record(raw.actions)
  const balanceOf = (item: Record<string, any>) => item.balance === null || item.balance === undefined
    ? null : text(item.balance)
  const knownOf = (item: Record<string, any>) => bool(item.balanceKnown, item.balance_known)
  return {
    groupId: text(raw.groupId, raw.group_id),
    activityId: text(raw.activityId, raw.activity_id),
    name: text(raw.name, '以薯换福'),
    startTime: toMs(raw.startTime ?? raw.start_time),
    endTime: toMs(raw.endTime ?? raw.end_time),
    rules: Array.isArray(raw.rules) ? raw.rules.map((r: any) => text(r)).filter(Boolean)
      : text(raw.rules).split(/\n+/).map(s => s.trim()).filter(Boolean),
    active: bool(raw.active),
    serverTime: text(raw.serverTime, raw.server_time),
    shop: {
      gid: text(shop.gid),
      price: text(shop.price),
      priceKnown: bool(shop.priceKnown, shop.price_known),
      quoteTime: text(shop.quoteTime, shop.quote_time),
      selfPrice: text(shop.selfPrice, shop.self_price),
      bonus: text(shop.bonus),
      estimatedPrice: shop.estimatedPrice === null || shop.estimatedPrice === undefined
        ? null : text(shop.estimatedPrice),
      quota: shop.quota === null || shop.quota === undefined ? null : text(shop.quota),
      quotaCap: text(shop.quotaCap, shop.quota_cap),
      quotaUsed: shop.quotaUsed === null || shop.quotaUsed === undefined ? null : text(shop.quotaUsed),
    },
    seed: { ...normalizeItem(seed), balance: balanceOf(seed), balanceKnown: knownOf(seed) },
    sweetPotato: { ...normalizeItem(potato), balance: balanceOf(potato), balanceKnown: knownOf(potato) },
    luckCoin: { ...normalizeItem(coin), balance: balanceOf(coin), balanceKnown: knownOf(coin) },
    catalog: records(raw.catalog).map(normalizeCatalogEntry),
    catalogLoaded: bool(raw.catalogLoaded, raw.catalog_loaded),
    commission: {
      pending: text(commission.pending),
      claimable: bool(commission.claimable),
      flag: text(commission.flag),
    },
    balanceError: text(raw.balanceError, raw.balance_error),
    balanceStale: bool(raw.balanceStale, raw.balance_stale),
    daily: {
      dateKey: text(daily.dateKey, daily.date_key),
      seedClaimed: bool(daily.seedClaimed, daily.seed_claimed),
      shared: bool(daily.shared),
      sharedToday: bool(daily.sharedToday, daily.shared_today, daily.quoteGeneratedToday, daily.quote_generated_today),
      // 今天这串分享标识是否已落盘。false 时即使已分享也允许再点一次补标识（只有标识、无奖励）。
      shareKeySaved: bool(daily.shareKeySaved, daily.share_key_saved),
    },
    actions: {
      claimSeed: normalizeAction(actions, 'claimSeed'),
      sell: normalizeAction(actions, 'sell'),
      share: normalizeAction(actions, 'share'),
      exchange: normalizeAction(actions, 'exchange'),
    },
  }
}
function responsePayload(data: unknown): unknown {
  const value = record(data)
  return 'data' in value ? value.data : value
}
function errorMessage(error: any, fallback: string): string {
  return text(error?.response?.data?.error, error?.message) || fallback
}

export const useYishuHuanfuStore = defineStore('yishuhuanfu', () => {
  const accountStore = useAccountStore()
  const state = ref<YshfActivity | null>(null)
  const catalog = ref<YshfCatalogEntry[]>([])
  const recordsList = ref<YshfRecord[]>([])
  const friendShops = ref<YshfFriendShop[]>([])
  const friendScanAt = ref(0)
  const notes = ref({ catalog: '', records: '', friends: '' })
  const loading = ref(false)
  const pending = ref('')
  const error = ref('')
  const needsRefresh = ref(false)
  const loadingCatalog = ref(false)
  const loadingRecords = ref(false)
  const loadingFriends = ref(false)

  let accountId = ''
  let generation = 0
  const catalogAccountId = ref('')
  const recordsAccountId = ref('')
  const friendsAccountId = ref('')

  const walletKnown = computed(() => {
    const value = state.value
    if (!value) return false
    return value.sweetPotato.balance !== null && value.luckCoin.balance !== null
  })
  const sweetPotatoCount = computed(() => Number(state.value?.sweetPotato.balance || '0'))
  const luckCoinBalance = computed(() => Number(state.value?.luckCoin.balance || '0'))

  function isCurrent(targetId: string, gen: number) {
    return targetId === accountId && gen === generation && targetId === String(accountStore.currentAccount?.id ?? '')
  }
  function headers(id: string) {
    return { 'x-account-id': id }
  }
  function clear() {
    generation++
    state.value = null
    catalog.value = []
    recordsList.value = []
    friendShops.value = []
    friendScanAt.value = 0
    notes.value = { catalog: '', records: '', friends: '' }
    loading.value = false
    pending.value = ''
    error.value = ''
    needsRefresh.value = false
    loadingCatalog.value = false
    loadingRecords.value = false
    loadingFriends.value = false
    catalogAccountId.value = ''
    recordsAccountId.value = ''
    friendsAccountId.value = ''
    accountId = ''
  }

  async function load(id: string, force = false) {
    const targetId = String(id || '').trim()
    if (!targetId) return false
    if (targetId !== accountId) {
      clear()
      accountId = targetId
    }
    const gen = generation
    if (loading.value) return false
    loading.value = true
    try {
      const { data } = await api.get(ACTIVITY_API, { headers: headers(targetId) })
      if (!isCurrent(targetId, gen) || !data?.ok) return false
      const incoming = normalizeActivity(responsePayload(data.data))
      // 快照不携带 cmd 97 目录：保留上一次已加载的真实档位，避免轮询把目录闪回骨架。
      if (incoming && catalog.value.length && catalogAccountId.value === targetId) {
        incoming.catalog = catalog.value
        incoming.catalogLoaded = true
      }
      state.value = incoming
      needsRefresh.value = false
      // 快照里的目录只是骨架，进入页面后再单独拉一次真实档位与限购。
      if (force || (!catalog.value.length && catalogAccountId.value !== targetId))
        void loadCatalog(targetId)
      void loadShop(targetId)
      void loadRecords(targetId)
      return true
    }
    catch (err: any) {
      if (isCurrent(targetId, gen)) error.value = errorMessage(err, '以薯换福数据加载失败')
      return false
    }
    finally {
      if (isCurrent(targetId, gen)) loading.value = false
    }
  }

  async function loadCatalog(id: string) {
    const targetId = String(id || '').trim()
    if (!targetId || loadingCatalog.value) return false
    if (catalogAccountId.value !== targetId) {
      catalog.value = []
      notes.value.catalog = ''
      catalogAccountId.value = ''
    }
    const gen = generation
    catalogAccountId.value = targetId
    loadingCatalog.value = true
    try {
      const { data } = await api.get(`${ACTIVITY_API}/catalog`, { headers: headers(targetId), skipErrorToast: true } as any)
      if (gen !== generation || catalogAccountId.value !== targetId) return false
      const payload = record(responsePayload(data?.data))
      catalog.value = records(payload.catalog).map(normalizeCatalogEntry)
      notes.value.catalog = text(payload.message)
      if (state.value && isCurrent(targetId, gen)) {
        state.value = {
          ...state.value,
          catalog: catalog.value,
          catalogLoaded: true,
          actions: { ...state.value.actions, exchange: state.value.actions.exchange },
        }
      }
      return true
    }
    catch (err: any) {
      if (gen === generation && catalogAccountId.value === targetId)
        notes.value.catalog = errorMessage(err, '兑换目录加载失败')
      return false
    }
    finally {
      if (gen === generation && catalogAccountId.value === targetId) loadingCatalog.value = false
    }
  }

  async function loadRecords(id: string, force = false) {
    const targetId = String(id || '').trim()
    if (!targetId || loadingRecords.value) return false
    if (recordsAccountId.value !== targetId) {
      recordsList.value = []
      notes.value.records = ''
      recordsAccountId.value = ''
    }
    if (!force && recordsAccountId.value === targetId && recordsList.value.length) return true
    const gen = generation
    recordsAccountId.value = targetId
    loadingRecords.value = true
    try {
      const { data } = await api.get(`${ACTIVITY_API}/records`, { headers: headers(targetId), skipErrorToast: true } as any)
      if (gen !== generation || recordsAccountId.value !== targetId) return false
      const payload = record(responsePayload(data?.data))
      recordsList.value = records(payload.records).map(entry => ({
        timestamp: text(entry.timestamp), gid: text(entry.gid), count: text(entry.count),
        total: text(entry.total), name: text(entry.name), avatar: text(entry.avatar),
        level: text(entry.level), commission: text(entry.commission),
      }))
      notes.value.records = text(payload.message)
      return true
    }
    catch (err: any) {
      if (gen === generation && recordsAccountId.value === targetId)
        notes.value.records = errorMessage(err, '收购记录加载失败')
      return false
    }
    finally {
      if (gen === generation && recordsAccountId.value === targetId) loadingRecords.value = false
    }
  }

  async function loadShop(id: string) {
    const targetId = String(id || '').trim()
    if (!targetId || !state.value) return false
    const gen = generation
    try {
      const { data } = await api.get(`${ACTIVITY_API}/shop`, { headers: headers(targetId), skipErrorToast: true } as any)
      if (gen !== generation || !isCurrent(targetId, gen) || !state.value) return false
      const payload = record(responsePayload(data?.data))
      if (payload.quota === null || payload.quota === undefined) return false
      state.value = {
        ...state.value,
        shop: {
          ...state.value.shop,
          quota: text(payload.quota),
          quotaCap: text(payload.quotaCap, payload.quota_cap, state.value.shop.quotaCap),
          quotaUsed: payload.quotaUsed === null || payload.quotaUsed === undefined
            ? null : text(payload.quotaUsed),
        },
      }
      return true
    }
    catch {
      return false
    }
  }

  /**
   * 查任意 GID 的铺子行情（cmd 92）：蜜薯可卖给陌生人，不必先加好友。
   * 返回结构与比价列表一致，复用同一套渲染；按 GID 记回执，改号后调用方自行丢弃旧提示。
   */
  async function queryShopQuote(id: string, gid: string): Promise<YshfFriendShop | null> {
    const targetId = String(id || '').trim()
    const targetGid = String(gid || '').trim()
    if (!targetId || !/^\d+$/.test(targetGid)) return null
    try {
      const { data } = await api.get(`${ACTIVITY_API}/shop`, {
        headers: headers(targetId), params: { friendGid: targetGid }, skipErrorToast: true,
      } as any)
      if (!isCurrent(targetId, generation) || !data?.ok) return null
      const payload = record(responsePayload(data?.data))
      const shop = record(payload.shop)
      const price = text(payload.price)
      const bonus = text(payload.bonus)
      return {
        gid: text(shop.gid, payload.targetGid, targetGid), name: text(shop.name),
        avatar: text(shop.avatar), level: text(shop.level), own: bool(payload.own),
        price, bonus,
        totalPrice: text(payload.totalPrice, payload.total_price, price),
        quota: text(payload.quota), quotaCap: text(payload.quotaCap, payload.quota_cap),
        quotaUsed: text(payload.quotaUsed, payload.quota_used),
        canSell: payload.canSell === null || payload.canSell === undefined ? null : bool(payload.canSell, payload.can_sell),
        unlimited: bool(payload.own), via: 'manual',
        // 手填 GID 查价同样受「必须有当天标识」约束：后端会告诉这家能不能卖。
        shareKeyKnown: payload.shareKeyKnown === undefined || payload.shareKeyKnown === null
          ? true
          : bool(payload.shareKeyKnown, payload.share_key_known),
        shareKey: text(payload.shareKey, payload.share_key),
      }
    } catch { return null }
  }

  async function scanFriendShops(id: string, force = false) {
    const targetId = String(id || '').trim()
    if (!targetId || loadingFriends.value) return false
    if (friendsAccountId.value !== targetId) {
      friendShops.value = []
      friendScanAt.value = 0
      notes.value.friends = ''
      friendsAccountId.value = ''
    }
    const gen = generation
    friendsAccountId.value = targetId
    loadingFriends.value = true
    try {
      const { data } = await api.get(`${ACTIVITY_API}/friends`, {
        headers: headers(targetId), params: force ? { force: 1 } : {}, skipErrorToast: true,
      } as any)
      if (gen !== generation || friendsAccountId.value !== targetId) return false
      const payload = record(responsePayload(data?.data))
      friendShops.value = records(payload.shops).map(entry => {
        const price = text(entry.price)
        const bonus = text(entry.bonus)
        const totalPrice = text(entry.totalPrice, entry.total_price)
          || String(Number(price || '0') + Number(bonus || '0'))
        return {
          gid: text(entry.gid), name: text(entry.name), avatar: text(entry.avatar), level: text(entry.level),
          own: bool(entry.own), price, bonus, totalPrice,
          quota: text(entry.quota), quotaCap: text(entry.quotaCap, entry.quota_cap),
          quotaUsed: text(entry.quotaUsed, entry.quota_used),
          canSell: entry.canSell === undefined || entry.canSell === null ? null : bool(entry.canSell, entry.can_sell),
          unlimited: bool(entry.unlimited) || bool(entry.own),
          // 后端没带 shareKeyKnown 时按「有标识」处理，避免旧后端下整排铺子被标成不可卖。
          shareKeyKnown: entry.shareKeyKnown === undefined || entry.shareKeyKnown === null
            ? true
            : bool(entry.shareKeyKnown, entry.share_key_known),
          shareKey: text(entry.shareKey, entry.share_key),
          via: text(entry.via), panelAccount: text(entry.panelAccount, entry.panel_account),
        }
      })
      friendScanAt.value = finiteNumber(payload.scannedAt ?? payload.scanned_at) || Date.now()
      const scanned = finiteNumber(payload.scanned)
      const failed = finiteNumber(payload.failed)
      notes.value.friends = text(payload.friendListError, payload.friend_list_error)
        || text(payload.message)
        || (scanned === 0 ? '没有可查询的铺子'
          : `已扫描 ${friendShops.value.length} 个铺子${failed ? `，${failed} 个查询失败` : ''}`)
      return true
    }
    catch (err: any) {
      if (gen === generation && friendsAccountId.value === targetId)
        notes.value.friends = errorMessage(err, '好友铺子比价失败')
      return false
    }
    finally {
      if (gen === generation && friendsAccountId.value === targetId) loadingFriends.value = false
    }
  }

  async function operate(action: string, body: Record<string, unknown> = {}, id = accountId) {
    const targetId = String(id || '').trim()
    if (!targetId || pending.value) return false
    const gen = generation
    pending.value = action
    error.value = ''
    try {
      const { data } = await api.post(`${ACTIVITY_API}/${action}`, body, { headers: headers(targetId) })
      if (!isCurrent(targetId, gen)) return false
      if (!data?.ok) throw new Error(text(data?.error, '操作失败'))
      // 写操作只发一次，绝不因超时重试猜结果；直接重读权威快照。
      await load(targetId, true)
      return true
    }
    catch (err: any) {
      if (isCurrent(targetId, gen)) {
        error.value = errorMessage(err, '操作失败')
        needsRefresh.value = true
      }
      return false
    }
    finally {
      if (isCurrent(targetId, gen)) pending.value = ''
    }
  }

  /**
   * 手动导入好友当天分享标识（贴分享链接/卡片文本，或直接填 UUID / 32 位十六进制）。
   * 服务端没有按 gid 反查好友标识的接口，面板外的真人好友只能靠这个入口变得可售。
   */
  async function importShareKey(gid: string, raw: string, id = accountId) {
    const targetId = String(id || '').trim()
    const shopGid = String(gid || '').trim()
    const shareText = String(raw || '').trim()
    if (!targetId) return false
    if (!shopGid || !shareText) {
      error.value = '需要同时填写铺主 GID 和对方的分享标识'
      return false
    }
    if (pending.value) return false
    pending.value = 'share-key'
    error.value = ''
    try {
      const { data } = await api.post(`${ACTIVITY_API}/share-key`, { gid: shopGid, text: shareText }, { headers: headers(targetId) })
      if (!data?.ok) throw new Error(text(data?.error, '导入分享标识失败'))
      // 标识变了，「这家能不能卖」要重算：强制重扫比价列表。
      await scanFriendShops(targetId, true)
      return true
    }
    catch (err: any) {
      error.value = errorMessage(err, '导入分享标识失败')
      return false
    }
    finally {
      pending.value = ''
    }
  }

  /**
   * 把某家铺子移出比价列表：比价池由标识存档决定，删掉这条就没了。
   * 面板账号下次分享会重新落盘，所以这不是永久屏蔽。
   */
  async function forgetShareKey(gid: string, id = accountId) {
    const targetId = String(id || '').trim()
    const shopGid = String(gid || '').trim()
    if (!targetId || !shopGid) return false
    if (pending.value) return false
    pending.value = 'share-key-remove'
    error.value = ''
    try {
      const { data } = await api.post(`${ACTIVITY_API}/share-key/remove`, { gid: shopGid }, { headers: headers(targetId) })
      if (!data?.ok) throw new Error(text(data?.error, '移出比价失败'))
      friendShops.value = friendShops.value.filter(shop => shop.gid !== shopGid)
      await scanFriendShops(targetId, true)
      return true
    }
    catch (err: any) {
      error.value = errorMessage(err, '移出比价失败')
      return false
    }
    finally {
      pending.value = ''
    }
  }

  return {
    state, catalog, recordsList, friendShops, friendScanAt, notes,
    loading, pending, error, needsRefresh,
    loadingCatalog, loadingRecords, loadingFriends,
    walletKnown, sweetPotatoCount, luckCoinBalance,
    load, loadCatalog, loadRecords, loadShop, queryShopQuote, scanFriendShops, operate,
    importShareKey, forgetShareKey, clear,
  }
})
