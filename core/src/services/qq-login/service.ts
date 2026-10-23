import type { LoginSettings } from '../../types/config';
export {};

const axios = require('axios').default;
const store = require('../../models/store');

const QQ_MINIAPP_APP_ID = '1112386029';
const REQUEST_TIMEOUT_MS = 120_000;

export type QqLoginTaskStatus
    = 'waiting_scan'
    | 'scanned'
    | 'confirmed'
    | 'cancelled'
    | 'expired'
    | 'failed';

export interface QqLoginTask {
    taskId: string;
    status: QqLoginTaskStatus;
    qrImage: string;
    expiresAt: number;
}

export interface QqMiniappLoginResult {
    code: string;
    nickname?: string;
}

function loginSettings(): LoginSettings {
    const settings = store.getLoginSettings();
    if (!settings?.qqQrLogin)
        throw new Error('QQ扫码登录未开启');
    if (!settings.napCatEndpoint || !settings.napCatSignature)
        throw new Error('请先配置 NapCat 接口地址和接口签名');
    return settings;
}

function apiUrl(endpoint: string, path: string): string {
    return `${endpoint.replace(/\/+$/, '')}${path}`;
}

function napCatErrorMessage(data: any): string {
    const errorCode = String(data?.code || '').trim().toUpperCase();
    switch (errorCode) {
        case 'SIGNATURE_REQUIRED':
            return 'NapCat 接口签名缺失，请检查配置';
        case 'INVALID_SIGNATURE':
            return 'NapCat 接口签名无效，请检查配置';
        case 'WORKFLOW_BUSY':
            return 'NapCat 登录工作流繁忙，请稍后重试';
        case 'LOGIN_REQUIRED':
            return 'QQ 登录尚未确认，请先完成扫码确认';
        case 'LOGOUT_REQUIRED':
            return '上一位 QQ 登录尚未注销，请稍后重试';
        case 'TASK_EXPIRED':
            return 'QQ 登录任务已过期，请重新获取二维码';
        default:
            return `NapCat 接口返回失败${errorCode ? `（${errorCode}）` : ''}`;
    }
}

function normalizeTask(raw: any): QqLoginTask {
    const task = (raw?.task && typeof raw.task === 'object') ? raw.task : {};
    const taskId = String(task.id || '').trim();
    const status = String(task.status || '').trim() as QqLoginTaskStatus;
    const qrImage = String(task.qrImage || '').trim();
    const expiresAt = Number(task.expiresAt);
    if (!taskId)
        throw new Error('NapCat 返回的登录任务无效');
    if (!qrImage)
        throw new Error('NapCat 未返回登录二维码');
    return {
        taskId,
        status,
        qrImage,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    };
}

async function requestNapCat(path: string, body: Record<string, unknown>, requireOk = true): Promise<any> {
    const settings = loginSettings();
    let response;
    try {
        response = await axios.post(apiUrl(settings.napCatEndpoint, path), body, {
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: status => status === 200,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Signature': settings.napCatSignature,
            },
        });
    }
    catch (error: any) {
        if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout'))
            throw new Error('NapCat 接口请求超时，请检查服务状态');
        throw new Error('无法连接 NapCat 接口，请检查地址和服务状态');
    }

    const data = response?.data;
    if (requireOk && (!data || typeof data !== 'object' || data.ok !== true)) {
        throw new Error(napCatErrorMessage(data));
    }
    return data;
}

async function createLoginTask(): Promise<QqLoginTask> {
    return normalizeTask(await requestNapCat('/api/qq/login/qrcode', {}));
}

async function queryLoginStatus(taskId: string): Promise<QqLoginTask> {
    const id = String(taskId || '').trim();
    if (!id)
        throw new Error('登录任务 ID 不能为空');
    return normalizeTask(await requestNapCat('/api/qq/login/status', {
        taskId: id,
        refresh: false,
    }));
}

async function getMiniappCode(taskId: string): Promise<QqMiniappLoginResult> {
    const id = String(taskId || '').trim();
    if (!id)
        throw new Error('登录任务 ID 不能为空');
    const data = await requestNapCat('/api/qq/miniapp/code', {
        taskId: id,
        appId: QQ_MINIAPP_APP_ID,
    });
    const code = String(data?.code || '').trim();
    if (!code)
        throw new Error('NapCat 未返回小程序授权 Code');
    const nickname = typeof data?.nickname === 'string' ? data.nickname.trim() : '';
    return nickname ? { code, nickname } : { code };
}

async function cancelLoginTask(taskId: string): Promise<void> {
    const id = String(taskId || '').trim();
    if (!id)
        throw new Error('登录任务 ID 不能为空');
    await requestNapCat('/api/qq/logout', {
        taskId: id,
    }, false);
}

export {
    cancelLoginTask,
    createLoginTask,
    getMiniappCode,
    QQ_MINIAPP_APP_ID,
    queryLoginStatus,
};
