const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const { createDataProvider } = require('../dist/runtime/data-provider');
const { createAccountStartupService } = require('../dist/runtime/account-startup');

function load(file, overrides = {}) {
    const filename = path.resolve(__dirname, '../dist', file);
    const realRequire = createRequire(filename);
    const sandbox = {
        require: name => overrides[name] || realRequire(name),
        module: { exports: {} },
        exports: {},
        Buffer,
        process,
        console: { warn() {}, error() {} },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox.module.exports;
}

function createAccountsStore(initial) {
    let data = initial === undefined ? undefined : JSON.parse(JSON.stringify(initial));
    return load('models/store/accounts.js', {
        '../../config/runtime-paths': { ensureDataDir() {} },
        '../../services/json-db': {
            readJsonFileStrict: (_file, fallbackFactory) => (
                data === undefined ? fallbackFactory() : JSON.parse(JSON.stringify(data))
            ),
            writeJsonFileAtomic: (_file, value) => { data = JSON.parse(JSON.stringify(value)); },
            storageError: (action, file, cause) => new Error(`${action} ${file} failed: ${cause}`),
        },
        './shared-state': { ACCOUNTS_FILE: 'synthetic-accounts.json' },
        './account-config': { ensureAccountConfig() {}, removeAccountConfig() {} },
    });
}

test('accounts.json 持久化 autoStart，旧账号默认不启用且未知字段不落盘', () => {
    const initial = {
        accounts: [{ id: '1', name: 'legacy', code: 'old-code', platform: 'wx', bogus: 'drop-me' }],
        nextId: 2,
    };
    const store = createAccountsStore(initial);

    // 引入该字段前服务重启从不自动拉起账号；旧账号无此字段时默认 false，与历史行为一致。
    const normalized = store.normalizeAccountsData(initial);
    assert.equal(normalized.accounts[0].autoStart, false);
    assert.equal(normalized.accounts[0].bogus, undefined);

    store.addOrUpdateAccount({ id: '1', autoStart: true });
    assert.equal(store.loadAccounts().accounts[0].autoStart, true);

    store.addOrUpdateAccount({ name: 'new', code: 'new-code', platform: 'qq', bogus: 'drop-me' });
    const reloaded = store.loadAccounts();
    assert.equal(reloaded.accounts.length, 2);
    assert.equal(reloaded.accounts[0].autoStart, true);
    // 新账号未经手动启动，默认 false。
    assert.equal(reloaded.accounts[1].autoStart, false);
    assert.equal(reloaded.accounts[1].bogus, undefined);
});

test('启动恢复只拉起 autoStart 账号，微信账号先换 Code，QQ 账号沿用旧 Code', async () => {
    const accounts = [
        { id: '1', name: 'wx-on', code: 'stale-1', platform: 'wx', autoStart: true },
        { id: '2', name: 'qq-on', code: 'qq-code', platform: 'qq', autoStart: true },
        { id: '3', name: 'wx-off', code: 'stale-3', platform: 'wx', autoStart: false },
        { id: '4', name: 'wx-no-cred', code: 'stale-4', platform: 'wechat', autoStart: true },
        { id: '5', name: 'legacy-no-field', code: 'stale-5', platform: 'qq' },
    ];
    const started = [];
    const refreshed = [];
    const logs = [];
    const credentialStore = {
        describe: id => (id === '4'
            ? { bound: false, blocked: false, credentialReady: false }
            : { bound: true, blocked: false, credentialReady: true }),
    };
    const startup = createAccountStartupService({
        store: { getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }) },
        credentialStore,
        refreshCodeForStartup: async id => {
            refreshed.push(id);
            const account = accounts.find(item => item.id === id);
            return { ...account, code: `fresh-${id}` };
        },
        startWorker: account => {
            started.push(account);
            return true;
        },
        log: (tag, msg) => logs.push({ tag, msg }),
        addAccountLog: (action, msg) => logs.push({ action, msg }),
        concurrency: 1,
    });

    assert.equal(await startup.startPersistedAccounts(), 3);
    assert.deepEqual(refreshed, ['1']);
    // 缺少 autoStart 字段的旧账号不参与重启恢复。
    assert.deepEqual(started.map(account => account.id), ['1', '2', '4']);
    assert.equal(started[0].code, 'fresh-1');
    assert.equal(started[1].code, 'qq-code');
    // 未绑定长凭据的旧微信账号回退为沿用现有 Code，不能被静默跳过。
    assert.equal(started[2].code, 'stale-4');
    assert.equal(logs.some(entry => entry.action === 'startup_code_refresh_unavailable'), true);
    assert.equal(logs.some(entry => entry.tag === '警告'), true);

    const fresh = await startup.prepareAccountForStart('1', { freshCode: true });
    assert.equal(fresh.code, 'stale-1');
    assert.deepEqual(refreshed, ['1']);
});

