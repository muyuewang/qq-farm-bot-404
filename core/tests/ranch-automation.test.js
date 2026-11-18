const test = require('node:test');
const assert = require('node:assert/strict');

const { RANCH_AUTOMATION_DEFAULTS, RANCH_SWITCH_KEYS, RANCH_ANIMAL_OPTIONS, normalizeRanchSetting } = require('../dist/config/ranch-automation');

// 桩件只覆盖 automation 模块在 require 期绑定的依赖，全部使用固定数据，不连服务端。
function loadAutomation({ automation = {}, unlocked = true, taskState = { doneToday: true, nextCheckAt: 0 }, shareState = { doneToday: true, nextCheckAt: 0 }, goods = {}, raw = { cells: { facilities: [] } }, prepareAction = async () => ({ skipped: true }), operate = async () => ({ status: 'skipped' }), stateDeps = {}, friendDeps = {}, logs = [] } = {}) {
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    mock('config/gameConfig', { getShopGoodsById: id => goods[id] });
    mock('models/store', { getAutomation: () => automation });
    // 与真实 transport 一致地把巡查体跑一遍，让路时序才可以被断言。
    mock('services/ranch/transport', { isUnlocked: () => unlocked, inScene: async (work) => work({}) });
    mock('services/ranch/state', {
        loadRaw: async () => raw,
        snapshot: () => ({ facilities: [], serverTime: 1_800_000_000_000 }),
        inventory: () => stateDeps.inventory?.() ?? [],
        catalog: async () => ({ goods: stateDeps.catalog?.() ?? [] }),
        market: async () => stateDeps.market?.() ?? { opened: true, present: true, periodDay: '1', roundIndex: '1', goods: [] },
        balance: (bag, id) => stateDeps.balance?.(bag, id) ?? { total: '0', locked: '0' },
    });
    mock('services/ranch/model', { cubMap: new Map(), quantity: v => Number(v) });
    mock('services/ranch/actions', { prepareAction, operate });
    mock('services/ranch/daily', { getTaskRoutineState: () => taskState, getShareRoutineState: () => shareState, getBenefitRoutineState: () => ({ doneToday: true, nextCheckAt: 0 }), claimTasks: async () => {}, claimShare: async () => {}, claimBenefit: async () => {}, markTasksChanged: () => {} });
    mock('services/ranch/operation-state', { forCurrentAccount: () => ({ reserved: () => 0 }) });
    mock('services/ranch/context', { getAmbientSendContext: () => null, runWithSendContext: (_ctx, run) => run() });
    // 牧场好友阶段会复用农场名单；默认给空名单，避免加载真实 friend 服务。
    mock('services/friend', {
        getFriendsListCacheOnly: () => friendDeps.cacheOnly?.() ?? [],
        getFriendsList: async (...args) => { friendDeps.onListCall?.(args); return friendDeps.list?.() ?? []; },
    });
    mock('services/ranch/friends', {
        getInteractionTimes: async () => friendDeps.times?.() ?? { stroke: 1, steal: 1, cleanFriend: 1, putMosquito: 1 },
        automateFriend: async (gid) => { friendDeps.onVisit?.(gid); return friendDeps.visit?.() ?? { times: {}, results: [], yielded: false }; },
    });
    mock('utils/utils', { getServerTimeSec: () => 1_800_000_000, log: (tag, message) => logs.push({ tag, message }) });
    const id = require.resolve('../dist/services/ranch/automation');
    delete require.cache[id];
    return require(id);
}

