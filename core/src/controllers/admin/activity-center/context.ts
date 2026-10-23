import type { Application, Request, Response } from 'express';
import type { AdminContext } from '../context';
import type { ActivityRouteContext } from './types';
import { handleActivityApiError } from './error-handler';

const { getAccId } = require('../middleware');

export function createActivityRouteContext(app: Application, ctx: AdminContext): ActivityRouteContext {
    const withAccount = (handler: (accountId: string, req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
        const accountId = getAccId(ctx, req);
        if (!accountId) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const data = await handler(accountId, req, res);
            if (!res.headersSent) return res.json({ ok: true, data });
            return undefined;
        } catch (error: any) {
            return handleActivityApiError(res, error);
        }
    };
    const mountGet = (path: string, providerMethod: string): void => {
        app.get(path, withAccount((accountId: string) => ctx.provider[providerMethod](accountId)));
    };
    return { app, ctx, withAccount, mountGet };
}
