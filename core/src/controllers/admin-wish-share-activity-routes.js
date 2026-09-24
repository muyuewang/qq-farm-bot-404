const { getAuthorizedAccountId, requireConnectedAccount } = require('./admin-activity-route-helpers');

function registerAdminWishShareActivityRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  const context = { getAccountIdFromRequest, canAccessAccount };
  for (const [slug, getter, operator, actions] of [
    ['wish-sign', 'getWishSignActivity', 'operateWishSign', ['draw', 'claim']],
    ['share-reward', 'getShareRewardActivity', 'operateShareReward', ['daily', 'share', 'milestones']],
  ]) {
    app.get(`/api/activity/${slug}`, async (req, res) => {
      const accountId = getAuthorizedAccountId(req, res, context);
      if (!accountId) return;
      try {
        if (!requireConnectedAccount(res, provider, accountId, '获取活动失败: 账号未运行')) return;
        res.json({ ok: true, activity: await provider[getter](accountId) });
      } catch (error) { sendProviderError(res, error); }
    });
    app.post(`/api/activity/${slug}/operate`, async (req, res) => {
      const accountId = getAuthorizedAccountId(req, res, context);
      if (!accountId) return;
      if (!actions.includes(req.body?.action)) return res.status(400).json({ ok: false, error: '活动操作无效' });
      try {
        if (!requireConnectedAccount(res, provider, accountId, '活动操作失败: 账号未运行')) return;
        res.json(await provider[operator](accountId, req.body.action, req.body.chooseId));
      } catch (error) { sendProviderError(res, error); }
    });
  }
}

module.exports = { registerAdminWishShareActivityRoutes };
