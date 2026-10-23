import type { Request, Response } from 'express';
import type { ActivityRouteContext } from './types';

export function mountWeatherActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/weather', 'getCurrentWeatherActivity');
    mountGet('/api/activity-center/weather/friends', 'getWeatherFriends');
    app.post('/api/activity-center/weather/research/light', withAccount((accountId, req: Request) => ctx.provider.lightWeatherResearch(accountId, req.body?.nodeId ?? req.body?.node_id)));
    app.post('/api/activity-center/weather/bottle/buy', withAccount((accountId, req: Request) => ctx.provider.buyWeatherBottle(accountId, req.body?.count)));
    app.post('/api/activity-center/weather/bottle/collect', withAccount((accountId, req: Request) => ctx.provider.collectWeatherBottle(accountId, req.body?.targetGid ?? req.body?.target_gid)));
    app.post('/api/activity-center/weather/rain/summon', withAccount(accountId => ctx.provider.summonWeatherRain(accountId)));
    app.post('/api/activity-center/weather/shop/exchange', withAccount(accountId => ctx.provider.exchangeWeatherCollectorBottle(accountId)));
    app.post('/api/activity-center/weather/friends/scan', withAccount((accountId, req: Request) => ctx.provider.scanWeatherFriends(accountId, req.body?.friendGids ?? req.body?.friend_gids ?? req.body?.gids)));
    app.post('/api/activity-center/weather/collect', withAccount((accountId, req: Request) => ctx.provider.useWeatherCollectorBottle(accountId, req.body?.friendGid)));
    app.post('/api/activity-center/weather/summon', withAccount(accountId => ctx.provider.useWeatherSummonBottle(accountId)));
    app.post('/api/activity-center/weather/mischief/frog', withAccount((accountId, req: Request) => ctx.provider.useWeatherFrogBottle(accountId, req.body?.friendGid)));
    app.post('/api/activity-center/weather/mischief/cloud', withAccount((accountId, req: Request) => ctx.provider.useWeatherCloudBottle(accountId, req.body?.friendGid, req.body?.landId)));
    app.post('/api/activity-center/weather/research/:nodeId/advance', withAccount((accountId, req: Request, res: Response) => {
        const nodeId = String(req.params.nodeId || '');
        if (!/^[1-9]\d*$/.test(nodeId)) {
            res.status(400).json({ ok: false, error: 'nodeId 必须是正十进制整数' });
            return Promise.resolve(undefined);
        }
        return ctx.provider.advanceWeatherResearch(accountId, nodeId);
    }));
}
