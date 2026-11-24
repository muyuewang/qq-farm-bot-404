const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 好友牧场「一键帮忙生产」（上游 PR#185）。
 *
 * 这条链路的风险点是：只指定主人、由服务端挑就绪动物，所以前端没有逐只报价，
 * 必须靠回包的 op_results 逐条确认「确是这次帮忙、确是好友的动物」，否则会出现
 * 页面以为帮了忙、实际没打出去或被重复提交。这里用桩件把 plan → interact 跑通，
 * 而不是只对源码做字符串断言。
 */
const HOST_GID = '88001';

function loadFriends({ ranches = defaultRanches(), reply = null } = {}) {
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    const sent = [];
    const makeError = (code, message) => Object.assign(new Error(message), { code });
    const quantity = value => (value === undefined || value === null || value === '' ? 0 : Number(value));

    mock('services/ranch/transport', {
        inScene: async work => work({}),
        rpc: async (route, payload) => {
            sent.push({ route, payload });
            if (route === 'enterFriend') return { basic: { gid: payload.host_gid, name: '好友甲' }, homestead_cells: { facilities: [] } };
            if (route === 'leaveFriend') return {};
            if (route === 'animals') return { ranches };
            return reply ?? {
                remaining_times: 0,
                op_results: [
                    { kind: 1, facility_inst_id: '1', target_id: '101', costs: [], rewards: [] },
                    { kind: 1, facility_inst_id: '2', target_id: '202', costs: [], rewards: [] },
                ],
                rewards: [],
            };
        },
    });
    // 保留真实 network 的其余导出（getWs 等），只替换本测试关心的两项。
    const realNetwork = require('../dist/utils/network');
    mock('utils/network', {
        ...realNetwork,
        getUserState: () => ({ gid: '99001' }),
        networkEvents: { emit: () => {} },
    });
    mock('services/ranch/model', {
        error: makeError,
        positiveId: value => Number(value),
        positiveCount: value => Math.floor(Number(value)),
        quantity,
        itemDto: raw => ({ id: Number(raw.id), count: String(raw.count), name: '产物', image: '' }),
        sumItems: items => items,
        signature: items => JSON.stringify(items),
    });
    mock('services/ranch/state', {
        animalDto: raw => ({ id: Number(raw.animal_id), name: '动物' }),
        ranchCareer: async () => null,
    });
    mock('services/ranch/operation-state', {
        forCurrentAccount: () => ({ spend: async (_options, work) => work() }),
    });
    mock('services/stats', { recordOperation: () => {} });
    mock('services/ranch/context', { getAmbientSendContext: () => null, runWithSendContext: async (_ctx, work) => work() });
    mock('utils/utils', { getServerTimeSec: () => 1000, logWarn: () => {} });

    const id = require.resolve('../dist/services/ranch/friends');
    delete require.cache[id];
    return { friends: require(id), sent };
}

function defaultRanches() {
    return [
        { ranch_inst_id: '1', animals: [
            { ranch_inst_id: '1', animal_inst_id: '101', animal_id: '5001', can_deliver: true },
            { ranch_inst_id: '1', animal_inst_id: '102', animal_id: '5001', can_deliver: false },
        ] },
        { ranch_inst_id: '2', animals: [
            { ranch_inst_id: '2', animal_inst_id: '202', animal_id: '5002', can_deliver: true },
        ] },
    ];
}

test('帮忙生产：动作已登记，报价只按就绪动物计数且不夹带自家目标', async () => {
    const { contract } = (() => ({ contract: require('../dist/services/ranch/contract') }))();
    assert.ok(contract.ACTIONS.includes('produceFriend'), 'produceFriend 必须在动作白名单，否则会被网关拦掉');

    const { friends, sent } = loadFriends();
    const quote = await friends.prepareInteraction('produceFriend', { hostGid: HOST_GID });
    assert.equal(quote.action, 'produceFriend');
    assert.equal(quote.count, 2, '只数 can_deliver 的动物，没就绪的不算');
    assert.deepEqual(quote.costs, []);
    sent.length = 0;

    const prepared = await friends.prepareInteraction('produceFriend', { hostGid: HOST_GID });
    assert.equal(prepared.expected.signature, quote.expected.signature, '同一份牧场状态应给出稳定签名');
    assert.equal(sent.filter(row => row.route === 'produce').length, 0, '报价阶段不能发出写请求');
});

test('帮忙生产：direct 免签名直发，按 Produce 回包逐条确认并计入帮忙统计', async () => {
    const { friends, sent } = loadFriends();
    const quote = await friends.prepareInteraction('produceFriend', { hostGid: HOST_GID });
    sent.length = 0;

    // direct：不带 expected 也允许提交（前端走直投通道）。
    const result = await friends.interact('produceFriend', { hostGid: HOST_GID, direct: true });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.completed, 2);
    const writes = sent.filter(row => row.route === 'produce');
    assert.equal(writes.length, 1, '只能发一次 produce 写请求');
    assert.deepEqual(writes[0].payload, { host_gid: Number(HOST_GID), targets: [] }, '只指定主人，动物由服务端挑选');
    assert.match(result.notice, /2 只动物已开始生产/);
    assert.equal(result.remainingTimes, undefined, '帮忙生产没有「剩余互动次数」回读，不要伪造一个');
    assert.equal(result.refreshRequired, true, '好友那边状态变了，前端必须刷新');
    assert.ok(quote.count > 0);
});

test('帮忙生产：非 direct 模式下签名不符要拒绝，防止拿旧报价打新状态', async () => {
    const { friends, sent } = loadFriends();
    await assert.rejects(
        () => friends.interact('produceFriend', { hostGid: HOST_GID, expected: { signature: 'stale' } }),
        cause => cause.code === 'RANCH_OFFER_CHANGED',
    );
    assert.equal(sent.filter(row => row.route === 'produce').length, 0, '签名不符时不能发出写请求');
});

test('帮忙生产：回包出现不属于本次的动物时判结果未知，不当成成功', async () => {
    const { friends } = loadFriends({
        reply: {
            remaining_times: 0,
            op_results: [{ kind: 1, facility_inst_id: '9', target_id: '999', costs: [], rewards: [] }],
            rewards: [],
        },
    });
    await assert.rejects(
        () => friends.interact('produceFriend', { hostGid: HOST_GID, direct: true }),
        cause => cause.code === 'RANCH_RESULT_UNKNOWN',
    );
});

test('帮忙生产：好友没有就绪动物时跳过并给出可理解的提示', async () => {
    const { friends, sent } = loadFriends({
        ranches: [{ ranch_inst_id: '1', animals: [{ ranch_inst_id: '1', animal_inst_id: '101', animal_id: '5001', can_deliver: false }] }],
    });
    const result = await friends.interact('produceFriend', { hostGid: HOST_GID, direct: true });
    assert.equal(result.status, 'skipped');
    assert.equal(result.completed, 0);
    assert.equal(result.notice, '好友当前没有可帮生产的动物');
    assert.equal(result.refreshRequired, true);
    assert.equal(sent.filter(row => row.route === 'produce').length, 0, '没有可帮的动物时不能发写请求');
});
