const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 好友赠送牧草（上游 PR#179）。
 *
 * 这条链路跨了三层：动作要能带 hostGid 进好友牧场（inActionScene → withFriendVisit）、
 * 下发时要带 host_gid、回包要按好友牧草机确认。任何一层漏了，表现都是「界面点得动但
 * 牧草送不出去」或者「送出去了但页面以为失败」，所以这里用桩件把整条链路跑一遍，
 * 而不是只对源码做字符串断言。
 */
const HOST_GID = '123456789';
const FACILITY_ID = 1;

function loadActions({ feedCount = 90, capacity = 100, stock = '500', reply = null, friendEntry = null } = {}) {
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    const sent = [];
    const visited = [];
    const cells = {
        facilities: [{
            instance_id: FACILITY_ID,
            module_type: 8,
            state: 1,
            capacity,
            level: 3,
            feed_machine: { feed_count: feedCount },
        }],
    };
    const makeError = (code, message) => Object.assign(new Error(message), { code });
    const item = (raw) => ({ id: Number(raw.id), count: String(raw.count), name: '牧草', image: '' });
    const entry = friendEntry ?? { basic: { gid: HOST_GID, name: '好友甲' }, homestead_cells: cells };

    mock('services/ranch/transport', {
        inScene: async work => work(cells),
        rpc: async (route, payload) => {
            sent.push({ route, payload });
            return reply ?? { detail: { feed_count: feedCount + Number(payload.add_count) }, consumed: [] };
        },
    });
    // 赠送牧草会扣自家背包：before 与回读后的 after 必须给出不同余量，
    // 真实链路靠这一步确认扣减真的发生了（actions.ts 的「库存扣减与费用不匹配」判据）。
    const bagBefore = { total: stock, physical_items: [] };
    const bagAfter = { total: String(Number(stock) - 10), physical_items: [] };
    mock('services/ranch/state', {
        loadRaw: async () => ({ cells, bag: bagBefore }),
        loadBag: async () => bagAfter,
        snapshot: () => ({ facilities: [] }),
        balance: (bag) => ({ total: bag?.total ?? '0', locked: '0' }),
        resourceBalance: async raw => ({ total: raw?.bag?.total ?? '0', locked: '0' }),
        taskList: () => [],
        catalog: async () => ({ goods: [] }),
        market: async () => ({ opened: true, present: true, goods: [] }),
        canCatalog: async () => ({ goods: [] }),
        ranchMallCatalog: async () => ({ goods: [] }),
        canLockRanchItem: () => true,
        salePrices: () => ({}),
        shedAwaitingActivation: () => null,
    });
    mock('services/ranch/model', {
        animalMap: new Map(),
        cubMap: new Map(),
        canMap: new Map(),
        facilityMap: new Map(),
        itemMap: new Map(),
        taskMap: new Map(),
        error: makeError,
        positiveId: (value, label) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) throw makeError('INVALID_ARGUMENT', `${label}参数无效`);
            return parsed;
        },
        positiveCount: (value) => {
            const parsed = Math.floor(Number(value));
            if (!Number.isFinite(parsed) || parsed <= 0) throw makeError('INVALID_ARGUMENT', '数量参数无效');
            return parsed;
        },
        quantity: value => Number(value ?? 0),
        itemDto: item,
        sumItems: items => items,
        signature: items => JSON.stringify(items),
    });
    mock('services/ranch/operation-state', {
        forCurrentAccount: () => ({
            spend: async (_options, work) => work(),
            withLock: async work => work(),
            acknowledge: () => {},
            reserved: () => 0,
        }),
    });
    mock('services/stats', { recordOperation: () => {} });
    mock('services/ranch/friends', {
        withFriendVisit: async (hostGid, work) => {
            visited.push(String(hostGid));
            return work(entry, HOST_GID);
        },
        prepareSteal: async () => null,
        prepareInteraction: async () => null,
        interact: async () => null,
        steal: async () => null,
    });

    const id = require.resolve('../dist/services/ranch/actions');
    delete require.cache[id];
    return { actions: require(id), sent, visited, cells, bagBefore };
}

