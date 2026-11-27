const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWxCredentialStore } = require('../dist/services/wx-login/credential-store');
const { createWxKickoutRecoveryService } = require('../dist/runtime/wx-kickout-recovery');
const {
    DEFAULT_WX_KICKOUT_RELOGIN,
    normalizeWxKickoutRelogin,
    resolveKickoutDelayMs,
    isCustomDelayActive,
    isReloginBudgetExhausted,
} = require('../dist/services/wx-login/reconnect-config');

const NOW = 1_730_000_000_000;
const MINUTE = 60_000;

function fakeScheduler(nowRef) {
    const tasks = new Map();
    return {
        tasks,
        setTimeoutTask(name, delay, fn) {
            tasks.set(name, { name, delay, fn, nextRunAt: nowRef.value + delay });
            return { name };
        },
        clear(name) {
            return tasks.delete(name);
        },
        has(name) {
            return tasks.has(name);
        },
        getSnapshot() {
            return {
                tasks: [...tasks.values()].map(task => ({
                    name: task.name,
                    delayMs: task.delay,
                    nextRunAt: task.nextRunAt,
                })),
            };
        },
        getDelay(name) {
            return tasks.get(name)?.delay;
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
    };
}

function createHarness(options = {}) {
    const nowRef = { value: NOW };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-recovery-'));
    const filePath = path.join(dir, 'data', 'wx-credentials.json');
    const credentialStore = createWxCredentialStore({ filePath, now: () => nowRef.value });
    const accounts = [{ id: '1', name: '微信一号', code: 'old-code', platform: 'wx' }];
    const settings = {
        wxKickoutRelogin: {
            ...DEFAULT_WX_KICKOUT_RELOGIN,
            ...(options.settings || {}),
        },
    };
    const logs = [];
    const issued = [];
    const refreshed = [];
    const started = [];
    let running = false;
    const scheduler = fakeScheduler(nowRef);
    const store = {
        getAccounts: () => ({ accounts: accounts.map(account => ({ ...account })) }),
        addOrUpdateAccount: patch => {
            const account = accounts.find(item => item.id === String(patch.id));
            if (account) Object.assign(account, patch);
            return { accounts: accounts.map(item => ({ ...item })) };
        },
        getLoginSettings: () => JSON.parse(JSON.stringify(settings)),
    };
    const defaultIssueCode = async (loginBuffer, appId) => {
        issued.push({ loginBuffer, appId });
        return `new-code-${issued.length}`;
    };
    const defaultRefresh = async (credential, refreshOptions = {}) => {
        refreshed.push(credential.loginBuffer);
        const checkpoint = {
            ...credential,
            loginBuffer: 'lb2',
            refreshToken: 'rt2',
            accessToken: 'at2',
            expiresAt: nowRef.value + 7200 * 1000,
            expiresIn: 7200,
            observedAt: nowRef.value,
            rotated: true,
        };
        if (typeof refreshOptions.onCredentialsRefreshed === 'function') {
            await refreshOptions.onCredentialsRefreshed(checkpoint);
        }
        return checkpoint;
    };
    credentialStore.set('1', {
        openid: 'openid-1',
        loginBuffer: 'lb1',
        refreshToken: 'rt1',
        accessToken: 'at1',
        loginType: 'WX',
        expiresAt: nowRef.value + (options.nearExpiry ? 10 * MINUTE : 7200 * MINUTE),
        expiresIn: options.nearExpiry ? 600 : 7200,
        observedAt: nowRef.value,
    });
    const issueCode = options.issueCodeImpl
        ? async (loginBuffer, appId) => {
            issued.push({ loginBuffer, appId });
            return options.issueCodeImpl(loginBuffer, appId);
        }
        : defaultIssueCode;
    const service = createWxKickoutRecoveryService({
        store,
        credentialStore,
        scheduler,
        now: () => nowRef.value,
        random: () => 0,
        isAccountRunning: () => running,
        startWorker: account => {
            started.push({ ...account });
            return options.startWorkerImpl ? options.startWorkerImpl(account) : true;
        },
        issueCode,
        refreshLoginBuffer: options.refreshLoginBufferImpl || defaultRefresh,
        log: () => {},
        addAccountLog: (action, msg, accountId, accountName, extra = {}) => {
            logs.push({ action, msg, accountId, accountName, extra });
        },
    });
    return {
        service,
        scheduler,
        store,
        settings,
        accounts,
        credentialStore,
        nowRef,
        logs,
        issued,
        refreshed,
        started,
        setRunning: value => { running = value; },
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
}

test('配置归一化、递增退避、有效期与每日预算', () => {
    const cfg = normalizeWxKickoutRelogin({ delayMinutes: 99999, dailyLimit: -3, validUntil: '   ' });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.delayMinutes, 4320);
    assert.equal(cfg.dailyLimit, 0);
    assert.equal(normalizeWxKickoutRelogin({ dailyLimit: 'bad' }).dailyLimit, 5);
    assert.deepEqual([
        resolveKickoutDelayMs(DEFAULT_WX_KICKOUT_RELOGIN, 0),
        resolveKickoutDelayMs(DEFAULT_WX_KICKOUT_RELOGIN, 1),
        resolveKickoutDelayMs(DEFAULT_WX_KICKOUT_RELOGIN, 2),
        resolveKickoutDelayMs(DEFAULT_WX_KICKOUT_RELOGIN, 3),
        resolveKickoutDelayMs(DEFAULT_WX_KICKOUT_RELOGIN, 9),
    ], [5 * MINUTE, 30 * MINUTE, 60 * MINUTE, 180 * MINUTE, 180 * MINUTE]);

    const custom = normalizeWxKickoutRelogin({
        delayMinutes: 17,
        validUntil: new Date(NOW + 60 * MINUTE).toISOString(),
    });
    assert.equal(isCustomDelayActive(custom, NOW), true);
    assert.equal(resolveKickoutDelayMs(custom, 0, NOW), 17 * MINUTE);
    assert.equal(isCustomDelayActive(custom, NOW + 61 * MINUTE), false);
    assert.equal(isCustomDelayActive({ delayMinutes: 17, validUntil: '2026-11-27T12:00' }, NOW), false);
    assert.equal(isReloginBudgetExhausted(DEFAULT_WX_KICKOUT_RELOGIN, { attempts: 5, failures: 0 }), true);
    assert.equal(isReloginBudgetExhausted(DEFAULT_WX_KICKOUT_RELOGIN, { attempts: 0, failures: 3 }), true);
    assert.equal(isReloginBudgetExhausted(normalizeWxKickoutRelogin({ dailyLimit: 0 }), { attempts: 99, failures: 99 }), false);
});

test('被踢后按默认退避排程，等待期只保活，到点换取新 Code 并启动账号', async t => {
    const h = createHarness();
    t.after(h.cleanup);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', { reason: '已在其他终端登录' }), true);
    assert.equal(h.scheduler.getDelay('relogin_1'), 5 * MINUTE);
    assert.equal(h.issued.length, 0);
    assert.equal(h.started.length, 0);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true);
    assert.equal(h.logs.some(entry => entry.action === 'kickout_relogin_scheduled'), true);

    await h.scheduler.run('relogin_1');
    assert.equal(h.issued.length, 1);
    assert.equal(h.issued[0].appId, 'wx5306c5978fdb76e4');
    assert.equal(h.accounts[0].code, 'new-code-1');
    assert.equal(h.started.length, 1);
    assert.equal(h.started[0].code, 'new-code-1');
    assert.equal(h.service.getStatus('1').attempts, 1);
    assert.equal(h.service.getStatus('1').failures, 0);
    assert.equal(h.credentialStore.get('1').lastSuccessAt, NOW);
    assert.equal(h.logs.some(entry => entry.action === 'auto_relogin'), true);
});

