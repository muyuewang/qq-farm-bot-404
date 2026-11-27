import crypto from 'node:crypto';
import { getNativeWxLoginCode } from './native-protocol';
import type { WxCredentialCheckpoint, WxCredentialRefreshOptions, WxCredentialRefreshResult, WxCredentialSnapshot } from './types';

const { credentialResponseError } = require('./credential-errors');

const QR_CONNECT_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const QR_IMAGE_BASE = 'https://open.weixin.qq.com/connect/qrcode/';
const QR_POLL_URL = 'https://long.open.weixin.qq.com/connect/l/qrconnect';
const CALLBACK_URL = 'https://yybadaccess.3g.qq.com/pc_yyb/pcyyb_oauth';
const LOGIN_BUFFER_URL = 'https://yybadaccess.3g.qq.com/pc_yyb_auth/pcyyb_get_wx_login_buffer_auth';
const USER_INFO_URL = 'https://yybadaccess.3g.qq.com/pc_yyb/pcyyb_get_user_info';
const OAUTH_APP_ID = 'wxd44977328b36e647';
const USER_AGENT = 'Mozilla/5.0';
const LOGIN_BUFFER_ACCESS_KEY = 'wgrdg373hy26ww2';
const REFRESH_TOKEN_URL = 'https://yybadaccess.3g.qq.com/pc_yyb_auth/pcyyb_refresh_token_auth';
const DEFAULT_CREDENTIAL_EXPIRES_IN_SECONDS = 7200;

export type ScanStatus = 'waiting' | 'scanned' | 'authorized' | 'cancelled' | 'expired';

export interface WxLoginSession {
    cookies: Map<string, string>;
    uuid: string;
    oauthCode?: string;
    openid?: string;
    nickname?: string;
    loginBuffer?: string;
    refreshToken?: string;
    accessToken?: string;
    loginType?: string;
    expiresAt?: number;
    expiresIn?: number;
    observedAt?: number;
}

export class WxCredentialRefreshError extends Error {
    rotatedCredential?: WxCredentialCheckpoint;

    constructor(message: string, rotatedCredential?: WxCredentialCheckpoint) {
        super(message);
        this.name = 'WxCredentialRefreshError';
        this.rotatedCredential = rotatedCredential;
    }
}

interface HttpResult {
    status: number;
    body: Buffer;
    headers: Headers;
}

function cookieHeader(cookies: Map<string, string>): string {
    return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ');
}

function storeCookies(cookies: Map<string, string>, headers: Headers): void {
    const headerValue = headers.get('set-cookie');
    const values = typeof (headers as any).getSetCookie === 'function'
        ? (headers as any).getSetCookie()
        : headerValue ? [headerValue] : [];
    for (const value of values) {
        const pair = value.split(';', 1)[0].trim();
        const separator = pair.indexOf('=');
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
}

async function request(url: string, cookies: Map<string, string>, init: RequestInit = {}, timeout = 35_000): Promise<HttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        let currentUrl = url;
        let method = init.method || 'GET';
        let body = init.body;
        for (let redirects = 0; redirects <= 5; redirects++) {
            const headers = new Headers(init.headers);
            headers.set('User-Agent', USER_AGENT);
            if (cookies.size) headers.set('Cookie', cookieHeader(cookies));
            const response = await fetch(currentUrl, { ...init, method, body, headers, redirect: 'manual', signal: controller.signal });
            storeCookies(cookies, response.headers);
            const location = response.headers.get('location');
            if (response.status < 300 || response.status >= 400 || !location) {
                return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
            }
            currentUrl = new URL(location, currentUrl).toString();
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
                method = 'GET';
                body = undefined;
            }
        }
        throw new Error('Too many redirects while contacting WeChat');
    } finally {
        clearTimeout(timer);
    }
}

function requiredCookie(cookies: Map<string, string>, name: string): string {
    const value = cookies.get(name);
    if (!value) throw new Error(`WeChat OAuth callback did not provide ${name}`);
    return value;
}

