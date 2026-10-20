const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const {
    CONFIG,
    DEFAULT_CLIENT_VERSION,
    DEFAULT_WX_CLIENT_VERSION,
    getDefaultSystemConfig,
    getRuntimeConfig,
    resolveClientVersion,
    updateRuntimeConfig,
} = require('../src/config/config');
const { getClientVersion, isWechatPlatform } = require('../src/utils/client-profile');
const {
    MINI_PROGRAM_APP_IDS,
    TSDK_BUILDS,
    TsdkRuntime,
    resolveTsdkPlatform,
} = require('../src/utils/tsdk-runtime');

function withRuntimeConfig(overrides, run) {
    const previous = getRuntimeConfig();
    try {
        updateRuntimeConfig(overrides);
        return run();
    } finally {
        updateRuntimeConfig(previous);
        CONFIG.platform = previous.platform;
    }
}

test('each platform is measured against its own default version', () => {
    assert.equal(resolveClientVersion('1.14.0.4_20260911'), DEFAULT_CLIENT_VERSION);
    assert.equal(resolveClientVersion('1.14.0.4_20260911', 'wx'), DEFAULT_WX_CLIENT_VERSION);
    assert.equal(resolveClientVersion('1.16.0.0_20261201', 'qq'), '1.16.0.0_20261201');
    assert.equal(resolveClientVersion('1.16.0.0_20261201', 'wechat'), '1.16.0.0_20261201');
    assert.equal(resolveClientVersion('1.15.0.1_20261001', 'wx'), DEFAULT_WX_CLIENT_VERSION);
});

test('a version written for one platform never moves the other', () => {
    withRuntimeConfig({
        platform: 'qq',
        clientVersion: DEFAULT_CLIENT_VERSION,
        wxClientVersion: DEFAULT_WX_CLIENT_VERSION,
    }, () => {
        updateRuntimeConfig({ clientVersion: '1.16.0.0_20261201' });
        assert.equal(CONFIG.clientVersion, '1.16.0.0_20261201');
        assert.equal(CONFIG.wxClientVersion, DEFAULT_WX_CLIENT_VERSION);

        updateRuntimeConfig({ wxClientVersion: '1.17.0.0_20261201' });
        assert.equal(CONFIG.clientVersion, '1.16.0.0_20261201');
        assert.equal(CONFIG.wxClientVersion, '1.17.0.0_20261201');

        // 过期的抓包版本只会退回自己平台的默认值。
        updateRuntimeConfig({ clientVersion: '1.13.0.5_20260723', wxClientVersion: '1.14.0.4_20260911' });
        assert.equal(CONFIG.clientVersion, DEFAULT_CLIENT_VERSION);
        assert.equal(CONFIG.wxClientVersion, DEFAULT_WX_CLIENT_VERSION);
    });
});

test('the client version and platform flag resolve together', () => {
    withRuntimeConfig({
        platform: 'qq',
        clientVersion: '1.16.0.0_20261201',
        wxClientVersion: '1.17.0.0_20261201',
    }, () => {
        assert.equal(isWechatPlatform(), false);
        assert.equal(getClientVersion(), '1.16.0.0_20261201');
        CONFIG.platform = 'wechat';
        assert.equal(isWechatPlatform(), true);
        assert.equal(getClientVersion(), '1.17.0.0_20261201');
    });
});

test('an empty WeChat version falls back to the verified default', () => {
    withRuntimeConfig({ platform: 'wechat', clientVersion: DEFAULT_CLIENT_VERSION }, () => {
        updateRuntimeConfig({ wxClientVersion: '' });
        assert.equal(CONFIG.wxClientVersion, DEFAULT_WX_CLIENT_VERSION);
        assert.equal(getClientVersion(), DEFAULT_WX_CLIENT_VERSION);

        CONFIG.wxClientVersion = '';
        assert.equal(getClientVersion(), DEFAULT_WX_CLIENT_VERSION);
    });
});

test('the WeChat runtime selects its own WASM build and mini-program app id', () => {
    assert.notEqual(TSDK_BUILDS.qq.file, TSDK_BUILDS.wx.file);
    assert.notEqual(TSDK_BUILDS.qq.sha256, TSDK_BUILDS.wx.sha256);
    assert.equal(resolveTsdkPlatform('WeChat'), 'wx');
    assert.equal(resolveTsdkPlatform(undefined), 'qq');

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-platform-builds-'));
    try {
        for (const platform of ['qq', 'wx']) {
            const runtime = new TsdkRuntime({ accountId: platform, platform, dataDir });
            assert.equal(runtime.build, TSDK_BUILDS[platform]);
            assert.equal(runtime.appId, MINI_PROGRAM_APP_IDS[platform]);
            assert.equal(path.basename(runtime.wasmPath), TSDK_BUILDS[platform].file);
            assert.equal(runtime.getStatus().version, TSDK_BUILDS[platform].version);
            assert.ok(fs.existsSync(runtime.wasmPath), `${platform} wasm must ship with the runtime`);
        }
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('saving one platform version keeps the other stored value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-system-config-'));
    try {
        fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({
            systemConfig: {
                serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
                clientVersion: '1.15.0.9_20261001',
                wxClientVersion: '1.15.0.8_20261001',
                platform: 'qq',
                os: 'iOS',
            },
        }));
        const script = `
            const assert = require('node:assert/strict');
            const store = require('./src/models/store');
            const defaults = ${JSON.stringify(getDefaultSystemConfig())};
            // 旧版面板只提交 QQ 字段。
            store.setSystemConfig({ serverUrl: defaults.serverUrl, clientVersion: '1.16.1.1_20261101', platform: 'qq', os: 'iOS' });
            assert.equal(store.getSystemConfig().wxClientVersion, '1.15.0.8_20261001');
            store.setSystemConfig({ wxClientVersion: '1.16.2.2_20261101' });
            assert.equal(store.getSystemConfig().clientVersion, '1.16.1.1_20261101');
            assert.equal(store.getSystemConfig().serverUrl, defaults.serverUrl);
        `;
        execFileSync(process.execPath, ['-e', script], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, FARM_DATA_DIR: dir },
            stdio: 'pipe',
        });
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json')));
        assert.equal(saved.systemConfig.wxClientVersion, '1.16.2.2_20261101');
        assert.equal(saved.systemConfig.clientVersion, '1.16.1.1_20261101');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
