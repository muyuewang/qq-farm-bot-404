const {
  registerAdminHeluActivityRoutes,
} = require("./admin-helu-activity-routes");
const {
  registerAdminNanguaActivityRoutes,
} = require("./admin-nangua-activity-routes");
const { registerAdminActivityUpdateRoutes } = require('./admin-activity-update-routes');
const { registerAdminWishShareActivityRoutes } = require('./admin-wish-share-activity-routes');

function registerAdminActivityRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
  requireAdminToken,
}) {
  const routeContext = {
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  };

  registerAdminNanguaActivityRoutes(routeContext);
  registerAdminHeluActivityRoutes(routeContext);
  registerAdminActivityUpdateRoutes({ app, provider, requireAdminToken });
  registerAdminWishShareActivityRoutes(routeContext);
}

module.exports = { registerAdminActivityRoutes };
