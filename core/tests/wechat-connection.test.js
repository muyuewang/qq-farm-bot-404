const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const { CONFIG, DEFAULT_CLIENT_VERSION, DEFAULT_WX_CLIENT_VERSION } = require('../dist/config/config');
const { loadProto, types } = require('../dist/utils/proto');
const { getClientVersion } = require('../dist/utils/client-profile');
const { sanitizeMeta } = require('../dist/services/logger');

test('QQ and WeChat versions can be configured independently', () => {
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, wxClientVersion: CONFIG.wxClientVersion };
    try {
        CONFIG.clientVersion = '';
        CONFIG.wxClientVersion = '';
        assert.equal(DEFAULT_WX_CLIENT_VERSION, '1.15.1.4_20261001');
        for (const platform of ['qq', 'wx', 'wechat']) {
            CONFIG.platform = platform;
            assert.equal(getClientVersion(), DEFAULT_CLIENT_VERSION);
        }
        CONFIG.clientVersion = 'custom-version';
        CONFIG.platform = 'wx';
        assert.equal(getClientVersion(), DEFAULT_WX_CLIENT_VERSION);
        CONFIG.wxClientVersion = 'wx-custom';
        assert.equal(getClientVersion(), 'wx-custom');
        CONFIG.platform = 'qq';
        assert.equal(getClientVersion(), 'custom-version');
    } finally {
        Object.assign(CONFIG, saved);
    }
});

test('decoded WeChat login uses configured device fields and does not invent a launch scene', async () => {
    await loadProto();
    const { buildLoginBody } = require('../dist/utils/network');
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, deviceInfo: CONFIG.deviceInfo };
    try {
        CONFIG.platform = 'wx';
        CONFIG.clientVersion = DEFAULT_CLIENT_VERSION;
        CONFIG.deviceInfo = { sysSoftware: 'Windows test', network: 'wifi', memory: '8192', deviceId: 'test-device' };
        const decode = () => types.PlayerLoginRequest.toObject(types.PlayerLoginRequest.decode(buildLoginBody()), { longs: String });
        const wx = decode();
        assert.deepEqual(wx.device_info, { client_version: DEFAULT_CLIENT_VERSION, sys_software: 'Windows test', network: 'wifi', memory: '8192', device_id: 'test-device' });
        assert.equal(wx.share_key, '');
        assert.equal(wx.game_scene_id, 1);
        assert.deepEqual(Object.keys(wx.report_data).sort(), ['minigame_channel', 'minigame_platid']);
        assert.equal(wx.report_data.minigame_channel, 'other');
        assert.equal(wx.report_data.minigame_platid, 2);
        assert.equal(Object.hasOwn(wx, 'scene_id'), false);
        CONFIG.deviceInfo.memory = 'invalid';
        assert.equal(Object.hasOwn(decode().device_info, 'memory'), false);
        CONFIG.platform = 'qq';
        const qq = types.PlayerLoginRequest.toObject(types.PlayerLoginRequest.decode(buildLoginBody()), { longs: String });
        assert.equal(qq.device_info.client_version, DEFAULT_CLIENT_VERSION);
        assert.equal(qq.report_data.minigame_channel, 'other-qq');
        assert.equal(Object.hasOwn(qq.device_info, 'device_id'), false);
    } finally {
        Object.assign(CONFIG, saved);
    }
});

test('diagnostic numeric codes survive while credentials remain redacted', () => {
    const result = sanitizeMeta({ code: 123456, token: 'secret', diagnostics: {
        reasonCode: 2, disconnectCode: 1006, errorCode: 500, closeCode: 'credential',
        authCode: 'secret', reason: 'wss://example.test/?code=secret&token=secret',
    } });
    assert.equal(result.code, '[REDACTED]');
    assert.equal(result.token, '[REDACTED]');
    assert.equal(result.diagnostics.reasonCode, 2);
    assert.equal(result.diagnostics.disconnectCode, 1006);
    assert.equal(result.diagnostics.errorCode, 500);
    assert.equal(result.diagnostics.closeCode, '[REDACTED]');
    assert.equal(result.diagnostics.authCode, '[REDACTED]');
    assert.ok(!JSON.stringify(result).includes('secret'));
});