test('好友赠送牧草：进入好友牧场并下发 host_gid', async () => {
    const { actions, sent, visited, cells, bagBefore } = loadActions();
    const plan = await actions.planAction('addGrass', { hostGid: HOST_GID, facilityId: FACILITY_ID, count: 10 }, {
        cells,
        bag: bagBefore,
        recipient: { gid: HOST_GID, name: '好友甲' },
    });
    assert.equal(plan.payload.host_gid, HOST_GID, '赠送牧草必须带 host_gid，否则会补到自己机器上');
    assert.equal(plan.payload.instance_id, FACILITY_ID);
    assert.equal(plan.payload.add_count, 10);
    assert.equal(plan.label, '向好友甲赠送牧草', '报价弹窗要显示送给谁，不能沿用自家补草文案');

    // 自家补草仍走 inScene，不应触发好友拜访。
    await actions.planAction('addGrass', { facilityId: FACILITY_ID, count: 5 }, { cells, bag: bagBefore });
    assert.equal(visited.length, 0, '没有 hostGid 时不能进好友牧场');

    const prepared = await actions.prepareAction('addGrass', { hostGid: HOST_GID, facilityId: FACILITY_ID, count: 3 });
    assert.deepEqual(visited, [HOST_GID], '报价阶段就要按好友牧场读取，否则容量判据会用自家机器');
    assert.equal(prepared.count, 3);
    assert.equal(sent.length, 0, '报价不允许发写请求');
});

test('好友赠送牧草：超过对方牧草机剩余容量时拒绝', async () => {
    const { actions, cells, bagBefore } = loadActions({ feedCount: 98, capacity: 100 });
    await assert.rejects(
        () => actions.planAction('addGrass', { hostGid: HOST_GID, facilityId: FACILITY_ID, count: 5 }, {
            cells,
            bag: bagBefore,
            recipient: { gid: HOST_GID, name: '好友甲' },
        }),
        (cause) => {
            assert.equal(cause.code, 'RANCH_GRASS_CAPACITY');
            return true;
        },
    );
});

test('好友赠送牧草：回包按好友牧草机确认，不拿自家快照冒充结果', async () => {
    const { actions, sent } = loadActions({ feedCount: 90, capacity: 100 });
    const input = { hostGid: HOST_GID, facilityId: FACILITY_ID, count: 10 };
    const quote = await actions.prepareAction('addGrass', input);
    const result = await actions.operate('addGrass', { ...input, expected: quote.expected });
    assert.equal(sent[0].route, 'addGrass');
    assert.equal(sent[0].payload.host_gid, HOST_GID);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.notice, '已向好友甲赠送 10 份牧草');
    assert.equal(result.snapshot, null, '好友回包不含自家快照，不能把好友数据当自己的下发');
    assert.equal(result.refreshRequired, true, '缺少可确认的自家快照时必须要求刷新核对');
    assert.deepEqual(result.costs.map(cost => [cost.id, cost.count]), [[7001, '10']], '消耗要按牧草 7001 记账，界面据此显示成本');
});

test('好友赠送牧草：回包牧草数不符时按结果未知处理', async () => {
    // 回包的数量超过机器容量，说明这份回包不是本次赠送的结果。
    const { actions } = loadActions({ reply: { detail: { feed_count: 150 }, consumed: [] } });
    const input = { hostGid: HOST_GID, facilityId: FACILITY_ID, count: 10 };
    const quote = await actions.prepareAction('addGrass', input);
    await assert.rejects(
        () => actions.operate('addGrass', { ...input, expected: quote.expected }),
        (cause) => {
            assert.equal(cause.code, 'RANCH_RESULT_UNKNOWN');
            return true;
        },
    );
});
