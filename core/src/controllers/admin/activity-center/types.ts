import type { Application, Request, Response } from 'express';
import type { AdminContext } from '../context';

export type ActivityAccountHandler = (accountId: string, req: Request, res: Response) => Promise<any>;

export interface ActivityRouteContext {
    app: Application;
    ctx: AdminContext;
    withAccount: (handler: ActivityAccountHandler) => (req: Request, res: Response) => Promise<any>;
    mountGet: (path: string, providerMethod: string) => void;
}
