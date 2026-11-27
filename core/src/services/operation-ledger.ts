export {};
const { appendEntry, clampInt, dateKeyOf, DAY_MS, paginate, pruneBefore, readEntries } = require('./ledger-store');

/**
 * 农作物流水 + 牧场流水
 *
 * namespace: 'farm-ledger'  → 农场操作（买种子、种植、收获、出售）
 * namespace: 'ranch-ledger' → 牧场操作（所有 operate 动作）
 *
 * 写入在 worker 内，读取在主进程 API 内，只通过磁盘文件交互。
 */

const FARM_NS = 'farm-ledger';
const RANCH_NS = 'ranch-ledger';
const RETENTION_DAYS = 30;
const MAX_QUERY_LIMIT = 500;
const FARM_OPS = ['buy_seed', 'plant', 'harvest', 'sell'] as const;

export type FarmOpType = typeof FARM_OPS[number];

export interface FarmEntry {
    id: string;
    ts: number;
    op: FarmOpType;
    // 买种子
    seedId?: number;
    seedName?: string;
    count?: number;
    totalCost?: number;
    unitPrice?: number;
    // 种植
    landCount?: number;
    landIds?: number[];
    // 收获
    harvestCount?: number;
    harvestInfo?: Array<{ landId: number; plantId?: number; name?: string; exp?: number; fruitNum?: number }>;
    goldDelta?: number;
    expDelta?: number;
    // 出售
    items?: Array<{ id: number; name: string; count: number; unitPrice?: number }>;
    goldEarned?: number;
}

export interface RanchEntry {
    id: string;
    ts: number;
    action: string;
    label: string;
    completed: number;
    costs: Array<{ id: number; name: string; count: number }>;
    rewards: Array<{ id: number; name: string; count: number }>;
}

let seq = 0;
function makeId(now: number): string {
    return `${now}-${process.pid}-${++seq}`;
}

function writeEntry(namespace: string, accountId: string, entry: any, now: number): void {
    try {
        pruneBefore(namespace, accountId, now, RETENTION_DAYS);
        appendEntry(namespace, accountId, now, entry);
    } catch {
        // 旁路记录，不影响主流程
    }
}

/** 写入发生在账号 worker 内，账号由 worker 启动时注入的环境变量决定，调用方不需要传。 */
function currentAccountId(): string {
    try { return process.env.FARM_ACCOUNT_ID || ''; } catch { return ''; }
}

// ============ 农场写入 ============

function recordFarmEntry(fields: Omit<FarmEntry, 'id' | 'ts'>, now: number = Date.now()): void {
    const accountId = currentAccountId();
    if (!accountId) return;
    const entry: FarmEntry = { id: makeId(now), ts: now, ...fields };
    writeEntry(FARM_NS, accountId, entry, now);
}

function recordBuySeed(params: { seedId: number; seedName: string; count: number; totalCost: number; unitPrice: number }, now?: number): void {
    recordFarmEntry({ op: 'buy_seed', ...params }, now);
}

function recordPlant(params: { seedId: number; seedName: string; landCount: number; landIds?: number[] }, now?: number): void {
    recordFarmEntry({ op: 'plant', ...params }, now);
}

function recordHarvest(params: {
    harvestCount: number;
    harvestInfo?: Array<{ landId: number; plantId?: number; name?: string; exp?: number; fruitNum?: number }>;
    goldDelta?: number;
    expDelta?: number;
}, now?: number): void {
    recordFarmEntry({ op: 'harvest', ...params }, now);
}

function recordSell(params: {
    items: Array<{ id: number; name: string; count: number; unitPrice?: number }>;
    goldEarned: number;
}, now?: number): void {
    recordFarmEntry({ op: 'sell', ...params }, now);
}

// ============ 牧场写入 ============

function recordRanchOperation(params: {
    action: string;
    label: string;
    completed: number;
    costs: Array<{ id: number; name: string; count: number }>;
    rewards: Array<{ id: number; name: string; count: number }>;
}, now: number = Date.now()): void {
    const accountId = currentAccountId();
    if (!accountId) return;
    const entry: RanchEntry = { id: makeId(now), ts: now, ...params };
    writeEntry(RANCH_NS, accountId, entry, now);
}

// ============ 读取（主进程 API） ============

export interface LedgerQuery {
    days?: number;
    op?: string;
    limit?: number;
    before?: string;
    now?: number;
}

interface ItemTotal { id: number; name: string; count: number }

