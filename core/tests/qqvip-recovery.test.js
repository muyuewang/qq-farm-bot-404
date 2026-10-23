const assert = require('node:assert/strict');
const test = require('node:test');

function harness(t, options = {}) {
    const calls = [];
    const logs = [];
    const status = options.status || {
        is_qq_vip: true,
        can_claim: true,
        mall_free_can_claim: true,
        reward_statuses: [{ type: 1, is_enable: true, reward_type: 5 }],
    };
    const mock = (name, exports) => {
        const id = require.resolve(name);
        const original = require.cache[id];
        require.cache[id] = { id, filename: id, loaded: true, exports };
        t.after(() => { if (original) require.cache[id] = original; else delete require.cache[id]; });
    };
    const codec = (decoded = {}) => ({ create: v => v, encode: v => ({ finish: () => v }), decode: () => decoded });
    mock('../dist/utils/network', { sendMsgAsync: async (_service, method, body) => {
        calls.push({ method, body });
        if (method === 'RefreshVipInfo' && options.refreshError) throw options.refreshError;
        if (method === 'GetQQVipRewardsStatus' && options.statusError) throw options.statusError;
        if (method === 'ClaimQQVipRewards' && options.claimError) throw options.claimError;
        return { body: Buffer.alloc(0) };
    } });
    mock('../dist/utils/proto', { types: {
        RefreshVipInfoRequest: codec(), RefreshVipInfoReply: codec(),
        GetQQVipRewardsStatusRequest: codec(), GetQQVipRewardsStatusReply: codec(status),
        ClaimQQVipRewardsRequest: codec(), ClaimQQVipRewardsReply: codec({ items: [{ id: 1901, count: 1 }] }),
    } });
    mock('../dist/utils/utils', {
        log: (...args) => logs.push(args), toNum: v => Number(v) || 0,
        getSystemDateKey: () => new Date(Date.now()).toISOString().slice(0, 10),
    });
    mock('../dist/services/mall', {
        getMallListBySlotType: async () => {
            if (options.mallError) throw options.mallError;
            return { goods_list: [{ goods_id: 1053, is_free: true, is_available: true, price: { id: 1004, count: 0 } }] };
        },
        purchaseMallGoods: async (...args) => { calls.push({ method: 'Purchase', args }); return { success: true }; },
    });
    const id = require.resolve('../dist/services/qqvip');
    const original = require.cache[id];
    delete require.cache[id];
    t.after(() => { if (original) require.cache[id] = original; else delete require.cache[id]; });
    return { service: require(id), calls, logs, options, status };
}

test('daily gifts remain claimable when the optional membership refresh service is busy', async (t) => {
    const h = harness(t, {
        refreshError: Object.assign(new Error('网络繁忙，请稍候再试。'), { code: 1000032 }),
    });
    assert.equal(await h.service.performDailyVipGift(true), true);
    assert.ok(h.calls.some(c => c.method === 'ClaimQQVipRewards'));
    assert.ok(h.calls.some(c => c.method === 'Purchase'));
    assert.equal(h.service.getVipDailyState().result, 'ok');
    assert.equal(h.service.getVipDailyState().doneToday, true);
    assert.equal(h.service.getVipDailyState().lastError, '');
});

test('an SVIP mall failure does not block the daily membership reward or mark the day complete', async (t) => {
    const h = harness(t, { mallError: new Error('mall offline') });
    assert.equal(await h.service.performDailyVipGift(), true);
    assert.ok(h.calls.some(c => c.method === 'ClaimQQVipRewards'));
    const state = h.service.getVipDailyState();
    assert.equal(state.result, 'partial');
    assert.equal(state.doneToday, false);
    assert.equal(state.isVip, true);
    assert.match(state.lastError, /SVIP 商城免费礼包.*mall offline/);
});

test('a daily reward failure does not block the independently claimable free mall reward', async (t) => {
    const h = harness(t, { claimError: new Error('claim failed') });
    assert.equal(await h.service.performDailyVipGift(), true);
    assert.ok(h.calls.some(c => c.method === 'Purchase'));
    assert.equal(h.service.getVipDailyState().result, 'partial');
    assert.equal(h.service.getVipDailyState().doneToday, false);
});

test('already claimed daily rewards do not hide a failed mall reward', async (t) => {
    const h = harness(t, {
        claimError: Object.assign(new Error('今日已领取'), { code: 1021002 }),
        mallError: new Error('mall offline'),
    });
    assert.equal(await h.service.performDailyVipGift(), false);
    assert.equal(h.service.getVipDailyState().doneToday, false);
    assert.match(h.service.getVipDailyState().lastError, /mall offline/);
});

test('a failed status read preserves unknown membership instead of declaring a nonmember', async (t) => {
    const h = harness(t, { statusError: new Error('status offline') });
    assert.equal(await h.service.performDailyVipGift(), false);
    assert.equal(h.service.getVipDailyState().result, 'error');
    assert.equal(h.service.getVipDailyState().isVip, null);
    assert.equal(h.service.getVipDailyState().hasGift, null);
    assert.match(h.service.getVipDailyState().lastError, /status offline/);
});

test('a busy status read cannot claim and is retried after the cooldown', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-17T02:00:00Z') });
    const h = harness(t, {
        statusError: Object.assign(new Error('code=1000032 网络繁忙，请稍候再试。'), { code: 1000032 }),
    });
    assert.equal(await h.service.performDailyVipGift(), false);
    assert.equal(h.calls.some(c => c.method === 'ClaimQQVipRewards' || c.method === 'Purchase'), false);
    assert.equal(h.service.getVipDailyState().doneToday, false);
    assert.equal(h.service.getVipDailyState().isVip, null);
    assert.match(h.service.getVipDailyState().lastError, /1000032/);
    t.mock.timers.tick(10 * 60 * 1000);
    h.options.statusError = null;
    assert.equal(await h.service.performDailyVipGift(), true);
    assert.equal(h.service.getVipDailyState().result, 'ok');
    assert.equal(h.service.getVipDailyState().lastError, '');
});

test('a failed gift retries after the cooldown, with fresh server status preventing duplicate claims', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-17T02:00:00Z') });
    const h = harness(t, { mallError: new Error('mall offline') });
    await h.service.performDailyVipGift();
    const count = h.calls.length;
    t.mock.timers.tick(10 * 60 * 1000 - 1);
    assert.equal(await h.service.performDailyVipGift(), false);
    assert.equal(h.calls.length, count);
    t.mock.timers.tick(1);
    h.options.mallError = null;
    h.status.can_claim = false;
    h.status.claimed_today = true;
    assert.equal(await h.service.performDailyVipGift(), true);
    assert.equal(h.calls.filter(c => c.method === 'ClaimQQVipRewards').length, 1);
    assert.equal(h.service.getVipDailyState().doneToday, true);
    assert.equal(h.service.getVipDailyState().result, 'ok');
    assert.equal(h.service.getVipDailyState().lastError, '');
    await h.service.performDailyVipGift();
    assert.equal(h.calls.filter(c => c.method === 'Purchase').length, 1);
});

test('an unrelated error mentioning not-yet-claimed is not treated as already claimed', async (t) => {
    const h = harness(t, { claimError: new Error('无法确认是否已领取'), mallError: new Error('mall offline') });
    await h.service.performDailyVipGift();
    assert.equal(h.service.getVipDailyState().doneToday, false);
    assert.equal(h.service.getVipDailyState().result, 'error');
    assert.match(h.service.getVipDailyState().lastError, /无法确认是否已领取/);
});
