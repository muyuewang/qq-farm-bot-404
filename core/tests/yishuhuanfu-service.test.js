const assert = require('node:assert/strict');
const test = require('node:test');

const { loadProto, types } = require('../dist/utils/proto');
const { createYishuHuanfuActivityService } = require('../dist/services/activity-center/yishuhuanfu');

// proto 类型是按需加载的，测试前必须先装载一次。
test.before(async () => {
    await loadProto();
});

const ACTIVITY_ID = '2026111708';
const GROUP_ID = '2026111707';

function makeGroupReply({
    selfPrice = '33',
    quoteTime = '1795573881',
    seed = '0',
    sweetPotato = '0',
    luckCoin = '0',
    stateLuckCoin = '0',
    bonus = '111',
    active = true,
    seedClaimed = false,
    shared = false,
    capacity = '10000',
    pendingCommission = '0',
} = {}) {
    const now = Math.floor(Date.now() / 1000);
    const main = types.ActivityData.create({
        activity: {
            activity_id: ACTIVITY_ID,
            group_id: GROUP_ID,
            type: 26,
            name: '以薯换福',
            begin_time: String(now - 600),
            end_time: String(now + 86400),
        },
        // 130 的语义已由官方抓包确认：1=claims（今日领取标记）、2=分享状态、
        // 5=基础价、6=分享暴击加成、7=铺子接收总量。
        yishuhuanfu: {
            claims: { seed_claimed: seedClaimed ? 1 : 0, share_claimed: shared ? 1 : 0 },
            share: { bonus, field_2: '1', timestamp: quoteTime, field_4: '1' },
            base_price: selfPrice,
            bonus_price: bonus,
            capacity,
            // 好友把蜜薯卖进自己铺子后服务端才下发 11 号字段，领取(cmd 99)后消失。
            pending_commission: pendingCommission,
            commission_flag: pendingCommission === '0' ? '0' : '1',
            // 卖出后服务端才下发 field 3，测试里用它模拟权威余额。
            luck_coin: stateLuckCoin,
        },
    });
    const group = types.ActivityData.create({
        activity: { activity_id: GROUP_ID, group_id: GROUP_ID, type: 1, name: '以薯换福' },
        children: [main],
    });
    const reply = types.GetGroupReply.create({ group });
    return { reply, balances: { seed, sweetPotato, luckCoin }, active, now };
}

// 只读请求报文里的 cmd（field 2），不要用 ActivityOperateReply 去解请求，
// 否则请求专有的参数槽位会被误当成回包槽位解析。
function readRequestCmd(buffer) {
    let index = 1; // 跳过 field 1 的 key(0x08)
    while (buffer[index] & 0x80) index += 1;
    index += 1;
    index += 1; // 跳过 field 2 的 key(0x10)
    let value = 0;
    let shift = 0;
    while (true) {
        const byte = buffer[index++];
        value |= (byte & 0x7f) << shift;
        shift += 7;
        if (!(byte & 0x80)) return value;
    }
}

const DEFAULT_CATALOG = [
    { index: '1', price: '1000000', status: '2', limit: '1' },
    { index: '9', price: '35000', status: '2', limit: '10' },
    { index: '10', price: '7000', status: '2', limit: '50' },
];

/**
 * 内存版分享标识存档。生产实现落在 core/data/yishu_share_keys/<gid>.json，
 * 测试里换成 Map，既不碰真实存档，也能直接断言「分享后写进去了什么」。
 */
function createMemoryShareKeyStore() {
    const entries = new Map();
    const store = {
        readYishuShareKey: gid => entries.get(String(gid)) || null,
        writeYishuShareKey: (gid, entry) => {
            const shareKey = String(entry?.shareKey || '');
            if (!gid || !shareKey) return false;
            entries.set(String(gid), {
                gid: String(gid),
                shareKey,
                activityId: String(entry?.activityId || ''),
                dateKey: String(entry?.dateKey || ''),
                // 和真实存档一致：分享自动落盘记 share，手填记 manual。
                source: String(entry?.source || 'share'),
                updatedAt: Date.now(),
            });
            return true;
        },
        listYishuShareKeys: () => new Map(entries),
        removeYishuShareKey: gid => entries.delete(String(gid)),
        findYishuShareKey: (gid, dateKey) => {
            const entry = entries.get(String(gid));
            if (!entry) return null;
            if (dateKey && entry.dateKey && entry.dateKey !== dateKey) return null;
            return { shareKey: entry.shareKey, activityId: entry.activityId };
        },
        normalizeShareKey: (value) => {
            const match = String(value || '').match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
            return match ? match[0].toLowerCase() : '';
        },
    };
    store.entries = entries;
    return store;
}

// cmd 92 的回包：base_price 是基础收购价、bonus_price 是分享暴击加成、quota 是剩余接收额度，
// can_sell 是这个铺子当前收不收薯（字段 2）。entry.canSell 传 null 表示回包不带该字段。
function shopQuotePayload(gid, entry) {
    const payload = {
        quote: {
            base_price: entry.price,
            bonus_price: entry.bonus || '0',
            quota: entry.quota,
            shop: { gid, name: entry.name || '', avatar: '', level: '30' },
        },
    };
    if (entry.canSell !== null) payload.can_sell = entry.canSell !== false;
    return payload;
}