function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function positiveSeconds(value: unknown, fallback = DEFAULT_CREDENTIAL_EXPIRES_IN_SECONDS): number {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickLoginBuffer(data: unknown): string {
    const source = asRecord(data);
    const snake = asRecord(asRecord(asRecord(source.ext_info).list_s).login_buffer).value;
    const camel = asRecord(asRecord(asRecord(source.extInfo).listS).loginBuffer).value;
    const value = (Array.isArray(snake) ? snake[0] : undefined) || (Array.isArray(camel) ? camel[0] : undefined) || '';
    return typeof value === 'string' ? value : '';
}

export function getWxCredentialSnapshot(session: WxLoginSession): WxCredentialSnapshot {
    const openid = String(session?.openid || '').trim();
    const loginBuffer = String(session?.loginBuffer || '').trim();
    if (!openid || !loginBuffer) throw new Error('WeChat login credential is incomplete');
    const expiresIn = positiveSeconds(session.expiresIn);
    return {
        openid,
        loginBuffer,
        refreshToken: String(session.refreshToken || '').trim(),
        accessToken: String(session.accessToken || '').trim(),
        loginType: String(session.loginType || 'WX').trim() || 'WX',
        expiresAt: Number(session.expiresAt) || Date.now() + expiresIn * 1000,
        expiresIn,
        observedAt: Number(session.observedAt) || Date.now(),
    };
}

function cookieHeaderValue(value: unknown): string {
    return String(value || '').replace(/[\r\n;]/g, '');
}

/**
 * Keep the OAuth callback parser as a fallback. The authoritative profile is
 * fetched from pcyyb_get_user_info after the login buffer is issued.
 */
function extractNickname(body: Buffer): string | undefined {
    let callbackData: unknown;
    try {
        callbackData = JSON.parse(body.toString('utf8'));
    } catch {
        return undefined;
    }

    if (!callbackData || typeof callbackData !== 'object') return undefined;
    let userInfo = (callbackData as Record<string, unknown>).user_info;
    if (typeof userInfo === 'string') {
        try {
            userInfo = JSON.parse(userInfo);
        } catch {
            return undefined;
        }
    }
    if (!userInfo || typeof userInfo !== 'object') return undefined;

    const info = userInfo as Record<string, unknown>;
    for (const key of ['nickname', 'nick_name', 'nickName']) {
        const value = info[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function extractUserInfoNickname(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const info = data as Record<string, unknown>;
    for (const key of ['nick_name', 'nickname', 'nickName']) {
        const value = info[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    // Some responses wrap the profile in user_info; the Go endpoint normally
    // returns nick_name at the top level, but accepting both keeps parsing
    // compatible with deployed response variants.
    let nested = info.user_info;
    if (typeof nested === 'string') {
        try {
            nested = JSON.parse(nested);
        } catch {
            nested = undefined;
        }
    }
    return extractUserInfoNickname(nested);
}

async function fetchUserInfo(
    cookies: Map<string, string>,
    openid: string,
    accessToken: string,
): Promise<unknown> {
    const timestamp = String(Date.now());
    const nonce = String(crypto.randomInt(0, 10000));
    const requestId = String(crypto.randomInt(1000, 10000));
    const signature = crypto.createHash('md5').update(`${timestamp}${nonce}`).digest('hex');
    const response = await request(USER_INFO_URL, cookies, {
        headers: {
            'Ual-Access-Access-Token': accessToken,
            'Ual-Access-Login-Type': '2',
            'Ual-Access-Openid': openid,
            'Ual-Access-Businessid': 'pc_yyb',
            'Ual-Access-Guid': 'web',
            'Ual-Access-Nonce': nonce,
            'Ual-Access-Requestid': requestId,
            'Ual-Access-Signature': signature,
            'Ual-Access-Timestamp': timestamp,
        },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Unable to obtain WeChat user info (HTTP ${response.status})`);
    }
    return JSON.parse(response.body.toString('utf8'));
}

export class WxLoginService {
    async createQrSession(): Promise<{ session: WxLoginSession; qr: Buffer }> {
        const cookies = new Map<string, string>();
        const params = new URLSearchParams({
            appid: OAUTH_APP_ID,
            redirect_uri: `${CALLBACK_URL}?login_type=WX`,
            response_type: 'code',
            scope: 'snsapi_login,snsapi_runtime_pcsdk',
            state: 'web',
            fast_login: '1',
            self_redirect: 'true',
        });
        const page = await request(`${QR_CONNECT_URL}?${params}`, cookies);
        if (page.status < 200 || page.status >= 300) throw new Error(`Unable to create WeChat QR session (HTTP ${page.status})`);
        const uuid = /\/connect\/qrcode\/([^"'>\s]+)/.exec(page.body.toString('utf8'))?.[1];
        if (!uuid) throw new Error('Unable to parse the WeChat QR session');
        const qr = await request(`${QR_IMAGE_BASE}${encodeURIComponent(uuid)}`, cookies);
        if (qr.status < 200 || qr.status >= 300) throw new Error(`Unable to download WeChat QR image (HTTP ${qr.status})`);
        return { session: { cookies, uuid }, qr: qr.body };
    }

    async poll(session: WxLoginSession): Promise<ScanStatus> {
        if (session.oauthCode) return 'authorized';
        const params = new URLSearchParams({ uuid: session.uuid, _: String(Date.now()) });
        const response = await request(`${QR_POLL_URL}?${params}`, session.cookies, {}, 35_000);
        if (response.status < 200 || response.status >= 300) throw new Error(`WeChat QR polling failed (HTTP ${response.status})`);
        const body = response.body.toString('utf8');
        const errcode = /wx_errcode\s*=\s*(\d+)/.exec(body)?.[1];
        if (errcode === '408') return 'waiting';
        if (errcode === '404') return 'scanned';
        if (errcode === '403') return 'cancelled';
        if (errcode === '402') return 'expired';
        if (errcode === '405') {
            const code = /wx_code\s*=\s*'([^']+)'/.exec(body)?.[1];
            if (!code) throw new Error('WeChat authorization response did not include a code');
            session.oauthCode = code;
            return 'authorized';
        }
        throw new Error('Unrecognized WeChat QR polling response');
    }

    async confirm(session: WxLoginSession): Promise<{ openid: string; loginBuffer: string; credential: WxCredentialSnapshot }> {
        if (!session.oauthCode) throw new Error('Waiting for scan authorization');
        const params = new URLSearchParams({ login_type: 'WX', code: session.oauthCode, state: 'web' });
        const callback = await request(`${CALLBACK_URL}?${params}`, session.cookies);
        if (callback.status < 200 || callback.status >= 400) throw new Error(`WeChat authorization callback failed (HTTP ${callback.status})`);
        const nickname = extractNickname(callback.body);
        const openid = requiredCookie(session.cookies, 'openid');
        const accessToken = requiredCookie(session.cookies, 'accesstoken');
        const refreshToken = session.cookies.get('refreshtoken') || '';
        const loginType = session.cookies.get('logintype') || 'WX';
        const expiresIn = positiveSeconds(session.cookies.get('expires_in'));
        const expiresAt = Date.now() + expiresIn * 1000;
        const payload = JSON.stringify({ extInfo: { listS: { unionid: { value: [openid] }, user_id: { value: [openid] }, access_token: { value: [accessToken] } }, listI: { user_type: { value: [0] } } } });
        const timestamp = String(Date.now());
        const nonce = String(crypto.randomInt(1000, 10000));
        const signature = crypto.createHash('md5').update(`${payload}${timestamp}${LOGIN_BUFFER_ACCESS_KEY}${nonce}`).digest('hex');
        const response = await request(LOGIN_BUFFER_URL, session.cookies, {
            method: 'POST', body: payload,
            headers: { 'Content-Type': 'application/json', 'Ual-Access-Businessid': 'pc_yyb_auth', 'Ual-Access-Timestamp': timestamp, 'Ual-Access-Nonce': nonce, 'Ual-Access-Signature': signature },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`Unable to obtain WeChat login buffer (HTTP ${response.status})`);
        const data = JSON.parse(response.body.toString('utf8'));
        const loginBuffer = data?.code === 0 ? pickLoginBuffer(data) : '';
        if (!loginBuffer) throw credentialResponseError('login_buffer', data);
        let userInfoNickname: string | undefined;
        try {
            const userInfo = await fetchUserInfo(session.cookies, openid, accessToken);
            userInfoNickname = extractUserInfoNickname(userInfo);
        } catch {
            // The Go implementation treats profile lookup as best effort.
        }
        session.cookies.clear();
        session.openid = openid;
        session.nickname = userInfoNickname || nickname;
        session.loginBuffer = loginBuffer;
        session.refreshToken = refreshToken;
        session.accessToken = accessToken;
        session.loginType = loginType;
        session.expiresIn = expiresIn;
        session.expiresAt = expiresAt;
        session.observedAt = Date.now();
        return { openid, loginBuffer, credential: getWxCredentialSnapshot(session) };
    }

    async issueCode(session: WxLoginSession | Pick<WxCredentialSnapshot, 'loginBuffer'>, appId: string): Promise<string> {
        if (!session.loginBuffer) throw new Error('WeChat login session has not been confirmed');
        return getNativeWxLoginCode(session.loginBuffer, appId);
    }

    /**
     * 用持久化 refresh token 滚动长凭据。上游轮换成功后，即使随后换 loginBuffer 失败，
     * 调用方也必须通过 onCredentialsRefreshed 或 rotatedCredential 保存新 token。
     */
    async refreshLoginBuffer(credential: WxCredentialSnapshot, options: WxCredentialRefreshOptions = {}): Promise<WxCredentialRefreshResult> {
        const openid = String(credential?.openid || '').trim();
        const refreshToken = String(credential?.refreshToken || '').trim();
        if (!openid || !refreshToken) throw new Error('缺少刷新凭证（refreshtoken），请重新扫码登录');
        const accessToken = String(credential?.accessToken || '').trim();
        const loginType = String(credential?.loginType || 'WX').trim() || 'WX';
        const refreshCookies = new Map<string, string>();
        const payload = JSON.stringify({
            userInfo: { openId: openid, refreshToken, accessToken, loginType },
        });
        const timestamp = String(Date.now());
        const nonce = String(crypto.randomInt(1000, 10000));
        const signature = crypto.createHash('md5').update(`${payload}${timestamp}${LOGIN_BUFFER_ACCESS_KEY}${nonce}`).digest('hex');
        const response = await request(REFRESH_TOKEN_URL, refreshCookies, {
            method: 'POST', body: payload,
            headers: {
                'Content-Type': 'application/json',
                'Ual-Access-Businessid': 'pc_yyb_auth',
                'Ual-Access-Timestamp': timestamp,
                'Ual-Access-Nonce': nonce,
                'Ual-Access-Signature': signature,
                'Cookie': `openid=${cookieHeaderValue(openid)}; accesstoken=${cookieHeaderValue(accessToken)}; refreshtoken=${cookieHeaderValue(refreshToken)}`,
            },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`Unable to refresh WeChat token (HTTP ${response.status})`);
        const data = asRecord(JSON.parse(response.body.toString('utf8')));
        if (data.code !== 0) throw credentialResponseError('refresh_token', data);
        const info = asRecord(data.user_info || data.userInfo || asRecord(data.data).user_info || asRecord(data.data).userInfo);
        const nextAccessToken = String(info.access_token || info.accessToken || info.accesstoken || '');
        const nextRefreshToken = String(info.refresh_token || info.refreshToken || info.refreshtoken || refreshToken);
        if (!nextAccessToken) throw new Error('WeChat refresh_token failed: response missing access_token');
        // 上游可能把 expires_in 报成 0/空串：只在取到正数时采用，且必须优先同级 expiresIn，
        // 否则 0 会被 || 吞掉后错误地沿用更长的旧有效期。
        const rawExpiresIn = info.expires_in ?? info.expiresIn;
        const reportedExpiresIn = Number.parseInt(String(rawExpiresIn ?? ''), 10);
        const expiresIn = Number.isFinite(reportedExpiresIn) && reportedExpiresIn > 0
            ? reportedExpiresIn
            : positiveSeconds(credential.expiresIn);
        const expiresAt = Date.now() + expiresIn * 1000;
        const checkpoint: WxCredentialCheckpoint = {
            openid,
            loginBuffer: String(credential.loginBuffer || ''),
            refreshToken: nextRefreshToken,
            accessToken: nextAccessToken,
            loginType,
            expiresAt,
            expiresIn,
            observedAt: Date.now(),
            rotated: nextRefreshToken !== refreshToken || nextAccessToken !== accessToken,
        };
        if (typeof options.onCredentialsRefreshed === 'function') {
            await options.onCredentialsRefreshed(checkpoint);
        }
        if (typeof options.shouldContinue === 'function' && !options.shouldContinue()) {
            throw new WxCredentialRefreshError('微信凭证刷新已取消', checkpoint);
        }
        const lbPayload = JSON.stringify({ extInfo: { listS: { unionid: { value: [openid] }, user_id: { value: [openid] }, access_token: { value: [nextAccessToken] } }, listI: { user_type: { value: [0] } } } });
        const ts2 = String(Date.now());
        const nonce2 = String(crypto.randomInt(1000, 10000));
        const sig2 = crypto.createHash('md5').update(`${lbPayload}${ts2}${LOGIN_BUFFER_ACCESS_KEY}${nonce2}`).digest('hex');
        try {
            const lbCookies = new Map<string, string>();
            const lbResponse = await request(LOGIN_BUFFER_URL, lbCookies, {
                method: 'POST', body: lbPayload,
                headers: {
                    'Content-Type': 'application/json',
                    'Ual-Access-Businessid': 'pc_yyb_auth',
                    'Ual-Access-Timestamp': ts2,
                    'Ual-Access-Nonce': nonce2,
                    'Ual-Access-Signature': sig2,
                    'Cookie': `openid=${cookieHeaderValue(openid)}; accesstoken=${cookieHeaderValue(nextAccessToken)}; refreshtoken=${cookieHeaderValue(nextRefreshToken)}`,
                },
            });
            if (lbResponse.status < 200 || lbResponse.status >= 300) throw new Error(`Unable to obtain WeChat login buffer (HTTP ${lbResponse.status})`);
            const lbData = asRecord(JSON.parse(lbResponse.body.toString('utf8')));
            const loginBuffer = lbData.code === 0 ? pickLoginBuffer(lbData) : '';
            if (!loginBuffer) throw credentialResponseError('login_buffer', lbData);
            return { ...checkpoint, loginBuffer, rotated: checkpoint.rotated };
        } catch (error: any) {
            throw new WxCredentialRefreshError(String(error?.message || 'Unable to refresh WeChat login buffer'), checkpoint);
        }
    }

    destroy(session: WxLoginSession): void {
        session.cookies.clear();
        session.oauthCode = undefined;
        session.openid = undefined;
        session.nickname = undefined;
        session.loginBuffer = undefined;
        session.refreshToken = undefined;
        session.accessToken = undefined;
        session.loginType = undefined;
        session.expiresAt = undefined;
        session.expiresIn = undefined;
        session.observedAt = undefined;
    }
}
