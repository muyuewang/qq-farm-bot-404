const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWxCredentialStore } = require('../dist/services/wx-login/credential-store');
const { createCredentialHandoff, HANDOFF_TTL_MS } = require('../dist/services/wx-login/credential-handoff');
const { bindWxCredentialFromCode, forgetWxCredential, isWxPlatform } = require('../dist/services/wx-login/credential-binding');
const { WxLoginService, getWxCredentialSnapshot } = require('../dist/services/wx-login/service');
const {
    isDefinitiveWxCredentialError,
    sanitizeWxCredentialError,
    credentialResponseError,
} = require('../dist/services/wx-login/credential-errors');

function makeCredential(overrides = {}) {
    const now = 1_730_000_000_000;
    return {
        openid: 'openid-1',
        loginBuffer: 'lb1',
        refreshToken: 'rt1',
        accessToken: 'at1',
        loginType: 'WX',
        expiresAt: now + 7200 * 1000,
        expiresIn: 7200,
        observedAt: now,
        ...overrides,
    };
}

function jsonResponse(body, init = {}) {
    return {
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => Buffer.from(body),
        ...init,
    };
}

test('微信凭据以 0600 文件持久化，重新扫码后旧阻断自动解除', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-credential-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filePath = path.join(dir, 'data', 'wx-credentials.json');
    const store = createWxCredentialStore({ filePath, now: () => 1_730_000_000_000 });

    store.set('1', makeCredential());
    // Windows 的 ACL 文件系统不保留 Unix 权限位（chmod 后 mode 仍是 0o666），
    // 只有在 POSIX 文件系统上才能断言 0600/0700；Windows 上只校验文件已落盘。
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
    } else {
        assert.equal(fs.existsSync(filePath), true);
        assert.equal(fs.readFileSync(filePath, 'utf8').includes('loginBuffer'), true);
    }

    const reloaded = createWxCredentialStore({ filePath, now: () => 1_730_000_000_000 });
    assert.equal(reloaded.get('1').loginBuffer, 'lb1');
    assert.equal(reloaded.describe('1').credentialReady, true);
    assert.equal(JSON.stringify(reloaded.describe('1')).includes('lb1'), false);

    reloaded.markBlocked('1');
    assert.equal(reloaded.isBlocked('1'), true);
    reloaded.set('1', makeCredential({ loginBuffer: 'lb-new', observedAt: 1_730_000_100_000 }));
    assert.equal(reloaded.isBlocked('1'), false);

    assert.equal(forgetWxCredential('1', { credentialStore: reloaded }), true);
    assert.equal(reloaded.get('1'), null);
});

test('凭据交接只消费一次并按时过期，绑定时校验平台与 openid', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-handoff-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filePath = path.join(dir, 'wx-credentials.json');
    let now = 1_730_000_000_000;
    const credentialStore = createWxCredentialStore({ filePath, now: () => now });
    const credentialHandoff = createCredentialHandoff({ now: () => now });
    let accountPlatform = 'wx';
    const deps = {
        credentialStore,
        credentialHandoff,
        findAccount: () => ({ id: '1', platform: accountPlatform }),
    };
    const credential = makeCredential();

    assert.equal(credentialHandoff.register('one-time-code', credential), true);
    assert.equal(credentialHandoff.consume('one-time-code').loginBuffer, 'lb1');
    assert.equal(credentialHandoff.consume('one-time-code'), null);

    // 没有 refreshtoken 的凭据无法续期，不能报告「自动连回已就绪」。
    assert.equal(credentialHandoff.register('no-refresh-token', { ...credential, refreshToken: '' }), false);
    assert.equal(credentialHandoff.consume('no-refresh-token'), null);

    credentialHandoff.register('expired-code', credential);
    now += HANDOFF_TTL_MS + 1;
    assert.equal(credentialHandoff.consume('expired-code'), null);

    credentialHandoff.register('bound-code', credential);
    const status = bindWxCredentialFromCode('1', 'bound-code', { platform: 'wx', wxid: 'openid-1' }, deps);
    assert.equal(status.bound, true);
    assert.equal(credentialStore.get('1').loginBuffer, 'lb1');

    accountPlatform = 'qq';
    credentialHandoff.register('qq-code', credential);
    assert.equal(bindWxCredentialFromCode('1', 'qq-code', { platform: 'qq' }, deps), null);
    accountPlatform = 'wx';
    credentialHandoff.register('wrong-wxid-code', credential);
    assert.equal(bindWxCredentialFromCode('1', 'wrong-wxid-code', { platform: 'wx', wxid: 'openid-2' }, deps), null);

    assert.equal(isWxPlatform('wechat'), true);
    assert.equal(isWxPlatform('qq'), false);
});

