import type { ActivityExchangeShopItem } from '@/stores/activity'

export type ActivitySectionKey = 'qixi' | 'records' | 'shop' | 'journey' | 'notes'

export interface ActivitySection {
  key: ActivitySectionKey
  label: string
  icon: string
  count?: number
}

export interface ExchangeState {
  canExchange: boolean
  label: string
}

export interface ActivityLabels {
  title: string
  currentAccount: string
  none: string
  needAccount: string
  refresh: string
  loading: string
  empty: string
  warningTitle: string
  heluTitle: string
  giftLotusTab: string
  shopTab: string
  journeyTab: string
  notesTab: string
  pool: string
  recent: string
  freeRemain: string
  paidRemain: string
  dailyUsed: string
  dailyRemain: string
  helu: string
  heluBalance: string
  exchangeGoods: string
  drawOne: string
  drawBatch: string
  drawDone: string
  batchDone: string
  drawFail: string
  exchangeDone: string
  exchangeFail: string
  canExchange: string
  unavailable: string
  owned: string
  noHelu: string
  unsupportedCurrency: string
  priceLabel: string
  stateLabel: string
  drawCostLabel: string
  freeDraw: string
  paidDraw: string
  recentCost: string
  rewardPoolCount: string
  exchangeCount: string
  typeFallback: string
  gold: string
  coupon: string
  activityCurrency: string
  defaultHeluTitle: string
  decorationLabel: string
  subActivityUnavailable: string
  activityStatus: string
}

export type ExchangeItem = ActivityExchangeShopItem
