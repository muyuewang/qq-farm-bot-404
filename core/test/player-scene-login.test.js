const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const { CONFIG } = require('../src/config/config');
const { loadProto, types } = require('../src/utils/proto');

const networkFile = path.resolve(__dirname, '../src/utils/network.js');
const COMPLETE_SCENE = { global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) };
const LOGIN_VERSION = '1.15.0.2_20261001';

const settle = () => new Promise(resolve => setImmediate(resolve));

// 登录链路只依赖网关收发。这里用桩替换真实 socket、ACE、心跳与设置拉取，并把场景登录
// 挂在一个手动闸门上等被测代码自己走到那一步，只保留 sendLogin 的分派与回包校验。
async function harness(platform, respond) {
    await loadProto();
    const steps = [];
    let releaseScene;
    let scenePayload = COMPLETE_SCENE;
    const sceneGate = new Promise(resolve => { releaseScene = resolve; });

    const overrides = {
        ws: { OPEN: 1 },
        '../services/scheduler': { createScheduler: () => ({ clear() {}, clearAll() {}, setTimeoutTask() {}, setTask() {} }) },
        '../services/ace-service': { AceService: class { constructor() { steps.push('ace'); } start() {} stop() {} } },
        '../services/status': { updateStatusFromLogin() {}, updateStatusGold() {}, updateStatusLevel() {} },
        './crypto-wasm': { setRuntime() {}, bindUser: async () => {}, getEncryptedInitInfo: () => '' },
        './utils': { toLong: Number, toNum: Number, log() {}, logWarn() {}, syncServerTime() {} },
    };
    const realRequire = createRequire(networkFile);
    const state = { scenePayload: COMPLETE_SCENE };
    const sandbox = {
        require: name => overrides[name] || realRequire(name),
        module: { exports: {} },
        exports: {},
        Buffer,
        process,
        console: { warn() {}, log() {}, error() {} },
        setTimeout,
        clearTimeout,
        assert,
        respond,
        sceneGate,
        steps,
        state,
        release: () => releaseScene(),
    };
    vm.runInNewContext(`${fs.readFileSync(networkFile, 'utf8')}
        module.exports.run = async () => {
            ws = { readyState: 1, terminate: () => steps.push('terminate') };
            tsdkRuntime = { ready: true, bindUser: () => steps.push('bind'), getEncryptedInitInfo: () => '' };
            currentConnection = { id: 1, socket: ws, phase: 'authenticating', finalized: false, loginInitialized: false };
            startHeartbeat = () => steps.push('heartbeat');
            fetchUserSettings = async () => steps.push('settings');
            finalizeConnection = () => steps.push('failed');
            sendMsg = async (_context, _service, method, body, options) => {
                steps.push(method);
                await options.callback(null, respond(method, body));
            };
            sendMsgAsync = async (_service, method, body) => {
                steps.push(method);
                assert.equal(types.PlayerSceneLoginRequest.decode(body).global_scene_id, 1);
                await sceneGate;
                return { body: types.PlayerSceneLoginReply.encode(state.scenePayload).finish() };
            };
            await sendLogin(currentConnection, () => steps.push('ready'));
        };
        module.exports.drop = () => { currentConnection = null; };
        module.exports.finish = payload => { state.scenePayload = payload; release(); };
    `, sandbox, { filename: networkFile });

    CONFIG.platform = platform;
    const api = sandbox.module.exports;
    return { steps, run: api.run(), drop: api.drop, finish: api.finish };
}

function loginResponder(record) {
    return (method, body) => {
        const request = types[`${method}Request`].decode(body);
        assert.ok(request.device_info.client_version, '登录请求必须带上自己的客户端版本');
        if (record) record(method, request, Buffer.from(body).toString('hex'));
        return types[`${method}Reply`].encode({
            basic: { gid: 1, level: 1, open_id: 'synthetic-open-id' },
        }).finish();
    };
}

function withConfig(values, run) {
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, wxClientVersion: CONFIG.wxClientVersion };
    Object.assign(CONFIG, values);
    return run().finally(() => Object.assign(CONFIG, saved));
}

