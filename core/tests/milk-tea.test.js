const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protobuf = require('protobufjs');
const root = new protobuf.Root().loadSync(path.join(__dirname, '../src/proto/activitypb.proto'), { keepCase: true });
const types = Object.fromEntries(['MilkTeaGetGroupReply', 'MilkTeaOperateReply', 'MilkTeaOperateRequest', 'GetGroupRequest'].map(name => [name, root.lookupType(`gamepb.activitypb.${name}`)]));
const encode = (type, data) => Buffer.from(type.encode(type.fromObject(data)).finish());

function harness() {
    const calls = [];
    let now = 1792032000;
    let failRefresh = false;
    let writes = 0;
    const milk = { head: { activity_id: '2026110101', name: '奶茶热销中', begin_time: 1792029600, end_time: 1794844799, settle_start_time: 1794671999 }, milk_tea: { summary: { shop_open_at: 1792030000, shop_name: '测试店铺', level: 1, total_revenue: 500 } } };
    const goods = { id: 301, item: [{ id: 20525, count: 1 }], cost: [{ id: 1001, count: 10000 }], purchase_limit: 108, purchased_count: 2, category_tag: 'seed', cond_hints: [] };
    const fund = { unlocked: false, unlock_cost: [{ id: 1004, count: 360 }], tiers: [{ tier_id: 1, state: 2, reward: [{ id: 1002, count: 288 }] }] };
    const bag = [{ id: 1042, count: 1 }, { id: 1041, count: 200 }, { id: 1001, count: 100000 }, { id: 40525, uid: 900, count: 20 }];
    const shop = { level: 1, sales_item_id: 1042, boost_cups_per_use: 40, drink_cups: { 2: 10 }, slots: [], pending_rewards: [{ id: 1041, count: 12 }] };
    const work = { hire_subscribe_qq_jump_url: 'private-signature', hire_subscribe_template_id: 'private-template' };
    const fields = { 55: 'milk_tea_get_shop', 56: 'milk_tea_get_hire_list', 58: 'milk_tea_get_workshop', 60: 'milk_tea_boost', 62: 'milk_tea_craft', 57: 'milk_tea_hire', 1: 'shop_buy', 75: 'growth_fund_unlock', 76: 'growth_fund_claim', 63: 'milk_tea_get_work_page' };
    Object.assign(fields, { 54: 'milk_tea_rename_shop', 61: 'milk_tea_upgrade', 68: 'milk_tea_set_hire_disable', 65: 'milk_tea_interact' });
    const mock = (name, exports) => { const id = require.resolve(`../dist/${name}`); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    mock('utils/proto', { types });
    mock('utils/utils', { toNum: v => Number(v) || 0, getServerTimeSec: () => now });
    mock('config/gameConfig', { getItemById: id => ({ name: `物品${id}` }), getItemImageById: () => '' });
    mock('services/pay', { getDiamondBalance: async () => 767 });
    mock('services/warehouse', { getBag: async () => ({ items: bag }), getBagItems: b => b.items, isItemLocked: v => !!v.locked });
    mock('utils/network', { sendMsgAsync: async (_service, method, body) => {
        if (method === 'GetGroup') {
            if (failRefresh && writes) throw new Error('offline');
            return { body: encode(types.MilkTeaGetGroupReply, { group: { head: { activity_id: '2026110100' }, children: [milk, { head: { activity_id: '2026110102' }, shop: { goods: [goods] } }, { head: { activity_id: '2026110103' }, growth_fund: fund }] } }) };
        }
        const req = types.MilkTeaOperateRequest.toObject(types.MilkTeaOperateRequest.decode(body), { longs: String });
        const cmd = Number(req.operate_type);
        let result;
        if (cmd === 55) result = { shop };
        else if (cmd === 58) result = { recipes: [{ recipe_id: 2, recipe_name: '甜莓奶茶', unlocked: true, is_advanced: true, stock_cups: 10 }] };
        else if (cmd === 56) result = { duration_id: 1, wage_total: 40, min_remain_biz_sec: 600, robots: [{ friend: { gid: 101, name: '实习员工' }, is_robot: true }] };
        else if (cmd === 63) result = work;
        else {
            calls.push(req); writes++;
            if (cmd === 60) { bag[0].count--; result = { cups: 40, token_gain: 183, coin_gain: 111375 }; }
            else if (cmd === 75) { fund.unlocked = true; result = {}; }
            else if (cmd === 76) { fund.tiers[0].state = 3; result = { claimed_tier_ids: [1], awards: [{ id: 1002, count: 288 }] }; }
            else if (cmd === 57) result = { results: [{ success: false, error_code: 1, error_msg: '员工状态已变化' }] };
            else if (cmd === 62) result = { crafted_cups: { 2: 20 }, drink_cups: { 2: 30 }, used_fruits: [bag[3]] };
            else result = { awards: [{ id: 20525, count: 1 }] };
        }
        return { body: encode(types.MilkTeaOperateReply, { activity_id: req.activity_id, operate_type: cmd, [fields[cmd]]: result }) };
    } });
    const id = require.resolve('../dist/services/milk-tea'); delete require.cache[id];
    return { service: require(id), calls, bag, shop, fund, goods, work, summary: milk.milk_tea.summary, setTime: v => now = v, failRefresh: () => failRefresh = true };
}

test('boost spends the checked horn once and returns actual awards, retaining success after refresh failure', async () => {
    const h = harness();
    const state = await h.service.getMilkTeaActivity();
    assert.deepEqual(state.shop.drink_cups, { 2: 10 });
    h.failRefresh();
    const result = await h.service.operateMilkTeaActivity('boost', { count: 1, expectedCosts: [{ id: 1042, count: 1 }] });
    assert.equal(result.refreshRequired, true);
    assert.deepEqual(result.rewards.map(v => [v.id, v.count]), [[1041, 183], [1001, 111375]]);
    assert.deepEqual(h.calls[0].milk_tea_boost, { count: 1 });
    assert.equal(h.bag[0].count, 0);
});
test('boost rejects insufficient horns, changed prices and settlement without sending writes', async () => {
    const h = harness();
    await assert.rejects(h.service.operateMilkTeaActivity('boost', { count: 2, expectedCosts: [{ id: 1042, count: 1 }] }), /不足/);
    await assert.rejects(h.service.operateMilkTeaActivity('boost', { count: 1, expectedCosts: [{ id: 1004, count: 1 }] }), /费用已变化/);
    h.setTime(1794672000);
    await assert.rejects(h.service.operateMilkTeaActivity('boost', { count: 1 }), /结算期/);
    assert.equal(h.calls.length, 0);
});
test('craft consumes complete UID stacks and rejects locked, changed or duplicate selections', async () => {
    const h = harness();
    for (const fruits of [[{ uid: '900', count: 19 }], [{ uid: '900', count: 20 }, { uid: '900', count: 20 }]]) await assert.rejects(h.service.operateMilkTeaActivity('craft', { fruits }));
    h.bag[3].locked = true;
    await assert.rejects(h.service.operateMilkTeaActivity('craft', { fruits: [{ uid: '900', count: 20 }] }), /锁定状态/);
    h.bag[3].locked = false;
    const result = await h.service.operateMilkTeaActivity('craft', { fruits: [{ uid: '900', count: 20 }] });
    assert.deepEqual(result.result.crafted_cups, { 2: 20 });
    assert.deepEqual(h.calls[0].milk_tea_craft, { fruit_uids: ['900'] });
});
test('shop retains finite limits and enforces level, price and settlement conditions', async () => {
    const h = harness();
    assert.equal((await h.service.getMilkTeaActivity('exchange')).goods[0].remaining, 106);
    h.goods.cond_hints = [{ cond_type: 'level', current: 1, target: 3, satisfied: false }];
    await assert.rejects(h.service.operateMilkTeaActivity('exchange', { goodsId: 301, count: 1, expectedCosts: h.goods.cost }), /条件/);
    h.goods.cond_hints = [];
    await assert.rejects(h.service.operateMilkTeaActivity('exchange', { goodsId: 301, count: 1, expectedCosts: [{ id: 1001, count: 1 }] }), /费用已变化/);
    h.setTime(1794672000);
    await assert.rejects(h.service.operateMilkTeaActivity('exchange', { goodsId: 301, count: 1, expectedCosts: h.goods.cost }), /条件/);
    assert.equal(h.calls.length, 0);
});
test('fund unlock is serialized and claims require paid unlock without duplicate charges', async () => {
    const h = harness();
    await assert.rejects(h.service.operateMilkTeaActivity('fundClaim'), /暂无/);
    const results = await Promise.allSettled([1, 2].map(() => h.service.operateMilkTeaActivity('unlock', { expectedCosts: [{ id: 1004, count: 360 }] })));
    assert.deepEqual(results.map(v => v.status), ['fulfilled', 'rejected']);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0], { activity_id: '2026110103', operate_type: '75' });
    const result = await h.service.operateMilkTeaActivity('fundClaim');
    assert.equal(result.rewards[0].count, 288);
    await assert.rejects(h.service.operateMilkTeaActivity('fundClaim'), /暂无/);
});
test('hire partial failures are not reported as success and signed work links stay private', async () => {
    const h = harness();
    await assert.rejects(h.service.operateMilkTeaActivity('hire', { targetGid: '101', slotIndex: 0, durationId: 1, expectedCosts: [{ id: 1041, count: 40 }] }), /员工状态/);
    assert.deepEqual(h.calls[0].milk_tea_hire.hires[0], { slot_index: 0, duration_id: 1, target_gid: '101' });
    const state = await h.service.getMilkTeaActivity('work');
    assert.equal(JSON.stringify(state).includes('private-'), false);
});

