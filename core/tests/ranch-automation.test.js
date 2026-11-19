const test = require('node:test');
const assert = require('node:assert/strict');

const { RANCH_AUTOMATION_DEFAULTS, RANCH_SWITCH_KEYS, RANCH_ANIMAL_OPTIONS, normalizeRanchSetting } = require('../dist/config/ranch-automation');

// 桩件只覆盖 automation 模块在 require 期绑定的依赖，全部使用固定数据，不连服务端。
function loadAutomation({ automation = {}, unlocked = true, taskState = { doneToday: true, nextCheckAt: 0 }, shareState = { doneToday: true, nextCheckAt: 0 }, goods = {}, raw = { cells: { facilities: [] } }, prepareAction = async () => ({ skipped: true }), operate = async () => ({ status: 'skipped' }), stateDeps = {}, friendDeps = {}, cubs = null, logs = [] } = {}) {
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    mock('config/gameConfig', { getShopGoodsById: id => goods[id] });
    // automation 在 require 期就解构了这两个函数，所以这里必须让它按需读取，测试才能注入名单。
    // 牧场黑名单已与农场好友黑名单拆分（上游 PR#163），桩件必须用 getRanchFriendBlacklist，
    // 否则黑名单过滤会静默失效、断言假通过。
    mock('models/store', {
        getAutomation: () => automation,
        getRanchFriendBlacklist: () => friendDeps.blacklist?.() ?? [],
        addRanchFriendToBlacklist: (_accountId, gid) => {
            friendDeps.onAutoBlacklist?.(Number(gid));
            return friendDeps.autoBlacklistResult?.() ?? true;
        },
    });
    // 与真实 transport 一致地把巡查体跑一遍，让路时序才可以被断言。
    mock('services/ranch/transport', { isUnlocked: () => unlocked, inScene: async (work) => work({}) });
    mock('services/ranch/state', {
        loadRaw: async () => raw,
        snapshot: () => ({ facilities: [], serverTime: 1_800_000_000_000 }),
        inventory: () => stateDeps.inventory?.() ?? [],
        catalog: async () => ({ goods: stateDeps.catalog?.() ?? [] }),
        market: async () => stateDeps.market?.() ?? { opened: true, present: true, periodDay: 1, roundIndex: 1, goods: [] },
        // 集市轮次与 market 桩保持同一场次，否则兑换阶段会按「场次已变化」整段跳过。
        readMarketRotation: async () => stateDeps.rotation?.() ?? { shop_id: 7, period_day: '1', round_index: 1,
            shop_start_time: 1_799_000_000, shop_end_time: 1_801_000_000, present: true },
        balance: (bag, id) => stateDeps.balance?.(bag, id) ?? { total: '0', locked: '0' },
        // 21 级待激活棚：默认没有，需要解锁的用例自己提供。
        shedAwaitingActivation: raw => stateDeps.shed?.(raw) ?? null,
    });
    mock('services/ranch/model', { cubMap: cubs ? new Map(cubs) : new Map(), quantity: v => Number(v) });
    mock('services/ranch/actions', { prepareAction, operate });
    mock('services/ranch/daily', { getTaskRoutineState: () => taskState, getShareRoutineState: () => shareState, getBenefitRoutineState: () => ({ doneToday: true, nextCheckAt: 0 }), claimTasks: async () => {}, claimShare: async () => {}, claimBenefit: async () => {}, markTasksChanged: () => {} });
    mock('services/ranch/operation-state', { forCurrentAccount: () => ({ reserved: () => 0 }) });
    mock('services/ranch/context', { getAmbientSendContext: () => null, runWithSendContext: (_ctx, run) => run() });
    // 牧场好友名单改为按 global_scene_id=2 独立同步（上游 #160），不再复用农场名单。
    mock('services/ranch/friend-roster', {
        getRanchFriendList: async (checkpoint) => {
            friendDeps.onRosterCall?.();
            const roster = friendDeps.roster?.() ?? [];
            // 名单同步会分批回调 checkpoint，让路时序用例需要它被真实触发一次。
            checkpoint?.(true);
            return roster;
        },
    });
    mock('services/ranch/friends', {
        getInteractionTimes: async () => friendDeps.times?.() ?? { stroke: 1, steal: 1, cleanFriend: 1, putMosquito: 1 },
        // 0 表示当天次数未用完；让路/停排测试靠它区分「能不能排进巡查」。
        getInteractionQuotaResetAt: action => friendDeps.quotaReset?.(action) ?? 0,
        automateFriend: async (gid, _enabled, _shouldYield, _onOutcome, progress) => {
            friendDeps.onVisit?.(gid);
            // 让用例模拟「不是好友」被服务端拒绝：抛 EnterHomestead 网关错误。
            const reject = friendDeps.reject?.(gid);
            if (reject) {
                throw Object.assign(new Error(reject.message ?? '不是好友'), {
                    name: 'GatewayError', methodName: 'EnterHomestead', code: reject.code,
                });
            }
            return friendDeps.visit?.(progress) ?? { times: {}, results: [], yielded: false };
        },
    });
    mock('utils/utils', { getServerTimeSec: () => 1_800_000_000, log: (tag, message) => logs.push({ tag, message }) });
    const id = require.resolve('../dist/services/ranch/automation');
    delete require.cache[id];
    return require(id);
}

