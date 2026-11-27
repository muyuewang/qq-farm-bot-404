import crypto from 'node:crypto';
import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
import { WxLoginService, getWxCredentialSnapshot } from '../../services/wx-login/service';
import type { ScanStatus, WxLoginSession } from '../../services/wx-login/service';

export { };

const { createAuthRequired } = require('./middleware');
const { TARGET_APP_ID } = require('../../services/wx-login/constants');
const { wxCredentialHandoff } = require('../../services/wx-login/credential-handoff');

const TASK_TTL_MS = 110_000;
const MAX_TASKS = 64;
const LOGIN_OK_MESSAGE = 'login:ok';
type Status = ScanStatus | 'ready_for_code' | 'failed' | 'completed';

interface Task {
    id: string;
    createdAt: number;
    status: Status;
    session: WxLoginSession;
    qr: Buffer;
    code?: string;
    codeResult?: any;
    pollPending?: Promise<void>;
    confirmPending?: Promise<void>;
    codePending?: Promise<any>;
}

const tasks = new Map<string, Task>();
const wxLogin = new WxLoginService();

function clearSession(task: Task): void {
    wxLogin.destroy(task.session);
    task.code = undefined;
}

function destroy(task: Task): void {
    clearSession(task);
    tasks.delete(task.id);
}

function publicTask(task: Task) {
    return {
        task_id: task.id,
        app_id: TARGET_APP_ID,
        status: task.status,
        expires_at: Math.floor((task.createdAt + TASK_TTL_MS) / 1000),
    };
}

function cleanupTasks(): void {
    const current = Date.now();
    for (const [id, task] of tasks) {
        if (current - task.createdAt > TASK_TTL_MS) {
            clearSession(task);
            tasks.delete(id);
        }
    }
    while (tasks.size > MAX_TASKS) {
        const oldest = tasks.keys().next().value;
        if (oldest === undefined) break;
        const task = tasks.get(oldest);
        if (task) clearSession(task);
        tasks.delete(oldest);
        console.warn(`[wx-login] 扫码任务数超过 ${MAX_TASKS}，已清理最旧任务`);
    }
}

function findTask(req: Request, res: Response): Task | null {
    cleanupTasks();
    const task = tasks.get(String(req.params.taskId || ''));
    if (!task) {
        res.status(404).json({ ok: false, error: 'Login task not found or expired' });
        return null;
    }
    return task;
}

async function createTask(): Promise<Task> {
    // cleanupTasks 允许 size 恰好等于 MAX_TASKS，新建前需要再腾出一个位置。
    cleanupTasks();
    if (tasks.size >= MAX_TASKS) {
        const oldest = tasks.values().next().value;
        if (oldest) destroy(oldest);
    }
    const { session, qr } = await wxLogin.createQrSession();
    const task: Task = { id: crypto.randomBytes(32).toString('hex'), createdAt: Date.now(), status: 'waiting', session, qr };
    tasks.set(task.id, task);
    return task;
}

async function poll(task: Task): Promise<void> {
    if (task.status === 'authorized' || task.status === 'ready_for_code' || task.status === 'completed') return;
    task.status = await wxLogin.poll(task.session);
}

async function confirm(task: Task): Promise<void> {
    if (task.status !== 'authorized') throw new Error('Waiting for scan authorization');
    await wxLogin.confirm(task.session);
    task.status = 'ready_for_code';
}

async function consumeCode(task: Task): Promise<void> {
    if (task.status !== 'ready_for_code') throw new Error('Login code is not ready');
    task.code = await wxLogin.issueCode(task.session, TARGET_APP_ID);
}

async function ensurePolled(task: Task): Promise<void> {
    if (!task.pollPending) {
        task.pollPending = poll(task).finally(() => { task.pollPending = undefined; });
    }
    await task.pollPending;
}

async function ensureConfirmed(task: Task): Promise<void> {
    // 不重复调用 ensurePolled：调用方已保证 poll 至少完成一次，
    // 避免 pollPending 被 .finally 清空后再发起第二次 poll 请求。
    if (task.status !== 'authorized') return;
    if (!task.confirmPending) {
        task.confirmPending = confirm(task).finally(() => { task.confirmPending = undefined; });
    }
    await task.confirmPending;
}

function mountWxLoginRoutes(app: Application, ctx: AdminContext): void {
    app.use('/api/wx-login', createAuthRequired(ctx));

    app.post('/api/wx-login/tasks', async (req, res) => {
        if (req.body?.app_id && req.body.app_id !== TARGET_APP_ID) {
            return res.status(400).json({ ok: false, error: 'Unsupported app_id' });
        }
        try {
            const task = await createTask();
            res.json({ ok: true, data: { ...publicTask(task), qr_url: `/api/wx-login/tasks/${task.id}/qr` } });
        } catch (error: any) {
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/wx-login/tasks/:taskId/qr', (req, res) => {
        const task = findTask(req, res);
        if (task) res.type('jpeg').send(task.qr);
    });

    app.delete('/api/wx-login/tasks/:taskId', (req, res) => {
        const task = tasks.get(String(req.params.taskId || ''));
        if (!task) return res.status(404).json({ ok: false, error: 'Login task not found or expired' });
        destroy(task);
        return res.json({ ok: true });
    });

    app.get('/api/wx-login/tasks/:taskId/status', async (req, res) => {
        const task = findTask(req, res);
        if (!task) return;
        try {
            await ensurePolled(task);
            const data = publicTask(task);
            if (task.status === 'cancelled' || task.status === 'expired') destroy(task);
            res.json({ ok: true, data });
        } catch (error: any) {
            task.status = 'failed';
            destroy(task);
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/wx-login/tasks/:taskId/confirm', async (req, res) => {
        const task = findTask(req, res);
        if (!task) return;
        try {
            await ensurePolled(task);
            await ensureConfirmed(task);
            res.json({ ok: true, data: publicTask(task) });
        } catch (error: any) {
            task.status = 'failed';
            destroy(task);
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/wx-login/tasks/:taskId/code', async (req, res) => {
        const task = findTask(req, res);
        if (!task) return;
        try {
            if (task.codeResult) return res.json({ ok: true, data: task.codeResult });
            if (!task.codePending) {
                task.codePending = (async () => {
                    await ensurePolled(task);
                    if (task.confirmPending) await task.confirmPending;
                    if (task.status !== 'ready_for_code') await ensureConfirmed(task);
                    if (task.status !== 'ready_for_code') throw new Error('Login code is not ready');
                    if (!task.code) await consumeCode(task);
                    const credential = getWxCredentialSnapshot(task.session);
                    const autoReloginReady = wxCredentialHandoff.register(task.code, credential);
                    const data = {
                        openid: task.session.openid,
                        app_id: TARGET_APP_ID,
                        code: task.code,
                        nickname: task.session.nickname || '',
                        auto_relogin_ready: autoReloginReady,
                        err_msg: LOGIN_OK_MESSAGE,
                    };
                    // 保留任务与一次性响应快照，供并发/重复请求复用；凭据 session 先销毁。
                    task.codeResult = data;
                    task.status = 'completed';
                    clearSession(task);
                    return data;
                })().finally(() => { task.codePending = undefined; });
            }
            const data = await task.codePending;
            res.json({ ok: true, data });
        } catch (error: any) {
            task.status = 'failed';
            destroy(task);
            res.status(502).json({ ok: false, error: error.message });
        }
    });
}

module.exports = { mountWxLoginRoutes };