test('手动启动/停止/重启写入 autoStart，并在启动前准备新 Code', async () => {
    const workers = {};
    const patches = [];
    const started = [];
    const restarted = [];
    const prepared = [];
    const manual = [];
    let accounts = [
        { id: '1', name: 'wx', code: 'stale-code', platform: 'wx', autoStart: false },
    ];
    const store = {
        getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }),
        addOrUpdateAccount: patch => {
            patches.push({ ...patch });
            const account = accounts.find(item => item.id === patch.id);
            if (account) Object.assign(account, patch);
        },
    };
    const provider = createDataProvider({
        workers,
        globalLogs: [],
        accountLogs: [],
        store,
        getAccounts: store.getAccounts,
        callWorkerApi: async () => null,
        buildDefaultStatus: () => ({}),
        normalizeStatusForPanel: data => data,
        filterLogs: list => list,
        addAccountLog: () => {},
        nextConfigRevision: () => 1,
        broadcastConfigToWorkers: () => {},
        buildConfigSnapshotForAccount: () => ({}),
        startWorker: account => {
            started.push({ ...account });
            workers[account.id] = { status: null };
            return true;
        },
        stopWorker: id => { delete workers[id]; },
        restartWorker: account => { restarted.push({ ...account }); },
        onManualStart: id => manual.push(`start:${id}`),
        onManualStop: id => manual.push(`stop:${id}`),
        prepareAccountForStart: async (id, options = {}) => {
            prepared.push({ id, options });
            const account = accounts.find(item => item.id === id);
            if (options.freshCode) return { ...account };
            account.code = `fresh-${id}`;
            return { ...account };
        },
    });

    assert.equal(await provider.startAccount('1'), true);
    assert.equal(patches.at(-1).autoStart, true);
    assert.equal(started.at(-1).code, 'fresh-1');
    assert.deepEqual(prepared.at(-1).options, { freshCode: false });

    assert.equal(provider.stopAccount('1'), true);
    assert.equal(patches.at(-1).autoStart, false);
    assert.equal(workers['1'], undefined);

    assert.equal(await provider.restartAccount('1'), true);
    assert.equal(patches.at(-1).autoStart, true);
    assert.equal(restarted.length, 1);
    // 重启同样要换成新 Code，不能重放旧 Code。
    assert.equal(restarted[0].code, 'fresh-1');

    assert.equal(await provider.startAccount('1', { freshCode: true }), true);
    assert.deepEqual(prepared.at(-1).options, { freshCode: true });
    assert.equal(started.at(-1).code, 'fresh-1');

    assert.equal(await provider.startAccount('missing'), false);
    assert.deepEqual(manual, ['start:1', 'stop:1', 'start:1', 'start:1']);
    assert.deepEqual(prepared.map(item => item.options.freshCode), [false, false, true]);
});

test('启动前准备失败时明确拒绝，且不写入启动状态', async () => {
    const workers = {};
    const started = [];
    const restarted = [];
    const patches = [];
    const manual = [];
    const accounts = [{ id: '1', name: 'wx', code: 'stale-code', platform: 'wx', autoStart: false }];
    const provider = createDataProvider({
        workers,
        globalLogs: [],
        accountLogs: [],
        store: {
            getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }),
            addOrUpdateAccount: patch => patches.push({ ...patch }),
        },
        getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }),
        callWorkerApi: async () => null,
        buildDefaultStatus: () => ({}),
        normalizeStatusForPanel: data => data,
        filterLogs: list => list,
        addAccountLog: () => {},
        nextConfigRevision: () => 1,
        broadcastConfigToWorkers: () => {},
        buildConfigSnapshotForAccount: () => ({}),
        startWorker: account => { started.push(account); return true; },
        stopWorker: () => {},
        restartWorker: account => { restarted.push({ ...account }); },
        onManualStart: id => manual.push(`start:${id}`),
        onManualStop: id => manual.push(`stop:${id}`),
        prepareAccountForStart: async () => null,
    });

    await assert.rejects(() => provider.startAccount('1'), /重新扫码/);
    assert.equal(started.length, 0);
    assert.equal(workers['1'], undefined);
    assert.equal(patches.length, 0, '失败时不能把账号标记为自动启动');
    assert.deepEqual(manual, [], '失败时不能提前取消已有的恢复排程');

    await assert.rejects(() => provider.restartAccount('1'), /重启前自动换 Code 失败/);
    assert.equal(restarted.length, 0);
    assert.equal(patches.length, 0);
    assert.deepEqual(manual, []);
});

test('未绑定长凭据的微信账号手动启动沿用现有 Code', async () => {
    const accounts = [{ id: '9', name: 'legacy-wx', code: 'manual-code', platform: 'wx', autoStart: false }];
    const logs = [];
    const startup = createAccountStartupService({
        store: { getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }) },
        credentialStore: { describe: () => ({ bound: false, blocked: false, credentialReady: false }) },
        refreshCodeForStartup: async () => { throw new Error('未绑定凭据时不应换码'); },
        startWorker: () => true,
        log: (tag, msg) => logs.push({ tag, msg }),
        addAccountLog: (action, msg) => logs.push({ action, msg }),
    });

    const prepared = await startup.prepareAccountForStart('9');
    assert.equal(prepared.code, 'manual-code');
    assert.equal(logs.some(entry => entry.action === 'startup_code_refresh_unavailable'), true);
    assert.equal(logs.some(entry => entry.tag === '警告'), true);
});