test('牧场自动化默认只开任务与分享，其余会改状态的动作全部关闭', () => {
    const actions = ['ranch_buy', 'ranch_upgrade', 'ranch_grass_buy', 'ranch_sell', 'ranch_fill_cans', 'ranch_feed_normal', 'ranch_feed_organic', 'ranch_harvest', 'ranch_produce', 'ranch_clean', 'ranch_grass', 'ranch_market_organic'];
    assert.deepEqual(actions.filter(key => RANCH_AUTOMATION_DEFAULTS[key] !== false), []);
    assert.deepEqual(actions.filter(key => !RANCH_SWITCH_KEYS.includes(key)), [], '每个自动动作都必须有对应开关');
    assert.equal(RANCH_AUTOMATION_DEFAULTS.ranch_task, true);
    assert.equal(RANCH_AUTOMATION_DEFAULTS.ranch_share, true);
    // 上游把动作默认值全改成 true，本项目坚持保守默认，不受其影响。
    assert.equal(RANCH_AUTOMATION_DEFAULTS.ranch_grass_threshold_percent, 20, '牧草补满阈值默认 20%');
});

test('牧场设置只接受已登记开关与范围内的取值', () => {
    assert.throws(() => normalizeRanchSetting('ranch_strategy', 'random'), /养殖策略/);
    assert.equal(normalizeRanchSetting('ranch_bag_fallback', 'preferred'), 'preferred');
    for (const value of [0, 1.5, 61, 'x']) assert.throws(() => normalizeRanchSetting('ranch_check_minutes', value), /巡查间隔/);
    assert.equal(normalizeRanchSetting('ranch_check_minutes', 7), 7);
    // 牧草补满阈值：1–100 的整数百分比，越界或非整数都要拒绝。
    for (const value of [0, 1.5, 101, 'x']) assert.throws(() => normalizeRanchSetting('ranch_grass_threshold_percent', value), /阈值/);
    assert.equal(normalizeRanchSetting('ranch_grass_threshold_percent', 20), 20);
    assert.equal(normalizeRanchSetting('ranch_grass_threshold_percent', 100), 100);
    assert.throws(() => normalizeRanchSetting('ranch_harvest', 'yes'), /布尔值/);
    // 窝/棚 由 husbandry_type 决定，指定错栏位的动物必须拒绝。
    const coop = RANCH_ANIMAL_OPTIONS.find(a => a.kind === '窝');
    const shed = RANCH_ANIMAL_OPTIONS.find(a => a.kind === '棚');
    assert.ok(coop && shed, '官方动物表需同时存在窝与棚');
    assert.throws(() => normalizeRanchSetting('ranch_shed_animal', coop.value), /窝或棚/);
    assert.equal(normalizeRanchSetting('ranch_shed_animal', shed.value), shed.value);
    assert.equal(normalizeRanchSetting('ranch_coop_animal', 0), 0, '不购买始终可用');
});

test('补栏选种按策略过滤：仅可用、金券计价、栏位匹配的幼崽才参与', () => {
    const goods = { 1: { conds: 'level:12' }, 2: { conds: 'level:30' }, 3: { conds: 'level:40' } };
    const base = { available: true, price: { id: 1007, count: '100' }, animal: { id: 1, enable_flag: true, husbandry_type: '窝' } };
    const candidates = [
        { ...base, id: 1, animal: { ...base.animal, id: 1 }, requiredLevel: 12 },
        { ...base, id: 2, animal: { ...base.animal, id: 2 }, requiredLevel: 30 },
        // 棚用幼崽、点券计价、不可买：三种情况都不该被选中
        { ...base, id: 3, animal: { ...base.animal, id: 3, husbandry_type: '棚' }, requiredLevel: 40 },
        { ...base, id: 4, price: { id: 1001, count: '100' }, requiredLevel: 50 },
        { ...base, id: 5, available: false, requiredLevel: 60 },
    ];
    const level = loadAutomation({ goods });
    assert.equal(level.selectAnimal(candidates, { ...RANCH_AUTOMATION_DEFAULTS }, 1).id, 2, 'level 策略取等级最高的可用窝用幼崽');
    assert.equal(level.selectAnimal(candidates, { ...RANCH_AUTOMATION_DEFAULTS, ranch_strategy: 'preferred', ranch_coop_animal: 1 }, 1).id, 1);
    assert.equal(level.selectAnimal(candidates, { ...RANCH_AUTOMATION_DEFAULTS, ranch_strategy: 'preferred', ranch_coop_animal: 3 }, 1), undefined, '指定动物不匹配栏位时不退而求其次');
    assert.equal(level.selectAnimal(candidates, { ...RANCH_AUTOMATION_DEFAULTS, ranch_strategy: 'preferred', ranch_coop_animal: 4 }, 1), undefined, '指定非金券商品时拒绝');
    const shed = loadAutomation({ goods }).selectAnimal(candidates, { ...RANCH_AUTOMATION_DEFAULTS }, 2);
    assert.equal(shed?.animal.husbandry_type, '棚', 'kind=2 只看棚用幼崽');
    const fallback = loadAutomation({ goods }).selectAnimal(candidates, { ...RANCH_AUTOMATION_DEFAULTS, ranch_strategy: 'bag_priority', ranch_bag_fallback: 'level' }, 1);
    assert.equal(fallback.id, 2, '背包优先无货时按回退策略选种');
});

