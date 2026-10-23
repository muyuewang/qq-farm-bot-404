import type { Request, Response } from 'express';
import type { ActivityRouteContext } from './types';

export function mountStellarActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/season', 'getCurrentSeasonEvent');
    mountGet('/api/activity-center/stellar', 'getCurrentStellarActivity');
    mountGet('/api/activity-center/shop', 'getCurrentStarSandShop');
    mountGet('/api/activity-center/solar-terms', 'getCurrentSolarTerms');
    app.post('/api/activity-center/pass/claim', withAccount(accountId => ctx.provider.claimBattlePassRewards(accountId)));
    app.post('/api/activity-center/constellation/light', withAccount(accountId => ctx.provider.lightConstellation(accountId)));
    app.post('/api/activity-center/shop/exchange', withAccount((accountId, req: Request) => ctx.provider.exchangeStarSandGoods(accountId, req.body?.goodsId, req.body?.count)));
    app.post('/api/activity-center/solar-terms/:termId/claim', withAccount((accountId, req: Request, res: Response) => {
        const termId = String(req.params.termId || '');
        if (!/^[1-9]\d*$/.test(termId)) {
            res.status(400).json({ ok: false, error: 'termId 必须是正十进制整数' });
            return Promise.resolve(undefined);
        }
        return ctx.provider.claimSolarTerm(accountId, termId);
    }));
}
