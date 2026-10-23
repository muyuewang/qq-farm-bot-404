const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { WxLoginService } = require('../dist/services/wx-login/service');

test('WeChat confirm fetches user info and uses nick_name for the session nickname', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    const responses = [
        '{}',
        JSON.stringify({ code: 0, ext_info: { list_s: { login_buffer: { value: ['login-buffer'] } } } }),
        JSON.stringify({ code: 0, nick_name: 'wechat-nickname', head_img_url: 'https://example.test/avatar.jpg' }),
    ];

    global.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const body = responses.shift();
        assert.notEqual(body, undefined);
        return {
            status: 200,
            headers: new Headers(),
            arrayBuffer: async () => Buffer.from(body),
        };
    };

    try {
        const session = {
            cookies: new Map([
                ['openid', 'openid-value'],
                ['accesstoken', 'access-token-value'],
                ['refreshtoken', 'refresh-token-value'],
            ]),
            uuid: 'uuid',
            oauthCode: 'oauth-code',
        };

        await new WxLoginService().confirm(session);

        assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
            '/pc_yyb/pcyyb_oauth',
            '/pc_yyb_auth/pcyyb_get_wx_login_buffer_auth',
            '/pc_yyb/pcyyb_get_user_info',
        ]);
        assert.equal(session.nickname, 'wechat-nickname');
        const infoHeaders = calls[2].init.headers;
        const timestamp = infoHeaders.get('Ual-Access-Timestamp');
        const nonce = infoHeaders.get('Ual-Access-Nonce');
        assert.equal(infoHeaders.get('Ual-Access-Access-Token'), 'access-token-value');
        assert.equal(infoHeaders.get('Ual-Access-Openid'), 'openid-value');
        assert.equal(
            infoHeaders.get('Ual-Access-Signature'),
            crypto.createHash('md5').update(`${timestamp}${nonce}`).digest('hex'),
        );
    }
    finally {
        global.fetch = originalFetch;
    }
});