test('未解锁或全部开关关闭时不排入牧场巡查', () => {
    assert.equal(loadAutomation({ unlocked: false, automation: { ranch_harvest: true } }).getRoutineState().doneToday, true, '牧场未解锁不得发起巡查');
    assert.equal(loadAutomation({ automation: {} }).getRoutineState().doneToday, true, '一个自动动作都没开就不该跑');
    assert.equal(loadAutomation({ automation: { ranch_grass_buy: true } }).getRoutineState().doneToday, true, '子开关（牧草购买）不足以启动巡查');
    assert.equal(loadAutomation({ automation: { ranch_harvest: true } }).getRoutineState().doneToday, false);
    assert.equal(loadAutomation({ automation: { ranch_task: true }, taskState: { doneToday: false, nextCheckAt: 0 } }).getRoutineState().doneToday, false, '到点的任务领取需要排入巡查');
    assert.equal(loadAutomation({ automation: { ranch_task: true }, taskState: { doneToday: true, nextCheckAt: 0 } }).getRoutineState().doneToday, true, '当日已领完则不再排入');
    assert.equal(loadAutomation({ automation: { ranch_share: true }, shareState: { doneToday: false, nextCheckAt: Date.now() + 60_000 } }).getRoutineState().doneToday, true, '分享未到点则不再排入');
});

test('农场到期时牧场巡查让路，按重进场间隔而不是巡查周期排队', async () => {
    const logs = [];
    const level = loadAutomation({
        automation: { ranch_harvest: true, ranch_clean: true, ranch_check_minutes: 30 },
        logs,
        // 每个动作都返回「本轮跳过」，让巡查推进到下一个动作，触发第二个动作前的让路检查。
        prepareAction: async () => ({ skipped: true }),
    });
    const before = Date.now();
    await level.run({ farmDeadline: () => Date.now() - 1 });
    const { doneToday, nextCheckAt } = level.getRoutineState();
    assert.equal(doneToday, false, '让路不是做完，不能标记当日已完成');
    assert.ok(nextCheckAt >= before + 19_000 && nextCheckAt <= before + 21_000,
        `让路后应在 20 秒重进场窗口内，实际 ${nextCheckAt - before}ms`);
    assert.deepEqual(logs.filter(row => row.tag === '牧场'), [], '让路不是失败，不该记成巡查失败日志');
});