test('hire automatically chooses a freshly vacant unlocked slot and rejects a full shop', async () => {
    const h = harness();
    h.shop.level = 3;
    h.shop.slots = [{ slot_index: 0, end_at: 1792042000 }];
    const input = { targetGid: '101', durationId: 1, expectedCosts: [{ id: 1041, count: 40 }] };
    await assert.rejects(h.service.operateMilkTeaActivity('hire', input), /员工状态/);
    assert.equal(h.calls[0].milk_tea_hire.hires[0].slot_index, 1);
    h.shop.slots.push({ slot_index: 1, end_at: 1792042000 });
    await assert.rejects(h.service.operateMilkTeaActivity('hire', input), /位置已满/);
    assert.equal(h.calls.length, 1);
    h.shop.slots[0].end_at = 1792031000;
    await assert.rejects(h.service.operateMilkTeaActivity('hire', input), /员工状态/);
    assert.equal(h.calls.at(-1).milk_tea_hire.hires[0].slot_index, 0);
});

test('settings validate the current shop and preserve boolean hire mode in the wire request', async () => {
    const h = harness();
    await assert.rejects(h.service.operateMilkTeaActivity('hireSetting', { disabled: 'false' }), /无效/);
    for (const disabled of [true, false]) {
        await h.service.operateMilkTeaActivity('hireSetting', { disabled });
        assert.equal(h.calls.at(-1).milk_tea_set_hire_disable.hire_disabled, disabled);
    }
    h.summary.rename_cd_until_at = 1792033000;
    await assert.rejects(h.service.operateMilkTeaActivity('rename', { name: '奶茶补给站' }), /修改店名时间/);
    h.summary.shop_open_at = 0;
    await assert.rejects(h.service.operateMilkTeaActivity('boost', { count: 1 }), /先开业/);
    assert.equal(h.calls.length, 2);
});

