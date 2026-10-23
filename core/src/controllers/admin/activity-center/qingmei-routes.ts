import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

export function mountQingMeiActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/qingmei', 'getCurrentQingMeiActivity');
    app.post('/api/activity-center/qingmei/daily-seed/claim', withAccount(accountId => ctx.provider.claimQingMeiDailySeed(accountId)));
    app.post('/api/activity-center/qingmei/brew/start', withAccount((accountId, req: Request) => ctx.provider.startQingMeiBrew(accountId, req.body?.ingredients ?? req.body?.count)));
    app.post('/api/activity-center/qingmei/brew/continue', withAccount(accountId => ctx.provider.continueQingMeiBrew(accountId)));
    app.post('/api/activity-center/qingmei/brew/settle', withAccount(accountId => ctx.provider.settleQingMeiBrew(accountId)));
}