function createHarness(options = {}) {
    const built = makeGroupReply(options);
    const requests = [];
    const dateKeyOf = (nowMs) => {
        const ms = typeof nowMs === 'number' ? nowMs : built.now * 1000;
        return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
    };
    // 分享标识存档：默认注入内存表；options.shareKeys 用来预置「对方今天已分享」。
    const shareKeyStore = options.shareKeyStore || createMemoryShareKeyStore();
    for (const [gid, shareKey] of Object.entries(options.shareKeys || {})) {
        shareKeyStore.writeYishuShareKey(gid, {
            shareKey,
            activityId: ACTIVITY_ID,
            dateKey: options.shareKeyDateKey || dateKeyOf(),
        });
    }
    const service = createYishuHuanfuActivityService({
        types,
        sendMsgAsync: async (service_, method, body) => {
            requests.push({ method, body });
            if (method === 'GetGroup') {
                return { body: Buffer.from(types.GetGroupReply.encode(built.reply).finish()) };
            }
            if (method === 'Operate') {
                const cmd = readRequestCmd(Buffer.from(body));
                // 模拟服务端业务拒绝（比如 1034177 今日种子已领取）；
                // 传 body 是为了让用例能按 gid 决定「哪一家」报错（1034184 是按铺子来的）。
                const thrown = options.operateThrows ? options.operateThrows(cmd, Buffer.from(body)) : null;
                if (thrown) throw thrown;
                const payload = { activity_id: ACTIVITY_ID, operate_type: cmd };
                // 默认给每个命令一个最小可用的回包，单个用例可以覆盖。
                if (cmd === 97) payload.yshf_catalog = { goods: options.catalog || DEFAULT_CATALOG };
                if (cmd === 92 && options.shopQuotes) {
                    // 请求体里带 shop_gid（params.shop_gid），按 gid 查桩表；
                    // 未登记的 gid 直接报错，模拟失联好友。
                    const decoded = types.YshfShopQueryRequest.decode(Buffer.from(body));
                    const gid = String(decoded.params?.shop_gid ?? '');
                    const quotes = options.shopQuotes;
                    if (!Object.prototype.hasOwnProperty.call(quotes, gid)) throw new Error('shop quote unavailable: ' + gid);
                    payload.yshf_shop = shopQuotePayload(gid, quotes[gid]);
                }
                if (options.operateReply) Object.assign(payload, options.operateReply(cmd) || {});
                const reply = types.ActivityOperateReply.create(payload);
                return { body: Buffer.from(types.ActivityOperateReply.encode(reply).finish()) };
            }
            throw new Error('unexpected method ' + method);
        },
        getBag: async () => {
            if (options.bagThrows) throw new Error(options.bagThrows);
            return { items: [] };
        },
        // 日期键按真实日期算（UTC+8），这样 quote_time 的“今天/昨天”判定可以被测到。
        getSystemDateKey: (nowMs) => {
            const ms = typeof nowMs === 'number' ? nowMs : built.now * 1000;
            return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
        },
        getServerTimeSec: () => built.now,
        // proto 解出来的 int64 是 Long，必须走 toString 再转数字。
        int64String: value => (value == null ? '0' : String(value)),
        int64Number: value => Number(value == null ? 0 : String(value)),
        bytesToText: value => (value == null ? '' : String(value)),
        itemDto: item => ({ id: String(item?.item_id ?? '0'), count: String(item?.count ?? '0') }),
        textContent: () => ({ title: '', paragraphs: [] }),
        businessError: (code, message) => Object.assign(new Error(message), { code }),
        positiveDecimal: value => String(value),
        activityWindowIsActive: () => built.active,
        readBagBalances: () => {
            if (options.bagThrows) throw new Error(options.bagThrows);
            return new Map([
                ['20307', built.balances.seed],
                ['1032', built.balances.sweetPotato],
                ['1033', built.balances.luckCoin],
            ]);
        },
        serializeMutation: operation => operation(),
        getActivityCenterSnapshot: async () => ({}),
        getUserState: () => ({ gid: '1220537209' }),
        // 好友列表走桩，避免测试里拉起真实网关。
        getAllFriends: options.getAllFriends || (async () => ({ game_friends: [] })),
        // 面板其它账号的好友默认空，测试可注入以覆盖跨账号候选池。
        getPanelFriendGids: options.getPanelFriendGids || (() => []),
        shareKeyStore,
    });
    const operateRequest = () => requests.filter(entry => entry.method === 'Operate');
    return { service, requests, built, operateRequest, shareKeyStore, dateKey: dateKeyOf() };
}

test('yishuhuanfu snapshot maps the price slot and gates actions by balance', async () => {
    const noSweetPotato = createHarness({ sweetPotato: '0', seed: '0' });
    const snapshot = await noSweetPotato.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.activityId, ACTIVITY_ID);
    assert.equal(snapshot.groupId, GROUP_ID);
    assert.equal(snapshot.name, '以薯换福');
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.shop.price, '33');
    assert.equal(snapshot.shop.priceKnown, true);
    assert.equal(snapshot.shop.gid, '1220537209');
    // 背包没有蜜薯时不允许卖出，避免空跑一次网关命令。
    assert.equal(snapshot.actions.sell.enabled, false);
    // 领种子与分享只看本地日期键，首次调用应为可执行。
    assert.equal(snapshot.actions.claimSeed.enabled, true);
    assert.equal(snapshot.actions.share.enabled, true);
    // 快照不带目录，但兑换开关只跟活动期走：目录/价格/余额由前端与下单接口校验，
    // 否则每次快照刷新都会把按钮短暂打回不可兑。
    assert.equal(snapshot.actions.exchange.enabled, true);
    assert.equal(snapshot.catalogLoaded, false);

    const withSweetPotato = createHarness({ sweetPotato: '97', seed: '28' });
    const second = await withSweetPotato.service.getCurrentYishuHuanfuActivity();
    assert.equal(second.sweetPotato.balance, '97');
    assert.equal(second.seed.balance, '28');
    assert.equal(second.actions.sell.enabled, true);
});

test('yishuhuanfu snapshot refuses to sell before the daily quote exists', async () => {
    const harness = createHarness({ selfPrice: '0', quoteTime: '0', sweetPotato: '50' });
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.shop.priceKnown, false);
    assert.equal(snapshot.actions.sell.enabled, false);
    await assert.rejects(
        () => harness.service.sellYishuHuanfuSweetPotato(null),
        error => error.code === 'YSHF_QUOTE_NOT_READY',
    );
});

test('yishuhuanfu claim seed sends cmd 91 and locks the day', async () => {
    const harness = createHarness({
        operateReply: () => ({ yshf_claim_seed: { grant: { item_id: '20307', count: '28' } } }),
    });
    const result = await harness.service.claimYishuHuanfuSeeds();
    assert.equal(result.count, '28');
    assert.equal(result.reward.id, '20307');

    const sent = types.YshfClaimSeedRequest.decode(harness.operateRequest()[0].body);
    assert.equal(Number(sent.cmd), 91);
    assert.equal(String(sent.activity_id), ACTIVITY_ID);

    // 当日重复领取直接拦截，不再打网关。
    await assert.rejects(
        () => harness.service.claimYishuHuanfuSeeds(),
        error => error.code === 'YSHF_SEED_ALREADY_CLAIMED',
    );
});

test('yishuhuanfu claim maps the server 1034177 refusal to a readable code and locks the day', async () => {
    const harness = createHarness({
        // 服务端对“今天已经领过”返回协议码 1034177，以前没有映射，前端只能看到通用失败文案。
        operateThrows: cmd => (cmd === 91 ? new Error('gamepb.activitypb.ActivityService.Operate code=1034177 今日种子已领取') : null),
    });
    await assert.rejects(
        () => harness.service.claimYishuHuanfuSeeds(),
        error => error.code === 'YSHF_SEED_ALREADY_CLAIMED' && /已经领取/.test(error.message),
    );
    // 被服务端确认领过之后，本地也要把当天标成已领，按钮不能再亮着。
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.daily.seedClaimed, true);
    assert.equal(snapshot.actions.claimSeed.enabled, false);
});

test('yishuhuanfu snapshot surfaces the bag read failure instead of silently showing dashes', async () => {
    const harness = createHarness({ bagThrows: 'itempb.ItemService.Bag timeout' });
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.seed.balance, null);
    assert.equal(snapshot.seed.balanceKnown, false);
    assert.equal(snapshot.sweetPotato.balanceKnown, false);
    assert.equal(snapshot.balanceError, 'itempb.ItemService.Bag timeout');
    assert.equal(snapshot.actions.sell.enabled, true);
});

test('yishuhuanfu keeps the last good balances when a later bag read fails', async () => {
    // 实机现象：刷新后数字出来，几秒后轮询又变成 “--”。
    // 原因是每次快照都重新读 Bag，串行队列里被挤掉一次就把界面抹平。
    const options = { sweetPotato: '480', seed: '28', luckCoin: '69120' };
    const harness = createHarness(options);
    const first = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(first.sweetPotato.balance, '480');
    assert.equal(first.balanceStale, false);

    options.bagThrows = 'itempb.ItemService.Bag timeout';
    // TTL 内直接复用缓存，连网关都不用打。
    const cached = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(cached.sweetPotato.balance, '480');
    assert.equal(cached.balanceStale, false);
    assert.equal(cached.balanceError, '');

    // 写操作路径会强制重读；读失败时回退上次成功值，只把 stale 标记透出去。
    const stale = await harness.service.getCurrentYishuHuanfuActivity({ freshBalances: true });
    assert.equal(stale.sweetPotato.balance, '480');
    assert.equal(stale.seed.balance, '28');
    assert.equal(stale.sweetPotato.balanceKnown, true);
    assert.equal(stale.balanceStale, true);
    assert.equal(stale.balanceError, '');
});

