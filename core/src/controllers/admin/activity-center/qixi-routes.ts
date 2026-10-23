import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

export function mountQixiActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/qixi', 'getCurrentQixiActivity');
    app.post('/api/activity-center/qixi/bridge/claim', withAccount(accountId => ctx.provider.claimQixiBridgeRewards(accountId)));
    app.post('/api/activity-center/qixi/gift', withAccount((accountId, req: Request) => ctx.provider.giftQixiSachet(accountId, req.body?.friendGid, req.body?.messageTextId ?? 15)));
}
