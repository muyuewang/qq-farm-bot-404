const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const test = require('node:test');
const { CONFIG } = require('../dist/config/config');
const { loadProto, types } = require('../dist/utils/proto');

function harness() {
    const filename = path.resolve(__dirname, '../dist/utils/network.js');
    const realRequire = createRequire(filename);
    const tasks = new Map();
    const requests = [];
    const sockets = [];
    let mono = 0;
    let wall = 100000;
    class Socket extends EventEmitter {
        static OPEN = 1;
        readyState = 1;
        constructor(url, options) { super(); this.url = url; this.options = options; sockets.push(this); }
        terminate() { this.terminated = true; this.emit('close', 1006); }
        close() { this.emit('close', 1000); }
    }
    const overrides = {
        ws: Socket,
        'node:perf_hooks': { performance: { now: () => mono } },
        '../services/scheduler': { createScheduler: () => ({
            setIntervalTask: (key, _ms, fn) => tasks.set(key, fn),
            setTimeoutTask: (key, _ms, fn) => tasks.set(key, fn),
            clear: key => tasks.delete(key), clearAll: () => tasks.clear(),
        }) },
        '../services/ace': { startAceRuntime() {}, stopAceRuntime() {}, getAceDiagnostics: () => ({}) },
        '../services/status': { updateStatusFromLogin() {} },
        './crypto-wasm': { bindUser() {}, getEncryptedInitInfo: () => '', getDiagnostics: () => ({}) },
        './utils': { toLong: Number, toNum: Number, log() {}, logWarn() {}, syncServerTime() {} },
    };
    const sandbox = {
        require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {},
        Buffer, console: { warn() {} }, process, URL, URLSearchParams,
        Date: class extends Date { static now() { return wall; } }, requests,
    };
    vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}
        fetchUserSettings = async () => {};
        sendMsg = async (_context, _service, method, body, options) => {
            requests.push({ method, body });
            await options.callback(null, types[method + 'Reply'].encode({ basic: { gid: 1, level: 1 } }).finish());
        };
        module.exports.login = () => sendLogin(currentConnection);
        module.exports.setSender = fn => { sendMsgAsync = fn; };
        module.exports.snapshot = () => getConnectionDiagnostics(currentConnection);
    `, sandbox, { filename });
    const api = sandbox.module.exports;
    api.setSender(async (_service, method, body) => {
        requests.push({ method, body });
        return { body: types.PlayerSceneLoginReply.encode({ global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) }).finish() };
    });
    return { api, sockets, requests, tasks, advance: ms => { mono += ms; wall += ms; }, jumpWall: ms => { wall += ms; } };
}

test('each session pins its platform version from handshake through login and heartbeat', async () => {
    await loadProto();
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, wxClientVersion: CONFIG.wxClientVersion };
    try {
        for (const platform of ['qq', 'wx', 'wechat']) {
            CONFIG.platform = platform;
            CONFIG.clientVersion = '1.15.0.2_qq';
            CONFIG.wxClientVersion = '1.15.0.2_wx';
            const expected = platform === 'qq' ? CONFIG.clientVersion : CONFIG.wxClientVersion;
            const h = harness();
            h.api.connect('synthetic-code');
            assert.equal(new URL(h.sockets[0].url).searchParams.get('ver'), expected);
            assert.equal(new URL(h.sockets[0].url).searchParams.get('platform'), platform === 'qq' ? 'qq' : 'wx');
            assert.equal(h.sockets[0].options.handshakeTimeout, 20000);
            // A settings broadcast while connecting must not change the login RPC or version.
            CONFIG.clientVersion = '1.14.2.15_old';
            CONFIG.wxClientVersion = '1.14.2.13_old';
            await h.api.login();
            assert.equal(h.requests[0].method, 'PlayerLogin');
            assert.equal(types.PlayerLoginRequest.decode(h.requests[0].body).device_info.client_version, expected);
            h.api.setSender(async (_service, method, body) => {
                assert.equal(method, 'Heartbeat');
                assert.equal(types.HeartbeatRequest.decode(body).client_version, expected);
                return { body: Buffer.alloc(0) };
            });
            await h.tasks.get('heartbeat_interval')();
            assert.equal(h.api.snapshot().clientVersion, expected);
            h.api.cleanup();
        }
    } finally { Object.assign(CONFIG, saved); }
});

test('wall-clock jumps cannot disconnect a recently active connection or conceal a stale one', async () => {
    await loadProto();
    const h = harness();
    const disconnects = [];
    h.api.networkEvents.on('disconnected', event => disconnects.push(event));
    h.api.connect('synthetic-code');
    await h.api.login();
    h.api.setSender(async () => { throw new Error('synthetic timeout'); });
    const heartbeat = h.tasks.get('heartbeat_interval');
    h.advance(20000);
    h.jumpWall(86400000);
    await heartbeat(); await heartbeat(); await heartbeat();
    assert.equal(disconnects.length, 0);
    assert.equal(h.api.snapshot().lastInboundAgeMs, 20000);
    assert.equal(h.api.snapshot().onlineAgeMs, 20000);
    h.advance(20000);
    h.jumpWall(-172800000);
    await heartbeat();
    assert.equal(disconnects.length, 1);
    assert.equal(disconnects[0].source, 'heartbeat_timeout');
    assert.equal(disconnects[0].diagnostics.lastInboundAgeMs, 40000);
    assert.equal(disconnects[0].diagnostics.connectionAgeMs, 40000);
    assert.equal(h.sockets[0].terminated, true);
    assert.equal(h.sockets.length, 1); // No automatic replay of the one-time Code.
    assert.equal(h.tasks.size, 0);
});

test('a failed handshake ends once and never reuses its Code', () => {
    const h = harness();
    const disconnects = [];
    h.api.networkEvents.on('disconnected', event => disconnects.push(event));
    h.api.connect('synthetic-code');
    h.sockets[0].emit('error', new Error('Opening handshake has timed out'));
    h.sockets[0].emit('close', 1006);
    h.sockets[0].emit('close', 1006);
    assert.equal(disconnects.length, 1);
    assert.equal(disconnects[0].phase, 'connecting');
    assert.equal(h.api.getWs(), null);
    assert.equal(h.sockets.length, 1);
});
