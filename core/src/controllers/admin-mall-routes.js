const { getItemById, getItemImageById } = require("../config/gameConfig");
const { parseMallPriceInfo, parseMallLimitInfo, parseMallItemIds } = require("../services/mall");
const mallImageSupplement = require('../gameConfig/MallImageSupplement.json');
const mallImageByGoodsId = new Map(mallImageSupplement.entries.map(entry => [entry.goodsId, entry]));
  const { toNum } = require("../utils/utils");

const FEATURED_MALL_GOODS_ORDER = [1002, 1003, 1006];
const MALL_GOODS_PRICE_OVERRIDES = {
  1002: 42,
  1003: 34,
  1006: 33,
};
const MALL_GOODS_META = {
  1002: {
    name: "10小时有机化肥",
    images: [
      "/game-config/seed_images_named/80011_organic_1.png",
      "/game-config/seed_images_named/80013_organic_8.png",
    ],
    layout: "horizontal",
  },
  1003: {
    name: "10小时化肥",
    images: [
      "/game-config/seed_images_named/80001_ordinary_1.png",
      "/game-config/seed_images_named/80003_ordinary_8.png",
    ],
    layout: "horizontal",
  },
  1006: {
    name: "狗粮礼包",
    images: [
      "/game-config/seed_images_named/90004_dog_food_1.png",
      "/game-config/seed_images_named/90005_dog_food_3.png",
      "/game-config/seed_images_named/90006_dog_food_5.png",
    ],
    layout: "triangle",
  },
};

function isActivityMallGoods(discount) {
  return discount?.is_activity === true || toNum(discount?.end_time) > 0;
}

function shouldExposeMallGoods(discount) {
  const id = toNum(discount?.goods_id) || 0;
  return id > 0 && (FEATURED_MALL_GOODS_ORDER.includes(id) || isActivityMallGoods(discount));
}

function compareMallGoods(left, right) {
  if (left.isActivity !== right.isActivity) return left.isActivity ? -1 : 1;
  if (left.isActivity) return left.sourceOrder - right.sourceOrder;
  return FEATURED_MALL_GOODS_ORDER.indexOf(left.goodsId)
    - FEATURED_MALL_GOODS_ORDER.indexOf(right.goodsId);
}

function getCurrencyMeta(currencyId, status) {
  const id = toNum(currencyId) || 0;
  const balances = {
    1001: status?.status?.gold,
    1002: status?.status?.coupon,
    1004: status?.status?.diamond,
    1005: status?.status?.goldBean,
  };
  const rawBalance = balances[id];
  const balanceKnown = rawBalance !== undefined && rawBalance !== null;
  const item = getItemById(id);
  return {
    currencyName: item?.name || (id > 0 ? `道具 #${id}` : ""),
    currencyBalance: balanceKnown ? Math.max(0, toNum(rawBalance)) : 0,
    balanceKnown,
  };
}

function getAuthorizedAccountId({
  req,
  res,
  getAccountIdFromRequest,
  canAccessAccount,
}) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({ ok: false, error: "Missing\x20x-account-id" });
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function registerAdminMallRoutes({
  app,
  provider,
  adminLogger,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  app.get("/api/shop/mall", async (req, res) => {
    const accountId = getAuthorizedAccountId({
      req,
      res,
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const status = provider.getStatus(accountId);
      if (!status || !status.connection || !status.connection.connected) {
        return res.json({
          ok: false,
          error: "获取道具商城失败:\x20账号未运行",
        });
      }

      const userTicket = status?.status?.coupon || 0;
      const userDiamond = status?.status?.diamond || 0;
      const discounts = await provider.getMallGoods(accountId);
      const goods = [];

      for (const [sourceOrder, discount] of discounts.entries()) {
        const id = toNum(discount.goods_id) || 0;
        if (!shouldExposeMallGoods(discount)) continue;

        const meta = MALL_GOODS_META[id] || {};

        const isFree = discount.is_free === true;
        const limitBytes = discount.limit;
        const isLimited = !!(limitBytes && (limitBytes.length === undefined || limitBytes.length > 0));
        const endTime = toNum(discount.end_time) || 0;
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (endTime > 0 && nowSeconds > endTime) continue;
        const priceInfo = parseMallPriceInfo(discount.price);
        const currencyId = priceInfo.currencyId || (isFree ? 0 : 1002);
        const currencyMeta = getCurrencyMeta(currencyId, status);
        const price = MALL_GOODS_PRICE_OVERRIDES[id] || priceInfo.price;
        let limitCount = 0;
        let boughtNum = 0;
        let limitType = 0;
        if (isLimited) {
          try {
            const limitInfo = parseMallLimitInfo(limitBytes);
            if (limitInfo) {
              limitCount = limitInfo.limitCount || 0;
              boughtNum = limitInfo.boughtNum || 0;
              limitType = limitInfo.limitType || 0;
            }
          } catch {}
        }

        const isSoldOut = limitCount > 0 && boughtNum >= limitCount;
        const parsedItemIds = (Array.isArray(discount.item_ids) ? discount.item_ids : [discount.item_ids])
          .flatMap(parseMallItemIds);
        const imageMeta = mallImageByGoodsId.get(id);
        const itemIds = parsedItemIds.length ? parsedItemIds : (imageMeta?.itemIds || []);
        const dynamicImages = itemIds.map(getItemImageById).filter(Boolean);
        goods.push({
          id,
          goodsId: id,
          name: meta.name || String(discount.name || `活动商品 #${id}`),
          type: toNum(discount.type) || 0,
          itemIds,
          price,
          currencyId,
          ...currencyMeta,
          isFree,
          isLimited,
          limitCount,
          boughtNum,
          limitType,
          isSoldOut,
          isActivity: discount.is_activity === true || endTime > 0,
          sourceOrder,
          endTime,
          discount: discount.discount || "",
          images: meta.images || (imageMeta?.file
            ? [`/game-config/seed_images_named/${encodeURIComponent(imageMeta.file)}`]
            : dynamicImages),
          layout: meta.layout || "single",
          canBuy: !isSoldOut,
        });
      }

      goods.sort(compareMallGoods);
      for (const item of goods) delete item.sourceOrder;
      res.json({ ok: true, data: goods, userTicket, userDiamond });
    } catch (error) {
      adminLogger.error("获取道具商城失败", {
        error: error.message,
        stack: error.stack,
      });
      const message = error.message || "未知错误";
      res.json({ ok: false, error: `获取道具商城失败:\x20${  message}` });
    }
  });

  app.post("/api/shop/mall/buy", async (req, res) => {
    const accountId = getAuthorizedAccountId({
      req,
      res,
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const { goodsId, count } = req.body || {};
      if (!goodsId || !count) {
        return res.status(400).json({ ok: false, error: "参数不完整" });
      }

      const data = await provider.buyMallGoods(accountId, goodsId, count);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = {
  compareMallGoods,
  isActivityMallGoods,
  registerAdminMallRoutes,
  shouldExposeMallGoods,
};
