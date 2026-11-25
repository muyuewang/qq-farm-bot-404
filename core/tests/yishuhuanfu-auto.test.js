const assert = require('node:assert/strict');
const test = require('node:test');

const { createYishuAutomation, isYishuAutomationEnabled } = require('../dist/services/yishuhuanfu-auto');

// 以薯换福自动任务的纯逻辑测试：所有网关调用都用桩替换，只验证「什么时候发、发给谁、发几次」。
const NOW_SEC = 1795573881;

function makeSnapshot(overrides = {}) {
    const base = {
        active: true,
        daily: { seedClaimed: false, shared: false, sharedToday: false },
        sweetPotatoBalance: '0',
        shop: { priceKnown: true, price: '111', bonus: '33', estimatedPrice: '144' },
        commission: { pending: '0', claimable: false, flag: '0' },
    };
    return {
        ...base,
        ...overrides,
        daily: { ...base.daily, ...(overrides.daily || {}) },
        shop: { ...base.shop, ...(overrides.shop || {}) },
        commission: { ...base.commission, ...(overrides.commission || {}) },
    };
}

function makeShop(overrides = {}) {
    return {
        gid: '1',
        name: '甲',
        own: false,
        totalPrice: '165',
        price: '99',
        bonus: '66',
        quota: '0',
        quotaCap: '8000',
        quotaUsed: '8000',
        ...overrides,
    };
}

function createHarness(options = {}) {
    const calls = [];
    const logs = [];
    let snapshot = options.snapshot || makeSnapshot();
    const shops = options.shops || [];
    const automation = createYishuAutomation({
        getActivity: async (...args) => {
            calls.push(['getActivity', args[0]]);
            return snapshot;
        },
        claimSeed: async (args) => {
            calls.push(['claimSeed', args]);
            return { count: '28' };
        },
        shareShop: async (args) => {
            calls.push(['shareShop', args]);
            return { count: '3', shareReported: true };
        },
        claimCommission: async (args) => {
            calls.push(['claimCommission', args]);
            return { amount: '86', balance: '32156' };
        },
        scanFriends: async (args) => {
            calls.push(['scanFriends', args]);
            return { shops };
        },
        sell: async (friendGid, count, args) => {
            calls.push(['sell', friendGid, count, args]);
            if (options.sell) return options.sell(friendGid, count);
            return { count, price: '165', income: String(Number(count) * 165) };
        },
        getServerTimeSec: () => NOW_SEC,
        log: (module, message, meta) => logs.push({ module, message, meta }),
    });
    return {
        automation,
        calls,
        logs,
        sells: () => calls.filter(entry => entry[0] === 'sell'),
        setSnapshot: next => { snapshot = next; },
    };
}

const ALL_ON = {
    yishu_claim_seed: true,
    yishu_share: true,
    yishu_claim_commission: true,
    yishu_auto_sell: true,
    yishu_sell_fallback_own: true,
    yishu_scan_friend_limit: 20,
    yishu_scan_interval_minutes: 30,
    yishu_sell_min_count: 1,
};

test('yishu automation is enabled by any single switch', () => {
    assert.equal(isYishuAutomationEnabled({}), false);
    assert.equal(isYishuAutomationEnabled({ yishu_share: true }), true);
    assert.equal(isYishuAutomationEnabled({ yishu_claim_commission: true }), true);
    assert.equal(isYishuAutomationEnabled({ muge_claim_rewards: true }), false);
});

test('daily seed and share claims run once, then skip on the server flags', async () => {
    const harness = createHarness({ snapshot: makeSnapshot({ sweetPotatoBalance: '0' }) });
    await harness.automation.runYishuAutomation(ALL_ON);

    assert.deepEqual(harness.calls.filter(entry => entry[0] !== 'getActivity').map(entry => entry[0]), [
        'claimSeed',
        'shareShop',
    ]);
    // 自动任务不需要整份活动中心快照（那是 7 个活动的读），必须显式关掉。
    assert.deepEqual(harness.calls.find(entry => entry[0] === 'claimSeed')[1], { withSnapshot: false });

    const second = createHarness({
        snapshot: makeSnapshot({ daily: { seedClaimed: true, shared: true } }),
    });
    await second.automation.runYishuAutomation(ALL_ON);
    assert.deepEqual(second.calls.filter(entry => entry[0] !== 'getActivity').map(entry => entry[0]), []);
    // 每天只记一条跳过，不刷日志。
    assert.ok(second.logs.some(entry => entry.message.includes('今日红薯种子已经领过')));
});

test('commission is claimed only when the server says it is claimable', async () => {
    const pending = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '0', commission: { pending: '86', claimable: true } }),
    });
    await pending.automation.runYishuAutomation({ yishu_claim_commission: true, yishu_auto_sell: false });
    assert.deepEqual(pending.calls.filter(entry => entry[0] === 'claimCommission')[0][1], { withSnapshot: false });

    const empty = createHarness({ snapshot: makeSnapshot({ sweetPotatoBalance: '0' }) });
    await empty.automation.runYishuAutomation({ yishu_claim_commission: true, yishu_auto_sell: false });
    assert.equal(empty.calls.filter(entry => entry[0] === 'claimCommission').length, 0);
});