test('自定义延迟在有效期内生效，过期后回退默认退避', t => {
    const h = createHarness({
        settings: { delayMinutes: 17, validUntil: new Date(NOW + 60 * MINUTE).toISOString() },
    });
    t.after(h.cleanup);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    assert.equal(h.scheduler.getDelay('relogin_1'), 17 * MINUTE);
    h.service.onManualStop('1');
    assert.equal(h.scheduler.has('relogin_1'), false);
    h.nowRef.value += 61 * MINUTE;
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    assert.equal(h.scheduler.getDelay('relogin_1'), 5 * MINUTE);
});

test('临时失败受每日上限熔断；上限为 0 时继续按退避重试', async t => {
    const limited = createHarness({
        settings: { dailyLimit: 1 },
        issueCodeImpl: async () => { throw new Error('socket read timeout'); },
    });
    t.after(limited.cleanup);
    assert.equal(limited.service.onTerminalEvent('1', 'kickout', {}), true);
    await limited.scheduler.run('relogin_1');
    assert.equal(limited.issued.length, 1);
    assert.equal(limited.scheduler.has('relogin_1'), false);
    assert.equal(limited.logs.some(entry => entry.action === 'auto_relogin_blocked'), true);

    const unlimited = createHarness({
        settings: { dailyLimit: 0 },
        issueCodeImpl: async () => { throw new Error('socket read timeout'); },
    });
    t.after(unlimited.cleanup);
    assert.equal(unlimited.service.onTerminalEvent('1', 'kickout', {}), true);
    await unlimited.scheduler.run('relogin_1');
    assert.equal(unlimited.scheduler.has('relogin_1'), true);
    await unlimited.scheduler.run('relogin_1');
    assert.equal(unlimited.issued.length, 2);
    assert.equal(unlimited.scheduler.has('relogin_1'), true);
});

