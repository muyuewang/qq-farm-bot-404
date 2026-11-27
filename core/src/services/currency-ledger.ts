export {};
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const ledgerStore = require('./ledger-store');

/**
 * 货币流水：金币、点券、钻石、金豆的逐笔变化。
 *
 * 服务端推送（ItemNotify / BasicNotify / RechargeInfoNotify）不带变动原因，同一笔变化还可能被
 * 多条推送重复报告。因此这里按「余额观测」记账：每次拿到权威余额就与上次已知余额比较，差值非零
 * 才记一笔，重复推送自然得到差值 0。原因由调用方按推送到达时正在处理的请求推断后传入。
 *
 * 写入发生在账号 worker 内，读取发生在主进程 API 内，两边只通过磁盘文件交互：
 * data/currency-ledger/<账号>/<YYYY-MM-DD>.ndjson 逐行追加，state.json 保存各货币最后余额。
 */

export type LedgerCurrency = 'gold' | 'coupon' | 'diamond' | 'goldBean';

export interface LedgerAttribution {
    key: string;
    label: string;
    method?: string;
    candidates?: string[];
}

export interface LedgerEntry {
    id: string;
    ts: number;
    currency: LedgerCurrency;
    delta: number;
    balanceBefore: number;
    balanceAfter: number;
    reasonKey: string;
    reason: string;
    method?: string;
    candidates?: string[];
}

export interface RequestTrace {
    serviceName: string;
    methodName: string;
    at: number;
}

const CURRENCIES: LedgerCurrency[] = ['gold', 'coupon', 'diamond', 'goldBean'];
const NAMESPACE = 'currency-ledger';
const RETENTION_DAYS = 30;
const RECENT_WINDOW_MS = 2000;
const MAX_QUERY_LIMIT = 500;
const READ_ONLY_METHOD = /^(Get|All|Query|List|Fetch|Load|Check|Heartbeat|Sync|Ping|Bag|ShopInfo|TaskInfo|CareerInfoGet)/;

const ATTRIBUTION_LOGIN_SYNC: LedgerAttribution = { key: 'login_sync', label: '登录校准（离线期间的变化）' };
const ATTRIBUTION_BALANCE_REFRESH: LedgerAttribution = { key: 'balance_refresh', label: '余额刷新（未收到推送的变化）' };
const ATTRIBUTION_SERVER_PUSH: LedgerAttribution = { key: 'server_push', label: '服务端推送（无对应请求）' };

const METHOD_LABELS: Record<string, string> = {
    'ShopService.BuyGoods': '商店购买',
    'MallService.Purchase': '商城购买',
    'MallService.ClaimMonthCardReward': '月卡奖励',
    'ItemService.Sell': '出售',
    'ItemService.Use': '使用道具',
    'ItemService.BatchUse': '批量使用道具',
    'PlantService.Plant': '种植',
    'PlantService.Harvest': '收获',
    'PlantService.Fertilize': '施肥',
    'PlantService.Farming': '一键务农',
    'PlantService.WaterLand': '浇水',
    'PlantService.RemovePlant': '铲除',
    'PlantService.PutSocialItem': '放置互动道具',
    'PlantService.UnlockLand': '解锁土地',
    'PlantService.UpgradeLand': '升级土地',
    'TaskService.ClaimTaskReward': '任务奖励',
    'TaskService.ClaimDailyReward': '活跃奖励',
    'EmailService.ClaimEmail': '邮件领取',
    'EmailService.BatchClaimEmail': '邮件批量领取',
    'ShareService.ClaimShareReward': '分享奖励',
    'QQVipService.ClaimQQVipRewards': 'QQ 会员礼包',
    'SeasonService.ClaimBattlePassRewards': '赛季通行证奖励',
    'SolarTermsService.ClaimSolarTerms': '节气奖励',
    'GuideService.ClaimWeakGuideReward': '引导奖励',
    'ActivityService.Operate': '活动操作',
    'DogService.AddFood': '狗粮投喂',
    'DogService.ActivateDog': '激活狗狗',
    'DogService.ClaimSkillGifts': '狗狗技能礼物',
    'VisitService.Enter': '访问好友农场',
    'VisitService.Leave': '离开好友农场',
};

// ============ 公共工具 ============

const { accountKey, dateKeyOf } = ledgerStore;

function isCurrency(value: unknown): value is LedgerCurrency {
    return CURRENCIES.includes(value as LedgerCurrency);
}