test.before(async () => loadProto());

test('QQ and WeChat finish the farm scene login before automation starts', () => withConfig(
    { clientVersion: LOGIN_VERSION, wxClientVersion: LOGIN_VERSION },
    async () => {
        for (const platform of ['qq', 'wx', 'wechat']) {
            const h = await harness(platform, loginResponder());
            await settle();
            assert.deepEqual(h.steps, ['PlayerLogin', 'bind', 'ace', 'heartbeat', 'settings', 'PlayerSceneLogin']);
            assert.equal(h.steps.includes('ready'), false, '场景登录没有回执前不能开始任务');
            h.finish(COMPLETE_SCENE);
            await h.run;
            assert.equal(h.steps.at(-1), 'ready');
        }
    },
));

test('an incomplete scene reply tears the connection down instead of farming half a session', () => withConfig(
    { clientVersion: LOGIN_VERSION, wxClientVersion: LOGIN_VERSION },
    async () => {
        for (const payload of [
            { global_scene_id: 1 },
            { global_scene_id: 2, farm_scene_ext_data: Buffer.from([8, 1]) },
        ]) {
            const h = await harness('qq', loginResponder());
            await settle();
            h.finish(payload);
            await h.run;
            assert.deepEqual(h.steps.slice(-2), ['failed', 'terminate']);
            assert.equal(h.steps.includes('ready'), false);
        }
    },
));

test('a scene reply that arrives after disconnect never starts farming', () => withConfig(
    { clientVersion: LOGIN_VERSION, wxClientVersion: LOGIN_VERSION },
    async () => {
        const h = await harness('qq', loginResponder());
        await settle();
        assert.equal(h.steps.at(-1), 'PlayerSceneLogin');
        h.drop();
        h.finish(COMPLETE_SCENE);
        await h.run;
        assert.equal(h.steps.includes('ready'), false);
        assert.equal(h.steps.includes('failed'), false);
    },
));

test('historical 1.14 clients keep the single-stage login path', () => withConfig(
    { clientVersion: '1.14.2.15_20260922', wxClientVersion: '1.14.2.13_20260922' },
    async () => {
        for (const platform of ['qq', 'wx']) {
            const h = await harness(platform, loginResponder());
            await h.run;
            assert.equal(h.steps[0], 'Login');
            assert.equal(h.steps.includes('PlayerSceneLogin'), false);
            assert.equal(h.steps.at(-1), 'ready');
        }
    },
));

test('the two platforms encode different login fields on the wire', () => withConfig(
    { clientVersion: LOGIN_VERSION, wxClientVersion: LOGIN_VERSION },
    async () => {
        const logins = {};
        const bodies = {};
        for (const platform of ['qq', 'wx']) {
            const h = await harness(platform, loginResponder((_method, request, hex) => {
                logins[platform] = request;
                bodies[platform] = hex;
            }));
            h.finish(COMPLETE_SCENE);
            await h.run;
        }

        for (const login of Object.values(logins)) {
            assert.equal(login.share_key, '', '两段式要写入空分享键');
            assert.equal(login.game_scene_id, 1, '两段式要写入游戏场景');
            assert.equal(login.report_data.minigame_platid, 2);
            assert.equal(login.device_info.client_version, LOGIN_VERSION);
        }

        // protobufjs 解码会把缺失的 proto3 字段填成默认值，判断“官方到底没写这个字段”只能看字节。
        const sceneIdOnWire = Buffer.from([0x2a, 0x07, ...Buffer.from('1234567', 'utf8')]).toString('hex');
        assert.equal(logins.qq.scene_id, '1234567');
        assert.ok(bodies.qq.includes(sceneIdOnWire), 'QQ 登录写入官方启动场景');
        assert.ok(!bodies.wx.includes(sceneIdOnWire), '微信 Code 不带入口场景，整个字段必须缺失');
        assert.equal(logins.qq.report_data.minigame_channel, 'other-qq');
        assert.equal(logins.wx.report_data.minigame_channel, 'other');
    },
));