test('yishuhuanfu reads the share timestamp without hijacking the claim button', async () => {
    const today = createHarness({ quoteTime: String(Math.floor(Date.now() / 1000)) });
    const nowSnapshot = await today.service.getCurrentYishuHuanfuActivity();
    // 130.2.3 是分享时间戳，落在今天即今日触发过分享暴击。
    assert.equal(nowSnapshot.daily.sharedToday, true);
    // 分享与领种子互相独立，不能用分享时间推断“今天已领”，否则会让人漏领 28 个种子。
    assert.equal(nowSnapshot.daily.seedClaimed, false);
    assert.equal(nowSnapshot.actions.claimSeed.enabled, true);

    const yesterday = createHarness({ quoteTime: String(Math.floor(Date.now() / 1000) - 86400) });
    const oldSnapshot = await yesterday.service.getCurrentYishuHuanfuActivity();
    assert.equal(oldSnapshot.daily.sharedToday, false);
});

test('yishuhuanfu trusts the server claims slot over the local date bookkeeping', async () => {
    // 130.1 = claims{seed_claimed, share_claimed} 是服务端权威状态，
    // 进程重启后本地记账丢失也不会让按钮重新亮起来。
    const harness = createHarness({ seedClaimed: true, shared: true });
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.daily.seedClaimed, true);
    assert.equal(snapshot.daily.shared, true);
    assert.equal(snapshot.actions.claimSeed.enabled, false);
    // 已分享但本地没标识：还允许再点一次「补分享标识」（当天标识固定不变，只是没奖励）。
    assert.equal(snapshot.daily.shareKeySaved, false);
    assert.equal(snapshot.actions.share.enabled, true);
});

test('yishuhuanfu disables share once today key is on disk', async () => {
    const harness = createHarness({
        seedClaimed: true,
        shared: true,
        shareKeys: { 1220537209: 'e0000001-0000-4000-8000-000000000001' },
    });
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.daily.shareKeySaved, true);
    assert.equal(snapshot.actions.share.enabled, false);
});

test('yishuhuanfu re-shares a keyless already-shared day to recover only the key', async () => {
    // 真实场景：今天已经分享过（服务端记得），但那串 share_key 没被记下来
    // （进程重启 / 热更之前分享的）。再分享一次只有标识、没有暴击和种子。
    const harness = createHarness({
        shared: true,
        operateReply: () => ({
            yshf_share: {
                price: '33',
                shop: {
                    gid: '1220537209',
                    shop_ref: {
                        activity_id: ACTIVITY_ID,
                        gid: '1220537209',
                        share_key: 'f0000001-0000-4000-8000-000000000001',
                    },
                },
            },
        }),
    });
    const result = await harness.service.shareYishuHuanfuShop();
    assert.equal(result.rewardless, true);
    assert.equal(result.seedReward, null);
    assert.equal(result.shareKeySaved, true);
    assert.equal(harness.shareKeyStore.readYishuShareKey('1220537209').shareKey, 'f0000001-0000-4000-8000-000000000001');
    assert.match(result.message, /只补了分享标识/);

    // 标识补上之后再点就没意义了，直接拦住，不再白打一次网关。
    // 自己的标识要能读出来：比价列表第一行要显示它，方便对照别人贴进来的链接。
    const scan = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    const ownRow = scan.shops.find(entry => entry.own);
    assert.equal(ownRow.shareKey, 'f0000001-0000-4000-8000-000000000001');

    await assert.rejects(
        () => harness.service.shareYishuHuanfuShop(),
        error => error.code === 'YSHF_SHARE_ALREADY_DONE',
    );
});

test('yishuhuanfu sell defaults to the own shop and sends cmd 93 with the full balance', async () => {
    const harness = createHarness({
        sweetPotato: '480',
        operateReply: () => ({
            yshf_sell: { count: '480', price: '144', total: '69120', quota: '8000', balance: '69120' },
        }),
    });
    const result = await harness.service.sellYishuHuanfuSweetPotato();
    assert.equal(result.targetGid, '1220537209');
    assert.equal(result.own, true);
    assert.equal(result.count, '480');
    assert.equal(result.price, '144');
    assert.equal(result.income, '69120');
    assert.equal(result.balance, '69120');
    assert.equal(result.quota, '8000');

    const sent = types.YshfSellRequest.decode(harness.operateRequest()[0].body);
    // cmd 92 是只读查铺子，卖薯必须走 cmd 93，否则会静默不成交。
    assert.equal(Number(sent.cmd), 93);
    assert.equal(String(sent.params.shop_gid), '1220537209');
    assert.equal(String(sent.params.count), '480');
});

test('yishuhuanfu sell to a friend carries the friend gid and honours an explicit count', async () => {
    const harness = createHarness({
        sweetPotato: '480',
        // 卖好友铺子前会先 cmd 92 查一次行情，确认铺主与剩余额度。
        shopQuotes: { 1014343107: { price: '99', quota: '8000', name: '测试好友' } },
        // 2026-11-28 起卖给好友必须带对方当天的分享标识，这里预置一条。
        shareKeys: { 1014343107: '7b946b00-c609-4364-996d-46adb2f3d131' },
        operateReply: (cmd) => (cmd === 93
            ? { yshf_sell: { count: '155', price: '99', total: '15345', quota: '8000', balance: '84465' } }
            : {}),
    });
    const result = await harness.service.sellYishuHuanfuSweetPotato('1014343107', 155);
    assert.equal(result.targetGid, '1014343107');
    assert.equal(result.own, false);
    assert.equal(result.income, '15345');

    const sellCall = harness.operateRequest().find(entry => readRequestCmd(Buffer.from(entry.body)) === 93);
    const sent = types.YshfSellRequest.decode(sellCall.body);
    assert.equal(String(sent.params.shop_gid), '1014343107');
    assert.equal(String(sent.params.count), '155');
    // 分享引用：activity_id + gid + share_key，服务端靠它确认「这家铺子今天被分享过」。
    assert.equal(String(sent.params.shop.activity_id), ACTIVITY_ID);
    assert.equal(String(sent.params.shop.gid), '1014343107');
    assert.equal(sent.params.shop.share_key, '7b946b00-c609-4364-996d-46adb2f3d131');
});

test('yishuhuanfu sell refuses a friend shop without a usable share key', async () => {
    const harness = createHarness({
        sweetPotato: '480',
        shopQuotes: { 1014343107: { price: '99', quota: '8000', name: '测试好友' } },
    });
    // 没有标识就注定被服务端拒，本地直接拦下，不打任何写请求。
    await assert.rejects(
        () => harness.service.sellYishuHuanfuSweetPotato('1014343107', 100),
        error => error.code === 'YSHF_SHARE_KEY_MISSING' && /分享标识/.test(error.message),
    );
    assert.equal(harness.operateRequest().filter(entry => readRequestCmd(Buffer.from(entry.body)) === 93).length, 0);
});

test('yishuhuanfu sell ignores a share key recorded on a previous day', async () => {
    const harness = createHarness({
        sweetPotato: '480',
        shopQuotes: { 1014343107: { price: '99', quota: '8000', name: '测试好友' } },
        // 昨天的标识跨日失效：服务端当天会换新 key，拿旧的卖薯会被拒。
        shareKeys: { 1014343107: '7b946b00-c609-4364-996d-46adb2f3d131' },
        shareKeyDateKey: '2000-01-01',
    });
    await assert.rejects(
        () => harness.service.sellYishuHuanfuSweetPotato('1014343107', 100),
        error => error.code === 'YSHF_SHARE_KEY_MISSING',
    );
});