test('auto sell walks shops by price and switches to the next when one is full', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '500' }),
        shops: [
            makeShop({ gid: '1001', name: '最高价', totalPrice: '165', quota: '300' }),
            makeShop({ gid: '1002', name: '第二高', totalPrice: '150', quota: '0' }),
            makeShop({ gid: '1003', name: '第三高', totalPrice: '144', quota: '500' }),
            makeShop({ gid: 'own', name: '我的铺子', own: true, totalPrice: '111', quota: '10000' }),
        ],
        sell: (friendGid, count) => {
            if (friendGid === '1001') {
                // 服务端说这家已经收满：必须换下一家，而不是整轮失败。
                const error = new Error('1001 的铺子今日只剩 0 个接收额度');
                error.code = 'YSHF_SHOP_QUOTA_INSUFFICIENT';
                throw error;
            }
            return { count, price: '144', income: String(Number(count) * 144) };
        },
    });

    await harness.automation.runYishuAutomation(ALL_ON);

    assert.deepEqual(harness.sells().map(entry => [entry[1], entry[2]]), [
        ['1001', '300'],
        ['1003', '500'],
    ]);
    // 第三高那家把 500 个全吃了，自己的铺子不该再被写一次。
    assert.equal(harness.calls.filter(entry => entry[0] === 'sell').length, 2);
});

test('auto sell skips a shop whose can_sell is false without calling it', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '400' }),
        shops: [
            // 最高价但当前不收（can_sell=false），且额度还剩很多——
            // 只看 quota 就会白打一次 cmd 93 再失败。
            makeShop({ gid: '2001', name: '关门铺', totalPrice: '300', quota: '5000', canSell: false }),
            makeShop({ gid: '2002', name: '次高', totalPrice: '160', quota: '400', canSell: true }),
        ],
    });

    await harness.automation.runYishuAutomation(ALL_ON);

    assert.deepEqual(harness.sells().map(entry => [entry[1], entry[2]]), [['2002', '400']]);
});

test('leftover sweet potatoes fall back to the own shop when every friend is full', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '500' }),
        shops: [
            makeShop({ gid: '1001', quota: '0' }),
            makeShop({ gid: 'own', name: '我的铺子', own: true, totalPrice: '111', quota: '10000' }),
        ],
        sell: (friendGid, count) => ({ count, price: '111', income: String(Number(count) * 111) }),
    });

    await harness.automation.runYishuAutomation(ALL_ON);

    // null 表示「不传 friendGid」，服务端按自己的铺子结算。
    assert.deepEqual(harness.sells().map(entry => [entry[1], entry[2]]), [[null, '500']]);
});

test('closing the own-shop fallback keeps leftovers unsold', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '500' }),
        shops: [
            makeShop({ gid: '1001', quota: '0' }),
            makeShop({ gid: 'own', name: '我的铺子', own: true, totalPrice: '111', quota: '10000' }),
        ],
    });

    await harness.automation.runYishuAutomation({ ...ALL_ON, yishu_sell_fallback_own: false });

    assert.equal(harness.sells().length, 0);
    assert.ok(harness.logs.some(entry => entry.message.includes('没卖出去') || entry.message.includes('没有可卖')));
});

test('a round never switches more than three shops', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '1000' }),
        shops: [
            makeShop({ gid: '1001', totalPrice: '165', quota: '100' }),
            makeShop({ gid: '1002', totalPrice: '160', quota: '100' }),
            makeShop({ gid: '1003', totalPrice: '155', quota: '100' }),
            makeShop({ gid: '1004', totalPrice: '150', quota: '100' }),
            makeShop({ gid: '1005', totalPrice: '145', quota: '100' }),
        ],
    });

    await harness.automation.runYishuAutomation(ALL_ON);

    assert.deepEqual(harness.sells().map(entry => entry[1]), ['1001', '1002', '1003']);
    assert.ok(harness.logs.some(entry => entry.message.includes('还有 700 个蜜薯没卖出去')));
});

test('sweet potatoes below the sell threshold are left alone', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '12' }),
        shops: [makeShop({ gid: '1001', quota: '500' })],
    });

    await harness.automation.runYishuAutomation({ ...ALL_ON, yishu_sell_min_count: 20 });

    assert.equal(harness.sells().length, 0);
    assert.equal(harness.calls.filter(entry => entry[0] === 'scanFriends').length, 0);
    assert.ok(harness.logs.some(entry => entry.message.includes('未达到自动卖出阈值 20')));
});

test('friend price scan is throttled by the configured interval', async () => {
    const harness = createHarness({
        snapshot: makeSnapshot({ sweetPotatoBalance: '10' }),
        shops: [makeShop({ gid: '1001', quota: '1000' })],
    });

    await harness.automation.runYishuAutomation(ALL_ON);
    harness.setSnapshot(makeSnapshot({ sweetPotatoBalance: '10' }));
    await harness.automation.runYishuAutomation(ALL_ON);

    // 第二轮在 30 分钟窗口内，直接复用上一轮的排序结果。
    assert.equal(harness.calls.filter(entry => entry[0] === 'scanFriends').length, 1);
    // 比价只传好友数上限，force 由自动任务自己控制。
    assert.deepEqual(harness.calls.find(entry => entry[0] === 'scanFriends')[1], { limit: 20, force: true });
});

test('an inactive activity window stops the whole round', async () => {
    const harness = createHarness({ snapshot: makeSnapshot({ active: false, sweetPotatoBalance: '500' }) });
    await harness.automation.runYishuAutomation(ALL_ON);

    assert.deepEqual(harness.calls.map(entry => entry[0]), ['getActivity']);
    assert.ok(harness.logs.some(entry => entry.message.includes('不在开放窗口')));
});
