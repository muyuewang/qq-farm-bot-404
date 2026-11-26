export {};

/**
 * 以薯换福（2026-11-25 ~ 2026-12-09）。
 *
 * 协议来自两轮实机抓包：活动组 2026111707，主模块 2026111708（type=26）承载
 * 状态槽 field 130 与全部命令。命令走 ActivityService.Operate 的 cmd 字段，
 * 参数与回包挂在 190+cmd 号槽位：
 *   cmd 91 领每日红薯种子（回包 191：item_id=20307 / count=28）
 *   cmd 92 查指定铺子行情（参数 192.shop_gid；回包 192：价格 / 额度 / 铺主）
 *   cmd 93 卖蜜薯（参数 193：shop_gid + count；回包 193：数量 / 单价 / 总额 / 额度 / 余额）
 *   cmd 95 刷新今日行情（参数与回包均为空）
 *   cmd 96 兑换下单（参数 196：index + count；回包 196：单价 / 到手道具 / 余额）
 *   cmd 97 查兑换目录（回包 197：序号 / 价格 / 状态 / 限额）
 *   cmd 98 分享铺子（回包 198：种子奖励 / 单价 / 分享 key）
 *
 * 第二轮抓包（2026-11-25 12:49）修正了两处早期误判：
 *   - cmd 92 是只读的铺子行情查询，不是卖薯；卖薯是 cmd 93，且必须带数量。
 *   - 兑换下单是 cmd 96，索引走目录序号，服务端回包直接给出 item_id 与余额。
 */

/** 未取证的字段一律不做语义断言，相关常量集中在这里，便于后续校正。 */
const YSHF_GROUP_ID = '2026111707';
const YSHF_ACTIVITY_ID = '2026111708';
const YSHF_SEED_ITEM_ID = '20307';
const YSHF_SWEET_POTATO_ITEM_ID = '1032';
const YSHF_LUCK_COIN_ITEM_ID = '1033';

const YSHF_CMD_CLAIM_SEED = 91;
const YSHF_CMD_SHOP_QUERY = 92;
const YSHF_CMD_SELL = 93;
// 95 是「收购记录列表」，不是刷新行情。2026-11-25 15:11 抓包证实：
// 请求空、回包 slot195 = repeated 收购记录；没有记录时回包为空。
const YSHF_CMD_RECORDS = 95;
const YSHF_CMD_EXCHANGE = 96;
const YSHF_CMD_CATALOG = 97;
const YSHF_CMD_SHARE = 98;
// 99 是「领取收购提成」，请求空，回包 {1:领取额, 4:领取后福气币}。
const YSHF_CMD_CLAIM_COMMISSION = 99;

// cmd 91 回包固定带 28 个种子，cmd 98 首日分享固定带 4 个，仅用于回包缺字段时兜底。
const YSHF_DAILY_SEED_FALLBACK = '28';
const YSHF_SHARE_SEED_FALLBACK = '4';

/**
 * 单个铺子的每日接收额度上限。实机两个账号的 cmd 92 回包都是 quota=8000 起步，
 * 界面也按 7,000 / 8,000 画进度条，因此按常量处理；一旦服务端下发更大的 quota，
 * 以 quotient 为准，不让进度条出现负数。
 */
const YSHF_SHOP_QUOTA_CAP = '8000';

/** 背包余额的短缓存：只在轮询间隔内复用，领种子/卖薯/兑换后必须强制重读。 */
const BALANCE_CACHE_TTL_MS = 10 * 1000;
/**
 * 背包读取连续失败时，最多沿用多久之前的成功值。
 * 余额变化只发生在本次进程内的几个写操作上（写操作后都会强制刷新缓存），
 * 因此 10 分钟内的旧值仍然可信，比把界面刷成“--”更有用。
 *
 * 注意：自动任务的轮询间隔也是 10 分钟，正好卡在这个窗口边界上，
 * 一旦 Bag 超时就会「刚好过期 → 判定未知 → 跳过卖薯」。自动任务传自己的
 * 宽窗口（AUTO_BALANCE_STALE_MAX_MS），界面仍用这 10 分钟。
 */
const BALANCE_STALE_MAX_MS = 10 * 60 * 1000;
/** 自动任务沿用旧余额的上限：一小时内的蜜薯数足够可信，卖薯失败服务端还会兜底。 */
const AUTO_BALANCE_STALE_MAX_MS = 60 * 60 * 1000;

/** 好友比价结果缓存时间：cmd 92 是实时行情，短缓存只为防连点刷屏。 */
const FRIEND_SCAN_TTL_MS = 3 * 60 * 1000;
// 候选池现在是「本账号好友 + 面板其它账号好友」，上限放宽到 200；超出时按轮换窗口扫。
const FRIEND_SCAN_DEFAULT_LIMIT = 60;
const FRIEND_SCAN_MAX_LIMIT = 200;
const FRIEND_SCAN_CONCURRENCY = 4;

/**
 * 兑换目录（cmd 97）只下发序号与价格，商品由客户端静态配置按序号映射。
 * 这张表来自 2026-11-25 实机界面截图，价格与抓包逐档一致，用于给目录补名字和
 * 图标；价格对不上时视为官方调整过档位，退回序号占位而不是猜。
 * 值得注意的是 cmd 96 的回包会直接返回真实 item_id，因此兑换后可以回填校验。
 */
const YSHF_CATALOG_TEMPLATE: Record<number, { itemId: string; name: string; price: string }> = {
    1: { itemId: '204013', name: '七彩花弦', price: '1000000' },
    2: { itemId: '101627', name: '福气金豆礼包', price: '60000' },
    3: { itemId: '40522', name: '金币果', price: '40000' },
    4: { itemId: '40523', name: '经验蘑菇', price: '40000' },
    5: { itemId: '80011', name: '有机化肥(1小时)', price: '8500' },
    6: { itemId: '101620', name: '南瓜种子礼包', price: '28000' },
    7: { itemId: '101621', name: '荷风种子礼包', price: '28000' },
    8: { itemId: '101622', name: '千星种子礼包', price: '28000' },
    9: { itemId: '101623', name: '萌宠种子礼包', price: '35000' },
    10: { itemId: '80001', name: '化肥(1小时)', price: '7000' },
};

