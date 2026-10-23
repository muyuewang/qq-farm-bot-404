const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { Worker } = require('node:worker_threads');
const test = require('node:test');
const config = require('../dist/config/config');

function load(file, overrides = {}) {
    const filename = path.resolve(__dirname, '../dist', file);
    const realRequire = createRequire(filename);
    const sandbox = {
        require: name => overrides[name] || realRequire(name), module: { exports: {} }, exports: {},
        Buffer, process, console: { warn() {}, error: (...args) => { throw new Error(args.join(' ')); } },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox.module.exports;
}

function memoryStore(initialSystemConfig) {
    let saved = { systemConfig: initialSystemConfig };
    const overrides = {
        '../../config/runtime-paths': { getDataFile: name => name, ensureDataDir() {} },
        './config-storage': {
            createConfigStorage: () => ({
                load: () => saved,
                saveGlobal: value => { saved = JSON.parse(JSON.stringify(value)); },
            }),
        },
    };
    const shared = load('models/store/shared-state.js', overrides);
    const store = load('models/store/global-config.js', { ...overrides, './shared-state': shared });
    return { store, reload: () => shared.loadGlobalConfig(), saved: () => saved };
}

test('legacy shared versions migrate to an independent verified WeChat default', () => {
    const h = memoryStore({ clientVersion: 'qq-custom', clientVersionUpdatedAt: Date.now() });
    const saved = h.store.getSystemConfig();
    assert.equal(saved.clientVersion, 'qq-custom');
    assert.equal(saved.wxClientVersion, config.DEFAULT_WX_CLIENT_VERSION);
    assert.equal(saved.wxClientVersionUpdatedAt, config.DEFAULT_WX_CLIENT_VERSION_UPDATED_AT);
    assert.equal(h.saved().systemConfig.wxClientVersion, config.DEFAULT_WX_CLIENT_VERSION);
});

test('QQ and WeChat overrides persist independently, including writes from older clients', () => {
    const h = memoryStore(null);
    const defaults = config.getDefaultSystemConfig();
    h.store.setSystemConfig({ ...defaults, deviceInfo: { ...defaults.deviceInfo, sysSoftware: 'configured OS' }, wxClientVersion: 'wx-custom', wxClientVersionUpdatedAt: Date.now() });
    const wxTimestamp = h.store.getSystemConfig().wxClientVersionUpdatedAt;
    // A pre-upgrade panel only submits the old QQ fields.
    h.store.setSystemConfig({ clientVersion: 'qq-custom', clientVersionUpdatedAt: Date.now() });
    h.reload();
    const saved = h.store.getSystemConfig();
    assert.equal(saved.clientVersion, 'qq-custom');
    assert.equal(saved.deviceInfo.clientVersion, 'qq-custom');
    assert.equal(saved.wxClientVersion, 'wx-custom');
    assert.equal(saved.wxClientVersionUpdatedAt, wxTimestamp);
    h.store.setSystemConfig({ wxClientVersion: 'wx-next' });
    assert.equal(h.store.getSystemConfig().clientVersion, 'qq-custom');
    assert.equal(h.store.getSystemConfig().wxClientVersion, 'wx-next');
    assert.equal(h.store.getSystemConfig().deviceInfo.sysSoftware, 'configured OS');
    assert.equal(h.store.getSystemConfig().serverUrl, defaults.serverUrl);
});

test('configuration snapshots and worker starts carry both versions with each account platform', () => {
    const saved = config.getRuntimeConfig();
    try {
        config.updateRuntimeConfig({ clientVersion: 'qq-config', wxClientVersion: 'wx-config' });
        const { createRuntimeState } = require('../dist/runtime/runtime-state');
        const state = createRuntimeState({ store: { getConfigSnapshot: () => ({ automation: {} }) } });
        const { createWorkerManager } = load('runtime/worker-manager.js', {
            '../services/scheduler': { createScheduler: () => ({ clear() {} }) },
        });
        const children = [];
        class Child extends EventEmitter {
            messages = [];
            constructor() { super(); children.push(this); }
            postMessage(value) { this.messages.push(value); }
        }
        const manager = createWorkerManager({
            WorkerThread: Child, processRef: process, workerScriptPath: 'synthetic.js',
            workers: {}, globalLogs: [], log() {}, addAccountLog() {},
            buildConfigSnapshotForAccount: state.buildConfigSnapshotForAccount,
        });
        for (const platform of ['qq', 'wx']) manager.startWorker({ id: platform, name: platform, platform, code: 'synthetic' });
        assert.equal(children.length, 2);
        for (const [index, platform] of ['qq', 'wx'].entries()) {
            const start = children[index].messages[0];
            const sync = children[index].messages[1];
            assert.equal(start.config.platform, platform);
            assert.equal(start.config.systemClientVersion, 'qq-config');
            assert.equal(start.config.systemWxClientVersion, 'wx-config');
            assert.deepEqual(start.config.systemDeviceInfo, { ...saved.deviceInfo, clientVersion: 'qq-config' });
            assert.equal(sync.config.systemWxClientVersion, 'wx-config');
        }
    } finally { config.updateRuntimeConfig(saved); }
});

test('parallel QQ and WeChat workers select their own protocol, App ID and WASM', async () => {
    const result = await Promise.all(['qq', 'wx'].map(platform => new Promise((resolve, reject) => {
        const worker = new Worker(`
            const { parentPort, workerData } = require('node:worker_threads');
            const { CONFIG, updateRuntimeConfig } = require(workerData.root + '/config/config');
            const { getClientVersion } = require(workerData.root + '/utils/client-profile');
            const { resolveTsdkHostProfile, TSDK_BUILDS } = require(workerData.root + '/utils/tsdk-runtime');
            const { loadProto, types } = require(workerData.root + '/utils/proto');
            const { buildLoginBody, buildHeartbeatBody } = require(workerData.root + '/utils/network');
            updateRuntimeConfig({ platform: workerData.platform, clientVersion: '1.15.0.2_qq', wxClientVersion: '1.15.0.2_wx' });
            loadProto().then(() => {
                const login = types.PlayerLoginRequest.decode(buildLoginBody());
                parentPort.postMessage({ platform: CONFIG.platform, version: getClientVersion(), loginVersion: login.device_info.client_version,
                    heartbeatVersion: types.HeartbeatRequest.decode(buildHeartbeatBody(1)).client_version,
                    channel: login.report_data.minigame_channel, host: resolveTsdkHostProfile(CONFIG.platform), build: TSDK_BUILDS[CONFIG.platform] });
            });
        `, { eval: true, workerData: { root: path.resolve(__dirname, '../dist'), platform } });
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(new Error('Worker failed: ' + code)); });
    })));
    for (const item of result) {
        assert.equal(item.version, `1.15.0.2_${item.platform}`);
        assert.equal(item.loginVersion, item.version);
        assert.equal(item.heartbeatVersion, item.version);
    }
    assert.equal(result[0].channel, 'other-qq');
    assert.equal(result[1].channel, 'other');
    assert.equal(result[0].host.appId, '1112386029');
    assert.equal(result[1].host.appId, 'wx5306c5978fdb76e4');
    assert.equal(result[1].host.deviceText, undefined);
    assert.equal(result[1].host.userDataPath, undefined);
    assert.notEqual(result[0].build.file, result[1].build.file);
    assert.notEqual(result[0].build.sha256, result[1].build.sha256);
});

