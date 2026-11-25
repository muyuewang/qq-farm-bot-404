export {};

// 以薯换福的自动任务，按本项目既有习惯挂在 worker 的 scheduler 上，并串进
// automation-lock 的同一把全局锁：不会和农场/牧场/节令/牧歌挤在同一秒发请求。
//
// 三件事的顺序是有讲究的：
//   1. 领种子（cmd 91）—— 服务端只有「今天还没领」时才允许，领完当日行情才会生成；
//   2. 分享（cmd 98 + ShareService 上报）—— 每日首次触发暴击涨价，会抬高自己铺子的收购价；
//   3. 卖蜜薯（cmd 93）—— 背包里有蜜薯（红薯成熟收获后才有）才动，先比价再卖。
// 前两步是幂等的：服务端状态里已经有「今日已领 / 今日已分享」就直接跳过，不发写请求。
//
// 卖薯是唯一会消耗别人额度的写操作，所以额外做了三件事控制频率与风控面：
//   - 比价（cmd 92 逐个查好友铺子）按配置的间隔节流，间隔内复用上一轮排序结果；
//   - 单轮最多切 3 家铺子，笔间隔 1200ms，剩下的留到下一轮；
//   - 好友铺子额度不足/查不到只换下一家，不算失败，也不会重试同一笔。
// 「好友当天收购超量就换第二高」就是按 totalPrice 降序贪心：一家额度不够就吃满再往下走。
const YISHU_AUTOMATION_KEYS = [
    'yishu_claim_seed',
    'yishu_share',
    'yishu_auto_sell',
    'yishu_claim_commission',
] as const;

// 10 分钟一轮：比卖薯快得多，但每轮只是读一次活动状态，真正花请求的是「有蜜薯才比价」。
const YISHU_CHECK_INTERVAL_MS = 10 * 60 * 1000;
// 错相位：节令 19min、神秘商人 37min、牧歌 11min，以薯换福挑 4min。
const YISHU_CHECK_PHASE_MS = 4 * 60 * 1000;
// 首跑 260s：牧歌是 210s，登录后第一波活动读取不叠在同一秒。
const YISHU_INITIAL_DELAY_MS = 260000;
// 相邻两笔写之间隔这么久：连着发会把活动页的读和写挤在同一根连接上。
const YISHU_STEP_SPACER_MS = 1200;
// 单轮最多切换几家铺子：每卖一家就是一次 cmd 93 写，铺子越多越像脚本。
const YISHU_MAX_SHOPS_PER_RUN = 3;
// 这两种错误说明「这家现在卖不进去」，换下一家即可，不当作本轮失败。
const YISHU_SKIP_SHOP_CODES = new Set([
    'YSHF_SHOP_QUOTA_INSUFFICIENT',
    'YSHF_SHOP_UNKNOWN',
    // can_sell = false：这家铺子当前不收蜜薯，换下一家，不算整轮失败。
    'YSHF_SHOP_CLOSED',
]);

const DEFAULT_FRIEND_LIMIT = 20;
const DEFAULT_SCAN_INTERVAL_MINUTES = 30;
const DEFAULT_SELL_MIN_COUNT = 1;

function isYishuAutomationEnabled(automation: any = {}): boolean {
    return YISHU_AUTOMATION_KEYS.some(key => automation[key] === true);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toInt(value: any, fallback: number, min: number, max: number): number {
    const parsed = Number.parseInt(String(value), 10);
    const base = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, base));
}