test('upgrade uses fresh eligibility and rejects stale levels before sending a request', async () => {
    const h = harness();
    await assert.rejects(h.service.operateMilkTeaActivity('upgrade', { expectedLevel: 1 }), /升级条件/);
    h.summary.can_upgrade = true;
    await assert.rejects(h.service.operateMilkTeaActivity('upgrade', { expectedLevel: 2 }), /等级已变化/);
    const preview = await h.service.getMilkTeaActivity('upgrade');
    assert.ok(preview.levels[1].rewards.length);
    await h.service.operateMilkTeaActivity('upgrade', { expectedLevel: 1 });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].operate_type, '61');
});

test('work interactions validate the displayed shift and preview before submitting, and block expired or spent shifts', async () => {
    const h = harness();
    h.work.my_shift = { employer: { gid: '101' }, shift_id: '7', begin_at: 1792031000, end_at: 1792045400, interact_limit: 1, interact_count: 0, interact_previews: [{ interaction_type: 1, promote_cups: 40 }] };
    await assert.rejects(h.service.operateMilkTeaActivity('interact', { interactionType: 1, expectedShiftId: '6' }), /班次已变化/);
    h.work.my_shift.interact_previews = [];
    await assert.rejects(h.service.operateMilkTeaActivity('interact', { interactionType: 1, expectedShiftId: '7' }), /数据不完整/);
    assert.equal(h.calls.length, 0);
    await h.service.operateMilkTeaActivity('interact', { interactionType: 3, expectedShiftId: '7' });
    assert.deepEqual(h.calls[0].milk_tea_interact, { target_gid: '101', interaction_type: 3 });
    h.work.interact_done = true;
    await assert.rejects(h.service.operateMilkTeaActivity('interact', { interactionType: 4, expectedShiftId: '7' }), /不可互动/);
    h.work.interact_done = false;
    h.setTime(1792045400);
    await assert.rejects(h.service.operateMilkTeaActivity('interact', { interactionType: 4, expectedShiftId: '7' }), /不可互动/);
    assert.equal(h.calls.length, 1);
});