test('牧草按容量阈值补满：达到阈值不补，低于阈值才补，且一次补足缺额', async () => {
    const mkFacility = (instanceId, feedCount) => ({
        instance_id: instanceId, state: 1, capacity: 100,
        feed_machine: { feed_count: feedCount },
    });
    const runCase = async (feedCount, thresholdPercent, grassStock) => {
        const calls = [];
        const raw = { bag: {}, cells: { facilities: [mkFacility(5001, feedCount)] } };
        const level = loadAutomation({
            automation: { ranch_grass: true, ranch_grass_threshold_percent: thresholdPercent, ranch_check_minutes: 30 },
            raw,
            prepareAction: async action => ({ label: action, skipped: false, costItems: [], expected: {} }),
            operate: async (action, input) => { calls.push({ action, input }); return { status: 'ok' }; },
            stateDeps: {
                balance: (_bag, id) => ({ total: String(id === 7001 ? grassStock : 0), locked: '0' }),
                inventory: () => [],
            },
        });
        await level.run({ farmDeadline: () => Infinity });
        return calls.filter(call => call.action === 'addGrass');
    };

    // 存量 30% >= 阈值 20%：不补。
    assert.deepEqual(await runCase(30, 20, 100), [], '存量达到阈值不应补牧草');
    // 存量 10% < 阈值 20%：补满缺口 90，库存充裕。
    const added = await runCase(10, 20, 100);
    assert.equal(added.length, 1, '低于阈值应补一次');
    assert.equal(added[0].input.count, 90, '应一次补足到容量上限');
    // 库存只有 40 时补 40，不超发。
    const limited = await runCase(10, 20, 40);
    assert.equal(limited[0].input.count, 40, '库存不足时按实际库存补');
    // 阈值设为 5%：存量 10% 达到阈值，同样不补。
    assert.deepEqual(await runCase(10, 5, 100), [], '阈值越低越保守，达到阈值不补');
});

test('仓鼠集市只用便便兑换有机化肥：4 小时优先、便便不足不超兑、非目标商品跳过', async () => {
    const good = (id, rewardId, priceId, priceCount, remaining) => ({
        id, available: true, remaining,
        reward: { id: rewardId, count: '1' },
        price: { id: priceId, count: priceCount },
    });
    const runCase = async ({ goods, poop }) => {
        const calls = [];
        const level = loadAutomation({
            automation: { ranch_market_organic: true, ranch_check_minutes: 30 },
            raw: { bag: {}, cells: { facilities: [] } },
            stateDeps: {
                market: () => ({ opened: true, present: true, periodDay: '1', roundIndex: '1', goods }),
                balance: (_bag, id) => ({ total: String(id === 7002 ? poop : 0), locked: '0' }),
            },
            // 只有目标商品的报价放行，其余按 prepareAction 的奖励校验在 act 内被跳过。
            prepareAction: async (action, input) => {
                const item = goods.find(g => g.id === input.goodsId);
                return { label: action, skipped: false, costItems: [{ id: item.price.id, count: String(Number(item.price.count) * input.count) }], rewards: [{ id: item.reward.id, count: String(input.count) }], expected: {} };
            },
            operate: async (action, input) => { calls.push(input); return { status: 'ok' }; },
        });
        await level.run({ farmDeadline: () => Infinity });
        return calls.map(call => ({ goodsId: call.goodsId, count: call.count }));
    };

    // 4 小时(80012) 与 1 小时(80011) 都在售、便便充足：先兑 4 小时，且分商品累计提示优先顺序。
    const both = await runCase({
        goods: [good(11, 80011, 7002, '2', 10), good(12, 80012, 7002, '2', 10)],
        poop: 40,
    });
    assert.deepEqual(both[0], { goodsId: 12, count: 10 }, '先按 4 小时商品的可兑上限兑换');
    assert.deepEqual(both[1], { goodsId: 11, count: 10 }, '再兑换 1 小时商品');

    // 便便只够 5 个：不会按限购 10 超兑。
    const limited = await runCase({
        goods: [good(12, 80012, 7002, '2', 10)],
        poop: 5,
    });
    assert.deepEqual(limited, [{ goodsId: 12, count: 2 }], '按便便余额向下取整，不得超兑');

    // 非便便计价（松果 1001）的同名奖励不得兑换。
    const wrongCurrency = await runCase({
        goods: [good(12, 80012, 1001, '1', 10)],
        poop: 100,
    });
    assert.deepEqual(wrongCurrency, [], '非便便计价商品一律跳过');

    // 非目标奖励（普通化肥）不得兑换。
    const wrongReward = await runCase({
        goods: [good(12, 7003, 7002, '1', 10)],
        poop: 100,
    });
    assert.deepEqual(wrongReward, [], '非有机化肥奖励一律跳过');
});