test('牧场自动化默认只开领取类动作，会改状态的动作全部关闭', () => {
    const actions = ['ranch_buy', 'ranch_upgrade', 'ranch_grass_buy', 'ranch_sell', 'ranch_fill_cans', 'ranch_feed_normal', 'ranch_feed_organic', 'ranch_harvest', 'ranch_produce', 'ranch_clean', 'ranch_grass', 'ranch_market_organic', 'ranch_market_organic_poop', 'ranch_market_organic_pinecone'];
    assert.deepEqual(actions.filter(key => RANCH_AUTOMATION_DEFAULTS[key] !== false), []);
    assert.deepEqual(actions.filter(key => !RANCH_SWITCH_KEYS.includes(key)), [], '每个自动动作都必须有对应开关');
    // 领取类动作只是把已达标奖励收下，不改账号其它状态，保持默认开启。
    assert.equal(RANCH_AUTOMATION_DEFAULTS.ranch_task, true);
    assert.equal(RANCH_AUTOMATION_DEFAULTS.ranch_share, true);
    assert.equal(RANCH_AUTOMATION_DEFAULTS.ranch_illustrated, true, '补领图鉴奖励属于领取类，默认开启');
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

test('补栏按窝/棚背包优先顺序放养，放满即停，缺额才进商店', async () => {
    // cubMap 决定幼崽适用哪种设施：60001/60002 是窝用，70001 是棚用。
    const cubs = [
        [60001, { id: 60001, husbandry_type: '窝', name: '窝幼崽甲' }],
        [60002, { id: 60002, husbandry_type: '窝', name: '窝幼崽乙' }],
        [70001, { id: 70001, husbandry_type: '棚', name: '棚幼崽' }],
    ];
    const stock = () => [
        { id: 60001, animalId: 60001, count: '2', locked: false },
        { id: 60002, animalId: 60002, count: '5', locked: false },
        { id: 70001, animalId: 70001, count: '9', locked: false },
    ];
    const runCase = async (automation) => {
        const places = [];
        // 棚已住满（3/3）不参与补栏，只有窝（2/5）有空位。
        // animals/shelves 必须给空数组：updateDeadline 会直接遍历它们。
        const raw = { bag: {}, cells: { facilities: [
            { instance_id: '501', state: 1, ranch: { husbandry_type: 1, capacity: 5, animal_count: 2, animals: [], shelves: [] } },
            { instance_id: '502', state: 1, ranch: { husbandry_type: 2, capacity: 3, animal_count: 3, animals: [], shelves: [] } },
        ] } };
        const level = loadAutomation({
            automation: { ranch_buy: true, ranch_check_minutes: 30, ...automation },
            raw,
            cubs,
            stateDeps: {
                inventory: stock,
                // available() 走 balance 结算，幼崽库存也要从这里返回，否则可用量恒为 0。
                balance: (_bag, id) => ({ total: String(stock().find(item => item.id === id)?.count ?? '0'), locked: '0' }),
                catalog: () => [],
            },
            prepareAction: async action => ({ label: action, skipped: false, costItems: [], rewards: [], expected: {} }),
            operate: async (action, input) => {
                if (action !== 'place') return { status: 'ok' };
                places.push({ itemId: input.itemId, count: input.count });
                const pen = raw.cells.facilities.find(f => String(f.instance_id) === String(input.ranchId));
                pen.ranch.animal_count += input.count;
                return { status: 'ok' };
            },
        });
        await level.run({ farmDeadline: () => Infinity });
        return places;
    };

    // 乙优先但空位只有 3：按空位截断，库存 5 只不会超放。
    assert.deepEqual(await runCase({ ranch_strategy: 'bag_priority', ranch_coop_cub_priority: [60002, 60001] }),
        [{ itemId: 60002, count: 3 }], '按配置顺序放养，并按剩余空位截断');
    // 甲优先：库存 2 只先放完，剩 1 个空位继续放下一个优先级的幼崽。
    assert.deepEqual(await runCase({ ranch_strategy: 'bag_priority', ranch_coop_cub_priority: [60001, 60002] }),
        [{ itemId: 60001, count: 2 }, { itemId: 60002, count: 1 }], '库存放完自动轮到下一优先级');
    // 未配置顺序时按等级从高到低，不因缺配置而放弃放养。
    assert.deepEqual(await runCase({ ranch_strategy: 'bag_priority' }),
        [{ itemId: 60002, count: 3 }], '未配置顺序时退化为等级从高到低');
    // 非背包优先策略不消费背包，只按商店选中的动物补栏（商店无货则不放养）。
    assert.deepEqual(await runCase({ ranch_strategy: 'level' }), [], '指定动物策略不放养背包里的其它幼崽');
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

// 集市已拆成「便便 7002 / 松果 1008」两个独立开关并各自按到访通知排队，用例覆盖两种货币各自的目标奖励。
test('仓鼠集市按双货币兑换有机化肥：优先顺序、余额不足不超兑、非目标商品跳过', async () => {
    const good = (id, rewardId, priceId, priceCount, remaining) => ({
        id, available: true, remaining,
        reward: { id: rewardId, count: '1' },
        price: { id: priceId, count: priceCount },
    });
    const runCase = async ({ goods, balances, switches = { ranch_market_organic_poop: true, ranch_market_organic_pinecone: true } }) => {
        const calls = [];
        const level = loadAutomation({
            automation: { ...switches, ranch_check_minutes: 30 },
            raw: { bag: {}, cells: { facilities: [] } },
            stateDeps: {
                market: () => ({ opened: true, present: true, periodDay: 1, roundIndex: 1, goods }),
                balance: (_bag, id) => ({ total: String(balances[id] ?? 0), locked: '0' }),
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

    // 便便 7002：4 小时(80012) 优先于 1 小时(80011)。
    const poop = await runCase({
        goods: [good(11, 80011, 7002, '2', 10), good(12, 80012, 7002, '2', 10)],
        balances: { 7002: 40 },
    });
    assert.deepEqual(poop[0], { goodsId: 12, count: 10 }, '便便先兑 4 小时商品');
    assert.deepEqual(poop[1], { goodsId: 11, count: 10 }, '便便再兑 1 小时商品');

    // 松果 1008：4 小时(80013) 优先级最高。
    const pinecone = await runCase({
        goods: [good(21, 80012, 1008, '1', 5), good(22, 80013, 1008, '1', 5)],
        balances: { 1008: 20 },
    });
    assert.deepEqual(pinecone[0], { goodsId: 22, count: 5 }, '松果先兑 4 小时商品');
    assert.deepEqual(pinecone[1], { goodsId: 21, count: 5 }, '松果再兑次优先商品');

    // 余额只够 2 件：按余额向下取整，不按限购 10 超兑。
    const limited = await runCase({ goods: [good(12, 80012, 7002, '2', 10)], balances: { 7002: 5 } });
    assert.deepEqual(limited, [{ goodsId: 12, count: 2 }], '按余额向下取整，不得超兑');

    // 非便便/松果计价（金券 1001）的商品一律跳过。
    const wrongCurrency = await runCase({ goods: [good(12, 80012, 1001, '1', 10)], balances: { 7002: 100 } });
    assert.deepEqual(wrongCurrency, [], '非集市货币计价商品一律跳过');

    // 非目标奖励（普通化肥 7003）不得兑换。
    const wrongReward = await runCase({ goods: [good(12, 7003, 7002, '1', 10)], balances: { 7002: 100 } });
    assert.deepEqual(wrongReward, [], '非目标奖励一律跳过');

    // 只开便便兑换：松果商品即便有余额也不兑。
    const poopOnly = await runCase({
        goods: [good(12, 80012, 7002, '1', 5), good(22, 80013, 1008, '1', 5)],
        balances: { 7002: 20, 1008: 20 },
        switches: { ranch_market_organic_poop: true, ranch_market_organic_pinecone: false },
    });
    assert.deepEqual(poopOnly, [{ goodsId: 12, count: 5 }], '只开便便时不得兑松果商品');

    // 只开松果兑换：便便商品即便有余额也不兑。
    const pineconeOnly = await runCase({
        goods: [good(12, 80012, 7002, '1', 5), good(22, 80013, 1008, '1', 5)],
        balances: { 7002: 20, 1008: 20 },
        switches: { ranch_market_organic_poop: false, ranch_market_organic_pinecone: true },
    });
    assert.deepEqual(pineconeOnly, [{ goodsId: 22, count: 5 }], '只开松果时不得兑便便商品');

    // 两项都关：即使旧总开关开着也不兑（总开关只用于迁移旧配置）。
    const bothOff = await runCase({
        goods: [good(12, 80012, 7002, '1', 5), good(22, 80013, 1008, '1', 5)],
        balances: { 7002: 20, 1008: 20 },
        switches: { ranch_market_organic: true, ranch_market_organic_poop: false, ranch_market_organic_pinecone: false },
    });
    assert.deepEqual(bothOff, [], '两项独立开关都关时不得兑换');
});

test('集市开关默认关闭时不排入巡查，到访通知可立刻重新排队', async () => {
    // 旧总开关不再单独生效：任意一种货币的独立开关打开即排入巡查。
    const level = loadAutomation({
        automation: { ranch_market_organic_poop: true },
        stateDeps: { market: () => ({ opened: true, present: true, goods: [] }) },
    });
    assert.equal(level.getRoutineState().doneToday, false, '便便兑换开关打开且有待查标记时排入巡查');
    // 只开松果兑换同样能排入巡查。
    assert.equal(loadAutomation({ automation: { ranch_market_organic_pinecone: true } }).getRoutineState().doneToday, false, '松果兑换开关打开时同样排入巡查');
    // 仅旧总开关为 true、两项独立开关显式关闭时不得排入巡查。
    assert.equal(loadAutomation({ automation: { ranch_market_organic: true, ranch_market_organic_poop: false, ranch_market_organic_pinecone: false } }).getRoutineState().doneToday, true,
        '两项独立开关都关时不排入巡查');
    // 同一场次重复推送不重复唤醒；换一轮次才唤醒。
    const rotation = { shop_id: 7, period_day: 1, round_index: 1, shop_start_time: 1_799_000_000, shop_end_time: 1_801_000_000, present: true };
    assert.equal(level.noteMarketVisit(rotation), true, '首次到访通知应唤醒例程');
    assert.equal(level.noteMarketVisit(rotation), false, '同一场次重复通知不重复唤醒');
    assert.equal(level.noteMarketVisit({ ...rotation, round_index: 2 }), true, '换轮次应重新唤醒');
    level.resetSchedule();
    assert.equal(level.getRoutineState().nextCheckAt, 0, '重置后立刻复查');
    assert.equal(loadAutomation({ automation: {} }).getRoutineState().doneToday, true, '未开集市且无其它动作时不巡查');
});

test('旧配置只有总开关时迁移成便便与松果两个独立开关', () => {
    const { migrateRanchMarketAutomation } = require('../dist/config/ranch-automation');
    // 旧配置：只有总开关，两个新字段缺失 → 都继承总开关的值。
    assert.deepEqual(migrateRanchMarketAutomation({ ranch_market_organic: true }),
        { ranch_market_organic: true, ranch_market_organic_poop: true, ranch_market_organic_pinecone: true }, '旧总开关为 true 时两个新开关都被填充');
    assert.deepEqual(migrateRanchMarketAutomation({ ranch_market_organic: false, ranch_market_organic_poop: true }),
        { ranch_market_organic: false, ranch_market_organic_poop: true, ranch_market_organic_pinecone: false }, '已明确设置的新开关优先，不被旧总开关覆盖');
    // 没有总开关时不做任何填充，避免给新账号凭空开启兑换。
    assert.deepEqual(migrateRanchMarketAutomation({ ranch_grass: true }), { ranch_grass: true }, '缺少旧总开关时不填充');
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

test('牧场好友阶段按场景独立同步名单，并过滤黑名单', async () => {
    const runWith = async (roster, blacklist = []) => {
        const rosterCalls = [];
        const visits = [];
        const level = loadAutomation({
            automation: { ranch_friend_steal: true },
            friendDeps: {
                roster: () => roster,
                blacklist: () => blacklist,
                onRosterCall: () => rosterCalls.push(1),
                onVisit: gid => visits.push(gid),
            },
        });
        await level.run({ farmDeadline: () => Infinity, canContinue: () => true });
        return { rosterCalls, visits };
    };

    const roster = [{ gid: 1, name: 'A' }, { gid: 2, name: 'B' }];
    const hit = await runWith(roster);
    assert.equal(hit.rosterCalls.length, 1, '牧场名单按场景同步一次');
    assert.deepEqual(hit.visits, [1, 2], '按牧场名单顺序拜访，每轮最多三位');

    // 黑名单里的好友不得拜访。
    const filtered = await runWith(roster, [1]);
    assert.deepEqual(filtered.visits, [2], '黑名单好友应被跳过');
});

test('拜访被判定不是好友时自动加入牧场黑名单，其他网关错误只跳过', async () => {
    const runWith = async (code) => {
        const autoBlacklisted = [];
        const logs = [];
        const level = loadAutomation({
            automation: { ranch_friend_steal: true },
            logs,
            friendDeps: {
                roster: () => [{ gid: 7, name: 'C' }],
                reject: () => ({ code, message: '不是好友' }),
                onAutoBlacklist: gid => autoBlacklisted.push(gid),
            },
        });
        await level.run({ farmDeadline: () => Infinity, canContinue: () => true });
        return { autoBlacklisted, logs };
    };

    // 1002002 是服务端判定「不是好友」的错误码：加入黑名单，之后巡查与列表都不再处理。
    const notFriend = await runWith(1002002);
    assert.deepEqual(notFriend.autoBlacklisted, [7], '不是好友应自动拉黑');
    assert.ok(notFriend.logs.some(entry => entry.message.includes('已加入牧场拜访黑名单')), '自动拉黑要有日志');

    // 其他网关错误（如临时不可达）不能误拉黑，只记一条跳过日志。
    const other = await runWith(500100);
    assert.deepEqual(other.autoBlacklisted, [], '非「不是好友」错误不得拉黑');
    assert.ok(other.logs.some(entry => entry.message.includes('暂不能拜访')), '其他错误按跳过记录');
});

test('名单为空时不拜访任何好友', async () => {
    const visits = [];
    const level = loadAutomation({
        automation: { ranch_friend_steal: true },
        friendDeps: { roster: () => [], onVisit: gid => visits.push(gid) },
    });
    await level.run({ farmDeadline: () => Infinity, canContinue: () => true });
    assert.deepEqual(visits, [], '牧场名单为空时不发起拜访');
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
