const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { loadProto, types } = require('../dist/utils/proto');
const { CONFIG } = require('../dist/config/config');

async function harness(platform) {
    await loadProto();
    CONFIG.platform = platform;
    const file = path.resolve(__dirname, '../dist/utils/network.js');
    const realRequire = createRequire(file);
    const steps = [];
    let sceneResolve;
    const overrides = {
        ws: { OPEN: 1 },
        '../services/scheduler': { createScheduler: () => ({ clear() {}, clearAll() {} }) },
        '../services/ace': { startAceRuntime: () => steps.push('ace') },
        '../services/status': { updateStatusFromLogin() {} },
        './crypto-wasm': { bindUser: async () => steps.push('bind'), getEncryptedInitInfo: () => '' },
        './utils': { toLong: Number, toNum: Number, log() {}, logWarn() {}, syncServerTime() {} },
    };
    const sandbox = { require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {}, Buffer, console: { warn() {} }, process, steps };
    vm.runInNewContext(`${fs.readFileSync(file, 'utf8')}
        module.exports.run = async (respond, scene) => {
            ws = { readyState: 1, terminate: () => steps.push('terminate') };
            const context = currentConnection = { socket: ws, phase: 'authenticating', finalized: false, loginInitialized: false };
            startHeartbeat = () => steps.push('heartbeat');
            fetchUserSettings = async () => steps.push('settings');
            finalizeConnection = () => steps.push('failed');
            sendMsg = async (_context, _service, method, body, options) => {
                steps.push(method);
                await options.callback(null, respond(method, body));
            };
            sendMsgAsync = async (service, method, body) => { steps.push(method); return scene(body); };
            await sendLogin(context, () => steps.push('ready'));
        };
        module.exports.replace = () => { currentConnection = null; };
    `, sandbox, { filename: file });
    const api = sandbox.module.exports;
    const run = api.run((method, body) => {
        const request = types[`${method}Request`].decode(body);
        assert.ok(request.device_info.client_version);
        return types[`${method}Reply`].encode({ basic: { gid: 1, level: 1, open_id: 'synthetic' } }).finish();
    }, body => {
        assert.equal(types.PlayerSceneLoginRequest.decode(body).global_scene_id, 1);
        return new Promise(resolve => { sceneResolve = resolve; });
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { steps, run, replace: api.replace, finish: data => sceneResolve({ body: types.PlayerSceneLoginReply.encode(data).finish() }) };
}

test('QQ and WeChat enter the farm scene before starting automation', async () => {
    const saved = CONFIG.platform;
    try {
        for (const platform of ['qq', 'wx', 'wechat']) {
            const h = await harness(platform);
            assert.deepEqual(h.steps, ['PlayerLogin', 'bind', 'ace', 'heartbeat', 'settings', 'PlayerSceneLogin']);
            assert.equal(h.steps.includes('ready'), false);
            h.finish({ global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) });
            await h.run;
            assert.equal(h.steps.at(-1), 'ready');
        }
    } finally { CONFIG.platform = saved; }
});

test('incomplete or stale QQ and WeChat scene replies cannot start farming', async () => {
    const saved = CONFIG.platform;
    try {
        for (const platform of ['qq', 'wx']) {
            const broken = await harness(platform);
            broken.finish({ global_scene_id: 1 });
            await broken.run;
            assert.deepEqual(broken.steps.slice(-2), ['failed', 'terminate']);
            assert.equal(broken.steps.includes('ready'), false);
            const stale = await harness(platform);
            stale.replace();
            stale.finish({ global_scene_id: 1, farm_scene_ext_data: Buffer.from([8, 1]) });
            await stale.run;
            assert.equal(stale.steps.includes('ready'), false);
        }
    } finally { CONFIG.platform = saved; }
});

test('explicit historical QQ and WeChat clients retain single-stage login', async () => {
    const saved = { platform: CONFIG.platform, clientVersion: CONFIG.clientVersion, wxClientVersion: CONFIG.wxClientVersion };
    try {
        CONFIG.clientVersion = '1.14.2.15_20260922';
        CONFIG.wxClientVersion = '1.14.2.13_20260922';
        for (const platform of ['qq', 'wx']) {
            const old = await harness(platform);
            await old.run;
            assert.equal(old.steps[0], 'Login');
            assert.equal(old.steps.includes('PlayerSceneLogin'), false);
            assert.equal(old.steps.at(-1), 'ready');
        }
    } finally { Object.assign(CONFIG, saved); }
});