test('yishuhuanfu sell rejects a count larger than the bag', async () => {
    const harness = createHarness({ sweetPotato: '10' });
    await assert.rejects(
        () => harness.service.sellYishuHuanfuSweetPotato(null, 11),
        error => error.code === 'INSUFFICIENT_YSHF_SWEET_POTATO',
    );
    assert.equal(harness.operateRequest().length, 0);
});

test('yishuhuanfu shop query is read-only and returns the quota', async () => {
    const harness = createHarness({
        operateReply: () => ({
            yshf_shop: {
                quote: {
                    base_price: '111',
                    bonus_price: '33',
                    quota: '8000',
                    shop: { gid: '1000232619', name: '沐月', avatar: 'https://example/a.png', level: '143' },
                },
            },
        }),
    });
    const result = await harness.service.queryYishuHuanfuShop();
    assert.equal(result.targetGid, '1220537209');
    assert.equal(result.own, true);
    assert.equal(result.price, '111');
    assert.equal(result.bonus, '33');
    assert.equal(result.totalPrice, '144');
    assert.equal(result.quota, '8000');
    assert.equal(result.shop.name, '沐月');

    const sent = types.YshfShopQueryRequest.decode(harness.operateRequest()[0].body);
    assert.equal(Number(sent.cmd), 92);
    assert.equal(String(sent.params.shop_gid), '1220537209');
});

test('yishuhuanfu share sends cmd 98 once per day and records the shop share key', async () => {
    const harness = createHarness({
        operateReply: () => ({
            yshf_share: {
                grant: { item_id: '20307', count: '4' },
                price: '33',
                shop: {
                    gid: '1220537209',
                    // 2 号位是 GetShareKey 那种 32 位邀请码，不是卡片标识。
                    invite_key: '52ab5e16994b4110b4c7ff79367fce03',
                    // 5 号位才是分享卡片里的铺子标识，别人点卡片卖薯要回传它。
                    shop_ref: {
                        activity_id: ACTIVITY_ID,
                        gid: '1220537209',
                        share_key: '0d0e525c-1f3e-4133-89d6-da336d845e29',
                    },
                },
            },
        }),
    });
    const result = await harness.service.shareYishuHuanfuShop();
    assert.equal(result.count, '4');
    assert.equal(result.shareKey, '0d0e525c-1f3e-4133-89d6-da336d845e29');
    assert.equal(result.shareKeyGid, '1220537209');
    assert.equal(result.shareKeySaved, true);
    // 标识落盘后，别的账号（同面板）扫描时就能卖进这个铺子。
    const stored = harness.shareKeyStore.readYishuShareKey('1220537209');
    assert.equal(stored.shareKey, '0d0e525c-1f3e-4133-89d6-da336d845e29');
    assert.equal(stored.dateKey, harness.dateKey);

    const sent = types.YshfShareRequest.decode(harness.operateRequest()[0].body);
    assert.equal(Number(sent.cmd), 98);

    await assert.rejects(
        () => harness.service.shareYishuHuanfuShop(),
        error => error.code === 'YSHF_SHARE_ALREADY_DONE',
    );
});

test('yishuhuanfu imports a share key from a pasted link', async () => {
    const harness = createHarness({
        shopQuotes: { 1014343107: { price: '99', quota: '8000', name: '手填好友' } },
    });
    const result = await harness.service.importYishuHuanfuShareKey(
        '1014343107',
        'https://game.qq.com/x?share_key=7B946B00-C609-4364-996D-46ADB2F3D131&from=card',
    );
    assert.equal(result.gid, '1014343107');
    assert.equal(result.shareKey, '7b946b00-c609-4364-996d-46adb2f3d131');
    const stored = harness.shareKeyStore.readYishuShareKey('1014343107');
    assert.equal(stored.shareKey, '7b946b00-c609-4364-996d-46adb2f3d131');
    // 手填的标识要能和面板账号自动落盘的区分开：界面上会标「手填」，出错时先怀疑它。
    assert.equal(stored.source, 'manual');

    // 导入完立刻以 force 重扫：这家铺子要马上出现在比价列表里，且标识原样下发。
    const scan = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    const row = scan.shops.find(entry => entry.gid === '1014343107');
    assert.ok(row, '手填标识后该铺子要进池');
    assert.equal(row.shareKey, '7b946b00-c609-4364-996d-46adb2f3d131');
    assert.equal(row.shareKeySource, 'manual');

    await assert.rejects(
        () => harness.service.importYishuHuanfuShareKey('1014343107', '完全不是标识的一段文字'),
        error => error.code === 'INVALID_YSHF_SHARE_KEY',
    );
});

test('yishuhuanfu hand-typed key never overrides the account own share', async () => {
    // 同一 gid 当天标识固定、第二天才换新：账号自己分享落盘的那条是服务端下发的权威值。
    // 手填一条错的上去，会把当天唯一正确的标识换掉，那一天都卖不进去 —— 必须拦住。
    const harness = createHarness({
        shopQuotes: { 910001: { price: '260', quota: '2000', name: 'A号' } },
        shareKeys: { 910001: 'a0000001-0000-4000-8000-000000000001' },
    });
    await assert.rejects(
        () => harness.service.importYishuHuanfuShareKey('910001', 'deadbeef-dead-4ead-8ead-deadbeefdead'),
        error => error.code === 'YSHF_SHARE_KEY_LOCKED',
    );
    assert.equal(
        harness.shareKeyStore.readYishuShareKey('910001').shareKey,
        'a0000001-0000-4000-8000-000000000001',
        '权威值不能被手填改掉',
    );

    // 贴的是同一个值：幂等确认，不报错也不改写。
    const same = await harness.service.importYishuHuanfuShareKey('910001', 'a0000001-0000-4000-8000-000000000001');
    assert.equal(same.unchanged, true);

    // 手填值之间可以互相覆盖：贴错了要能改。
    await harness.service.importYishuHuanfuShareKey('900001', 'c0000001-0000-4000-8000-000000000001');
    await harness.service.importYishuHuanfuShareKey('900001', 'c0000002-0000-4000-8000-000000000002');
    assert.equal(
        harness.shareKeyStore.readYishuShareKey('900001').shareKey,
        'c0000002-0000-4000-8000-000000000002',
    );
});

test('yishuhuanfu forgets a shop and drops it from the pool', async () => {
    const harness = createHarness({
        shopQuotes: {
            1220537209: { price: '100', quota: '8000', name: '自己' },
            910001: { price: '260', quota: '2000', name: 'A号' },
        },
        shareKeys: { 910001: 'a0000001-0000-4000-8000-000000000001' },
    });
    const before = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.ok(before.shops.some(entry => entry.gid === '910001'));

    const removed = await harness.service.forgetYishuHuanfuShareKey('910001');
    assert.equal(removed.removed, true);
    assert.equal(harness.shareKeyStore.readYishuShareKey('910001'), null);

    const after = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.equal(after.shops.some(entry => entry.gid === '910001'), false);
    assert.equal(after.shops.length, 1);

    // 再删一次不报错，只是 nothing removed（界面连点两下不该弹出红字）。
    const again = await harness.service.forgetYishuHuanfuShareKey('910001');
    assert.equal(again.removed, false);
});

