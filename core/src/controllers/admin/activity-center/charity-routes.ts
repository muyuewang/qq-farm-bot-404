import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

export function mountCharityActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/charity-red-flower', 'getCurrentCharityRedFlowerActivity');
    app.post('/api/activity-center/charity-red-flower/seeds/claim', withAccount(accountId => ctx.provider.claimCharityRedFlowerSeeds(accountId)));
    app.post('/api/activity-center/charity-red-flower/love/donate', withAccount(accountId => ctx.provider.donateCharityRedFlowerLove(accountId)));
    app.post('/api/activity-center/charity-red-flower/daily-gift/claim', withAccount(accountId => ctx.provider.claimCharityRedFlowerDailyGift(accountId)));
    app.post('/api/activity-center/charity-red-flower/progress/claim', withAccount((accountId, req: Request) => ctx.provider.claimCharityRedFlowerProgressReward(accountId, req.body?.target)));
}