function createYishuAutomation(deps: {
    getActivity: (options?: any) => Promise<any>;
    claimSeed: (options?: any) => Promise<any>;
    shareShop: (options?: any) => Promise<any>;
    claimCommission: (options?: any) => Promise<any>;
    scanFriends: (options?: any) => Promise<any>;
    sell: (friendGid: any, count: any, options?: any) => Promise<any>;
    getServerTimeSec: () => number;
    log: (module: string, message: string, meta?: any) => void;
}) {
    const { getActivity, claimSeed, shareShop, claimCommission, scanFriends, sell, getServerTimeSec, log } = deps;
    // 跳过原因按服务端日期去重：10 分钟一轮若每轮都记一行「今天已经领过」，日志会被刷满。
    const skipLoggedOn = new Map<string, string>();
    // 比价结果按「好友数上限 + 配置间隔」复用，避免每轮都把好友扫一遍。
    let scanCache: { at: number; limit: number; shops: any[] } | null = null;

    function todayKey(): string {
        return new Date((getServerTimeSec() + 8 * 3600) * 1000).toISOString().slice(0, 10);
    }

    function skip(action: string, text: string): void {
        const key = `${todayKey()}:${action}:${text}`;
        if (skipLoggedOn.get(action) === key) return;
        skipLoggedOn.set(action, key);
        log('活动', `以薯换福自动跳过 ${action}: ${text}`, { module: 'activity', event: '以薯换福自动', result: 'skip', action });
    }

    function done(action: string, text: string): void {
        log('活动', text, { module: 'activity', event: '以薯换福自动', result: 'success', action });
    }

    function failed(action: string, text: string): void {
        log('活动', text, { module: 'activity', event: '以薯换福自动', result: 'error', action });
    }

    /**
     * 好友铺子比价（cmd 92）。返回按成交价（基础价 + 加成）降序的铺子列表，
     * 里面也包含自己的铺子——「好友都收满就卖自己」是同一个贪心循环的尾部。
     */
    async function rankedShops(limit: number, intervalMinutes: number): Promise<any[]> {
        const now = Date.now();
        if (scanCache && scanCache.limit === limit && now - scanCache.at < intervalMinutes * 60 * 1000)
            return scanCache.shops;
        const result = await scanFriends({ limit, force: true });
        const shops = Array.isArray(result?.shops) ? result.shops : [];
        scanCache = { at: now, limit, shops };
        return shops;
    }

    async function sellSweetPotatoes(snapshot: any, options: {
        friendLimit: number;
        scanIntervalMinutes: number;
        sellMinCount: number;
        fallbackOwn: boolean;
    }): Promise<void> {
        const bagRaw = snapshot?.sweetPotatoBalance;
        if (bagRaw === null || bagRaw === undefined) {
            skip('sell', '这次没读到背包蜜薯数量');
            return;
        }
        let remaining = BigInt(bagRaw || '0');
        if (remaining <= 0n) {
            skip('sell', '背包里还没有蜜薯，等红薯成熟收获后自动卖');
            return;
        }
        if (remaining < BigInt(options.sellMinCount)) {
            skip('sell', `背包只有 ${remaining} 个蜜薯，未达到自动卖出阈值 ${options.sellMinCount}`);
            return;
        }
        if (!snapshot?.shop?.priceKnown) {
            skip('sell', '今日收购价还没生成（先领一次红薯种子）');
            return;
        }

        let shops: any[];
        try {
            shops = await rankedShops(options.friendLimit, options.scanIntervalMinutes);
        }
        catch (e: any) {
            failed('scan', `好友铺子比价失败: ${e?.message || e}`);
            return;
        }
        const candidates = options.fallbackOwn ? shops : shops.filter((shop: any) => !shop.own);
        if (!candidates.length) {
            skip('sell', shops.length ? '只把自己的铺子留在候选里，但已关闭卖给自己' : '没有可卖的好友铺子');
            return;
        }

        let switched = 0;
        let wrote = false;
        const spacing = async (): Promise<void> => { if (wrote) await sleep(YISHU_STEP_SPACER_MS); };

        for (const shop of candidates) {
            if (remaining <= 0n || switched >= YISHU_MAX_SHOPS_PER_RUN) break;
            // can_sell 明确为 false 的铺子连请求都不用发，直接换下一家。
            if (shop.canSell === false) {
                skip('sell', `${shop.own ? '自己的铺子' : shop.name || shop.gid} 当前不收蜜薯，换下一家`);
                continue;
            }
            const quota = BigInt(shop.quota || '0');
            if (quota <= 0n) {
                skip('sell', `${shop.own ? '自己的铺子' : shop.name || shop.gid} 今日额度已用完，换下一家`);
                continue;
            }
            const count = quota < remaining ? quota : remaining;
            await spacing();
            try {
                const result = await sell(shop.own ? null : shop.gid, count.toString(), { withSnapshot: false });
                wrote = true;
                switched += 1;
                const sold = BigInt(result?.count || '0');
                remaining -= sold;
                // 服务端只回「该铺每日额度上限」，剩余额度要自己扣，别拿它当剩余值用。
                shop.quota = (quota - sold).toString();
                done('sell', `向${shop.own ? '自己的铺子' : `${shop.name || shop.gid} 的铺子`}卖出 ${sold} 个蜜薯，`
                    + `单价 ${result?.price}，共得 ${result?.income} 福气币`);
            }
            catch (e: any) {
                const code = String(e?.code || '');
                if (YISHU_SKIP_SHOP_CODES.has(code)) {
                    skip('sell', `${shop.own ? '自己的铺子' : shop.name || shop.gid} 现在卖不进去（${e?.message || code}），换下一家`);
                    shop.quota = '0';
                    continue;
                }
                // 回包不可信（数量/金额对不上）这类错误必须停手，绝不能重试猜结果。
                failed('sell', `卖薯失败: ${e?.message || e}`);
                return;
            }
        }

        if (remaining > 0n) {
            skip('sell', `还有 ${remaining} 个蜜薯没卖出去（${candidates.length} 家候选铺子：`
                + `${switched} 家已用过、其余额度不足），留到下一轮`);
        }
    }

    async function runYishuAutomation(automation: any = {}): Promise<void> {
        const claimSeedEnabled = automation.yishu_claim_seed === true;
        const shareEnabled = automation.yishu_share === true;
        const commissionEnabled = automation.yishu_claim_commission === true;
        const sellEnabled = automation.yishu_auto_sell === true;
        if (!claimSeedEnabled && !shareEnabled && !commissionEnabled && !sellEnabled) return;

        let snapshot: any;
        try {
            // 一轮只读一次：领种子 / 分享 / 卖薯的写操作自己会重新校验服务端状态。
            snapshot = await getActivity({ freshBalances: true });
        }
        catch (e: any) {
            failed('read', `读取以薯换福状态失败: ${e?.message || e}`);
            return;
        }
        if (!snapshot?.active) {
            skip('read', '不在开放窗口（尚未开始或已经结束）');
            return;
        }

        let wrote = false;
        const spacing = async (): Promise<void> => { if (wrote) await sleep(YISHU_STEP_SPACER_MS); };

        if (claimSeedEnabled) {
            if (snapshot.daily?.seedClaimed) {
                skip('claimSeed', '今日红薯种子已经领过');
            }
            else {
                await spacing();
                try {
                    const result = await claimSeed({ withSnapshot: false });
                    wrote = true;
                    done('claimSeed', `领取红薯种子 ${result?.count} 个`);
                }
                catch (e: any) {
                    const code = String(e?.code || '');
                    if (code === 'YSHF_SEED_ALREADY_CLAIMED') skip('claimSeed', '今日红薯种子已经领过');
                    else if (code === 'YSHF_INACTIVE') skip('read', '不在开放窗口（尚未开始或已经结束）');
                    else failed('claimSeed', `领种子失败: ${e?.message || e}`);
                }
            }
        }

        if (shareEnabled) {
            if (snapshot.daily?.shared) {
                skip('share', '今日已经分享过铺子，暴击涨价每日只触发一次');
            }
            else {
                await spacing();
                try {
                    const result = await shareShop({ withSnapshot: false });
                    wrote = true;
                    const extra = result?.count && result.count !== '0' ? `，额外获得 ${result.count} 个红薯种子` : '';
                    const report = result?.shareReported === false
                        ? `（分享上报未生效：${result?.shareReportError || '未知原因'}，暴击加成可能没加上）`
                        : '';
                    done('share', `分享铺子完成${extra}${report}`);
                }
                catch (e: any) {
                    const code = String(e?.code || '');
                    if (code === 'YSHF_SHARE_ALREADY_DONE') skip('share', '今日已经分享过铺子');
                    else if (code === 'YSHF_INACTIVE') skip('read', '不在开放窗口（尚未开始或已经结束）');
                    else failed('share', `分享铺子失败: ${e?.message || e}`);
                }
            }
        }

        if (sellEnabled) {
            await sellSweetPotatoes(snapshot, {
                friendLimit: toInt(automation.yishu_scan_friend_limit, DEFAULT_FRIEND_LIMIT, 1, 50),
                scanIntervalMinutes: toInt(automation.yishu_scan_interval_minutes, DEFAULT_SCAN_INTERVAL_MINUTES, 5, 720),
                sellMinCount: toInt(automation.yishu_sell_min_count, DEFAULT_SELL_MIN_COUNT, 1, 10000),
                fallbackOwn: automation.yishu_sell_fallback_own !== false,
            });
        }

        // 提成放在最后：好友把蜜薯卖进你的铺子才会产生，先卖完自己这一轮再看更划算；
        // 而且它是纯收钱动作，卖薯中途失败也不该漏掉。
        if (commissionEnabled) {
            const pending = BigInt(snapshot?.commission?.pending || '0');
            if (!snapshot?.commission?.claimable || pending <= 0n) {
                skip('commission', '当前没有可领取的收购提成');
            }
            else {
                await spacing();
                try {
                    const result = await claimCommission({ withSnapshot: false });
                    wrote = true;
                    const amount = String(result?.amount ?? '0');
                    const balance = result?.balance ? `，当前福气币 ${result.balance}` : '';
                    done('commission', amount === '0' ? '没有可领取的提成' : `领取收购提成 ${amount} 福气币${balance}`);
                }
                catch (e: any) {
                    const code = String(e?.code || '');
                    if (code === 'YSHF_NO_COMMISSION') skip('commission', '当前没有可领取的收购提成');
                    else if (code === 'YSHF_INACTIVE') skip('read', '不在开放窗口（尚未开始或已经结束）');
                    else failed('commission', `领取收购提成失败: ${e?.message || e}`);
                }
            }
        }
    }

    return { runYishuAutomation };
}