function describeMethod(serviceName: string, methodName: string): LedgerAttribution {
    const svc = String(serviceName || '').split('.').pop() || '';
    const method = `${svc}.${methodName || ''}`;
    return { key: method, label: METHOD_LABELS[method] || method, method };
}

/**
 * 推送不带原因，只能看它到达时网关上在处理哪些请求：服务端通常先推送物品变化再回包，
 * 所以优先取仍在等待回包的请求，其次取 2 秒内刚完成的请求；同一批里写操作优先于只读查询。
 */
function pickAttribution(pending: RequestTrace[], recent: RequestTrace[], now: number): LedgerAttribution {
    const rank = (list: RequestTrace[]) => list
        .filter(item => item && item.methodName)
        .sort((a, b) => {
            const readA = READ_ONLY_METHOD.test(a.methodName) ? 1 : 0;
            const readB = READ_ONLY_METHOD.test(b.methodName) ? 1 : 0;
            return readA - readB || b.at - a.at;
        });
    let chosen = rank(pending || []);
    if (chosen.length === 0) chosen = rank((recent || []).filter(item => now - item.at <= RECENT_WINDOW_MS));
    if (chosen.length === 0) return { ...ATTRIBUTION_SERVER_PUSH };
    const primary = describeMethod(chosen[0].serviceName, chosen[0].methodName);
    const candidates = chosen.slice(1, 4).map(item => describeMethod(item.serviceName, item.methodName).method!);
    return candidates.length > 0 ? { ...primary, candidates } : primary;
}

// ============ 写入（账号 worker 内） ============

interface WriterState {
    balances: Partial<Record<LedgerCurrency, number>>;
    seen: Set<LedgerCurrency>;
}

const writers: Map<string, WriterState> = new Map();
let sequence = 0;

function statePath(accountId: string): string {
    return path.join(ledgerStore.namespaceDir(NAMESPACE, accountId), 'state.json');
}

function writerFor(accountId: string): WriterState {
    let state = writers.get(accountId);
    if (!state) {
        const saved = readJsonFile(statePath(accountId), () => ({}));
        const balances: Partial<Record<LedgerCurrency, number>> = {};
        for (const currency of CURRENCIES) {
            const value = Number(saved?.balances?.[currency]);
            if (Number.isFinite(value) && value >= 0) balances[currency] = value;
        }
        state = { balances, seen: new Set() };
        writers.set(accountId, state);
    }
    return state;
}

function saveState(accountId: string, state: WriterState, now: number): void {
    writeJsonFileAtomic(statePath(accountId), { balances: state.balances, updatedAt: now }, 0);
}

/**
 * 记录一次权威余额。与上次已知余额不同时追加一笔流水并返回它，否则返回 null。
 * 本次进程内首次观测到某货币时，差值来自离线期间（手机上操作等），统一标为登录校准。
 */
function observeBalance(accountId: string, currency: LedgerCurrency, balance: number, attribution?: LedgerAttribution | null, now: number = Date.now()): LedgerEntry | null {
    try {
        const nextBalance = Number(balance);
        if (!accountId || !isCurrency(currency) || !Number.isFinite(nextBalance) || nextBalance < 0) return null;
        const state = writerFor(accountId);
        const previous = state.balances[currency];
        const firstInSession = !state.seen.has(currency);
        state.seen.add(currency);
        state.balances[currency] = nextBalance;
        if (previous === undefined) {
            saveState(accountId, state, now);
            return null;
        }
        const delta = nextBalance - previous;
        if (delta === 0) return null;
        const reason = firstInSession ? ATTRIBUTION_LOGIN_SYNC : (attribution || ATTRIBUTION_SERVER_PUSH);
        const entry: LedgerEntry = {
            id: `${now}-${process.pid}-${++sequence}`,
            ts: now,
            currency,
            delta,
            balanceBefore: previous,
            balanceAfter: nextBalance,
            reasonKey: reason.key,
            reason: reason.label,
        };
        if (reason.method) entry.method = reason.method;
        if (reason.candidates && reason.candidates.length > 0) entry.candidates = reason.candidates;
        ledgerStore.pruneBefore(NAMESPACE, accountId, now, RETENTION_DAYS);
        ledgerStore.appendEntry(NAMESPACE, accountId, now, entry);
        saveState(accountId, state, now);
        return entry;
    } catch {
        // 流水只是旁路记录，任何磁盘错误都不能影响推送处理
        return null;
    }
}

