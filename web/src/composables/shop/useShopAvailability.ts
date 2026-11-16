interface ShopAvailabilityContext {
  currentLevel: () => number
  currentGold: () => number
}

const L = {
  soldOutSeed: '该种子当前已售罄。',
  levelRequired: (level: number) => `达到 ${level} 级后可购买。`,
  goldInsufficient: '当前金币不足。',
  canBuyHint: '条件满足，可直接购买。',
  unavailable: '当前不开启购买。',
  freeHint: '可直接免费领取。',
  locked: '未解锁',
  soldOut: '已售罄',
  levelLow: '等级不足',
  goldLow: '金币不足',
  canBuy: '可购买',
  notOpen: '暂未开放',
  owned: '已拥有',
  shopDataUnknown: '商店数据未确认',
  localFallbackHint: '后端未能读取种子商店，以下仅为本地配置，价格与限购未知。',
  unlockCardHint: '该种子需要解锁卡，暂不支持在此购买。',
  remainingLimit: (remaining: number) => `剩余限购 ${remaining} 件。`,
  currencyInsufficient: (name: string) => `${name}余额不足。`,
  balanceUnknown: (name: string) => `${name}余额未确认，购买时由后端校验。`,
}

/** 道具商店后端 purchaseStatus 的直译；未识别的状态按“暂未开放”处理。 */
const PROPS_STATUS_LABELS: Record<string, string> = {
  owned: L.owned,
  sold_out: L.soldOut,
  unavailable: L.notOpen,
  ad_required: '需游戏内看广告',
  share_required: '需游戏内分享',
  svip_required: '需 SVIP 会员',
}

function priceOf(item: any) {
  return Number(item?.price || 0)
}

export function createShopAvailability(context: ShopAvailabilityContext) {
  function isSeedFromLocalConfig(item: any) {
    return item?.fromLocalConfig === true || Number(item?.id || 0) <= 0
  }

  function canAffordSeed(item: any) {
    if (isSeedFromLocalConfig(item))
      return false
    return context.currentGold() >= priceOf(item)
  }

  function canAffordProps(item: any) {
    // 后端余额为 null 表示未确认，此时不在前端臆断，交给服务端拒绝。
    if (item?.balance === null || item?.balance === undefined)
      return true
    return Number(item.balance) >= priceOf(item)
  }

  function getSeedHint(item: any) {
    if (isSeedFromLocalConfig(item))
      return L.localFallbackHint
    if (item?.requiresUnlockCard)
      return L.unlockCardHint
    if (item?.isSoldOut)
      return L.soldOutSeed
    if (context.currentLevel() < Number(item?.requiredLevel || 0))
      return L.levelRequired(Number(item?.requiredLevel || 0))
    if (!canAffordSeed(item))
      return L.goldInsufficient
    const remaining = Number(item?.remainingPurchaseCount ?? -1)
    return remaining >= 0 ? L.remainingLimit(remaining) : L.canBuyHint
  }

  function getPropsHint(item: any) {
    if (item?.isFree)
      return L.freeHint
    if (item?.unavailableReason)
      return item.unavailableReason
    if (item?.purchasable !== true)
      return L.unavailable
    if (!canAffordProps(item))
      return L.currencyInsufficient(String(item?.currencyName || ''))
    if (item?.balance === null || item?.balance === undefined)
      return L.balanceUnknown(String(item?.currencyName || ''))
    const remaining = Number(item?.remainingPurchaseCount ?? -1)
    return remaining >= 0 ? L.remainingLimit(remaining) : L.canBuyHint
  }

  function getSeedStatusLabel(item: any) {
    if (isSeedFromLocalConfig(item))
      return L.shopDataUnknown
    if (!item?.unlocked)
      return L.locked
    if (item?.isSoldOut)
      return L.soldOut
    if (context.currentLevel() < Number(item?.requiredLevel || 0))
      return L.levelLow
    if (!canAffordSeed(item))
      return L.goldLow
    return L.canBuy
  }

  function getPropsStatusLabel(item: any) {
    const backendStatus = String(item?.purchaseStatus || 'unavailable')
    if (backendStatus !== 'available')
      return PROPS_STATUS_LABELS[backendStatus] || L.notOpen
    if (!canAffordProps(item))
      return L.currencyInsufficient(String(item?.currencyName || ''))
    if (item?.isFree)
      return L.canBuy
    return L.canBuy
  }

  return {
    canAffordSeed,
    canAffordProps,
    getSeedHint,
    getPropsHint,
    getSeedStatusLabel,
    getPropsStatusLabel,
  }
}