test('yishuhuanfu catalog maps ten static tiers and is exchangeable', async () => {
    const harness = createHarness();
    const result = await harness.service.queryYishuHuanfuCatalog();
    assert.equal(result.catalog.length, 3);
    assert.equal(result.exchangeEnabled, true);
    // 序号 1 = 七彩花弦（界面截图与抓包价格一致，静态映射成立）。
    assert.equal(result.catalog[0].itemId, '204013');
    assert.equal(result.catalog[0].name, '七彩花弦');
    assert.equal(result.catalog[0].nameKnown, true);
    // 序号 10 = 化肥(1小时)
    const tier10 = result.catalog.find(entry => entry.index === 10);
    assert.equal(tier10.itemId, '80001');
    assert.equal(tier10.name, '化肥(1小时)');
    assert.equal(tier10.limit, '50');
    assert.ok(result.catalog.every(entry => entry.exchangeable === true));

    const sent = types.YshfCatalogRequest.decode(harness.operateRequest()[0].body);
    assert.equal(Number(sent.cmd), 97);
});

test('yishuhuanfu catalog exposes remaining = limit - exchanged', async () => {
    const harness = createHarness({
        catalog: [
            // 2026-11-28 抓包实况：限购 28、已兑 13 → 游戏界面「限购 15/28」。
            { index: '2', price: '60000', status: '2', limit: '28', exchanged: '13' },
            { index: '3', price: '40000', status: '2', limit: '40' },
            { index: '4', price: '40000', status: '2', limit: '40', exchanged: '40' },
        ],
    });
    const { catalog } = await harness.service.queryYishuHuanfuCatalog();
    assert.equal(catalog[0].limit, '28');
    assert.equal(catalog[0].exchanged, '13');
    assert.equal(catalog[0].remaining, '15');
    assert.equal(catalog[0].exchangeable, true);
    // 没下发 exchanged 的档位按 0 已兑处理，剩余等于上限。
    assert.equal(catalog[1].remaining, '40');
    // 已兑满：界面置灰，且兑换接口会在本地就拦下。
    assert.equal(catalog[2].remaining, '0');
    assert.equal(catalog[2].exchangeable, false);
});

test('yishuhuanfu exchange writes the remaining count back from the reply', async () => {
    const harness = createHarness({
        stateLuckCoin: '222828',
        catalog: [{ index: '2', price: '60000', status: '2', limit: '28', exchanged: '13' }],
        operateReply: cmd => (cmd === 96
            ? {
                yshf_exchange: {
                    price: '180000',
                    grant: { item_id: '101627', count: '3' },
                    balance: '42828',
                    count: '3',
                    exchanged: '16',
                },
            }
            : {}),
    });
    const result = await harness.service.exchangeYishuHuanfuGoods(2, 3);
    assert.equal(result.count, '3');
    // 回包 5 号位直接给「兑换后累计已兑次数」，前端据此把 15/28 改成 12/28。
    assert.equal(result.exchanged, '16');
    assert.equal(result.remaining, '12');
    assert.equal(result.balance, '42828');
});

test('yishuhuanfu exchange refuses to exceed the remaining count', async () => {
    const harness = createHarness({
        stateLuckCoin: '100000000',
        catalog: [{ index: '2', price: '60000', status: '2', limit: '28', exchanged: '13' }],
    });
    // 剩余 15 次，想兑 16 次：本地拦下，不打 cmd 96。
    await assert.rejects(
        () => harness.service.exchangeYishuHuanfuGoods(2, 16),
        error => error.code === 'YSHF_EXCEED_LIMIT' && /剩余可兑换 15 次/.test(error.message),
    );
    assert.equal(
        harness.operateRequest().filter(entry => readRequestCmd(Buffer.from(entry.body)) === 96).length,
        0,
    );
});

test('yishuhuanfu exchange sends cmd 96 and returns the real item id', async () => {
    const harness = createHarness({
        stateLuckCoin: '69120',
        operateReply: cmd => (cmd === 96
            ? { yshf_exchange: { price: '7000', grant: { item_id: '80001', count: '1' }, balance: '62120' } }
            : {}),
    });
    const result = await harness.service.exchangeYishuHuanfuGoods(10, 1);
    assert.equal(result.index, 10);
    assert.equal(result.itemId, '80001');
    assert.equal(result.count, '1');
    assert.equal(result.cost, '7000');
    assert.equal(result.balance, '62120');
    assert.equal(result.price, '7000');

    // 先查目录再下单，两条命令的先后顺序不能反。
    const cmds = harness.operateRequest().map(entry => readRequestCmd(Buffer.from(entry.body)));
    assert.deepEqual(cmds, [97, 96]);
    const sent = types.YshfExchangeRequest.decode(harness.operateRequest()[1].body);
    assert.equal(String(sent.params.index), '10');
    assert.equal(String(sent.params.count), '1');
});

test('yishuhuanfu exchange refuses when the luck coin balance is short', async () => {
    const harness = createHarness({ stateLuckCoin: '5000' });
    await assert.rejects(
        () => harness.service.exchangeYishuHuanfuGoods(10, 1),
        error => error.code === 'INSUFFICIENT_YSHF_LUCK_COIN',
    );
    // 只发了目录查询，没有发出下单请求。
    const cmds = harness.operateRequest().map(entry => readRequestCmd(Buffer.from(entry.body)));
    assert.deepEqual(cmds, [97]);
});

test('yishuhuanfu exchange rejects an unknown catalog tier', async () => {
    const harness = createHarness({ stateLuckCoin: '69120' });
    await assert.rejects(
        () => harness.service.exchangeYishuHuanfuGoods(99, 1),
        error => error.code === 'YSHF_CATALOG_ENTRY_NOT_FOUND',
    );
});

test('yishuhuanfu exchange supports a quantity and forwards it to cmd 96', async () => {
    // 第 10 档 7000/次、限 50 次；余额 69120 够买 9 次，这里买 3 次。
    const harness = createHarness({
        stateLuckCoin: '69120',
        operateReply: cmd => (cmd === 96
            ? { yshf_exchange: { price: '7000', grant: { item_id: '80001', count: '3' }, balance: '48120' } }
            : {}),
    });
    const result = await harness.service.exchangeYishuHuanfuGoods(10, 3);
    assert.equal(result.count, '3');
    // 本地按 count × 单价算成本，避免只扣一次币的错觉。
    assert.equal(result.cost, '21000');
    assert.equal(result.balance, '48120');

    const sent = types.YshfExchangeRequest.decode(harness.operateRequest()[1].body);
    assert.equal(String(sent.params.count), '3');
});

test('yishuhuanfu exchange refuses a quantity above the tier limit', async () => {
    // 第 1 档限兑 1 次，选 2 次要被本地拦住，不能白发一次网关请求。
    const harness = createHarness({ stateLuckCoin: '2000000' });
    await assert.rejects(
        () => harness.service.exchangeYishuHuanfuGoods(1, 2),
        error => error.code === 'YSHF_EXCEED_LIMIT',
    );
    const cmds = harness.operateRequest().map(entry => readRequestCmd(Buffer.from(entry.body)));
    assert.deepEqual(cmds, [97]);
});

test('yishuhuanfu luck coin prefers the server state over the bag', async () => {
    // 状态槽有值时以服务端为准（兑换后立即可见），背包余额只做兜底。
    const fromState = createHarness({ stateLuckCoin: '62120', luckCoin: '0' });
    const a = await fromState.service.getCurrentYishuHuanfuActivity();
    assert.equal(a.luckCoin.balance, '62120');

    const fromBag = createHarness({ stateLuckCoin: '0', luckCoin: '4321' });
    const b = await fromBag.service.getCurrentYishuHuanfuActivity();
    assert.equal(b.luckCoin.balance, '4321');
});