test('明确授权失效会阻断自动连回，重新扫码绑定后解除', async t => {
    const h = createHarness({
        issueCodeImpl: async () => { throw new Error('ManualAuth rejected: code=-101 credential response rejected'); },
    });
    t.after(h.cleanup);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    await h.scheduler.run('relogin_1');
    assert.equal(h.service.getStatus('1').blocked, true);
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(h.started.length, 0);

    h.credentialStore.set('1', {
        openid: 'openid-1',
        loginBuffer: 'lb-new',
        refreshToken: 'rt-new',
        accessToken: 'at-new',
        loginType: 'WX',
        expiresAt: h.nowRef.value + 7200 * MINUTE,
        expiresIn: 7200,
        observedAt: h.nowRef.value + 1,
    });
    const status = h.service.bindCredential('1');
    assert.equal(status.blocked, false);
    assert.equal(status.bound, true);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true);
});

test('手动停止取消排程，迟到换码结果不会覆盖账号或启动 Worker', async t => {
    const h = createHarness();
    t.after(h.cleanup);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    h.service.onManualStop('1');
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(await h.scheduler.run('relogin_1'), false);

    let markStarted;
    let resolveCode;
    const startedPromise = new Promise(resolve => { markStarted = resolve; });
    const codePromise = new Promise(resolve => { resolveCode = resolve; });
    const late = createHarness({
        issueCodeImpl: async () => {
            markStarted();
            return codePromise;
        },
    });
    t.after(late.cleanup);
    const pending = late.service.refreshAccountCode('1', 'kickout');
    await startedPromise;
    late.service.onManualStop('1');
    resolveCode('late-code');
    assert.equal(await pending, false);
    assert.equal(late.accounts[0].code, 'old-code');
    assert.equal(late.started.length, 0);
});

test('凭据临近过期先滚动长凭据，再用新 loginBuffer 换 Code', async t => {
    const h = createHarness({ nearExpiry: true });
    t.after(h.cleanup);
    assert.equal(await h.service.refreshAccountCode('1', 'kickout'), true);
    assert.equal(h.refreshed.length, 1);
    assert.equal(h.issued[0].loginBuffer, 'lb2');
    assert.equal(h.credentialStore.get('1').loginBuffer, 'lb2');
    assert.equal(h.credentialStore.get('1').refreshToken, 'rt2');
    assert.equal(h.started.length, 1);
});

test('并发换码只执行一次；服务端返回旧 Code 时绝不重放', async t => {
    let markStarted;
    let resolveCode;
    const startedPromise = new Promise(resolve => { markStarted = resolve; });
    const codePromise = new Promise(resolve => { resolveCode = resolve; });
    const secondHarness = createHarness({
        issueCodeImpl: async () => {
            markStarted();
            await codePromise;
            return 'fresh-code';
        },
    });
    t.after(secondHarness.cleanup);
    const p1 = secondHarness.service.refreshAccountCode('1', 'kickout');
    const p2 = secondHarness.service.refreshAccountCode('1', 'kickout');
    await startedPromise;
    resolveCode();
    assert.deepEqual(await Promise.all([p1, p2]), [true, true]);
    assert.equal(secondHarness.issued.length, 1);
    assert.equal(secondHarness.started.length, 1);

    const replay = createHarness({ issueCodeImpl: async () => 'old-code' });
    t.after(replay.cleanup);
    assert.equal(await replay.service.refreshAccountCode('1', 'kickout'), false);
    assert.equal(replay.accounts[0].code, 'old-code');
    assert.equal(replay.started.length, 0);
    assert.equal(replay.logs.some(entry => entry.action === 'auto_relogin_failed'), true);
});

