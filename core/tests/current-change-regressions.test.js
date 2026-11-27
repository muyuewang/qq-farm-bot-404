const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCredentialHandoff } = require('../dist/services/wx-login/credential-handoff');
const { bindWxCredentialFromCode } = require('../dist/services/wx-login/credential-binding');
const { createWxCredentialStore } = require('../dist/services/wx-login/credential-store');
const { createWxKickoutRecoveryService } = require('../dist/runtime/wx-kickout-recovery');
const { createDataProvider } = require('../dist/runtime/data-provider');
const { createAccountStartupService } = require('../dist/runtime/account-startup');
const { isDefinitiveWxCredentialError, shouldRefreshForCodeError } = require('../dist/services/wx-login/credential-errors');

const NOW = Date.parse('2026-11-26T20:00:00+08:00');
const CREDENTIAL = {
    openid: 'openid-1',
    loginBuffer: 'lb1',
    refreshToken: 'rt1',
    accessToken: 'at1',
    loginType: 'WX',
    expiresAt: NOW + 2 * 60 * 60 * 1000,
    expiresIn: 7200,
    observedAt: NOW,
};

function defer() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function ticks(count = 4) {
    for (let i = 0; i < count; i += 1) await new Promise(resolve => setImmediate(resolve));
}

function fakeScheduler() {
    const tasks = new Map();
    const setCounts = new Map();
    return {
        setTimeoutTask(name, delay, fn) {
            setCounts.set(name, (setCounts.get(name) || 0) + 1);
            tasks.set(name, { name, delay, fn, nextRunAt: NOW + delay });
            return { name };
        },
        clear(name) {
            return tasks.delete(name);
        },
        has(name) {
            return tasks.has(name);
        },
        getSnapshot() {
            return { tasks: [...tasks.values()].map(task => ({ name: task.name, nextRunAt: task.nextRunAt })) };
        },
        async run(name) {
            const task = tasks.get(name);
            if (!task) return false;
            try {
                await task.fn();
            } finally {
                if (tasks.get(name) === task) tasks.delete(name);
            }
            return true;
        },
        setCount(name) {
            return setCounts.get(name) || 0;
        },
    };
}

function createRecoveryHarness(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-review-recovery-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const credentialStore = createWxCredentialStore({
        filePath: path.join(dir, 'data', 'wx-credentials.json'),
        now: () => NOW,
    });
    credentialStore.set('1', CREDENTIAL);
    const accounts = [{ id: '1', name: '微信一号', code: 'old-code', platform: 'wx' }];
    const settings = {
        wxKickoutRelogin: {
            enabled: true,
            delayMinutes: 0,
            dailyLimit: 5,
            validUntil: '',
        },
    };
    const store = {
        getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }),
        getLoginSettings: () => settings,
        addOrUpdateAccount: patch => {
            Object.assign(accounts[0], patch);
        },
    };
    const scheduler = fakeScheduler();
    const issued = [];
    const issueCode = options.issueCode || (async (loginBuffer, appId) => {
        issued.push({ loginBuffer, appId });
        return 'fresh-code';
    });
    const refreshLoginBuffer = async (credential, refreshOptions = {}) => {
        const checkpoint = {
            ...credential,
            loginBuffer: 'lb2',
            refreshToken: 'rt2',
            accessToken: 'at2',
            expiresAt: NOW + 2 * 60 * 60 * 1000,
            observedAt: NOW,
            rotated: true,
        };
        if (typeof refreshOptions.onCredentialsRefreshed === 'function') {
            await refreshOptions.onCredentialsRefreshed(checkpoint);
        }
        if (typeof refreshOptions.shouldContinue === 'function' && !refreshOptions.shouldContinue()) {
            throw new Error('微信凭证刷新已取消');
        }
        return checkpoint;
    };
    const service = createWxKickoutRecoveryService({
        store,
        credentialStore,
        scheduler,
        now: () => NOW,
        random: () => 0,
        isAccountRunning: () => false,
        startWorker: () => true,
        issueCode,
        refreshLoginBuffer,
        log: () => {},
        addAccountLog: () => {},
    });
    return { accounts, settings, scheduler, issued, service, credentialStore };
}

function createProviderHarness() {
    const accounts = [{ id: '1', name: '微信一号', code: 'old-code', platform: 'wx', autoStart: false }];
    const workers = {};
    const patches = [];
    const started = [];
    const manual = [];
    const gate = defer();
    const store = {
        getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }),
        addOrUpdateAccount: patch => {
            patches.push({ ...patch });
            Object.assign(accounts[0], patch);
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
        restartWorker: () => {},
        onManualStart: id => manual.push(`start:${id}`),
        onManualStop: id => manual.push(`stop:${id}`),
        prepareAccountForStart: async () => {
            await gate.promise;
            return { ...accounts[0] };
        },
    });
    return { provider, patches, started, workers, manual, gate };
}