test('yishuhuanfu shop exposes estimated price and quota usage', async () => {
    const harness = createHarness({
        selfPrice: '116',
        bonus: '66',
        shopQuotes: { 1220537209: { price: '116', quota: '1000', bonus: '66' } },
    });
    const detail = await harness.service.getCurrentYishuHuanfuActivity();
    // 界面是「基础价 + 分享暴击 = 预计成交价」，116 + 66 = 182。
    assert.equal(detail.shop.price, '116');
    assert.equal(detail.shop.bonus, '66');
    assert.equal(detail.shop.estimatedPrice, '182');
    // 额度只能靠 cmd 92 现查，快照里必须是 null，不能让前端误以为已收购 0 个。
    assert.equal(detail.shop.quota, null);

    const quote = await harness.service.queryYishuHuanfuShop();
    assert.equal(quote.quota, '1000');
    assert.equal(quote.quotaCap, '8000');
    assert.equal(quote.quotaUsed, '7000');
    assert.equal(quote.own, true);
});

test('yishuhuanfu friend scan ranks shops by price and includes the own shop', async () => {
    const harness = createHarness({
        shopQuotes: {
            1220537209: { price: '116', quota: '7000', bonus: '66' },
            900001: { price: '220', quota: '3000', name: '阿甲' },
            900002: { price: '145', quota: '800', name: '阿乙' },
        },
        // 候选池现在只认「有当天分享标识」的账号：面板里能登录、今天分享过的铺子。
        shareKeys: {
            900001: '11111111-1111-4111-8111-111111111111',
            900002: '22222222-2222-4222-8222-222222222222',
        },
    });
    const result = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    // 自己 + 两个有标识的账号。
    assert.equal(result.scanned, 3);
    assert.equal(result.friendCount, 2);
    // 排序按游戏界面显示的成交价（基础价 + 加成）：220 > 116+66=182 > 145。
    assert.deepEqual(result.shops.map(entry => entry.gid), ['900001', '1220537209', '900002']);
    assert.equal(result.best.gid, '900001');
    assert.equal(result.best.price, '220');
    assert.equal(result.best.totalPrice, '220');
    assert.equal(result.ownShop.gid, '1220537209');
    // 自己的铺子 116 + 66 = 182，历史上这里只显示 116，和游戏里的收购价对不上。
    assert.equal(result.ownShop.totalPrice, '182');
    // 自家不占好友额度：unlimited 为真，界面显示「不限」；好友行照常给剩余额度。
    assert.equal(result.ownShop.unlimited, true);
    assert.equal(result.shops.find(entry => entry.gid === '900002').unlimited, false);
    // can_sell 逐行透传，默认桩值为可收；有标识的铺子都能卖。
    assert.equal(result.ownShop.canSell, true);
    assert.ok(result.shops.every(entry => entry.shareKeyKnown !== false));
    assert.equal(result.failed, 0);
});

test('yishuhuanfu scan sends the friend share key with cmd 92 but never for the own shop', async () => {
    const harness = createHarness({
        shopQuotes: {
            1220537209: { price: '116', quota: '7000' },
            900001: { price: '220', quota: '3000' },
        },
        shareKeys: { 900001: '11111111-1111-4111-8111-111111111111' },
    });
    await harness.service.scanYishuHuanfuFriendShops({ force: true });
    const queries = harness.operateRequest()
        .filter(entry => readRequestCmd(Buffer.from(entry.body)) === 92)
        .map(entry => types.YshfShopQueryRequest.decode(entry.body));
    const friendQuery = queries.find(q => String(q.params.shop_gid) === '900001');
    const ownQuery = queries.find(q => String(q.params.shop_gid) === '1220537209');
    assert.equal(friendQuery.params.shop.share_key, '11111111-1111-4111-8111-111111111111');
    assert.equal(String(friendQuery.params.shop.gid), '900001');
    // 查自己铺子不带分享引用（实机抓包同样没有这一段）。
    assert.equal(ownQuery.params.shop, null);
});

test('yishuhuanfu sell refuses a shop whose can_sell is false', async () => {
    const harness = createHarness({
        sweetPotato: '480',
        // 额度还剩很多，但对方当前不收蜜薯——只看 quota 会误判成可以卖。
        shopQuotes: { 900003: { price: '300', quota: '5000', name: '关张铺子', canSell: false } },
        shareKeys: { 900003: '33333333-3333-4333-8333-333333333333' },
    });
    await assert.rejects(
        () => harness.service.sellYishuHuanfuSweetPotato('900003', 10),
        error => error.code === 'YSHF_SHOP_CLOSED',
    );
    // 明确拒收时不能发出 cmd 93。
    assert.equal(
        harness.operateRequest().filter(entry => readRequestCmd(Buffer.from(entry.body)) === 93).length,
        0,
    );
});

test('yishuhuanfu sell proceeds when the reply omits can_sell', async () => {
    const harness = createHarness({
        sweetPotato: '100',
        // 老版本/精简回包不带字段 2：不能当成 false 把可卖的铺子拦下来。
        shopQuotes: { 900004: { price: '150', quota: '5000', name: '老回包', canSell: null } },
        shareKeys: { 900004: '44444444-4444-4444-8444-444444444444' },
        operateReply: (cmd) => (cmd === 93
            ? { yshf_sell: { count: '10', price: '150', total: '1500', quota: '4990', balance: '1500' } }
            : {}),
    });
    const result = await harness.service.sellYishuHuanfuSweetPotato('900004', 10);
    assert.equal(result.income, '1500');
});

test('yishuhuanfu friend scan tolerates a failing friend and caches the result', async () => {
    const harness = createHarness({
        shopQuotes: { 1220537209: { price: '116', quota: '7000' } },
        // 有标识但行情查失败：复刻「对方分享过、当前网络/网关抽风」的情况。
        shareKeys: { 900001: '55555555-5555-4555-8555-555555555555' },
    });
    const first = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    // 好友查询失败不中断整轮，只计一次失败，自己那行照常返回。
    assert.equal(first.failed, 1);
    assert.equal(first.shops.length, 1);
    assert.equal(first.shops[0].own, true);

    // 3 分钟缓存内重复调用不再打请求，force 才重扫。
    const before = harness.operateRequest().length;
    const cached = await harness.service.scanYishuHuanfuFriendShops();
    assert.equal(cached.cached, true);
    assert.equal(harness.operateRequest().length, before);

    await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.ok(harness.operateRequest().length > before);
});

test('yishuhuanfu sell invalidates the friend scan cache', async () => {
    const harness = createHarness({
        sweetPotato: '480',
        shopQuotes: { 1220537209: { price: '144', quota: '8000' } },
    });
    await harness.service.scanYishuHuanfuFriendShops({ force: true });
    await harness.service.sellYishuHuanfuSweetPotato(null, '100');
    const after = await harness.service.scanYishuHuanfuFriendShops();
    // 成交会改变额度，缓存必须失效，不能回放旧数据。
    assert.equal(after.cached, false);
});