test('confirm 保留 refresh token 与有效期，且仍能获取昵称', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const responses = [
        '{}',
        JSON.stringify({ code: 0, ext_info: { list_s: { login_buffer: { value: ['lb1'] } } } }),
        JSON.stringify({ code: 0, nick_name: 'wechat-nickname' }),
    ];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return jsonResponse(responses.shift());
    };
    try {
        const session = {
            cookies: new Map([
                ['openid', 'openid-1'],
                ['accesstoken', 'at1'],
                ['refreshtoken', 'rt1'],
                ['logintype', 'WX'],
                ['expires_in', '3600'],
            ]),
            uuid: 'uuid',
            oauthCode: 'oauth-code',
        };
        const result = await new WxLoginService().confirm(session);
        assert.equal(result.loginBuffer, 'lb1');
        assert.equal(result.credential.refreshToken, 'rt1');
        assert.equal(result.credential.accessToken, 'at1');
        assert.equal(result.credential.expiresIn, 3600);
        assert.ok(Math.abs(result.credential.expiresAt - (Date.now() + 3600 * 1000)) < 3000);
        assert.equal(session.nickname, 'wechat-nickname');
        assert.equal(getWxCredentialSnapshot(session).openid, 'openid-1');
        assert.equal(calls.length, 3);
        assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
            '/pc_yyb/pcyyb_oauth',
            '/pc_yyb_auth/pcyyb_get_wx_login_buffer_auth',
            '/pc_yyb/pcyyb_get_user_info',
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('refreshLoginBuffer 先保存轮换 token，再换新 loginBuffer', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const responses = [
        JSON.stringify({ code: 0, user_info: { access_token: 'at2', refresh_token: 'rt2', expires_in: 7200 } }),
        JSON.stringify({ code: 0, ext_info: { list_s: { login_buffer: { value: ['lb2'] } } } }),
    ];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return jsonResponse(responses.shift());
    };
    try {
        const checkpoints = [];
        const result = await new WxLoginService().refreshLoginBuffer(makeCredential(), {
            onCredentialsRefreshed: checkpoint => { checkpoints.push(checkpoint); },
        });
        assert.equal(result.loginBuffer, 'lb2');
        assert.equal(result.refreshToken, 'rt2');
        assert.equal(result.accessToken, 'at2');
        assert.equal(checkpoints.length, 1);
        assert.equal(checkpoints[0].refreshToken, 'rt2');
        assert.equal(calls[0].init.headers.get('Cookie').includes('refreshtoken=rt1'), true);
        assert.equal(calls[1].init.headers.get('Cookie').includes('refreshtoken=rt2'), true);
        assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
            '/pc_yyb_auth/pcyyb_refresh_token_auth',
            '/pc_yyb_auth/pcyyb_get_wx_login_buffer_auth',
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('loginBuffer 续期失败仍保留已轮换的凭据检查点', async () => {
    const originalFetch = globalThis.fetch;
    const responses = [
        JSON.stringify({ code: 0, user_info: { access_token: 'at2', refresh_token: 'rt2', expires_in: 7200 } }),
        JSON.stringify({ code: -101 }),
    ];
    globalThis.fetch = async () => jsonResponse(responses.shift());
    try {
        await assert.rejects(
            () => new WxLoginService().refreshLoginBuffer(makeCredential()),
            error => {
                assert.equal(error.rotatedCredential.refreshToken, 'rt2');
                assert.equal(error.rotatedCredential.accessToken, 'at2');
                assert.equal(isDefinitiveWxCredentialError(error.message), true);
                return true;
            },
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('明确授权失效与临时错误分类正确，日志不会回显 token', () => {
    assert.equal(isDefinitiveWxCredentialError('授权范围已失效，请重新扫码'), true);
    assert.equal(isDefinitiveWxCredentialError(credentialResponseError('refresh_token', { code: 40188 }).message), true);
    assert.equal(isDefinitiveWxCredentialError('code=-101 credential response rejected'), true);
    assert.equal(isDefinitiveWxCredentialError('code=-1 credential response rejected'), false);
    assert.equal(isDefinitiveWxCredentialError('socket read timeout'), false);
    assert.equal(sanitizeWxCredentialError('token=secret-value login_buffer=secret-buffer').includes('secret-value'), false);
});