test('凭据绑定校验失败时不得消费 handoff，且写盘失败可重试', t => {
    const handoff = createCredentialHandoff({ now: () => NOW });
    handoff.register('code-wxid', CREDENTIAL);
    const originalConsume = handoff.consume.bind(handoff);
    let consumed = 0;
    handoff.consume = code => {
        consumed += 1;
        return originalConsume(code);
    };
    const store = {
        set: () => false,
        describe: () => ({ bound: true }),
    };
    const findAccount = () => ({ id: '1', platform: 'wx' });

    assert.equal(bindWxCredentialFromCode('1', 'code-wxid', { platform: 'wx', wxid: 'another-openid' }, {
        credentialHandoff: handoff,
        credentialStore: store,
        findAccount,
    }), null);
    assert.equal(consumed, 0);
    assert.ok(handoff.consume('code-wxid'));

    const retryHandoff = createCredentialHandoff({ now: () => NOW });
    retryHandoff.register('code-write', CREDENTIAL);
    const retryConsume = retryHandoff.consume.bind(retryHandoff);
    let retryConsumed = 0;
    retryHandoff.consume = code => {
        retryConsumed += 1;
        return retryConsume(code);
    };
    assert.equal(bindWxCredentialFromCode('1', 'code-write', { platform: 'wx', wxid: CREDENTIAL.openid }, {
        credentialHandoff: retryHandoff,
        credentialStore: store,
        findAccount,
    }), null);
    assert.equal(retryConsumed, 0);
    assert.ok(retryHandoff.consume('code-write'));
});

test('平台校验必须读取持久化账号，缺失 payload.platform 时不得绑定到 QQ 账号', () => {
    const handoff = createCredentialHandoff({ now: () => NOW });
    handoff.register('code-platform', CREDENTIAL);
    let stored = 0;
    const store = {
        set: () => { stored += 1; return true; },
        describe: () => ({ bound: true }),
    };
    const result = bindWxCredentialFromCode('1', 'code-platform', { wxid: CREDENTIAL.openid }, {
        credentialHandoff: handoff,
        credentialStore: store,
        findAccount: () => ({ id: '1', platform: 'qq' }),
    });
    assert.equal(result, null);
    assert.equal(stored, 0);
    assert.ok(handoff.consume('code-platform'));
});

test('handoff 淘汰 pending 时必须通知调用方，不能静默丢凭据', () => {
    let evicted = 0;
    const handoff = createCredentialHandoff({ now: () => 0, onEvicted: count => { evicted += count; } });
    for (let i = 0; i < 70; i += 1) {
        assert.equal(handoff.register(`code-${i}`, CREDENTIAL), true);
    }
    assert.ok(evicted > 0, 'expected onEvicted to report silently dropped credential handoffs');
});

test('自动连回与启动前换 Code 必须共享 singleflight，不能并发签发两次 Code', async t => {
    const gate = defer();
    const h = createRecoveryHarness(t, {
        issueCode: async (loginBuffer, appId) => {
            h.issued.push({ loginBuffer, appId });
            await gate.promise;
            return 'fresh-code';
        },
    });
    const p1 = h.service.refreshAccountCode('1', 'kickout');
    const p2 = h.service.refreshCodeForStartup('1');
    await ticks(6);
    assert.equal(h.issued.length, 1, 'expected exactly one Code issuance for both recovery paths');
    gate.resolve();
    await Promise.all([p1, p2]);
    assert.equal(h.accounts[0].code, 'fresh-code');
});

test('启动前换 Code 在途时，新的 kickout 不得重复排程', async t => {
    const gate = defer();
    const h = createRecoveryHarness(t, {
        issueCode: async () => {
            h.issued.push({ loginBuffer: 'lb1' });
            await gate.promise;
            return 'fresh-code';
        },
    });
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    const runPromise = h.scheduler.run('relogin_1');
    await ticks(6);
    assert.ok(h.issued.length >= 1);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    gate.resolve();
    await runPromise;
    assert.equal(h.scheduler.setCount('relogin_1'), 1, 'expected only one relogin timer while refresh is in flight');
});

test('关闭自动连回开关只取消恢复排程，长凭据保活必须继续', t => {
    const h = createRecoveryHarness(t);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true);
    assert.equal(h.scheduler.has('relogin_1'), true);
    h.settings.wxKickoutRelogin.enabled = false;
    assert.equal(h.service.rescheduleAll(), 0);
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true, 'keepalive must survive config disable');
});

test('手动停止与启动前换 Code 并发时，启动结果不得覆盖停止意图', async () => {
    const h = createProviderHarness();
    const starting = h.provider.startAccount('1');
    assert.equal(h.provider.stopAccount('1'), true);
    h.gate.resolve();
    await starting;
    assert.equal(h.patches.at(-1).autoStart, false);
    assert.equal(h.started.length, 0);
    assert.equal(h.workers['1'], undefined);
});

test('启动恢复支持有限并发，不能串行等待所有微信换码', async () => {
    const gates = [0, 1, 2, 3].map(() => defer());
    let active = 0;
    let maxActive = 0;
    const accounts = [1, 2, 3, 4].map(id => ({ id: String(id), name: `wx-${id}`, platform: 'wx', code: `old-${id}`, autoStart: true }));
    const startup = createAccountStartupService({
        store: { getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }) },
        credentialStore: { describe: () => ({ bound: true, blocked: false, credentialReady: true }) },
        refreshCodeForStartup: async id => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await gates[Number(id) - 1].promise;
            active -= 1;
            return { ...accounts[Number(id) - 1], code: `fresh-${id}` };
        },
        startWorker: () => true,
        log: () => {},
        addAccountLog: () => {},
        concurrency: 2,
    });
    const started = startup.startPersistedAccounts();
    await ticks(6);
    assert.equal(maxActive, 2, 'expected bounded startup concurrency');
    gates.forEach(gate => gate.resolve());
    assert.equal(await started, 4);
});

test('微信错误分类保持 evolution 语义：-101 definitive，ManualAuth 可先续期重试', () => {
    assert.equal(isDefinitiveWxCredentialError('WeChat refresh_token failed: code=-101 credential response rejected'), true);
    assert.equal(shouldRefreshForCodeError('ManualAuth rejected: code=-101 message=expired'), true);
    assert.equal(isDefinitiveWxCredentialError('WeChat login_buffer failed: code=-1 credential response rejected'), false);
});