test('yishuhuanfu sell forwards the requested count to cmd 93', async () => {
    const harness = createHarness({
        sweetPotato: '660',
        shopQuotes: { 900001: { price: '220', quota: '3000' } },
        shareKeys: { 900001: '66666666-6666-4666-8666-666666666666' },
    });
    await harness.service.sellYishuHuanfuSweetPotato('900001', '120');
    const sellRequest = harness.operateRequest().find(entry => readRequestCmd(Buffer.from(entry.body)) === 93);
    assert.ok(sellRequest, '应当发出 cmd 93');
    const sent = types.YshfSellRequest.decode(sellRequest.body);
    assert.equal(String(sent.params.count), '120');
    assert.equal(String(sent.params.shop_gid), '900001');
});

test('yishuhuanfu shop quote reports the price the game shows (base + bonus)', async () => {
    // 2026-11-25 13:51 抓包：好友 1006086548「风筝有风」的 cmd 92 回包是 field_1=99、price=66，
    // 游戏界面「今日蜜薯收购价」显示 165。只报 price 会让整张比价表偏低 99。
    const harness = createHarness({
        shopQuotes: { 1006086548: { price: '66', bonus: '99', quota: '8000', name: '风筝有风' } },
        // 2026-11-28 起查别人铺子也要带对方当天的标识，否则服务端会退回自己铺子的数据。
        shareKeys: { 1006086548: 'b0000001-0000-4000-8000-000000000001' },
    });
    const quote = await harness.service.queryYishuHuanfuShop('1006086548');
    assert.equal(quote.price, '66');
    assert.equal(quote.bonus, '99');
    assert.equal(quote.totalPrice, '165');
    assert.equal(quote.quota, '8000');
    assert.equal(quote.own, false);
});

test('yishuhuanfu shop quote refuses a gid without a share key instead of echoing own shop', async () => {
    // 2026-11-28 实测：不带 shop 去查别人的 gid，服务端会把自己铺子的行情原样返回，
    // 回包结构和好友铺子完全一样。照单全收就会把「自己的价」当成对方的价记进比价表，
    // 所以这里必须直接拒掉，一次网关请求都不该发出去。
    const harness = createHarness({
        shopQuotes: { 1220537209: { price: '100', quota: '8000', name: '自己' } },
    });
    await assert.rejects(
        () => harness.service.queryYishuHuanfuShop('1006086548'),
        (error) => {
            assert.equal(error.code, 'YSHF_SHARE_KEY_MISSING');
            return true;
        },
    );
    assert.equal(harness.operateRequest().length, 0, '没有标识时不应发出 cmd 92');
});

test('yishuhuanfu purchase records decode the 2026-11-25 15:11 capture', async () => {
    // 抓包 slot195：{1:1795590561, 2:1006806548, 3:30, 4:4320, 6:'风筝有风', 8:114, 9:86}
    // 4320 = 30 × 144 是付给卖家的总额，86 是本人拿到的提成。
    const harness = createHarness({
        operateReply: cmd => (cmd === 95
            ? {
                yshf_records: {
                    records: [{
                        timestamp: '1795590561',
                        gid: '1006806548',
                        count: '30',
                        total: '4320',
                        name: '风筝有风',
                        avatar: 'https://example/a.png',
                        level: '114',
                        commission: '86',
                    }],
                },
            }
            : {}),
    });
    const result = await harness.service.queryYishuHuanfuRecords();
    assert.equal(result.count, 1);
    assert.equal(result.totalCommission, '86');
    assert.equal(result.records[0].gid, '1006806548');
    assert.equal(result.records[0].count, '30');
    assert.equal(result.records[0].total, '4320');
    assert.equal(result.records[0].name, '风筝有风');
    assert.match(result.message, /最近 1 条收购记录/);

    // 95 是收购记录列表，不是刷新行情：请求 params 为空。
    const sent = types.YshfRecordRequest.decode(harness.operateRequest()[0].body);
    assert.equal(Number(sent.cmd), 95);
    assert.equal(String(sent.activity_id), ACTIVITY_ID);
});

test('yishuhuanfu record list tolerates an empty reply', async () => {
    // 没有收购记录时服务端回包就是空的（15:09 抓包实测），不能报错。
    const harness = createHarness({ operateReply: () => ({}) });
    const result = await harness.service.queryYishuHuanfuRecords();
    assert.equal(result.count, 0);
    assert.equal(result.totalCommission, '0');
    assert.match(result.message, /暂无收购记录/);
});

test('yishuhuanfu commission claim sends cmd 99 and needs a pending amount', async () => {
    // 没有可领提成时本地直接拦下，不打网关。
    const empty = createHarness({});
    await assert.rejects(
        () => empty.service.claimYishuHuanfuCommission(),
        error => error.code === 'YSHF_NO_COMMISSION',
    );

    const harness = createHarness({
        pendingCommission: '86',
        stateLuckCoin: '32070',
        operateReply: cmd => (cmd === 99
            ? { yshf_commission: { amount: '86', field_3: '1', balance: '32156' } }
            : {}),
    });
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    // 130.11 待领提成，界面「可领提成 86」。
    assert.equal(snapshot.commission.pending, '86');
    assert.equal(snapshot.commission.claimable, true);

    const result = await harness.service.claimYishuHuanfuCommission();
    assert.equal(result.amount, '86');
    assert.equal(result.balance, '32156');
    assert.match(result.message, /86/);

    const claimCall = harness.operateRequest().find(entry => readRequestCmd(Buffer.from(entry.body)) === 99);
    const sent = types.YshfClaimCommissionRequest.decode(claimCall.body);
    assert.equal(Number(sent.cmd), 99);
    assert.equal(String(sent.activity_id), ACTIVITY_ID);
});

test('yishuhuanfu commission stays unclaimable when nobody sold into the shop', async () => {
    const harness = createHarness({ sweetPotato: '30' });
    const snapshot = await harness.service.getCurrentYishuHuanfuActivity();
    assert.equal(snapshot.commission.pending, '0');
    assert.equal(snapshot.commission.claimable, false);
});

test('yishuhuanfu scan pools every account with a share key and rotates the window', async () => {
    const quotes = {
        1220537209: { price: '100', quota: '8000', name: '自己' },
        910001: { price: '260', quota: '2000', name: 'A号' },
        910002: { price: '230', quota: '2000', name: 'B号' },
        910003: { price: '180', quota: '2000', name: 'C号' },
        910004: { price: '170', quota: '2000', name: 'D号' },
    };
    const harness = createHarness({
        shopQuotes: quotes,
        // 面板里 4 个账号今天都分享过：它们的标识各自落盘，本账号读到就能卖进去。
        shareKeys: {
            910001: 'a0000001-0000-4000-8000-000000000001',
            910002: 'a0000002-0000-4000-8000-000000000002',
            910003: 'a0000003-0000-4000-8000-000000000003',
            910004: 'a0000004-0000-4000-8000-000000000004',
        },
    });
    // 上限 4：自己 + 3 个候选，4 个候选账号里有一个要等下一轮。
    const result = await harness.service.scanYishuHuanfuFriendShops({ force: true, limit: 4 });
    assert.equal(result.panelFriendCount, 4);
    assert.equal(result.friendCount, 4);
    assert.equal(result.scanned, 4);
    assert.equal(result.pendingCount, 1);
    assert.equal(result.limit, 4);

    const queried = harness.operateRequest()
        .map(entry => String(types.YshfShopQueryRequest.decode(Buffer.from(entry.body)).params?.shop_gid));
    assert.equal(new Set(queried).size, queried.length, '同一 GID 不能查两次');

    // 面板账号没有本地备注，界面上用 cmd 92 回包的铺主昵称补齐。
    const panelRows = result.shops.filter(entry => entry.via === 'panel');
    assert.ok(panelRows.length >= 1);
    assert.ok(panelRows.every(entry => entry.name && entry.name !== entry.gid));
    assert.ok(panelRows.every(entry => entry.shareKeyKnown === true));
    assert.equal(result.shops.find(entry => entry.gid === '1220537209').via, 'own');

    // 下一轮从游标接着扫：上一轮没轮到的 GID 必须出现，且自己的铺子仍在。
    const next = await harness.service.scanYishuHuanfuFriendShops({ force: true, limit: 4 });
    const allGids = new Set([...result.shops, ...next.shops].map(entry => entry.gid));
    assert.equal(allGids.size, 5, '两轮轮换应覆盖自己 + 4 个候选账号');
});