/**
 * 只有增量的推送：仅在本次进程已建立可信余额后才换算成余额记账；
 * 登录后背包尚未初始化时 userState 里的点券/金豆还是 0，不能拿来当基线。
 */
function observeDelta(accountId: string, currency: LedgerCurrency, delta: number, attribution?: LedgerAttribution | null, now: number = Date.now()): LedgerEntry | null {
    const change = Number(delta);
    if (!accountId || !isCurrency(currency) || !Number.isFinite(change) || change === 0) return null;
    const state = writerFor(accountId);
    const previous = state.balances[currency];
    if (previous === undefined || !state.seen.has(currency)) return null;
    return observeBalance(accountId, currency, Math.max(0, previous + change), attribution, now);
}

function resetLedgerWritersForTest(): void {
    writers.clear();
    ledgerStore.resetPrunedStateForTest();
}

// ============ 读取（主进程 API） ============

export interface LedgerQuery {
    days?: number;
    currency?: string;
    limit?: number;
    before?: string;
    now?: number;
}

interface ReasonSummary {
    reasonKey: string;
    reason: string;
    income: number;
    expense: number;
    count: number;
}

interface CurrencySummary {
    income: number;
    expense: number;
    net: number;
    count: number;
    reasons: ReasonSummary[];
}

function summarize(entries: LedgerEntry[]): Record<string, CurrencySummary> {
    const summary: Record<string, CurrencySummary> = {};
    const reasonMaps: Record<string, Map<string, ReasonSummary>> = {};
    for (const entry of entries) {
        const bucket = summary[entry.currency] || (summary[entry.currency] = { income: 0, expense: 0, net: 0, count: 0, reasons: [] });
        const reasons = reasonMaps[entry.currency] || (reasonMaps[entry.currency] = new Map());
        const reason = reasons.get(entry.reasonKey) || { reasonKey: entry.reasonKey, reason: entry.reason, income: 0, expense: 0, count: 0 };
        if (entry.delta > 0) {
            bucket.income += entry.delta;
            reason.income += entry.delta;
        } else {
            bucket.expense += -entry.delta;
            reason.expense += -entry.delta;
        }
        bucket.count += 1;
        reason.count += 1;
        reasons.set(entry.reasonKey, reason);
    }
    for (const currency of Object.keys(summary)) {
        summary[currency].net = summary[currency].income - summary[currency].expense;
        summary[currency].reasons = Array.from(reasonMaps[currency].values())
            .sort((a, b) => (b.expense + b.income) - (a.expense + a.income));
    }
    return summary;
}

function readLedger(accountId: string, query: LedgerQuery = {}) {
    const now = Number.isFinite(Number(query.now)) ? Number(query.now) : Date.now();
    const days = ledgerStore.clampInt(query.days, 1, RETENTION_DAYS, 1);
    const limit = ledgerStore.clampInt(query.limit, 1, MAX_QUERY_LIMIT, 100);
    const currency = isCurrency(query.currency) ? query.currency : '';
    const startKey = dateKeyOf(now - (days - 1) * ledgerStore.DAY_MS);

    let entries: LedgerEntry[] = ledgerStore.readEntries(NAMESPACE, accountId, startKey, (entry: any) => isCurrency(entry.currency));
    if (currency) entries = entries.filter(entry => entry.currency === currency);
    entries.sort((a, b) => (b.ts - a.ts) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));

    // 游标失效（超出保留期被清理、筛选范围变化等）时返回空页并标记 cursorInvalid，
    // 调用方据此重新从首页拉取，而不是把它当成「确实没有更多数据」。
    const page = ledgerStore.paginate(entries, limit, query.before);
    return {
        days,
        startDate: startKey,
        currency,
        entries: page.entries,
        hasMore: page.hasMore,
        cursorInvalid: page.cursorInvalid,
        nextCursor: page.nextCursor,
        summary: summarize(entries),
    };
}

module.exports = {
    ATTRIBUTION_BALANCE_REFRESH,
    ATTRIBUTION_LOGIN_SYNC,
    CURRENCIES,
    RETENTION_DAYS,
    accountKey,
    dateKeyOf,
    describeMethod,
    observeBalance,
    observeDelta,
    pickAttribution,
    readLedger,
    resetLedgerWritersForTest,
};