let yishuAutomation: any = null;

async function runYishuTick(isReady: () => boolean): Promise<void> {
    if (!isReady()) return;
    const { getAutomation } = require('../models/store');
    const { runExclusiveAutomationTask } = require('./automation-lock');
    const automation = getAutomation() || {};
    if (!isYishuAutomationEnabled(automation)) return;
    await runExclusiveAutomationTask('yishuhuanfu', async () => {
        if (!isReady()) return;
        if (!yishuAutomation) {
            const activity = require('./activity-center');
            const { getServerTimeSec, log } = require('../utils/utils');
            yishuAutomation = createYishuAutomation({
                getActivity: activity.getCurrentYishuHuanfuActivity,
                claimSeed: activity.claimYishuHuanfuSeeds,
                shareShop: activity.shareYishuHuanfuShop,
                claimCommission: activity.claimYishuHuanfuCommission,
                scanFriends: activity.scanYishuHuanfuFriendShops,
                sell: activity.sellYishuHuanfuSweetPotato,
                getServerTimeSec,
                log,
            });
        }
        await yishuAutomation.runYishuAutomation(automation);
    });
}

/** 定时器挂在调用方（worker）的 scheduler 上，停表时随 clearAll() 一起清掉。 */
function startYishuTimer(scheduler: any, isReady: () => boolean): void {
    scheduler.clear('yishu_initial');
    scheduler.clear('yishu_interval');
    if (!isReady()) return;
    const { getAutomation } = require('../models/store');
    if (!isYishuAutomationEnabled(getAutomation())) return;
    scheduler.setTimeoutTask('yishu_initial', YISHU_INITIAL_DELAY_MS, () => {
        runYishuTick(isReady).catch(() => null);
    });
    scheduler.setIntervalTask('yishu_interval', YISHU_CHECK_INTERVAL_MS, () => {
        runYishuTick(isReady).catch(() => null);
    }, { phaseMs: YISHU_CHECK_PHASE_MS });
}

module.exports = {
    createYishuAutomation,
    isYishuAutomationEnabled,
    startYishuTimer,
    YISHU_AUTOMATION_KEYS,
    YISHU_CHECK_INTERVAL_MS,
    YISHU_CHECK_PHASE_MS,
    YISHU_INITIAL_DELAY_MS,
    YISHU_STEP_SPACER_MS,
    YISHU_MAX_SHOPS_PER_RUN,
};
