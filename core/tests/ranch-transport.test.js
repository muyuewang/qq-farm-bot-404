const test = require('node:test');
const assert = require('node:assert/strict');

const CELL_FIXTURE = { id: 101 };

// 网络与 proto 用固定桩件，场景串行锁和发送上下文走真实实现。
function loadTransport({ unlocked = true, globalSceneId = 1, restoreFails = false, swapSocket = false, contextChecks = [] } = {}) {
    const events = [];
    let socket = { id: 'first' };
    let scene = globalSceneId;
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    mock('utils/network', {
        getUserState: () => ({ unlockedSceneIds: unlocked ? [1, 2] : [1], globalSceneId: scene }),
        getWs: () => socket,
        invalidateGameScene: reason => events.push({ kind: 'invalidate', reason }),
        sendMsgAsync: async (service, method, body, options = {}) => {
            events.push({ kind: 'attempt', service, method });
            // 与 network.sendMsg 一致：beforeSend 返回错误即拒绝，包发出后才回调 onSent。
            const blocked = options.beforeSend?.();
            if (blocked) throw blocked;
            options.onSent?.();
            return { body: Buffer.alloc(0) };
        },
        loginGameScene: async id => {
            events.push({ kind: 'login', id });
            if (restoreFails && id === globalSceneId) throw new Error('游戏场景登录回包不完整');
            scene = id;
            return id === 2 ? { big_farm_scene_ext_data: Buffer.alloc(0) } : null;
        },
    });
    const request = { fromObject: input => ({ input }), encode: () => ({ finish: () => Buffer.alloc(0) }) };
    mock('utils/proto', {
        types: {
            RanchSceneData: { decode: () => ({ homestead_cells: CELL_FIXTURE }) },
            RanchHarvestRanchRequest: request,
            RanchHarvestRanchReply: { decode: () => ({ ret: 0 }) },
        },
    });
    mock('utils/utils', { logWarn: (tag, message) => events.push({ kind: 'warn', message }) });
    for (const name of ['services/ranch/transport', 'services/automation-lock', 'services/ranch/context']) delete require.cache[require.resolve(`../dist/${name}`)];
    const { inScene, rpc, isUnlocked } = require('../dist/services/ranch/transport');
    const { runWithSendContext } = require('../dist/services/ranch/context');
    return {
        events, inScene, isUnlocked,
        runWrite: (route, input) => runWithSendContext({
            check: () => contextChecks.shift() || null,
            onSent: () => events.push({ kind: 'onSent' }),
        }, () => rpc(route, input, true)),
        enterScene: async (hook) => {
            let cells;
            const result = await inScene(async value => {
                cells = value;
                if (swapSocket) socket = { id: 'reconnected' };
                return hook ? hook(value) : { status: 'ok' };
            });
            return { result, cells };
        },
    };
}

test('牧场未解锁时拒绝进入场景，也不发起任何登录', async () => {
    const h = loadTransport({ unlocked: false });
    await assert.rejects(h.enterScene(), error => error.code === 'RANCH_LOCKED');
    assert.deepEqual(h.events, []);
    assert.equal(h.isUnlocked(), false);
});

test('从别的场景进牧场操作后必须切回原场景', async () => {
    const h = loadTransport({ globalSceneId: 1 });
    const { result, cells } = await h.enterScene();
    assert.deepEqual(cells, CELL_FIXTURE, '牧场场景数据应透传给调用方');
    assert.equal(result.status, 'ok');
    assert.deepEqual(h.events.map(e => [e.kind, e.id]), [['login', 2], ['login', 1]]);
});

test('已经位于牧场场景时不重复登录，也不做恢复', async () => {
    const h = loadTransport({ globalSceneId: 2 });
    const { cells } = await h.enterScene();
    assert.equal(cells, null, '已在牧场则沿用现有场景，不再解包场景数据');
    assert.deepEqual(h.events, []);
});

test('场景恢复失败要标记重新登录，并把结果标成未确认', async () => {
    const h = loadTransport({ globalSceneId: 1, restoreFails: true });
    const { result } = await h.enterScene();
    assert.equal(result.sceneRestored, false);
    assert.equal(result.refreshRequired, true);
    assert.match(result.notice, /重新登录/);
    assert.ok(h.events.some(e => e.kind === 'invalidate'), '未确认的场景必须失效，避免后续操作沿用错误状态');
    assert.ok(h.events.some(e => e.kind === 'warn'));
});

test('操作期间断线重连后不再补发场景恢复', async () => {
    const h = loadTransport({ globalSceneId: 1, swapSocket: true });
    await h.enterScene();
    assert.deepEqual(h.events.map(e => [e.kind, e.id]), [['login', 2]], '重连由登录流程统一恢复场景');
});

test('写入请求在发送前复核开关，关闭后不得发包', async () => {
    const blocked = new Error('牧场操作开关已关闭');
    const h = loadTransport({ contextChecks: [blocked] });
    await assert.rejects(h.runWrite('harvest', { all: true }), error => error === blocked);
    assert.deepEqual(h.events.map(e => e.kind), ['attempt'], '开关关闭时不得发包，onSent 不应触发');

    const allowed = loadTransport({ contextChecks: [] });
    await allowed.runWrite('harvest', { all: true });
    assert.deepEqual(allowed.events.map(e => e.kind), ['attempt', 'onSent']);
});

test('并发巡查串行执行，第二个任务等第一个恢复场景后才进入牧场', async () => {
    const h = loadTransport({ globalSceneId: 1 });
    let inside = 0;
    let peak = 0;
    const guard = async () => {
        inside++;
        peak = Math.max(peak, inside);
        await new Promise(resolve => setTimeout(resolve, 5));
        inside--;
        return { status: 'ok' };
    };
    await Promise.all([h.enterScene(guard), h.enterScene(guard)]);
    assert.equal(peak, 1, '两个巡查不得同时停留在牧场场景');
    assert.deepEqual(h.events.map(e => [e.kind, e.id]), [['login', 2], ['login', 1], ['login', 2], ['login', 1]]);
});
