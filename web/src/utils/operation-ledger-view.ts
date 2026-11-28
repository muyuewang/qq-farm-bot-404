// 农作物 / 牧场流水的纯展示逻辑：按天分组、连续同类记录合并、明细文案、指标来源。
// 不依赖 Vue 与运行时模块，数字格式化由调用方传入，便于用固定夹具测试。

export interface LedgerMetrics {
  exp: number
  income: number
  expense: number
}

export interface LedgerItem {
  id: number
  name: string
  count: number
}

export interface LedgerViewEntry {
  id: string
  ts: number
  day?: string
  op?: string
  action?: string
  actionLabel?: string
  metrics?: Partial<LedgerMetrics>
  // 牧场
  label?: string
  completed?: number
  costs?: LedgerItem[]
  rewards?: LedgerItem[]
  // 农场
  seedId?: number
  seedName?: string
  count?: number
  unitPrice?: number
  landCount?: number
  landIds?: number[]
  fertilizerId?: number
  fertilizerName?: string
  times?: number
  harvestCount?: number
  harvestInfo?: Array<{ name?: string }>
  items?: LedgerItem[]
}

export interface LedgerRow<E extends LedgerViewEntry = LedgerViewEntry> {
  /** 首条（最新）记录的 id，加载更多后保持不变，可作为展开状态的键 */
  id: string
  key: string
  label: string
  entries: E[]
  earliestTs: number
  latestTs: number
  metrics: LedgerMetrics
}

export interface LedgerDay<E extends LedgerViewEntry = LedgerViewEntry> {
  day: string
  rows: LedgerRow<E>[]
}

export type LedgerTone = 'income' | 'expense' | 'exp' | 'none'
export type MetricKey = keyof LedgerMetrics
type Fmt = (value: number) => string

const plain: Fmt = value => String(value)

export function actionKeyOf(entry: LedgerViewEntry) {
  return String(entry.op || entry.action || '')
}

export function metricsOf(value?: Partial<LedgerMetrics> | null): LedgerMetrics {
  return {
    exp: Number(value?.exp) || 0,
    income: Number(value?.income) || 0,
    expense: Number(value?.expense) || 0,
  }
}

function addMetrics(a: LedgerMetrics, b: LedgerMetrics): LedgerMetrics {
  return { exp: a.exp + b.exp, income: a.income + b.income, expense: a.expense + b.expense }
}

/** 两个场景同一套着色：有收入、有支出、只得经验、其他。 */
export function toneOf(metrics: LedgerMetrics): LedgerTone {
  if (metrics.income > 0)
    return 'income'
  if (metrics.expense > 0)
    return 'expense'
  if (metrics.exp > 0)
    return 'exp'
  return 'none'
}

/**
 * 明细按服务器给出的日期分组；merge 为真时把同一天内连续的同类记录合并成一行。
 * 记录须已按时间倒序。筛选单一动作时调用方应关闭合并，否则整天会被并成一行。
 */
export function groupLedgerEntries<E extends LedgerViewEntry>(entries: E[], merge: boolean): LedgerDay<E>[] {
  const days: LedgerDay<E>[] = []
  for (const entry of entries) {
    const day = entry.day || ''
    let current: LedgerDay<E> | undefined = days[days.length - 1]
    if (!current || current.day !== day) {
      current = { day, rows: [] }
      days.push(current)
    }
    const key = actionKeyOf(entry)
    const metrics = metricsOf(entry.metrics)
    const last: LedgerRow<E> | undefined = current.rows[current.rows.length - 1]
    if (merge && last && last.key === key) {
      last.entries.push(entry)
      last.earliestTs = Math.min(last.earliestTs, entry.ts)
      last.latestTs = Math.max(last.latestTs, entry.ts)
      last.metrics = addMetrics(last.metrics, metrics)
      continue
    }
    current.rows.push({ id: entry.id, key, label: entry.actionLabel || key, entries: [entry], earliestTs: entry.ts, latestTs: entry.ts, metrics })
  }
  return days
}

export function mergeItems(lists: Array<LedgerItem[] | undefined>): LedgerItem[] {
  const totals = new Map<number, LedgerItem>()
  for (const list of lists) {
    for (const item of list || []) {
      const id = Number(item.id)
      const count = Number(item.count) || 0
      if (!Number.isFinite(id) || count === 0)
        continue
      const current = totals.get(id) || { id, name: item.name || `物品${id}`, count: 0 }
      current.count += count
      totals.set(id, current)
    }
  }
  return Array.from(totals.values()).sort((a, b) => b.count - a.count)
}

export function itemsText(items: LedgerItem[] | undefined, fmt: Fmt = plain, max = 4) {
  if (!items?.length)
    return ''
  const text = items.slice(0, max).map(item => `${item.name}×${fmt(item.count)}`).join('、')
  return items.length > max ? `${text} 等` : text
}

function uniqueNames(names: Array<string | undefined>, max = 3) {
  const list = Array.from(new Set(names.filter((name): name is string => !!name)))
  return list.length > max ? `${list.slice(0, max).join('、')} 等` : list.join('、')
}

function sum(entries: LedgerViewEntry[], pick: (entry: LedgerViewEntry) => number | undefined) {
  return entries.reduce((total, entry) => total + (Number(pick(entry)) || 0), 0)
}

function joinParts(parts: string[]) {
  return parts.filter(Boolean).join(' · ')
}