function createYishuHuanfuActivityService(deps: any) {
    const {
        types,
        sendMsgAsync,
        getBag,
        getSystemDateKey,
        getServerTimeSec,
        int64String,
        int64Number,
        bytesToText,
        itemDto,
        textContent,
        businessError,
        positiveDecimal,
        activityWindowIsActive,
        readBagBalances,
        serializeMutation,
        getActivityCenterSnapshot,
        getUserState,
        // 好友列表默认懒加载，测试可注入桩函数，避免拉起真实的网关请求。
        getAllFriends: getAllFriendsDep,
        // 面板其它账号的好友同样可注入，测试不必读写磁盘存档。
        getPanelFriendGids: getPanelFriendGidsDep,
    } = deps;

    // 状态槽 130 的 4 号子槽只保留最近一次动作，不能用它判断“今天是否已领”，
    // 因此每日动作按服务器日期在本地记账，服务端报错时再回滚。
    let seedClaimedDateKey = '';
    let sharedDateKey = '';
    let friendScanCache: { at: number; data: any } | null = null;
    // 候选池（本账号好友 + 面板其它账号好友）超过单轮上限时的轮换游标。
    let friendScanRotation = 0;
    // 背包读取失败时保留原因，随快照一起下发，前端可以显示“余额未知”的具体理由。
    let lastBalanceError = '';
    // 前端轮询很密，同一个超时错误 5 分钟内只记一条，避免把日志刷爆后反而看不到别的信息。
    let lastBalanceLogAt = 0;
    let lastBalanceLoggedError = '';
    // 快照会被前端反复轮询，而 Bag 是串行队列的最后一环，压力一大就会被挤掉。
    // 一旦某次失败就把界面刷成“--”，数字会出现“闪一下又没了”的观感，
    // 因此这里做两级兜底：短 TTL 复用减少请求 + 失败时回退最近一次成功值。
    let lastGoodBalances: { at: number; data: Map<string, string> } | null = null;
    let balanceStale = false;
    // 打网关的刷新同一时刻只跑一个，结果写进 lastGoodBalances 供快照同步读取。
    let balanceRefreshingPromise: Promise<Map<string, string> | null> | null = null;

    function ownGid(): string {
        const gid = int64String(getUserState()?.gid);
        return gid === '0' ? '' : gid;
    }

    async function queryYshfGroupReply(): Promise<any> {
        const body = Buffer.from(types.GetGroupRequest.encode(types.GetGroupRequest.create({
            group_id: YSHF_GROUP_ID,
        })).finish());
        const { body: replyBody } = await sendMsgAsync(
            'gamepb.activitypb.ActivityService',
            'GetGroup',
            body,
        );
        return types.GetGroupReply.decode(replyBody);
    }

    /**
     * 面板里所有账号的「已知好友 GID」。每个账号的 worker 同步好友列表时会把它落盘到
     * `known_friend_gids/<accountId>.json`（worker-manager 的 known_friend_gids_sync），
     * 这里把目录里所有账号的文件并起来，比价候选池就不再只有当前账号的好友。
     *
     * 蜜薯能卖给任何开着铺子的人，非好友也收，所以候选池越大越容易挑到当日最高价。
     * 读不到（文件缺失 / 存档损坏）只当没有，不影响本账号好友。
     */
    function collectPanelFriendGids(): Array<{ gid: string; accountName: string }> {
        if (typeof getPanelFriendGidsDep === 'function') {
            const injected = getPanelFriendGidsDep();
            if (Array.isArray(injected)) {
                const result: Array<{ gid: string; accountName: string }> = [];
                const seen = new Set<string>();
                for (const raw of injected) {
                    const gid = int64String(raw?.gid);
                    if (!gid || gid === '0' || !/^\d+$/.test(gid) || seen.has(gid)) continue;
                    seen.add(gid);
                    result.push({ gid, accountName: String(raw?.accountName || '') });
                }
                return result;
            }
        }
        const result: Array<{ gid: string; accountName: string }> = [];
        const seen = new Set<string>();
        try {
            const store = require('../models/store');
            const { readKnownFriendGidsCache } = require('../models/store/gid-cache');
            const listed = store?.getAccounts?.();
            const accounts = Array.isArray(listed?.accounts) ? listed.accounts : [];
            for (const account of accounts) {
                const accountId = String(account?.id || '');
                if (!accountId) continue;
                const gids = readKnownFriendGidsCache(accountId);
                if (!Array.isArray(gids)) continue;
                const accountName = String(account?.name || account?.nick || accountId);
                for (const raw of gids) {
                    const gid = int64String(raw);
                    if (!gid || gid === '0' || !/^\d+$/.test(gid) || seen.has(gid)) continue;
                    seen.add(gid);
                    result.push({ gid, accountName });
                }
            }
        } catch {
            // 读不到面板账号存档不是错误：退回只用本账号好友。
        }
        return result;
    }

    /**
     * 候选池超过本轮上限时的轮换窗口：自己的铺子永远在内，其余按扫描轮次前后滚动，
     * 几轮下来能把整个候选池覆盖一遍，不会被「永远只扫前 N 个」卡住。
     */
    function takeScanWindow(targets: any[], limit: number, hasOwn: boolean): any[] {
        if (targets.length <= limit) return targets;
        const ownEntry = hasOwn ? targets[0] : null;
        const others = hasOwn ? targets.slice(1) : targets.slice();
        const capacity = Math.max(1, limit - (ownEntry ? 1 : 0));
        if (others.length <= capacity) return ownEntry ? [ownEntry, ...others] : others;
        const start = friendScanRotation % others.length;
        const window: any[] = [];
        for (let offset = 0; offset < capacity; offset += 1)
            window.push(others[(start + offset) % others.length]);
        friendScanRotation = (start + capacity) % others.length;
        return ownEntry ? [ownEntry, ...window] : window;
    }

    async function operateYshf(requestType: any, payload: any): Promise<any> {
        const body = Buffer.from(requestType.encode(requestType.create(payload)).finish());
        const { body: replyBody } = await sendMsgAsync(
            'gamepb.activitypb.ActivityService',
            'Operate',
            body,
        );
        const reply = types.ActivityOperateReply.decode(replyBody);
        if (int64String(reply.activity_id) !== YSHF_ACTIVITY_ID) {
            throw businessError('YSHF_RESPONSE_INVALID', '以薯换福回包的活动 ID 不匹配');
        }
        if (int64Number(reply.operate_type) !== int64Number(payload.cmd)) {
            throw businessError('YSHF_RESPONSE_INVALID', '以薯换福回包的命令号不匹配');
        }
        // 领种子 / 卖薯 / 兑换 / 分享都会改变背包或福气币，必须让下次读取绕过缓存，
        // 否则界面会拿着写操作之前的余额继续展示。
        if ([YSHF_CMD_CLAIM_SEED, YSHF_CMD_SELL, YSHF_CMD_EXCHANGE, YSHF_CMD_SHARE, YSHF_CMD_CLAIM_COMMISSION].includes(int64Number(payload.cmd))) {
            invalidateBalanceCache();
        }
        return reply;
    }

    function findMainModule(groupReply: any): any | null {
        const children = Array.isArray(groupReply?.group?.children) ? groupReply.group.children : [];
        return children.find((child: any) => int64String(child?.activity?.activity_id) === YSHF_ACTIVITY_ID) || null;
    }

    /** 兑换目录的单档商品 DTO。status 在抓包中恒为 2，语义未取证，不据它判断可兑性。 */
    function catalogDto(catalog: any): any[] {
        const goods = Array.isArray(catalog?.goods) ? catalog.goods : [];
        return goods.map((entry: any) => {
            const index = int64Number(entry?.index);
            const price = int64String(entry?.price);
            const template = YSHF_CATALOG_TEMPLATE[index];
            const matched = !!template && template.price === price;
            const itemId = matched ? template.itemId : null;
            const limit = int64String(entry?.limit || '0');
            // 兑换后服务端会补 field 5/6，实机均取 1，疑似今日已兑次数，语义待定，
            // 因此只作为参考值透出，剩余可兑数量仍以 limit 为上限。
            const exchangedToday = int64String(entry?.field_5 || '0');
            return {
                index,
                itemId,
                name: matched ? template.name : '',
                // 价格变动说明官方换过档位，名字一律留空，避免展示错商品。
                nameKnown: matched,
                price,
                status: int64Number(entry?.status),
                limit,
                exchangedToday,
                image: itemId ? itemDto({ item_id: itemId, count: '1' }).image : '',
                exchangeable: true,
            };
        });
    }

    function yshfDto(groupReply: any, balances: Map<string, string> | null = null, catalog: any[] | null = null) {
        const main = findMainModule(groupReply);
        const activity = main?.activity || null;
        if (!activity) {
            throw businessError('YSHF_UNAVAILABLE', '服务端未发现以薯换福活动');
        }

        const state = main?.yishuhuanfu || {};
        const claims = state.claims || {};
        const shareState = state.share || {};
        // 130.5 = 基础收购价、130.6 = 分享暴击加成。早期版本把这两个字段写反，
        // 导致界面写成“基础 33 + 暴击 111”。官方抓包 111 + 33 = 144 与界面一致。
        const basePrice = int64String(state.base_price || '0');
        const bonus = int64String(state.bonus_price || '0');
        // 成交价 = 基础价 + 加成，最终以 cmd 93 回包为准，这里只作展示与预估。
        const estimatedPrice = basePrice !== '0'
            ? (BigInt(basePrice) + BigInt(bonus)).toString()
            : null;
        const active = activityWindowIsActive(activity);
        const dateKey = getSystemDateKey();
        const readBalance = (itemId: string): string => balances?.get(itemId) || '0';
        const seedBalance = balances ? readBalance(YSHF_SEED_ITEM_ID) : null;
        const sweetPotatoBalance = balances ? readBalance(YSHF_SWEET_POTATO_ITEM_ID) : null;
        // 福气币以服务端状态槽为准（卖出后出现、兑换后扣减，实机 69120→62120→27120），
        // 背包余额只在状态槽缺失时兜底。
        const stateLuckCoin = int64String(state.luck_coin || '0');
        const bagLuckCoin = balances ? readBalance(YSHF_LUCK_COIN_ITEM_ID) : null;
        const luckCoinBalance = stateLuckCoin !== '0' ? stateLuckCoin : bagLuckCoin;
        // 130.1 是服务端的今日领取标记，比本地日期记账可靠得多：
        // 进程重启、跨设备、多端操作都能立刻体现。本地记账只作为兜底保留。
        const seedClaimed = !!claims.seed_claimed || seedClaimedDateKey === dateKey;
        const shared = !!claims.share_claimed || sharedDateKey === dateKey;
        const shareTimeSec = Number(int64String(shareState.timestamp || '0'));
        const sharedToday = Number.isFinite(shareTimeSec) && shareTimeSec > 0
            && getSystemDateKey(shareTimeSec * 1000) === dateKey;
        // 基础价为 0 说明服务端还没下发当日行情，此时不能卖，否则按 0 价结算。
        const quoteReady = basePrice !== '0';
        const hasSweetPotato = balances === null || BigInt(sweetPotatoBalance || '0') > 0n;
        const gid = ownGid();
        const catalogLoaded = catalog !== null;
        // 可兑性只看活动期：目录/价格/余额都是前端与下单前的实时校验，
        // 拿 catalogLoaded 当开关会让快照刷新把按钮短暂打回不可兑。
        const exchangeEnabled = active;

        return {
            groupId: YSHF_GROUP_ID,
            activityId: YSHF_ACTIVITY_ID,
            name: bytesToText(activity.name) || '以薯换福',
            startTime: int64String(activity.begin_time),
            endTime: int64String(activity.end_time),
            rules: textContent(activity.extra),
            active,
            serverTime: String(getServerTimeSec()),
            shop: {
                gid,
                // price 保留为“基础价”，与 state.base_price 同源；成交以 cmd 93 回包为准。
                price: basePrice,
                priceKnown: quoteReady,
                quoteTime: int64String(shareState.timestamp || '0'),
                selfPrice: basePrice,
                bonus,
                estimatedPrice,
                // 130.7 = 本人铺子今日接收总量（实机 10000 / 12972）。
                capacity: int64String(state.capacity || '0'),
                // 剩余接收额度只能靠 cmd 92 现查，快照里不带，前端进页面时单独查一次。
                quota: null,
                quotaCap: YSHF_SHOP_QUOTA_CAP,
                quotaUsed: null,
            },
            seed: {
                ...itemDto({ item_id: YSHF_SEED_ITEM_ID, count: seedBalance || '0' }),
                balance: seedBalance,
                balanceKnown: balances !== null,
            },
            sweetPotato: {
                ...itemDto({ item_id: YSHF_SWEET_POTATO_ITEM_ID, count: sweetPotatoBalance || '0' }),
                balance: sweetPotatoBalance,
                balanceKnown: balances !== null,
            },
            luckCoin: {
                ...itemDto({ item_id: YSHF_LUCK_COIN_ITEM_ID, count: luckCoinBalance || '0' }),
                balance: luckCoinBalance,
                balanceKnown: luckCoinBalance !== null,
            },
            // 收购提成：好友把蜜薯卖进你的铺子后产生，界面「可领提成」就是 pending。
            // 没提成时服务端不下发 11 号字段，此时读出来是 0，语义上等于「没有」。
            commission: {
                pending: int64String(state.pending_commission || '0'),
                claimable: active && BigInt(int64String(state.pending_commission || '0')) > 0n,
                flag: int64String(state.commission_flag || '0'),
            },
            catalog: catalog || [],
            catalogLoaded,
            // stale=true 表示这次没读到背包，当前数字是上一次成功值（不做错误提示）。
            balanceStale: balances !== null && balanceStale,
            balanceError: balances === null ? (lastBalanceError || '背包读取失败') : '',
            daily: {
                dateKey,
                seedClaimed,
                shared,
                // 130.2.3 是分享时间戳，落在今天说明今天触发过分享暴击。
                sharedToday,
            },
            actions: {
                claimSeed: {
                    enabled: active && !seedClaimed,
                    available: active && !seedClaimed,
                    availabilityKnown: true,
                },
                sell: {
                    enabled: active && quoteReady && hasSweetPotato,
                    available: active && quoteReady && hasSweetPotato,
                    availabilityKnown: balances !== null,
                },
                share: {
                    enabled: active && !shared,
                    available: active && !shared,
                    availabilityKnown: true,
                },
                exchange: {
                    enabled: exchangeEnabled,
                    available: exchangeEnabled,
                    availabilityKnown: true,
                },
            },
        };
    }

    /**
     * 余额改成「快照永不等待 + 后台保活」两条通道。
     *
     * 背景：Bag 排在 7 个活动请求之后，网关并发一满就超时。之前快照里同步读、还重试三次
     * （250/700ms 退避 + 每次都要等网关超时），一次抖动既拖慢快照，又只能拿到 null；
     * 更糟的是页面挂载与轮询会并发打两个快照，后一个失败就覆盖前一个的成功结果，
     * 表现就是「刚刷新有数字、几秒后整排变 --」。
     *
     * 现在只有 refreshBalances 一个通道打网关（互斥，同一时刻只有一个在途），结果写进内存；
     * 快照只同步读内存。并发快照读的是同一份状态，不可能一个成功一个失败把数字打回去。
     */
    async function refreshBalances(options: { retries?: number; staleMaxMs?: number } = {}): Promise<Map<string, string> | null> {
        // 在途请求直接复用。注意：复用方拿到的可能是「按更窄窗口判定的 null」，
        // 自动任务因此先在调用处决定重试次数与窗口，避免和界面抢同一个 promise。
        if (balanceRefreshingPromise) return balanceRefreshingPromise;
        const retryDelays = options.retries === 0 ? [] : [250, 700];
        const staleMaxMs = options.staleMaxMs ?? BALANCE_STALE_MAX_MS;
        const task = (async () => {
            for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
                try {
                    // 一律走普通 getBag()：会复用在途请求；传 fresh:true 会绕过在途去重，
                    // 等于连甩三个 Bag 请求，反而更容易撞上网关超时。
                    const data = readBagBalances(await getBag(), [
                        YSHF_SEED_ITEM_ID,
                        YSHF_SWEET_POTATO_ITEM_ID,
                        YSHF_LUCK_COIN_ITEM_ID,
                    ]);
                    lastBalanceError = '';
                    balanceStale = false;
                    lastGoodBalances = { at: Date.now(), data };
                    return data;
                } catch (error: any) {
                    lastBalanceError = String(error?.message || error || '背包读取失败');
                    if (attempt < retryDelays.length) await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
                }
            }
            logBalanceFailure();
            if (freshFallback(staleMaxMs)) {
                // 失败但手里还有可用成功值：继续用它，只标 stale。
                balanceStale = true;
                return (lastGoodBalances as { data: Map<string, string> }).data;
            }
            balanceStale = false;
            return null;
        })();
        balanceRefreshingPromise = task;
        try {
            return await task;
        } finally {
            if (balanceRefreshingPromise === task) balanceRefreshingPromise = null;
        }
    }

    /** 同一类失败 5 分钟只记一条，避免把日志刷爆后反而看不到别的信息。 */
    function logBalanceFailure() {
        try {
            const nowAt = Date.now();
            if (lastBalanceLoggedError !== lastBalanceError || nowAt - lastBalanceLogAt > 5 * 60 * 1000) {
                lastBalanceLoggedError = lastBalanceError;
                lastBalanceLogAt = nowAt;
                require('../../utils/utils').logWarn('以薯换福背包读取失败', { error: lastBalanceError });
            }
        } catch {
            // 日志失败不影响主流程
        }
    }

    /** 最近一次成功值是否还能用（窗口可由调用方放宽，自动任务用 1 小时）。 */
    function freshFallback(maxMs: number = BALANCE_STALE_MAX_MS): boolean {
        return !!lastGoodBalances && Date.now() - lastGoodBalances.at <= maxMs;
    }

    /** 快照专用：同步返回内存里的余额，绝不 await 网关。 */
    function currentBalances(maxMs: number = BALANCE_STALE_MAX_MS): Map<string, string> | null {
        if (freshFallback(maxMs)) {
            // 值还在手就先给出去；超过 10 秒顺手在后台补一次，不阻塞本次快照。
            if (Date.now() - (lastGoodBalances as { at: number }).at > BALANCE_CACHE_TTL_MS) void refreshBalances();
            return (lastGoodBalances as { data: Map<string, string> }).data;
        }
        // 还没有任何成功值：触发后台刷新，本次先按未知下发（前端会用 localStorage 兜底）。
        void refreshBalances();
        return null;
    }

    /** 写操作成功后余额一定变了，立刻在后台补一次真值。 */
    function invalidateBalanceCache(): void {
        void refreshBalances();
    }

    async function getCurrentYishuHuanfuActivity(options: {
        freshBalances?: boolean;
        balanceRetries?: number;
        balanceStaleMaxMs?: number;
    } = {}) {
        const groupReply = await queryYshfGroupReply();
        // 写操作后、以及进程里还没有任何成功值时，同步单次读一次（不重试）。
        // 其余情况只读内存，快照不会被 Bag 拖住，也不会出现并发快照互相覆盖。
        // 自动任务需要更硬的读数：给重试次数和更宽松的 stale 窗口，
        // 否则「轮询间隔 10 分钟 = stale 上限 10 分钟」会让它每次刚好读到未知值。
        const staleMaxMs = options.balanceStaleMaxMs ?? BALANCE_STALE_MAX_MS;
        const balances = options.freshBalances || !freshFallback(staleMaxMs)
            ? await refreshBalances({ retries: options.balanceRetries ?? 0, staleMaxMs })
            : currentBalances(staleMaxMs);
        // 目录查询是独立命令，快照里不拉，避免每次刷新快照都多发一条网关请求；
        // 前端进入活动页时单独调用 queryYishuHuanfuCatalog。
        return yshfDto(groupReply, balances, null);
    }

    async function claimYishuHuanfuSeeds(options: { withSnapshot?: boolean } = {}) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            if (snapshot.daily.seedClaimed) {
                throw businessError('YSHF_SEED_ALREADY_CLAIMED', '今日红薯种子已经领取，无需重复领取');
            }

            const reply = await (async () => {
                try {
                    return await operateYshf(types.YshfClaimSeedRequest, {
                        activity_id: YSHF_ACTIVITY_ID,
                        cmd: YSHF_CMD_CLAIM_SEED,
                        params: {},
                    });
                } catch (error: any) {
                    const message = String(error?.message || '');
                    // 服务端用 1034177 表示今天已经领过。以前这个码没有映射，前端只能看到
                    // “活动操作失败，请刷新页面后重试”，按钮也不会变灰。
                    if (String(error?.code || '') === '1034177' || /code=1034177\b/.test(message)) {
                        seedClaimedDateKey = getSystemDateKey();
                        throw businessError('YSHF_SEED_ALREADY_CLAIMED', '今日红薯种子已经领取，明天再来领取');
                    }
                    throw error;
                }
            })();
            seedClaimedDateKey = getSystemDateKey();
            const grant = reply?.yshf_claim_seed?.grant;
            const count = grant ? int64String(grant.count) : YSHF_DAILY_SEED_FALLBACK;
            return {
                count,
                reward: grant ? itemDto({ item_id: int64String(grant.item_id), count }) : null,
                message: `领取红薯种子 ${count} 个`,
                // 自动任务只要结果，不需要整份活动中心快照（那是 7 个活动的读，代价很高）。
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }

    /**
     * 查单个铺子的今日行情（cmd 92）。只读，不产生成交，可以拿任意 gid 查，
     * 好友铺子比价就是靠它逐个扫。
     */
    async function fetchShopQuote(targetGid: string) {
        const reply = await operateYshf(types.YshfShopQueryRequest, {
            activity_id: YSHF_ACTIVITY_ID,
            cmd: YSHF_CMD_SHOP_QUERY,
            params: { shop_gid: targetGid },
        });
        const quote = reply?.yshf_shop?.quote;
        const shop = quote?.shop;
        // 官方抓包（2026-11-25 13:51，好友 1006086548 风筝有风）：
        // quote.base_price=99、quote.bonus_price=66，游戏界面「今日蜜薯收购价」显示 165。
        // 成交价 = 基础价 + 暴击加成，两个字段都不能单独当成交价用。
        const price = int64String(quote?.base_price || '0');
        const quota = int64String(quote?.quota || '0');
        const bonus = int64String(quote?.bonus_price || '0');
        const totalPrice = (BigInt(price) + BigInt(bonus)).toString();
        // quota 是“还能再收多少”，额度上限实机恒为 8000，用来算已用量。
        const cap = BigInt(YSHF_SHOP_QUOTA_CAP) > BigInt(quota) ? YSHF_SHOP_QUOTA_CAP : quota;
        const own = targetGid === ownGid();
        // can_sell = 这个铺子现在收不收薯。三态：true 可收 / false 明确拒收 / null 回包没这个字段。
        // protobufjs 对 bool 取默认值 false，读到的 false 分不清「明确 0」和「没下发」，
        // 所以先用 hasOwnProperty 判断字段是否真的在报文里，否则整排铺子会被误判成关张。
        // 自家铺子不占好友额度，界面显示「不限」，能不能卖同样只看 can_sell。
        const shopReply = reply?.yshf_shop;
        const hasCanSell = !!shopReply && Object.prototype.hasOwnProperty.call(shopReply, 'can_sell');
        const canSell = hasCanSell ? !!shopReply.can_sell : null;
        return {
            gid: targetGid,
            own,
            price,
            totalPrice,
            quota,
            quotaCap: cap,
            quotaUsed: (BigInt(cap) - BigInt(quota)).toString(),
            bonus,
            canSell,
            shop: shop ? {
                gid: int64String(shop.gid),
                name: shop.name || '',
                avatar: shop.avatar || '',
                level: int64String(shop.level),
            } : null,
        };
    }

    /**
     * 查指定铺子的今日行情（cmd 92）。不传 gid 时查自己铺子，
     * 返回该铺收购价、剩余接收额度与铺主信息。
     */
    async function queryYishuHuanfuShop(friendGidInput: unknown = null) {
        const own = ownGid();
        const targetGid = friendGidInput === null || friendGidInput === undefined || friendGidInput === ''
            ? own
            : positiveDecimal(friendGidInput, 'INVALID_YSHF_SHOP_GID', 'friendGid');
        if (!targetGid) {
            throw businessError('YSHF_OWN_GID_UNKNOWN', '无法确定本人 GID，暂时查不了铺子行情');
        }
        const quote = await fetchShopQuote(targetGid);
        return {
            targetGid,
            own: targetGid === own,
            ...quote,
            message: `铺子今日收购价 ${quote.totalPrice}（基础 ${quote.price} + 加成 ${quote.bonus}），剩余接收额度 ${quote.quota}`,
        };
    }

    /**
     * 好友铺子比价：把好友列表里每个 gid 丢给 cmd 92 扫一遍，按收购价从高到低排序。
     * 这就是外面说的“拿 gid 私自看别人的价”——协议本来就是一个只读查询，
     * 只要知道 gid 就能查，不需要对方同意，也不占用对方额度。
     *
     * 好友列表来自 FriendService/GetAll。单个好友查失败不中断整轮扫描，
     * 失败项单独计数返回，避免一个失联账号拖垮整张比价表。
     */
    async function scanYishuHuanfuFriendShops(options: any = {}) {
        const limitRaw = Number(options?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(Math.floor(limitRaw), FRIEND_SCAN_MAX_LIMIT)
            : FRIEND_SCAN_DEFAULT_LIMIT;
        const force = options?.force === true;
        const now = Date.now();
        if (!force && friendScanCache && now - friendScanCache.at < FRIEND_SCAN_TTL_MS) {
            return { ...friendScanCache.data, cached: true };
        }

        const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
        if (!snapshot.active) {
            throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
        }
        const own = ownGid();

        let friends: any[] = [];
        let friendListError = '';
        try {
            const loader = typeof getAllFriendsDep === 'function'
                ? getAllFriendsDep
                : () => require('../friend/api').getAllFriends(false, 'low');
            const reply = await loader(false, 'low');
            if (Array.isArray(reply?.game_friends)) friends = reply.game_friends;
            else if (Array.isArray(reply?.gameFriends)) friends = reply.gameFriends;
        } catch (error: any) {
            friendListError = error?.message || '好友列表获取失败';
        }

        const panelFriends = collectPanelFriendGids();

        const targets: any[] = [];
        const seen = new Set<string>();
        if (own) {
            targets.push({ gid: own, own: true, name: '我的铺子', avatar: '', level: '0', via: 'own' });
            seen.add(own);
        }
        for (const friend of friends) {
            const gid = int64String(friend?.gid);
            if (!gid || gid === '0' || seen.has(gid)) continue;
            seen.add(gid);
            targets.push({
                gid,
                own: gid === own,
                name: friend?.remark || friend?.name || gid,
                avatar: friend?.avatar_url || '',
                level: int64String(friend?.level),
                via: 'friend',
            });
        }
        // 面板里其它账号的好友同样并进来：蜜薯能卖给任何开着铺子的人，
        // 不限于本账号好友，候选池越大越容易挑到当日最高价。
        let panelCount = 0;
        for (const entry of panelFriends) {
            if (seen.has(entry.gid)) continue;
            seen.add(entry.gid);
            panelCount += 1;
            targets.push({
                gid: entry.gid,
                own: false,
                // 名字靠 cmd 92 回包里的铺主信息补，界面没有名字时会退化成显示 GID。
                name: '',
                avatar: '',
                level: '0',
                via: 'panel',
                panelAccount: entry.accountName,
            });
        }
        const slice = takeScanWindow(targets, limit, !!own);

        const shops: any[] = [];
        let failed = 0;
        let failureMessage = '';
        for (let start = 0; start < slice.length; start += FRIEND_SCAN_CONCURRENCY) {
            const batch = slice.slice(start, start + FRIEND_SCAN_CONCURRENCY);
            const settled = await Promise.allSettled(batch.map(entry => fetchShopQuote(entry.gid)));
            settled.forEach((result, index) => {
                const entry = batch[index];
                if (result.status === 'rejected') {
                    failed += 1;
                    if (!failureMessage) failureMessage = result.reason?.message || '铺子行情查询失败';
                    return;
                }
                const quotedOwner = result.value.shop;
                shops.push({
                    ...entry,
                    // 其它账号好友在这里没有本地名字：cmd 92 回包自带铺主昵称 / 头像 / 等级，
                    // 用它补齐，界面上就不用只显示一串 GID。
                    name: entry.name || quotedOwner?.name || '',
                    avatar: entry.avatar || quotedOwner?.avatar || '',
                    level: entry.level && entry.level !== '0' ? entry.level : (quotedOwner?.level || '0'),
                    price: result.value.price,
                    totalPrice: result.value.totalPrice,
                    quota: result.value.quota,
                    quotaCap: result.value.quotaCap,
                    quotaUsed: result.value.quotaUsed,
                    bonus: result.value.bonus,
                    canSell: result.value.canSell,
                    // 自家铺子不占好友额度：界面显示「不限」，也只能靠 can_sell 判断能不能卖。
                    unlimited: result.value.own === true,
                });
            });
        }

        // 按游戏界面显示的成交价（基础价 + 加成）排序，而不是只比基础价。
        shops.sort((left, right) => {
            const priceDiff = BigInt(right.totalPrice) - BigInt(left.totalPrice);
            if (priceDiff !== 0n) return priceDiff > 0n ? 1 : -1;
            const quotaDiff = BigInt(right.quota) - BigInt(left.quota);
            return quotaDiff === 0n ? 0 : quotaDiff > 0n ? 1 : -1;
        });

        const data = {
            shops,
            best: shops[0] || null,
            ownShop: shops.find(entry => entry.own) || null,
            scanned: slice.length,
            failed,
            // 候选池 = 本账号好友 + 面板里其它账号的已知好友（去重后）。
            friendCount: targets.length - (own ? 1 : 0),
            panelFriendCount: panelCount,
            candidateCount: targets.length - (own ? 1 : 0),
            // 候选池超过本轮上限时按轮换窗口扫，这里告诉界面还有多少没轮到。
            pendingCount: Math.max(0, targets.length - (own ? 1 : 0) - slice.filter(entry => !entry.own).length),
            limit,
            friendListError,
            message: shops.length === 0
                ? (friendListError || '没有可查询的铺子')
                : `已扫描 ${shops.length} 个铺子${panelCount ? `（含其它账号好友 ${panelCount} 个）` : ''}，`
                    + `最高收购价 ${shops[0].totalPrice}`,
            errorMessage: failureMessage,
            cached: false,
            scannedAt: now,
        };
        friendScanCache = { at: now, data };
        return data;
    }

    /**
     * 卖蜜薯（cmd 93）。不传 friendGid 时卖给自己的铺子；传 friendGid 时占用对方
     * 每日接收额度，对方获得提成。
     * count 缺省为背包全部蜜薯；服务端按传入数量成交，成交价由服务端决定，回包
     * 里的 price / total / balance 才是结算依据，任何本地预估都不作数。
     */
    async function sellYishuHuanfuSweetPotato(friendGidInput: unknown = null, countInput: unknown = null, options: { withSnapshot?: boolean } = {}) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            const own = ownGid();
            if (!own) {
                throw businessError('YSHF_OWN_GID_UNKNOWN', '无法确定本人 GID，暂时不能卖出蜜薯');
            }
            const targetGid = friendGidInput === null || friendGidInput === undefined || friendGidInput === ''
                ? own
                : positiveDecimal(friendGidInput, 'INVALID_YSHF_FRIEND_GID', 'friendGid');
            const balance = snapshot.sweetPotato.balance;
            if (balance !== null && BigInt(balance) <= 0n) {
                throw businessError('INSUFFICIENT_YSHF_SWEET_POTATO', '背包里没有可出售的蜜薯');
            }
            if (!snapshot.shop.priceKnown) {
                throw businessError('YSHF_QUOTE_NOT_READY', '今日收购价尚未生成，请先领取红薯种子');
            }

            let count: string;
            if (countInput === null || countInput === undefined || countInput === '') {
                if (balance === null) {
                    throw businessError('YSHF_BALANCE_UNKNOWN', '读取不到蜜薯数量，请显式指定出售数量');
                }
                count = balance;
            } else {
                count = positiveDecimal(countInput, 'INVALID_YSHF_SELL_COUNT', 'count');
                if (balance !== null && BigInt(count) > BigInt(balance)) {
                    throw businessError('INSUFFICIENT_YSHF_SWEET_POTATO', `背包只有 ${balance} 个蜜薯，不足 ${count} 个`);
                }
            }

            // 卖给好友铺子前先查一次行情（cmd 92）：确认铺主 gid 与请求一致、
            // 对方现在收不收（can_sell）、剩余接收额度够用，避免“卖出去才发现
            // 铺子不是这个人的 / 已经收满关张”。自己的铺子不限量，不需要这一步。
            if (targetGid !== own) {
                const quote = await fetchShopQuote(targetGid);
                if (!quote.shop || quote.shop.gid !== targetGid) {
                    throw businessError('YSHF_SHOP_UNKNOWN', `无法确认铺子 ${targetGid} 的主人，本次未出售`);
                }
                // canSell === null 表示回包没带这个字段（旧版本/字段缺失），按可卖继续，
                // 由随后的额度校验与下单回包兜底；只有明确 false 才拦下。
                if (quote.canSell === false) {
                    throw businessError(
                        'YSHF_SHOP_CLOSED',
                        `${quote.shop.name || targetGid} 的铺子当前不收蜜薯，换一家或卖给自己`,
                    );
                }
                if (BigInt(count) > BigInt(quote.quota)) {
                    throw businessError(
                        'YSHF_SHOP_QUOTA_INSUFFICIENT',
                        `${quote.shop.name || targetGid} 的铺子今日只剩 ${quote.quota} 个接收额度，不足 ${count} 个`,
                    );
                }
            }

            const reply = await operateYshf(types.YshfSellRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_SELL,
                params: { shop_gid: targetGid, count },
            });
            const result = reply?.yshf_sell;
            // 成交会改变目标铺子的剩余额度与自己的福气币，比价缓存必须失效。
            friendScanCache = null;
            const isOwn = targetGid === own;
            const soldCount = result ? int64String(result.count) : count;
            const price = result ? int64String(result.price) : '0';
            const total = result ? int64String(result.total) : '0';
            // 回包自洽校验：数量对不上或金额 ≠ 单价 × 数量，说明这条回包不可信，
            // 不能向用户谎报“卖出成功”。
            if (result) {
                if (soldCount !== count) {
                    throw businessError('YSHF_RESULT_UNKNOWN', `服务端回包数量 ${soldCount} 与请求 ${count} 不一致，请刷新核对`);
                }
                if (price !== '0' && BigInt(total) !== BigInt(price) * BigInt(soldCount)) {
                    throw businessError('YSHF_RESULT_UNKNOWN', `服务端回包金额 ${total} 与单价 × 数量不一致，请刷新核对`);
                }
            }
            return {
                targetGid,
                own: isOwn,
                count: soldCount,
                price,
                income: total,
                quota: result ? int64String(result.quota) : '0',
                balance: result ? int64String(result.balance) : null,
                message: `已向${isOwn ? '自己的铺子' : `好友 ${targetGid} 的铺子`}卖出 ${soldCount} 个蜜薯，单价 ${price}，共得 ${total} 福气币`,
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }

    /**
     * 刷新本人铺子的今日行情（cmd 92，shop_gid 传自己 gid）。
     * 旧实现打的是 cmd 95，而 95 其实是收购记录列表，回包不带任何行情字段，
     * 所以这个按钮以前点了「没反应」——记录为空时回包就是空的。
     */
    async function refreshYishuHuanfuQuote() {
        const gid = ownGid();
        if (!gid) throw businessError('YSHF_GID_UNKNOWN', '未获取到本人 gid，无法刷新行情');
        const quote = await queryYishuHuanfuShop(gid);
        return {
            ...quote,
            message: `今日收购价 ${quote.totalPrice}（基础 ${quote.price} + 暴击 ${quote.bonus}），还可收 ${quote.quota}`,
            // 前端点完「刷新行情」需要把新价格写回快照，否则按钮看起来没反应。
            // 余额读取已改成内存命中，这里不会再多等一次 Bag。
            snapshot: await getActivityCenterSnapshot(),
        };
    }

    function purchaseRecordDto(record: any) {
        return {
            timestamp: int64String(record?.timestamp || '0'),
            gid: int64String(record?.gid || '0'),
            count: int64String(record?.count || '0'),
            total: int64String(record?.total || '0'),
            name: record?.name || '',
            avatar: record?.avatar || '',
            level: int64String(record?.level || '0'),
            commission: int64String(record?.commission || '0'),
        };
    }

    /**
     * 收购记录列表（cmd 95）。界面「只展示最近 30 条」，服务端一次下发多少条就展示多少条。
     * 记录是好友把蜜薯卖进你铺子产生的：4 是付给卖家的总额，9 是你拿到的提成。
     */
    async function queryYishuHuanfuRecords() {
        const reply = await operateYshf(types.YshfRecordRequest, {
            activity_id: YSHF_ACTIVITY_ID,
            cmd: YSHF_CMD_RECORDS,
            params: {},
        });
        const records = (reply?.yshf_records?.records || []).map(purchaseRecordDto);
        const totalCommission = records
            .reduce((sum: bigint, entry: any) => sum + BigInt(entry.commission || '0'), 0n)
            .toString();
        return {
            records,
            count: records.length,
            totalCommission,
            message: records.length === 0 ? '暂无收购记录' : `最近 ${records.length} 条收购记录，合计提成 ${totalCommission}`,
        };
    }

    /** 领取收购提成（cmd 99）。没有可领提成时本地直接拦下，不打网关。 */
    async function claimYishuHuanfuCommission(options: { withSnapshot?: boolean } = {}) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity();
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            if (BigInt(snapshot.commission.pending) <= 0n) {
                throw businessError('YSHF_NO_COMMISSION', '当前没有可领取的收购提成');
            }
            const reply = await operateYshf(types.YshfClaimCommissionRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_CLAIM_COMMISSION,
                params: {},
            });
            const result = reply?.yshf_commission;
            const amount = result ? int64String(result.amount) : '0';
            return {
                amount,
                balance: result ? int64String(result.balance) : null,
                message: amount === '0' ? '没有可领取的提成' : `已领取收购提成 ${amount} 福气币`,
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }

    /** 查兑换目录（cmd 97）。只读，不下单。 */
    async function queryYishuHuanfuCatalog() {
        const reply = await operateYshf(types.YshfCatalogRequest, {
            activity_id: YSHF_ACTIVITY_ID,
            cmd: YSHF_CMD_CATALOG,
            params: {},
        });
        const catalog = catalogDto(reply?.yshf_catalog);
        return {
            catalog,
            exchangeEnabled: true,
            message: `兑换目录共 ${catalog.length} 档`,
        };
    }

    /**
     * 兑换下单（cmd 96）。index 取目录序号，count 为兑换数量。
     * 服务端回包给出真实 item_id 与兑换后余额，这里用余额做一次交叉校验，
     * 避免上游改了扣费规则后本地还按旧价展示。
     */
    async function exchangeYishuHuanfuGoods(indexInput: unknown, countInput: unknown = 1) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            const index = positiveDecimal(indexInput, 'INVALID_YSHF_CATALOG_INDEX', 'index');
            const count = positiveDecimal(countInput, 'INVALID_YSHF_EXCHANGE_COUNT', 'count');

            // 目录价格只有 cmd 97 才有，下单前必须现查一次，避免按过期档位扣币。
            const { catalog } = await queryYishuHuanfuCatalog();
            const goods = catalog.find((entry: any) => String(entry.index) === String(index));
            if (!goods) {
                throw businessError('YSHF_CATALOG_ENTRY_NOT_FOUND', `兑换目录里没有第 ${index} 档商品`);
            }
            const cost = BigInt(goods.price) * BigInt(count);
            const limit = BigInt(goods.limit || '0');
            // limit 是这一档“剩余可兑”次数，超了服务端会整单拒绝，这里提前拦住。
            if (limit > 0n && BigInt(count) > limit) {
                throw businessError('YSHF_EXCEED_LIMIT', `本档剩余可兑换 ${limit} 次，本次选择了 ${count} 次`);
            }
            const balance = snapshot.luckCoin.balance;
            if (balance !== null && BigInt(balance) < cost) {
                throw businessError('INSUFFICIENT_YSHF_LUCK_COIN', `福气币不足，需要 ${cost}，当前 ${balance}`);
            }

            const reply = await operateYshf(types.YshfExchangeRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_EXCHANGE,
                params: { index, count },
            });
            const result = reply?.yshf_exchange;
            const grant = result?.grant;
            const itemId = grant ? int64String(grant.item_id) : (goods.itemId || '');
            const granted = grant ? int64String(grant.count) : count;
            const nextBalance = result ? int64String(result.balance) : null;
            return {
                index: Number(index),
                count: granted,
                itemId,
                // 静态表与回包 item_id 不一致说明官方换过档位，标记出来供前端提示。
                itemIdMatched: goods.itemId === null || goods.itemId === '',
                price: result ? int64String(result.price) : goods.price,
                cost: cost.toString(),
                balance: nextBalance,
                reward: itemId ? itemDto({ item_id: itemId, count: granted }) : null,
                message: `兑换成功：${goods.nameKnown ? goods.name : `第 ${index} 档`} × ${granted}`,
                snapshot: await getActivityCenterSnapshot(),
            };
        });
    }

    /** 分享本人铺子（cmd 98）。每日首次触发分享暴击涨价。 */
    async function shareYishuHuanfuShop(options: { withSnapshot?: boolean } = {}) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            if (snapshot.daily.shared) {
                throw businessError('YSHF_SHARE_ALREADY_DONE', '今日已经分享过铺子，暴击涨价每日只触发一次');
            }

            const reply = await operateYshf(types.YshfShareRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_SHARE,
                params: {},
            });
            sharedDateKey = getSystemDateKey();
            // 分享暴击会抬高本人铺子收购价，比价里的自己那行要跟着变。
            friendScanCache = null;

            // cmd 98 只是“活动内的分享动作”，官方客户端还会走一次
            // ShareService.CheckCanShare → ReportShare{field_1:28, field_4:2017}，
            // 暴击加成要到这一步才真正落地。参考 Anrylin/qq-farm-bot 的实机实现。
            // 上报失败不阻断主流程，但要把原因透出去，免得用户以为分享没生效。
            let shareReported = false;
            let shareReportError = '';
            try {
                const checkBody = Buffer.from(types.CheckCanShareRequest.encode(
                    types.CheckCanShareRequest.create({}),
                ).finish());
                const checkReply = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', checkBody);
                if (types.CheckCanShareReply.decode(checkReply.body).can_share) {
                    const reportBody = Buffer.from(types.ReportShareRequest.encode(
                        types.ReportShareRequest.create({ field_1: 28, field_4: 2017 }),
                    ).finish());
                    await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', reportBody);
                    shareReported = true;
                } else {
                    shareReportError = '当前分享入口不可用（CheckCanShare=false）';
                }
            } catch (error: any) {
                shareReportError = String(error?.message || error || '分享上报失败');
                try {
                    require('../../utils/utils').logWarn('以薯换福分享上报失败', { error: shareReportError });
                } catch {
                    // 日志失败不影响主流程
                }
            }

            const share = reply?.yshf_share;
            const grant = share?.grant;
            const count = grant ? int64String(grant.count) : YSHF_SHARE_SEED_FALLBACK;
            return {
                count,
                seedReward: grant ? itemDto({ item_id: int64String(grant.item_id), count }) : null,
                price: share ? int64String(share.price) : snapshot.shop.price,
                shareKey: share?.shop?.share_key || '',
                shareReported,
                shareReportError,
                message: count === '0' ? '铺子分享成功' : `铺子分享成功，额外获得 ${count} 个红薯种子`,
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }

    // 进程起来后先预热一次背包。首个快照最容易被网关并发挤掉，而这时进程里还没有
    // “上次成功值”可回退，界面就会一路 "--" 到下一次成功为止。提前拉一次把兜底填上。
    const warmupTimer: any = setTimeout(() => {
        void refreshBalances();
    }, 1200);
    if (typeof warmupTimer?.unref === 'function') warmupTimer.unref();

    return {
        getCurrentYishuHuanfuActivity,
        claimYishuHuanfuSeeds,
        queryYishuHuanfuShop,
        scanYishuHuanfuFriendShops,
        sellYishuHuanfuSweetPotato,
        refreshYishuHuanfuQuote,
        queryYishuHuanfuCatalog,
        queryYishuHuanfuRecords,
        claimYishuHuanfuCommission,
        exchangeYishuHuanfuGoods,
        shareYishuHuanfuShop,
    };
}

module.exports = { createYishuHuanfuActivityService };