test('saving or resetting connection settings never restarts live QQ or WeChat accounts', () => {
    const saved = config.getRuntimeConfig();
    try {
        const routes = new Map();
        const h = memoryStore(null);
        const { mountAccountRoutes } = load('controllers/admin/account-routes.js', { '../../models/store': h.store });
        let broadcasts = 0;
        mountAccountRoutes({ get() {}, post: (route, handler) => routes.set(route, handler), delete() {}, put() {} }, { provider: {
            getAccounts: () => ({ accounts: [{ id: 'qq' }, { id: 'wx' }] }),
            isAccountRunning: () => true,
            restartAccount: () => assert.fail('Must not replay a used Code or disconnect another platform'),
            broadcastConfig: () => broadcasts++,
        } });
        let response;
        const res = { json: value => { response = value; } };
        routes.get('/api/settings/system-config')({ body: { ...saved, wxClientVersion: 'wx-changed' } }, res);
        assert.equal(response.ok, true);
        assert.equal(response.data.saved.wxClientVersion, 'wx-changed');
        routes.get('/api/settings/system-config/reset')({}, res);
        assert.equal(response.ok, true);
        assert.equal(response.data.current.wxClientVersion, config.DEFAULT_WX_CLIENT_VERSION);
        assert.equal(broadcasts, 2);
    } finally { config.updateRuntimeConfig(saved); }
});