test('兑换完重置集市排期可立刻重新检查，且开关默认关闭时不排入巡查', async () => {
    const level = loadAutomation({
        automation: { ranch_market_organic: true },
        stateDeps: { market: () => ({ opened: true, present: true, goods: [] }) },
    });
    assert.equal(level.getRoutineState().doneToday, false, '集市开关打开即需要排入巡查');
    level.resetMarketSchedule();
    assert.ok(level.getRoutineState().nextCheckAt <= Date.now() + 21_000, '重置后应按重进场窗口尽快复查');
    assert.equal(loadAutomation({ automation: {} }).getRoutineState().doneToday, true, '未开集市且无其它动作时不巡查');
});

test('连接不可继续时牧场不切场景、不执行动作，按重进场窗口退避', async () => {
    const calls = [];
    const level = loadAutomation({
        automation: { ranch_harvest: true, ranch_check_minutes: 30 },
        prepareAction: async () => ({ skipped: true }),
        operate: async (action, input) => { calls.push(action); return { status: 'ok' }; },
    });
    const before = Date.now();
    await level.run({ farmDeadline: () => Infinity, canContinue: () => false });
    assert.deepEqual(calls, [], '网关不可继续时不得执行任何牧场动作');
    const { doneToday, nextCheckAt } = level.getRoutineState();
    assert.equal(doneToday, false, '让路不等于当日做完');
    assert.ok(nextCheckAt >= before + 19_000 && nextCheckAt <= before + 21_000,
        `让路后应在 20 秒重进场窗口内，实际 ${nextCheckAt - before}ms`);
});

test('牧场好友阶段复用农场名单：缓存命中不重读，缓存为空只补读一次', async () => {
    const runWith = async (cacheOnly) => {
        const listCalls = [];
        const visits = [];
        const level = loadAutomation({
            automation: { ranch_friend_steal: true },
            friendDeps: {
                cacheOnly: () => cacheOnly,
                onListCall: args => listCalls.push(args),
                onVisit: gid => visits.push(gid),
            },
        });
        await level.run({ farmDeadline: () => Infinity, canContinue: () => true });
        return { listCalls, visits };
    };

    const cached = [{ gid: 1, name: 'A' }, { gid: 2, name: 'B' }];
    const hit = await runWith(cached);
    assert.deepEqual(hit.listCalls, [], '缓存命中时不得重读好友名单');
    assert.deepEqual(hit.visits, [1, 2], '按缓存名单顺序拜访，每轮最多三位');

    const miss = await runWith([]);
    assert.equal(miss.listCalls.length, 1, '缓存为空时补读一次');
    assert.equal(miss.listCalls[0][1], 'normal', '补读走普通优先级');
    assert.equal(miss.listCalls[0][2], true, '补读需把连接异常抛给调度器，不能静默降级');
});

test('核对完待核对账本会重置让路退避，立刻允许重新进牧场', async () => {
    const level = loadAutomation({
        automation: { ranch_harvest: true, ranch_clean: true, ranch_check_minutes: 30 },
        prepareAction: async () => ({ skipped: true }),
    });
    await level.run({ farmDeadline: () => Date.now() - 1 });
    assert.ok(level.getRoutineState().nextCheckAt > Date.now(), '让路后应短暂退避');
    level.resetSchedule();
    assert.equal(level.getRoutineState().nextCheckAt, 0, '核对结果后必须立刻恢复巡查');
});