function aceHarness() {
    const filename = path.resolve(__dirname, '../dist/services/ace.js');
    const realRequire = createRequire(filename);
    const tasks = new Map();
    const fed = [];
    const logs = [];
    let readError = false;
    let decodeError = false;
    let feedError = false;
    const overrides = {
        './scheduler': { createScheduler: () => ({ setIntervalTask: (name, _ms, fn) => tasks.set(name, fn), clearAll: () => tasks.clear() }) },
        '../utils/proto': { types: {
            AntiDataRequest: { create: value => value, encode: value => ({ finish: () => value.data }) },
            AntiDataReply: { decode: value => { if (decodeError) throw new Error('decode failed'); return { result: value }; } },
        } },
        '../utils/utils': { log: (...args) => logs.push(args), logWarn: (...args) => logs.push(args) },
        '../utils/crypto-wasm': {
            getDataToServer() { if (readError) throw new Error('read failed'); return Buffer.from([1]); },
            sendDataFromServer: value => { if (feedError) throw new Error('feed failed'); fed.push([...value]); },
            processReceivedData() { throw new Error('process failed'); },
            heartbeatTick() { throw new Error('tick failed'); },
            destroyWasm() {},
        },
    };
    const sandbox = { require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {}, Buffer, Date };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return {
        ace: sandbox.module.exports, tasks, fed, logs,
        failRead: () => { readError = true; },
        failDecode: () => { decodeError = true; },
        failFeed: () => { feedError = true; },
    };
}

test('empty AntiData confirms transport once per session without implying challenge execution', async () => {
    const h = aceHarness();
    h.ace.startAceRuntime(async () => ({ body: Buffer.alloc(0) }));
    await h.ace.sendAntiData();
    await h.ace.sendAntiData();
    assert.equal(h.ace.getAceDiagnostics().replies, 2);
    assert.equal(h.ace.getAceDiagnostics().nonemptyReplies, 0);
    const count = event => h.logs.filter(([, , meta]) => meta?.event === event).length;
    assert.equal(count('antidata_roundtrip'), 1);
    assert.equal(count('antidata_received'), 0);
    h.ace.stopAceRuntime();
    h.ace.startAceRuntime(async () => ({ body: Buffer.from([7]) }));
    await h.ace.sendAntiData();
    assert.equal(count('antidata_roundtrip'), 2);
    assert.equal(count('antidata_received'), 1);
    h.ace.stopAceRuntime();
});

test('AntiData failure stage distinguishes collection, transport, decoding and feeding', async () => {
    for (const stage of ['collect', 'request', 'decode', 'feed']) {
        const h = aceHarness();
        h.ace.startAceRuntime(async () => {
            if (stage === 'request') throw new Error('network failed');
            return { body: Buffer.from([7]) };
        });
        if (stage === 'collect') h.failRead();
        if (stage === 'decode') h.failDecode();
        if (stage === 'feed') h.failFeed();
        await h.ace.sendAntiData();
        const result = h.ace.getAceDiagnostics();
        assert.equal(result.lastFailureStage, stage);
        assert.equal(result.failures, 1);
        assert.equal(result.requests, stage === 'collect' ? 0 : 1);
        assert.equal(result.replies, ['decode', 'feed'].includes(stage) ? 1 : 0);
        assert.equal(result.requestRunning, false);
        assert.equal(h.logs.find(([, , meta]) => meta?.event === 'antidata_failed')[2].stage, stage);
        h.ace.stopAceRuntime();
    }
});