function addItems(totals: Map<number, ItemTotal>, items: any[] | undefined): void {
    for (const item of items || []) {
        const id = Number(item?.id);
        const count = Number(item?.count) || 0;
        if (!Number.isFinite(id) || count === 0) continue;
        const current = totals.get(id) || { id, name: String(item.name || `物品${id}`), count: 0 };
        current.count += count;
        totals.set(id, current);
    }
}

function sortedTotals(totals: Map<number, ItemTotal>): ItemTotal[] {
    return Array.from(totals.values()).sort((a, b) => b.count - a.count);
}

/** 农场汇总：每类动作的次数、数量（种子数 / 地块数 / 果实数）、金币与经验。 */
function summarizeFarm(entries: FarmEntry[]) {
    const summary: Record<FarmOpType, { times: number; quantity: number; gold: number; exp: number }> = {
        buy_seed: { times: 0, quantity: 0, gold: 0, exp: 0 },
        plant: { times: 0, quantity: 0, gold: 0, exp: 0 },
        harvest: { times: 0, quantity: 0, gold: 0, exp: 0 },
        sell: { times: 0, quantity: 0, gold: 0, exp: 0 },
    };
    for (const entry of entries) {
        const bucket = summary[entry.op];
        if (!bucket) continue;
        bucket.times += 1;
        if (entry.op === 'buy_seed') {
            bucket.quantity += Number(entry.count) || 0;
            bucket.gold += Number(entry.totalCost) || 0;
        } else if (entry.op === 'plant') {
            bucket.quantity += Number(entry.landCount) || 0;
        } else if (entry.op === 'harvest') {
            bucket.quantity += Number(entry.harvestCount) || 0;
            bucket.exp += (entry.harvestInfo || []).reduce((sum, info) => sum + (Number(info.exp) || 0), 0);
        } else if (entry.op === 'sell') {
            bucket.quantity += (entry.items || []).reduce((sum, item) => sum + (Number(item.count) || 0), 0);
            bucket.gold += Number(entry.goldEarned) || 0;
        }
    }
    return summary;
}

/** 牧场汇总：各动作次数，以及区间内累计消耗与收益（按物品合并）。 */
function summarizeRanch(entries: RanchEntry[]) {
    const actions = new Map<string, { action: string; label: string; times: number; completed: number }>();
    const costs = new Map<number, ItemTotal>();
    const rewards = new Map<number, ItemTotal>();
    for (const entry of entries) {
        const current = actions.get(entry.action) || { action: entry.action, label: entry.label, times: 0, completed: 0 };
        current.times += 1;
        current.completed += Number(entry.completed) || 0;
        actions.set(entry.action, current);
        addItems(costs, entry.costs);
        addItems(rewards, entry.rewards);
    }
    return {
        actions: Array.from(actions.values()).sort((a, b) => b.times - a.times),
        costs: sortedTotals(costs),
        rewards: sortedTotals(rewards),
    };
}

function queryLedger(namespace: string, accountId: string, query: LedgerQuery = {}) {
    const now = Number.isFinite(Number(query.now)) ? Number(query.now) : Date.now();
    const days = clampInt(query.days, 1, RETENTION_DAYS, 1);
    const limit = clampInt(query.limit, 1, MAX_QUERY_LIMIT, 100);
    const startKey = dateKeyOf(now - (days - 1) * DAY_MS);
    const opFilter = typeof query.op === 'string' && query.op ? query.op : '';

    const all = readEntries(namespace, accountId, startKey)
        .sort((a: any, b: any) => (b.ts - a.ts) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
    // 汇总覆盖整个时间范围，不受动作筛选影响：卡片同时充当筛选入口，切换筛选时数字不能跟着变
    const summary = namespace === RANCH_NS ? summarizeRanch(all) : summarizeFarm(all);
    const entries = opFilter ? all.filter((e: any) => (e.op || e.action) === opFilter) : all;

    const { entries: page, hasMore, cursorInvalid, nextCursor } = paginate(entries, limit, query.before);
    return { days, startDate: startKey, op: opFilter, entries: page, hasMore, cursorInvalid, nextCursor, summary };
}

function readFarmLedger(accountId: string, query?: LedgerQuery) {
    return queryLedger(FARM_NS, accountId, query);
}

function readRanchLedger(accountId: string, query?: LedgerQuery) {
    return queryLedger(RANCH_NS, accountId, query);
}

module.exports = {
    FARM_NS,
    RANCH_NS,
    FARM_OPS,
    recordBuySeed,
    recordPlant,
    recordHarvest,
    recordSell,
    recordRanchOperation,
    readFarmLedger,
    readRanchLedger,
};
