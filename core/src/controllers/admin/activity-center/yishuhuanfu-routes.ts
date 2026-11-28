import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

export function mountYishuHuanfuActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/yishuhuanfu', 'getCurrentYishuHuanfuActivity');
    mountGet('/api/activity-center/yishuhuanfu/catalog', 'queryYishuHuanfuCatalog');
    // 收购记录列表（cmd 95，只读）：界面「只展示最近 30 条」。
    mountGet('/api/activity-center/yishuhuanfu/records', 'queryYishuHuanfuRecords');
    // 好友铺子比价（cmd 92 批量扫描，只读）：limit 控制扫描上限，force=1 跳过 3 分钟缓存。
    app.get('/api/activity-center/yishuhuanfu/friends', withAccount((accountId: string, req: Request) => (
        ctx.provider.scanYishuHuanfuFriendShops(accountId, {
            limit: req.query?.limit ?? null,
            force: req.query?.force === '1' || req.query?.force === 'true',
        })
    )));
    app.post('/api/activity-center/yishuhuanfu/seed/claim', withAccount((accountId: string) => ctx.provider.claimYishuHuanfuSeeds(accountId)));
    // 查铺子行情（cmd 92，只读）：不传 friendGid 查自己铺子。
    app.get('/api/activity-center/yishuhuanfu/shop', withAccount((accountId: string, req: Request) => (
        ctx.provider.queryYishuHuanfuShop(accountId, req.query?.friendGid ?? null)
    )));
    // 卖薯（cmd 93）：friendGid 缺省卖给自己铺子；count 缺省卖出背包全部。
    app.post('/api/activity-center/yishuhuanfu/sell', withAccount((accountId: string, req: Request) => (
        ctx.provider.sellYishuHuanfuSweetPotato(accountId, req.body?.friendGid ?? null, req.body?.count ?? null)
    )));
    // 兑换下单（cmd 96）：index 为目录序号，count 为数量。
    app.post('/api/activity-center/yishuhuanfu/exchange', withAccount((accountId: string, req: Request) => (
        ctx.provider.exchangeYishuHuanfuGoods(accountId, req.body?.index, req.body?.count ?? 1)
    )));
    app.post('/api/activity-center/yishuhuanfu/quote/refresh', withAccount((accountId: string) => ctx.provider.refreshYishuHuanfuQuote(accountId)));
    // 领取收购提成（cmd 99）。
    app.post('/api/activity-center/yishuhuanfu/commission/claim', withAccount((accountId: string) => ctx.provider.claimYishuHuanfuCommission(accountId)));
    app.post('/api/activity-center/yishuhuanfu/share', withAccount((accountId: string) => ctx.provider.shareYishuHuanfuShop(accountId)));
    // 手动导入好友当天分享标识（贴分享链接/卡片文本或 UUID）。
    // 服务端没有按 gid 反查好友标识的接口，面板外的真人好友只能靠这个入口变得可售。
    app.post('/api/activity-center/yishuhuanfu/share-key', withAccount((accountId: string, req: Request) => (
        ctx.provider.importYishuHuanfuShareKey(accountId, req.body?.gid, req.body?.text)
    )));
    // 把某家铺子移出比价列表：比价池完全由标识存档决定，删掉这条就没了。
    // 面板账号下次分享会重新落盘，所以这不是永久屏蔽。
    app.post('/api/activity-center/yishuhuanfu/share-key/remove', withAccount((accountId: string, req: Request) => (
        ctx.provider.forgetYishuHuanfuShareKey(accountId, req.body?.gid)
    )));
}