test('yishuhuanfu scan never pools keyless friends', async () => {
    const harness = createHarness({
        shopQuotes: {
            1220537209: { price: '100', quota: '8000' },
            900001: { price: '300', quota: '2000', name: '普通好友' },
            900002: { price: '250', quota: '2000', name: '别号好友' },
        },
        // 历史收集过的 gid 还读得到，但今天都没标识 —— 一条都不该查。
        getAllFriends: async () => ({ game_friends: [{ gid: '900001', name: '普通好友' }] }),
        getPanelFriendGids: () => [{ gid: '900002', accountName: '别号' }],
    });
    const result = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.equal(result.shops.length, 1);
    assert.equal(result.shops[0].own, true);
    // 2026-11-28 之后 cmd 92 不带 shop 只会拿回自己铺子的数据，
    // 没有标识的 gid 一律不查，所以这里只有自己那一条请求。
    assert.equal(result.scanned, 1);
    const queried = harness.operateRequest()
        .map(entry => String(types.YshfShopQueryRequest.decode(Buffer.from(entry.body)).params?.shop_gid));
    assert.deepEqual(queried, ['1220537209']);

    // includeFriends 这个兼容入口已随查价收紧一并失效：传了也不会再并好友列表。
    const legacy = await harness.service.scanYishuHuanfuFriendShops({ force: true, includeFriends: true });
    assert.equal(legacy.shops.length, 1);
});

// 2026-11-28 实测：铺主重新分享一次后，之前那条链接立刻作废，
// 服务端回 1034184「分享链接已失效，请重新联系店主分享」。
// 存档里那条已经没用了 —— 必须清掉，否则每轮比价都拿死链打网关：
// 既拿不到价，又平白多出一堆注定失败的请求。
function shareKeyExpiredError() {
    return Object.assign(
        new Error('gamepb.activitypb.ActivityService.Operate code=1034184 分享链接已失效，请重新联系店主分享'),
        { code: 1034184, errorMessage: '分享链接已失效，请重新联系店主分享' },
    );
}

test('查价撞到 1034184 会删掉这家的标识，并从下一轮候选里消失', async () => {
    const harness = createHarness({
        shopQuotes: {
            1220537209: { price: '100', quota: '8000' },
            910001: { price: '260', quota: '2000', name: 'A号' },
        },
        shareKeys: { 910001: 'a0000001-0000-4000-8000-000000000001' },
        operateThrows: (cmd, body) => {
            if (cmd !== 92) return null;
            const gid = String(types.YshfShopQueryRequest.decode(body).params?.shop_gid ?? '');
            return gid === '910001' ? shareKeyExpiredError() : null;
        },
    });

    const first = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.equal(first.expiredKeyCount, 1);
    assert.deepEqual(first.expiredShops, [{ gid: '910001', name: '' }]);
    // 失效的不算「查询失败」：这不是网络问题，重试也不会好。
    assert.equal(first.failed, 0);
    assert.equal(first.shops.some(entry => entry.gid === '910001'), false);
    assert.match(first.message, /分享链接失效已移出/);
    // 死链已经从存档里清掉，否则下一轮还会拿它打网关。
    assert.equal(harness.shareKeyStore.readYishuShareKey('910001'), null);

    const before = harness.operateRequest().length;
    const second = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.equal(second.expiredKeyCount, 0);
    const queried = harness.operateRequest().slice(before)
        .map(entry => String(types.YshfShopQueryRequest.decode(Buffer.from(entry.body)).params?.shop_gid));
    assert.deepEqual(queried, ['1220537209'], '死链不该再被请求');
});

test('错误只把 code 拼在 message 里也能认出 1034184', async () => {
    // 真实链路里错误经过 worker / IPC 序列化后，可能只剩一句带 code= 的 message，
    // error.code 已经丢了。只按 code 判会漏，必须同时看文案。
    const harness = createHarness({
        shopQuotes: {
            1220537209: { price: '100', quota: '8000' },
            910001: { price: '260', quota: '2000' },
        },
        shareKeys: { 910001: 'a0000001-0000-4000-8000-000000000001' },
        operateThrows: cmd => (cmd === 92 ? new Error('ActivityService.Operate code=1034184 分享链接已失效') : null),
    });
    const result = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    // 自己的查价也会撞上这个桩，只能确认「至少认出了一条」且存档被清。
    assert.ok(result.expiredKeyCount >= 1);
    assert.equal(harness.shareKeyStore.readYishuShareKey('910001'), null);
});

test('售卖撞到 1034184 抛 SHARE_KEY_EXPIRED 并清掉死链', async () => {
    const harness = createHarness({
        sweetPotato: '30',
        shopQuotes: {
            1220537209: { price: '100', quota: '8000' },
            910001: { price: '260', quota: '2000', name: 'A号' },
        },
        shareKeys: { 910001: 'a0000001-0000-4000-8000-000000000001' },
        // cmd 92 正常（能查到价），cmd 93 被拒：模拟对方在这两步之间重新分享了。
        operateThrows: cmd => (cmd === 93 ? shareKeyExpiredError() : null),
    });
    await assert.rejects(
        () => harness.service.sellYishuHuanfuSweetPotato('910001', '30', { withSnapshot: false }),
        (error) => {
            assert.equal(error.code, 'YSHF_SHARE_KEY_EXPIRED');
            assert.match(error.message, /重新分享/);
            return true;
        },
    );
    assert.equal(harness.shareKeyStore.readYishuShareKey('910001'), null);
});

test('失效成片出现时提前中止本轮，不再继续打网关', async () => {
    // 5 家全部失效：第一批 4 个（含自己）撞到 3 条就停手，
    // 剩下的留给下一轮（那时存档已清，不会再撞）。
    const shareKeys = {};
    for (let i = 1; i <= 5; i += 1)
        shareKeys[`91000${i}`] = `a000000${i}-0000-4000-8000-00000000000${i}`;

    const harness = createHarness({
        shopQuotes: { 1220537209: { price: '100', quota: '8000' } },
        shareKeys,
        operateThrows: (cmd, body) => {
            if (cmd !== 92) return null;
            const gid = String(types.YshfShopQueryRequest.decode(body).params?.shop_gid ?? '');
            return gid === '1220537209' ? null : shareKeyExpiredError();
        },
    });

    const result = await harness.service.scanYishuHuanfuFriendShops({ force: true });
    assert.equal(result.expiredKeyCount, 3);
    // 只打了一批（自己 + 3 家），没把剩下两家也算成本轮已扫。
    assert.equal(result.scanned, 4);
    const queried = harness.operateRequest()
        .map(entry => String(types.YshfShopQueryRequest.decode(Buffer.from(entry.body)).params?.shop_gid));
    assert.equal(queried.length, 4, '熔断后不该再发请求');
});
