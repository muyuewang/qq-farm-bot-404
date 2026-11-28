export {};
const { appendEntry, clampInt, dateKeyOf, DAY_MS, paginate, pruneBefore, readEntries } = require('./ledger-store');

/**
 * 农作物流水 + 牧场流水
 *
 * namespace: 'farm-ledger'  → 农场操作（买种子、种植、施肥、收获、出售）
 * namespace: 'ranch-ledger' → 牧场操作（所有 operate 动作，以及每日福利罐头）
 *
 * 写入在 worker 内，读取在主进程 API 内，只通过磁盘文件交互。
 */

const FARM_NS = 'farm-ledger';
const RANCH_NS = 'ranch-ledger';
const RETENTION_DAYS = 30;
const MAX_QUERY_LIMIT = 500;
const FARM_OPS = ['buy_seed', 'plant', 'fertilize', 'harvest', 'sell'] as const;
const FERTILIZER_NAMES: Record<number, string> = { 1011: '普通化肥', 1012: '有机化肥' };

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
    // 种植 / 施肥
    landCount?: number;
    landIds?: number[];
    // 施肥：有机肥会对同一块地循环施多次，times 是成功次数，landCount 是去重后的地块数
    fertilizerId?: number;
    fertilizerName?: string;
    times?: number;
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

/**
 * 施肥：landIds 是服务端确认成功的每一次施肥（有机肥循环时同一地块会重复出现），
 * 一次调用合并成一条，避免有机肥循环几百次把流水刷屏。
 */