test('仅被踢/WS 400 触发；非微信、无凭据、普通断线和开关关闭都不排程', t => {
    const h = createHarness();
    t.after(h.cleanup);
    assert.equal(h.service.onTerminalEvent('1', 'disconnect', { source: 'heartbeat_timeout' }), false);
    assert.equal(h.service.onTerminalEvent('1', 'ws_400', { code: 400 }), true);
    h.service.onManualStop('1');

    h.accounts[0].platform = 'qq';
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), false);
    h.accounts[0].platform = 'wx';

    h.settings.wxKickoutRelogin.enabled = false;
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), false);
    h.settings.wxKickoutRelogin.enabled = true;

    h.credentialStore.delete('1');
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), false);
    assert.equal(h.scheduler.has('relogin_1'), false);
});

test('启动时只恢复长凭据保活；关闭开关只清除已排程任务', t => {
    const h = createHarness();
    t.after(h.cleanup);
    assert.equal(h.service.rescheduleAll(), 1);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true);
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(h.issued.length, 0);

    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    h.settings.wxKickoutRelogin.enabled = false;
    assert.equal(h.service.rescheduleAll(), 0);
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true);
});

test('启动前换 Code 不受自动连回开关和预算限制，也不启动 Worker', async t => {
    const h = createHarness({ settings: { enabled: false, dailyLimit: 1 } });
    t.after(h.cleanup);
    const account = await h.service.refreshCodeForStartup('1');
    assert.ok(account);
    assert.equal(account.code, 'new-code-1');
    assert.equal(h.issued.length, 1);
    assert.equal(h.started.length, 0);
    assert.equal(h.service.getStatus('1').attempts, 0);
});

test('启动前换 Code 对已阻断凭据直接跳过', async t => {
    const h = createHarness();
    t.after(h.cleanup);
    h.credentialStore.markBlocked('1');
    assert.equal(await h.service.refreshCodeForStartup('1'), null);
    assert.equal(h.issued.length, 0);
    assert.equal(h.started.length, 0);
});

test('启动前换 Code 并发只签发一次', async t => {
    let markStarted;
    let resolveCode;
    const startedPromise = new Promise(resolve => { markStarted = resolve; });
    const codePromise = new Promise(resolve => { resolveCode = resolve; });
    const h = createHarness({
        issueCodeImpl: async () => {
            markStarted();
            await codePromise;
            return 'fresh-startup-code';
        },
    });
    t.after(h.cleanup);
    const p1 = h.service.refreshCodeForStartup('1');
    const p2 = h.service.refreshCodeForStartup('1');
    await startedPromise;
    resolveCode();
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a.code, 'fresh-startup-code');
    assert.equal(b.code, 'fresh-startup-code');
    assert.equal(h.issued.length, 1);
    assert.equal(h.started.length, 0);
});

test('关闭开关会取消在途换码，不写回 Code 也不启动 Worker', async t => {
    let markIssued;
    let resolveCode;
    const issuedPromise = new Promise(resolve => { markIssued = resolve; });
    const codePromise = new Promise(resolve => { resolveCode = resolve; });
    const h = createHarness({
        issueCodeImpl: async () => {
            markIssued();
            return codePromise;
        },
    });
    t.after(h.cleanup);
    const pending = h.service.refreshAccountCode('1', 'kickout');
    await issuedPromise;
    h.settings.wxKickoutRelogin.enabled = false;
    assert.equal(h.service.rescheduleAll(), 0);
    resolveCode('late-code');
    assert.equal(await pending, false);
    assert.equal(h.accounts[0].code, 'old-code');
    assert.equal(h.started.length, 0);
    assert.equal(h.logs.some(entry => entry.action === 'auto_relogin_failed'), false);
});

test('手动停止只取消连回排程，仍保留长凭据保活', t => {
    const h = createHarness();
    t.after(h.cleanup);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    assert.equal(h.scheduler.has('relogin_1'), true);
    h.service.onManualStop('1');
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(h.scheduler.has('wx_keepalive_1'), true);
});

test('Worker 未真正停机时跳过恢复，不消耗预算反复重排', async t => {
    const h = createHarness();
    t.after(h.cleanup);
    h.setRunning(true);
    assert.equal(h.service.onTerminalEvent('1', 'kickout', {}), true);
    await h.scheduler.run('relogin_1');
    assert.equal(h.issued.length, 0);
    assert.equal(h.started.length, 0);
    assert.equal(h.scheduler.has('relogin_1'), false);
    assert.equal(h.service.getStatus('1').attempts, 0);
    assert.equal(h.logs.some(entry => entry.action === 'auto_relogin_skipped'), true);
});