/** 牧场明细只补充经验、金券以外的物品，标准指标已有单独位置。 */
function ranchItemsDetail(entries: LedgerViewEntry[], standardIds: Set<number>, fmt: Fmt) {
  const keep = (items?: LedgerItem[]) => (items || []).filter(item => !standardIds.has(Number(item.id)))
  const costs = mergeItems(entries.map(entry => keep(entry.costs)))
  const rewards = mergeItems(entries.map(entry => keep(entry.rewards)))
  return joinParts([costs.length ? `消耗 ${itemsText(costs, fmt)}` : '', rewards.length ? `获得 ${itemsText(rewards, fmt)}` : ''])
}

function seedName(entry: LedgerViewEntry) {
  return entry.seedName ?? `种子${entry.seedId ?? ''}`
}

function landsText(entries: LedgerViewEntry[]) {
  const ids = Array.from(new Set(entries.flatMap(entry => entry.landIds || [])))
  return ids.length ? `地块 ${ids.join(', ')}` : ''
}

export function describeEntry(entry: LedgerViewEntry, standardIds: Set<number>, fmt: Fmt = plain): { title: string, detail: string } {
  if (!entry.op) {
    const completed = Number(entry.completed) || 0
    const label = entry.label || entry.actionLabel || actionKeyOf(entry)
    return { title: completed > 1 ? `${label} ×${completed}` : label, detail: ranchItemsDetail([entry], standardIds, fmt) }
  }
  if (entry.op === 'buy_seed')
    return { title: `${seedName(entry)} ×${entry.count ?? 0}`, detail: entry.unitPrice ? `单价 ${fmt(entry.unitPrice)}` : '' }
  if (entry.op === 'plant')
    return { title: `${seedName(entry)} 种下 ${entry.landCount ?? 0} 块`, detail: landsText([entry]) }
  if (entry.op === 'fertilize') {
    const name = entry.fertilizerName ?? `化肥${entry.fertilizerId ?? ''}`
    const lands = entry.landCount ?? 0
    const times = entry.times ?? lands
    // 有机肥会对同一块地循环施多次，次数和地块数不同时两者都要显示
    return { title: times === lands ? `${name} 施 ${lands} 块` : `${name} 施 ${times} 次 · ${lands} 块`, detail: landsText([entry]) }
  }
  if (entry.op === 'harvest') {
    const names = uniqueNames((entry.harvestInfo || []).map(info => info.name))
    const count = entry.harvestCount ?? 0
    return { title: names ? `${names} 共 ${count} 块` : `收获 ${count} 块`, detail: '' }
  }
  const items = entry.items || []
  const total = items.reduce((acc, item) => acc + (Number(item.count) || 0), 0)
  return { title: itemsText(items, fmt, 3) || '出售', detail: items.length > 1 ? `共 ${fmt(total)} 个` : '' }
}

/** 单条记录照常描述；合并行用动作名做标题，明细给出合计。 */
export function describeRow(row: LedgerRow, standardIds: Set<number>, fmt: Fmt = plain): { title: string, detail: string } {
  const [first] = row.entries
  if (row.entries.length === 1 || !first)
    return first ? describeEntry(first, standardIds, fmt) : { title: row.label, detail: '' }
  const entries = row.entries
  if (!first.op) {
    const labels = new Set(entries.map(entry => entry.label || ''))
    return { title: labels.size === 1 && first.label ? first.label : row.label, detail: ranchItemsDetail(entries, standardIds, fmt) }
  }
  if (first.op === 'plant')
    return { title: row.label, detail: `${uniqueNames(entries.map(entry => entry.seedName))} 共 ${sum(entries, entry => entry.landCount)} 块` }
  if (first.op === 'fertilize')
    return { title: row.label, detail: `${uniqueNames(entries.map(entry => entry.fertilizerName))} 共 ${sum(entries, entry => entry.times ?? entry.landCount)} 次` }
  if (first.op === 'harvest')
    return { title: row.label, detail: `${uniqueNames(entries.flatMap(entry => (entry.harvestInfo || []).map(info => info.name)))} 共 ${sum(entries, entry => entry.harvestCount)} 块` }
  if (first.op === 'buy_seed') {
    const seeds = mergeItems(entries.map(entry => [{ id: Number(entry.seedId) || 0, name: seedName(entry), count: Number(entry.count) || 0 }]))
    return { title: row.label, detail: itemsText(seeds, fmt, 3) }
  }
  const items = mergeItems(entries.map(entry => entry.items))
  const total = items.reduce((acc, item) => acc + item.count, 0)
  return { title: row.label, detail: joinParts([itemsText(items, fmt, 3), `共 ${fmt(total)} 个`]) }
}

/** 某项指标贡献最大的几个动作，用于指标卡副行。 */
export function topSources<A extends LedgerMetrics & { label: string }>(actions: A[], metric: MetricKey, limit = 2) {
  return actions
    .filter(action => action[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit)
    .map(action => ({ label: action.label, value: action[metric] }))
}

function shiftDay(day: string, offset: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match)
    return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 日期分组标题。day 与 today 都是服务器时区的 YYYY-MM-DD，这里只做字符串换算。 */
export function dayLabel(day: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return '日期未知'
  const short = day.slice(5)
  if (day === today)
    return `今天 · ${short}`
  if (day === shiftDay(today, -1))
    return `昨天 · ${short}`
  return day.slice(0, 4) === today.slice(0, 4) ? short : day
}