function recordFertilize(params: { fertilizerId: number; landIds: number[] }, now?: number): void {
    const applied = (params.landIds || []).map(Number).filter(id => Number.isFinite(id) && id > 0);
    if (applied.length === 0) return;
    const fertilizerId = Number(params.fertilizerId) || 0;
    const landIds = [...new Set(applied)];
    recordFarmEntry({
        op: 'fertilize',
        fertilizerId,
        fertilizerName: FERTILIZER_NAMES[fertilizerId] || `化肥${fertilizerId}`,
        times: applied.length,
        landCount: landIds.length,
        landIds,
    }, now);
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

// ============ 标准指标 ============
// 农作物与牧场统一按「次数 / 经验 / 收入 / 支出」展示：
// 农场的经验是账号经验、货币是金币；牧场的经验是牧场经验（1102）、货币是金券（1007）。

export interface EntryMetrics { exp: number; income: number; expense: number }

export interface ActionSummary extends EntryMetrics {
    key: string;
    label: string;
    times: number;
}

interface SceneMeta {
    expLabel: string;
    currency: { id: number; name: string };
    // 已经归入经验、收入、支出的物品，明细里不再重复列出
    standardItemIds: number[];
}

const FARM_LABELS: Record<FarmOpType, string> = { buy_seed: '买种子', plant: '种植', fertilize: '施肥', harvest: '收获', sell: '出售' };
// 牧场动作的通用短名：汇总与筛选按动作归类，「购买火鸡 ×1」「升级窝室3级」这类具体内容只出现在明细里
const RANCH_LABELS: Record<string, string> = {
    buy: '购买', place: '放养', addGrass: '补充牧草', useCan: '添加罐头', feed: '喂养', produce: '生产',
    harvest: '收获', sell: '出售', clean: '清理', activateShed: '解锁棚', upgrade: '升级', speedUpUpgrade: '加速升级',
    completeUpgrade: '完成升级', claimTasks: '任务', reportEntry: '引导', exchange: '兑换', claimIllustrated: '图鉴',
    claimDailyShare: '分享礼包', claimDailyBenefit: '每日福利', buyCan: '购买罐头', buyMall: '商城购买', release: '放生',
};
const RANCH_EXP_ID = 1102;
const RANCH_CURRENCY_ID = 1007;
const FARM_META: SceneMeta = { expLabel: '经验', currency: { id: 1001, name: '金币' }, standardItemIds: [] };
const RANCH_META: SceneMeta = { expLabel: '牧场经验', currency: { id: RANCH_CURRENCY_ID, name: '金券' }, standardItemIds: [RANCH_EXP_ID, RANCH_CURRENCY_ID] };

function sumItem(items: any[] | undefined, id: number): number {
    return (items || []).reduce((sum, item) => sum + (Number(item?.id) === id ? Number(item?.count) || 0 : 0), 0);
}

function farmMetrics(entry: FarmEntry): EntryMetrics {
    return {
        exp: entry.op === 'harvest' ? (entry.harvestInfo || []).reduce((sum, info) => sum + (Number(info.exp) || 0), 0) : 0,
        income: entry.op === 'sell' ? Number(entry.goldEarned) || 0 : 0,
        expense: entry.op === 'buy_seed' ? Number(entry.totalCost) || 0 : 0,
    };
}

function ranchMetrics(entry: RanchEntry): EntryMetrics {
    return {
        exp: sumItem(entry.rewards, RANCH_EXP_ID),
        income: sumItem(entry.rewards, RANCH_CURRENCY_ID),
        expense: sumItem(entry.costs, RANCH_CURRENCY_ID),
    };
}

function actionKeyOf(entry: any): string {
    return String(entry?.op || entry?.action || '');
}

function actionLabel(isRanch: boolean, key: string): string {
    return (isRanch ? RANCH_LABELS[key] : FARM_LABELS[key as FarmOpType]) || key;
}

/**
 * 两个场景同一结构的汇总：total 是全部动作合计，actions 是逐动作的同口径数据，
 * 只列出发生过的动作，按次数从多到少（同次数时农场按流程顺序、牧场按动作键）。
 * 正在筛选的动作即使在当前时间范围内没有记录也保留，避免筛选入口凭空消失。
 */
function summarize(scene: 'farm' | 'ranch', entries: any[], opFilter = '') {
    const isRanch = scene === 'ranch';
    const meta = isRanch ? RANCH_META : FARM_META;
    const total = { times: 0, exp: 0, income: 0, expense: 0 };
    const actions = new Map<string, ActionSummary>();
    const emptyAction = (key: string): ActionSummary => ({ key, label: actionLabel(isRanch, key), times: 0, exp: 0, income: 0, expense: 0 });
    for (const entry of entries) {
        const key = actionKeyOf(entry);
        if (!key || (!isRanch && !(FARM_OPS as readonly string[]).includes(key))) continue;
        const action = actions.get(key) || emptyAction(key);
        const metrics = isRanch ? ranchMetrics(entry) : farmMetrics(entry);
        action.times += 1;
        action.exp += metrics.exp;
        action.income += metrics.income;
        action.expense += metrics.expense;
        actions.set(key, action);
        total.times += 1;
        total.exp += metrics.exp;
        total.income += metrics.income;
        total.expense += metrics.expense;
    }
    if (opFilter && !actions.has(opFilter)) actions.set(opFilter, emptyAction(opFilter));
    const order = (key: string) => (isRanch ? 0 : (FARM_OPS as readonly string[]).indexOf(key));
    return {
        ...meta,
        total,
        actions: Array.from(actions.values()).sort((a, b) => (b.times - a.times) || (order(a.key) - order(b.key)) || a.key.localeCompare(b.key)),
    };
}

function queryLedger(namespace: string, accountId: string, query: LedgerQuery = {}) {
    const now = Number.isFinite(Number(query.now)) ? Number(query.now) : Date.now();
    const days = clampInt(query.days, 1, RETENTION_DAYS, 1);
    const limit = clampInt(query.limit, 1, MAX_QUERY_LIMIT, 100);
    const startKey = dateKeyOf(now - (days - 1) * DAY_MS);
    const opFilter = typeof query.op === 'string' && query.op ? query.op : '';
    const isRanch = namespace === RANCH_NS;

    const all = readEntries(namespace, accountId, startKey)
        .sort((a: any, b: any) => (b.ts - a.ts) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
    // 汇总覆盖整个时间范围，不受动作筛选影响：筛选标签上的次数在切换筛选时不能跟着变
    const summary = summarize(isRanch ? 'ranch' : 'farm', all, opFilter);
    const entries = opFilter ? all.filter((e: any) => actionKeyOf(e) === opFilter) : all;
    // 按服务器时区切天：明细按天分组时用同一口径，前端不自行猜测时区
    const dayCounts: Record<string, number> = {};
    for (const entry of entries) {
        const day = dateKeyOf(entry.ts);
        dayCounts[day] = (dayCounts[day] || 0) + 1;
    }

    const { entries: page, hasMore, cursorInvalid, nextCursor } = paginate(entries, limit, query.before);
    // 每条明细附带通用动作名、所属日期和同口径指标，前端不再各自解析
    const enriched = page.map((entry: any) => ({
        ...entry,
        actionLabel: actionLabel(isRanch, actionKeyOf(entry)),
        day: dateKeyOf(entry.ts),
        metrics: isRanch ? ranchMetrics(entry) : farmMetrics(entry),
    }));
    return { days, startDate: startKey, today: dateKeyOf(now), op: opFilter, entries: enriched, dayCounts, hasMore, cursorInvalid, nextCursor, summary };
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
    recordFertilize,
    recordHarvest,
    recordSell,
    recordRanchOperation,
    readFarmLedger,
    readRanchLedger,
};