test('TSDK tick failures do not masquerade as received-data processing failures', () => {
    const h = aceHarness();
    h.ace.startAceRuntime(async () => ({ body: Buffer.alloc(0) }));
    h.tasks.get('heartbeat_tick')();
    let result = h.ace.getAceDiagnostics();
    assert.equal(result.taskFailures, 1);
    assert.equal(result.lastFailedTask, 'heartbeat_tick');
    assert.equal(result.lastProcessFailureAt, 0);
    h.tasks.get('process_received_data')();
    result = h.ace.getAceDiagnostics();
    assert.equal(result.taskFailures, 2);
    assert.equal(result.lastFailedTask, 'process_received_data');
    assert.ok(result.lastProcessFailureAt > 0);
    h.ace.stopAceRuntime();
});

test('late AntiData from a stopped connection cannot contaminate its replacement', async () => {
    const h = aceHarness();
    let finishOld;
    let finishNew;
    h.ace.startAceRuntime(() => new Promise(resolve => { finishOld = resolve; }));
    const oldRequest = h.ace.sendAntiData();
    h.ace.stopAceRuntime(true);
    h.ace.startAceRuntime(() => new Promise(resolve => { finishNew = resolve; }));
    const newRequest = h.ace.sendAntiData();
    finishOld({ body: Buffer.from([11]) });
    await oldRequest;
    assert.deepEqual(h.fed, []);
    assert.equal(h.ace.getAceDiagnostics().requestRunning, true);
    assert.equal(h.ace.getAceDiagnostics().replies, 0);
    finishNew({ body: Buffer.from([22]) });
    await newRequest;
    assert.deepEqual(h.fed, [[22]]);
    assert.equal(h.ace.getAceDiagnostics().nonemptyReplies, 1);
    assert.equal(h.ace.getAceDiagnostics().requestRunning, false);
    h.ace.stopAceRuntime();
});

test('empty AntiData replies and local processing failures remain distinguishable', async () => {
    const h = aceHarness();
    h.ace.startAceRuntime(async () => ({ body: Buffer.alloc(0) }));
    await h.ace.sendAntiData();
    assert.equal(h.ace.getAceDiagnostics().replies, 1);
    assert.equal(h.ace.getAceDiagnostics().nonemptyReplies, 0);
    h.tasks.get('process_received_data')();
    assert.ok(h.ace.getAceDiagnostics().lastProcessFailureAt > 0);
    h.failRead();
    await h.ace.sendAntiData();
    assert.equal(h.ace.getAceDiagnostics().failures, 1);
    assert.equal(h.ace.getAceDiagnostics().requestRunning, false);
    h.ace.stopAceRuntime();
});

