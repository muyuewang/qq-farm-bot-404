/**
 * 商城顶部资源条的余额取值。
 *
 * /api/props-shop 只为商品定价用到的币种返回余额，点券、钻石没有对应商品时根本不出现，
 * 所以需要备用来源：点券取 /api/status 的 status.coupon，钻石取 /api/diamond。
 * 返回 null 表示两个来源都没有可信数值，由界面显示「未确认」；0 是有效余额，不回退。
 */
export function pickCurrencyBalance(shopBalance: number | null | undefined, fallback: number | null | undefined): number | null {
  if (typeof shopBalance === 'number' && Number.isFinite(shopBalance))
    return shopBalance
  if (typeof fallback === 'number' && Number.isFinite(fallback))
    return fallback
  return null
}
