interface ShopAvailabilityContext {
  currentLevel: () => number
  currentGold: () => number
  currentCoupon: () => number
  currentDiamond: () => number
  userGoldBean: () => number
}

const L = {
  soldOutSeed: '\u8BE5\u79CD\u5B50\u5F53\u524D\u5DF2\u552E\u7F44\u3002',
  soldOutPet: '\u8BE5\u5BA0\u7269\u5F53\u524D\u5DF2\u552E\u7F44\u3002',
  soldOutMall: '\u8BE5\u9053\u5177\u5F53\u524D\u5DF2\u552E\u7F44\u3002',
  levelRequired: (level: number) => `\u8FBE\u5230 ${level} \u7EA7\u540E\u53EF\u8D2D\u4E70\u3002`,
  goldInsufficient: '\u5F53\u524D\u91D1\u5E01\u4E0D\u8DB3\u3002',
  goldBeanInsufficient: '\u5F53\u524D\u91D1\u8C46\u8C46\u4E0D\u8DB3\u3002',
  couponInsufficient: '\u5F53\u524D\u70B9\u5238\u4E0D\u8DB3\u3002',
  diamondInsufficient: '\u5F53\u524D\u94BB\u77F3\u4E0D\u8DB3\u3002',
  canBuyHint: '\u6761\u4EF6\u6EE1\u8DB3\uFF0C\u53EF\u76F4\u63A5\u8D2D\u4E70\u3002',
  unavailable: '\u5F53\u524D\u4E0D\u5F00\u653E\u8D2D\u4E70\u3002',
  decorationHint: '\u53EF\u7ACB\u5373\u8D2D\u4E70\u5E76\u751F\u6548\u3002',
  decorationOwnedHint: '\u8BE5\u5934\u50CF\u6846\u5DF2\u62E5\u6709\uFF0C\u65E0\u9700\u91CD\u590D\u8D2D\u4E70\u3002',
  freeHint: '\u53EF\u76F4\u63A5\u514D\u8D39\u9886\u53D6\u3002',
  locked: '\u672A\u89E3\u9501',
  soldOut: '\u5DF2\u552E\u7F44',
  levelLow: '\u7B49\u7EA7\u4E0D\u8DB3',
  goldLow: '\u91D1\u5E01\u4E0D\u8DB3',
  goldBeanLow: '\u91D1\u8C46\u8C46\u4E0D\u8DB3',
  couponLow: '\u70B9\u5238\u4E0D\u8DB3',
  diamondLow: '\u94BB\u77F3\u4E0D\u8DB3',
  canBuy: '\u53EF\u8D2D\u4E70',
  notOpen: '\u6682\u672A\u5F00\u653E',
  notBuyable: '\u6682\u4E0D\u53EF\u4E70',
  canClaimFree: '\u53EF\u514D\u8D39\u9886',
  owned: '\u5DF2\u62E5\u6709',
}

function priceOf(item: any) {
  return Number(item?.price || 0)
}

export function createShopAvailability(context: ShopAvailabilityContext) {
  function canAffordGoods(item: any) {
    if (item?.isGoldenBean)
      return context.userGoldBean() >= priceOf(item)
    return context.currentGold() >= priceOf(item)
  }

  function canAffordDecoration(item: any) {
    return context.userGoldBean() >= priceOf(item)
  }

  function canAffordMall(item: any) {
    if (item?.isFree)
      return true
    if (item?.balanceKnown === true)
      return Number(item.currencyBalance || 0) >= priceOf(item)
    if (item?.balanceKnown === false)
      return true
    if (Number(item?.currencyId) === 1004)
      return context.currentDiamond() >= priceOf(item)
    if (Number(item?.currencyId) === 1005)
      return context.userGoldBean() >= priceOf(item)
    if (Number(item?.currencyId) === 1001)
      return context.currentGold() >= priceOf(item)
    return context.currentCoupon() >= priceOf(item)
  }

  function mallBalanceMessage(item: any, hint = false) {
    const messages: Record<number, string> = hint
      ? { 1001: L.goldInsufficient, 1002: L.couponInsufficient, 1004: L.diamondInsufficient, 1005: L.goldBeanInsufficient }
      : { 1001: L.goldLow, 1002: L.couponLow, 1004: L.diamondLow, 1005: L.goldBeanLow }
    return messages[Number(item?.currencyId || 1002)] || (hint ? '当前所需道具不足。' : '所需道具不足')
  }

  function getSeedHint(item: any) {
    if (item.isSoldOut)
      return L.soldOutSeed
    if (context.currentLevel() < item.requiredLevel)
      return L.levelRequired(item.requiredLevel)
    if (!canAffordGoods(item))
      return L.goldInsufficient
    return L.canBuyHint
  }

  function getPetHint(item: any) {
    if (item.isSoldOut)
      return L.soldOutPet
    if (context.currentLevel() < item.requiredLevel)
      return L.levelRequired(item.requiredLevel)
    if (!canAffordGoods(item))
      return item.isGoldenBean ? L.goldBeanInsufficient : L.goldInsufficient
    return L.canBuyHint
  }

  function getDecorationHint(item: any) {
    if (item.owned)
      return L.decorationOwnedHint
    if (!item.canBuy)
      return L.unavailable
    if (!canAffordDecoration(item))
      return L.goldBeanInsufficient
    return L.decorationHint
  }

  function getMallHint(item: any) {
    if (item.isSoldOut)
      return L.soldOutMall
    if (!item.canBuy)
      return L.unavailable
    if (!canAffordMall(item))
      return mallBalanceMessage(item, true)
    const limitCount = Number(item.limitCount || 0)
    const boughtNum = Number(item.boughtNum || 0)
    if (limitCount > 0) {
      const period = Number(item.limitType || 0) === 1 ? '每日' : '活动'
      return `${period}限购 ${limitCount}，剩余 ${Math.max(0, limitCount - boughtNum)}。`
    }
    return item.isFree ? L.freeHint : L.canBuyHint
  }

  function getSeedStatusLabel(item: any) {
    if (!item.unlocked)
      return L.locked
    if (item.isSoldOut)
      return L.soldOut
    if (context.currentLevel() < item.requiredLevel)
      return L.levelLow
    if (!canAffordGoods(item))
      return L.goldLow
    return L.canBuy
  }

  function getPetStatusLabel(item: any) {
    if (!item.unlocked)
      return L.locked
    if (item.isSoldOut)
      return L.soldOut
    if (context.currentLevel() < item.requiredLevel)
      return L.levelLow
    if (!canAffordGoods(item))
      return item.isGoldenBean ? L.goldBeanLow : L.goldLow
    return L.canBuy
  }

  function getDecorationStatusLabel(item: any) {
    if (item.owned)
      return L.owned
    if (!item.canBuy)
      return L.notOpen
    if (!canAffordDecoration(item))
      return L.goldBeanLow
    return L.canBuy
  }

  function getMallStatusLabel(item: any) {
    if (item.isSoldOut)
      return L.soldOut
    if (!item.canBuy)
      return L.notBuyable
    if (!canAffordMall(item))
      return mallBalanceMessage(item)
    return item.isFree ? L.canClaimFree : L.canBuy
  }

  return {
    canAffordGoods,
    canAffordDecoration,
    canAffordMall,
    getSeedHint,
    getPetHint,
    getDecorationHint,
    getMallHint,
    getSeedStatusLabel,
    getPetStatusLabel,
    getDecorationStatusLabel,
    getMallStatusLabel,
  }
}