test('session summaries retain heartbeat outcomes and isolate a late completion from the next connection', async () => {
    await loadProto();
    const filename = path.resolve(__dirname, '../dist/utils/network.js');
    const realRequire = createRequire(filename);
    const tasks = new Map();
    const logs = [];
    let now = 100000;
    class Socket {
        static OPEN = 1;
        readyState = 1;
        on() { return this; }
        close() {}
    }
    const overrides = {
        ws: Socket,
        'node:perf_hooks': { performance: { now: () => now } },
        '../services/scheduler': { createScheduler: () => ({
            setIntervalTask: (key, _ms, fn) => tasks.set(key, fn),
            clear: key => tasks.delete(key), clearAll: () => tasks.clear(),
        }) },
        '../services/ace': { stopAceRuntime() {}, getAceDiagnostics: () => ({ replies: 7 }) },
        './crypto-wasm': { getDiagnostics: () => ({ ready: true }) },
        './utils': { toLong: Number, toNum: Number, log: (...args) => logs.push(args), logWarn() {}, syncServerTime() {} },
    };
    const sandbox = {
        require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {},
        Buffer, console, process, URL, URLSearchParams, Date: { now: () => now },
    };
    vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}
        module.exports.activate = () => {
            currentConnection.phase = 'online';
            currentConnection.onlineMono = performance.now();
            userState.gid = 1;
            startHeartbeat(currentConnection);
        };
        module.exports.setSender = fn => { sendMsgAsync = fn; };
        module.exports.snapshot = () => getConnectionDiagnostics(currentConnection);
    `, sandbox, { filename });
    const network = sandbox.module.exports;
    const heartbeat = () => tasks.get('heartbeat_interval')();
    const counts = () => JSON.parse(JSON.stringify(network.snapshot().heartbeat));
    network.connect('synthetic-code');
    assert.equal(network.snapshot().onlineAgeMs, 0);
    assert.equal(network.snapshot().heartbeat, null);
    assert.equal(network.snapshot().ace, null);
    now += 1000;
    network.activate();
    network.setSender(async () => ({ body: Buffer.alloc(0) }));
    await heartbeat();
    network.setSender(async () => { throw new Error('network timeout'); });
    await heartbeat();
    network.setSender(async () => ({ body: Buffer.alloc(0) }));
    await heartbeat();
    assert.deepEqual(counts(), { attempts: 3, replies: 2, failures: 1 });
    assert.equal(network.snapshot().heartbeatMissCount, 0);
    let finish;
    network.setSender(() => new Promise(resolve => { finish = resolve; }));
    const pending = heartbeat();
    now += 5000;
    network.cleanup('test stop');
    const summary = logs.find(([, , meta]) => meta?.event === 'connection_summary')[2];
    assert.equal(summary.intentionalClose, true);
    assert.equal(summary.source, 'intentional_close');
    assert.equal(summary.diagnostics.onlineAgeMs, 5000);
    assert.equal(summary.diagnostics.connectionAgeMs, 6000);
    assert.equal(summary.diagnostics.heartbeat.attempts, 4);
    assert.equal(summary.diagnostics.ace.replies, 7);
    network.connect('synthetic-next-code');
    assert.equal(network.snapshot().ace, null);
    network.activate();
    finish({ body: Buffer.alloc(0) });
    await pending;
    assert.deepEqual(counts(), { attempts: 0, replies: 0, failures: 0 });
    assert.equal(summary.diagnostics.heartbeat.replies, 2);
    network.cleanup();
});

test('kickout and close snapshots preserve diagnostics before cleanup', async () => {
    await loadProto();
    const filename = path.resolve(__dirname, '../dist/utils/network.js');
    const realRequire = createRequire(filename);
    let destroyed = false;
    const overrides = {
        ws: { OPEN: 1 },
        '../services/scheduler': { createScheduler: () => ({ clear() {}, clearAll() {} }) },
        '../services/ace': { stopAceRuntime() { destroyed = true; }, getAceDiagnostics: () => ({ replies: 7 }) },
        './crypto-wasm': { getDiagnostics: () => ({ ready: !destroyed, unsupportedAceVmCalls: 1 }) },
        './utils': { toLong: Number, toNum: Number, log() {}, logWarn() {} },
    };
    const sandbox = { require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {}, Buffer, console, process };
    vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}
        module.exports.inspectNotify = handleNotify;
        module.exports.installConnection = () => {
            ws = { readyState: 1, close() {} };
            currentConnection = { id: 1, socket: ws, phase: 'online', intentionalClose: false, finalized: false, loginInitialized: true, startedMono: performance.now() - 1000 };
        };
        module.exports.disconnect = () => finalizeConnection(currentConnection, { source: 'ws_close', code: 1006 });
    `, sandbox, { filename });
    const network = sandbox.module.exports;
    network.installConnection();
    let kicked;
    let closed;
    network.networkEvents.on('kickout', value => { kicked = value; });
    network.networkEvents.on('disconnected', value => { closed = value; });
    const event = types.EventMessage.encode(types.EventMessage.create({
        message_type: 'gamepb.userpb.KickoutNotify',
        body: types.KickoutNotify.encode(types.KickoutNotify.create({ reason: 2, reason_message: 'test kickout' })).finish(),
    })).finish();
    network.inspectNotify({ body: event });
    assert.equal(kicked.reasonCode, 2);
    assert.equal(kicked.diagnostics.tsdk.unsupportedAceVmCalls, 1);
    network.disconnect();
    assert.equal(closed.code, 1006);
    assert.equal(closed.diagnostics.tsdk.ready, true);
    assert.equal(closed.diagnostics.ace.replies, 7);
    assert.ok(closed.diagnostics.connectionAgeMs >= 1000);
    assert.equal(destroyed, true);
});
