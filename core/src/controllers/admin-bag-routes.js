const { getItemById } = require("../config/gameConfig");
const { toNum } = require("../utils/utils");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireAccessibleAccount(
  req,
  res,
  getAccountIdFromRequest,
  canAccessAccount,
  missingAccountError = "Missing x-account-id",
) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    const payload = { ok: false };
    if (missingAccountError)
      payload.error = missingAccountError;
    res.status(400).json(payload);
    return null;
  }

  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }

  return accountId;
}

function getItemName(itemId) {
  return getItemById(itemId)?.name || `物品${itemId}`;
}

function getBagItemCountMap(bag) {
  const counts = new Map();
  for (const item of bag?.originalItems || []) {
    counts.set(toNum(item.id), toNum(item.count));
  }
  return counts;
}

function getNewItemsAfterUse(bagBefore, bagAfter, usedItemId) {
  const beforeCounts = getBagItemCountMap(bagBefore);
  const newItems = [];

  for (const item of bagAfter?.originalItems || []) {
    const itemId = toNum(item.id);
    if (itemId === usedItemId)
      continue;

    const countDelta = toNum(item.count) - (beforeCounts.get(itemId) || 0);
    if (countDelta > 0) {
      newItems.push({
        id: itemId,
        count: countDelta,
        name: getItemName(itemId),
      });
    }
  }

  return newItems;
}

function buildUseItemMessage(usedItemName, usedCount, newItems) {
  if (newItems.length === 0)
    return `使用 ${usedItemName} x${usedCount}`;

  const rewards = newItems.map((item) => `${item.name} x${item.count}`).join(", ");
  return `使用 ${usedItemName} x${usedCount}，获得: ${rewards}`;
}

async function sellMergedBagItems(provider, accountId, items) {
  const normalized = items.map((item) => ({
    id: toNum(item.id),
    count: Math.max(1, toNum(item.count) || 1),
    uid: toNum(item.uid),
  }));
  const idCounts = new Map();
  for (const item of normalized)
    idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);

  const uniqueItems = normalized.filter(item => idCounts.get(item.id) === 1);
  const stackedItems = normalized.filter(item => idCounts.get(item.id) > 1);
  const results = [];

  if (uniqueItems.length > 0)
    results.push(await provider.sellItems(accountId, uniqueItems));

  // 同一物品在背包中可能按 UID 分成多个实例；官方客户端逐个 UID 出售。
  for (const item of stackedItems) {
    results.push(await provider.sellItems(accountId, [item]));
    if (stackedItems.length > 1)
      await wait(100);
  }

  return results.length === 1 ? results[0] : results;
}

function registerAdminBagRoutes({
  app,
  provider,
  store,
  emitRealtimeLog,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  app.get("/api/bag", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount, null);
    if (!accountId)
      return;

    try {
      const bag = await provider.getBag(accountId);
      res.json({ ok: true, data: bag });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/bag/use", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId)
      return;

    try {
      const { itemId, count, uid } = req.body;
      if (!itemId)
        return res.status(400).json({ ok: false, error: "缺少 itemId" });

      const usedItemId = toNum(itemId);
      const usedCount = Math.max(1, toNum(count) || 1);
      const usedItemName = getItemName(usedItemId);
      const bagBefore = await provider.getBag(accountId);

      await provider.useItem(accountId, usedItemId, usedCount, toNum(uid));
      await wait(500);

      const bagAfter = await provider.getBag(accountId);
      const newItems = getNewItemsAfterUse(bagBefore, bagAfter, usedItemId);

      emitRealtimeLog({
        accountId,
        time: new Date().toISOString().replace("T", " ").slice(0, 19),
        tag: "背包",
        msg: buildUseItemMessage(usedItemName, usedCount, newItems),
        module: "warehouse",
        event: "use_item",
      });

      res.json({
        ok: true,
        data: {
          items: newItems,
          usedItemName,
          usedCount,
        },
      });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/bag/sell", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId)
      return;

    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ ok: false, error: "缺少出售物品列表" });

      const result = await sellMergedBagItems(provider, accountId, items);
      res.json({ ok: true, data: result });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/bag/seeds", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId)
      return;

    try {
      const seeds = await provider.getBagSeeds(accountId);
      const result = store.syncBagSeedPriority(accountId, seeds);
      if (result.changed && typeof provider.syncAccountConfig === "function")
        provider.syncAccountConfig(accountId);
      res.json({
        ok: true,
        data: {
          seeds: result.seeds,
          priority: result.priority,
          knownIds: result.knownIds,
          excluded: result.excluded,
        },
      });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/daily-gifts", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount, null);
    if (!accountId)
      return;

    try {
      const gifts = await provider.getDailyGifts(accountId);
      res.json({ ok: true, data: gifts });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminBagRoutes, sellMergedBagItems };
