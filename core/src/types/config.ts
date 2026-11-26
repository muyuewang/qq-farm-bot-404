import type { RanchAutomationConfig } from '../config/ranch-automation';
export {};
export type PlantingStrategy =
  | 'preferred'
  | 'level'
  | 'max_exp'
  | 'max_fert_exp'
  | 'max_profit'
  | 'max_fert_profit'
  | 'bag_priority'
  | 'task_priority';

// 任务作物优先只决定"先种任务需要的种子"，后续补种仍走第二优先策略，
// 因此它本身不能作为背包优先的回退项。
export type BagSeedFallbackStrategy = Exclude<PlantingStrategy, 'bag_priority' | 'task_priority'>;

export type FertilizerMode = 'both' | 'normal' | 'organic' | 'smart' | 'none' | 'normal_ripen' | 'organic_ripen';

export type FertilizerLandType = 'blue-crystal' | 'purple-gold' | 'gold' | 'black' | 'red' | 'normal';

export interface AutomationConfig extends RanchAutomationConfig {
  farm: boolean;
  farm_harvest_tiangong: boolean;
  farm_push: boolean;
  farm_illustrated: boolean;
  land_upgrade: boolean;
  friend: boolean;
  friend_auto_accept: boolean;
  friend_help_exp_limit: boolean;
  friend_steal: boolean;
  friend_help: boolean;
  friend_bad: boolean;
  friend_help_protect_dog_ignore_exp_limit: boolean;
  task: boolean;
  fertilizer_gift: boolean;
  fertilizer_buy_organic: boolean;
  fertilizer_buy_normal: boolean;
  mystery_shop_auto_buy: boolean;
  mystery_shop_allow_gold: boolean;
  mystery_shop_allow_coupon: boolean;
  mystery_shop_allow_gold_bean: boolean;
  mystery_shop_allow_diamond: boolean;
  mystery_shop_arrival_notify: boolean;
  mystery_shop_purchase_notify: boolean;
  sell: boolean;
  fertilizer: FertilizerMode;
  fertilizer_multi_season: boolean;
  fertilizer_land_types: FertilizerLandType[];
  fertilizer_smart_seconds: number;
  skip_own_weed_bug: boolean;
  show_manual_fertilizer: boolean;
  // 以薯换福：领种子 / 分享 / 自动按好友收购价卖薯，数值项控制比价频率与分摊风险。
  yishu_claim_seed: boolean;
  yishu_share: boolean;
  yishu_auto_sell: boolean;
  /** 小铺收购提成（好友把蜜薯卖进你的铺子产生）到账后自动领。 */
  yishu_claim_commission: boolean;
  /** 好友铺子当天都收满时，把剩下的卖给自己铺子（不浪费已收获的蜜薯）。 */
  yishu_sell_fallback_own: boolean;
  /** 每次比价扫描的好友数量上限，好友越多单轮读请求越多。 */
  yishu_scan_friend_limit: number;
  /** 两次比价之间的最小间隔（分钟），间隔内复用上一轮结果。 */
  yishu_scan_interval_minutes: number;
  /** 背包蜜薯达到该数量才进入比价卖薯。 */
  yishu_sell_min_count: number;
  /**
   * 到点之后才开始卖薯（"HH:MM"，空串 = 不限）。
   * 不做精准卡点：过了这个时刻，之后每一轮自动任务（10 分钟）都会按原逻辑卖。
   * 卖太早好友还没暴击、价格排后面；卖太晚高价铺子的额度又可能被别人吃满。
   */
  yishu_sell_after_time: string;
}

export interface IntervalConfig {
  farm: number;
  farmMin: number;
  farmMax: number;
  friendMin: number;
  friendMax: number;
  helpMin: number;
  helpMax: number;
  stealMin: number;
  stealMax: number;
  [key: string]: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  continueFarm: boolean;
}

export interface AccountConfig {
  automation: AutomationConfig;
  plantingStrategy: PlantingStrategy;
  /** 优先种植 2×2 作物（独立开关，可与任意策略叠加）。 */
  prioritize2x2Crops: boolean;
  /** 任务作物优先（独立开关，可与任意策略叠加；策略为 task_priority 时同样生效）。 */
  prioritizeGrowthTasks: boolean;
  preferredSeedId: number;
  intervals: IntervalConfig;
  friendQuietHours: QuietHoursConfig;
  knownFriendGids: number[];
  knownFriendGidSyncCooldownSec: number;
  friendsListCacheTtlSec: number;
  friendBlacklist: number[];
  ranchFriendBlacklist: number[];
  plantBlacklist: number[];
  stealDelaySeconds: number;
  plantOrderRandom: boolean;
  plantDelaySeconds: number;
  fertilizerBuyOrganicCount: number;
  fertilizerBuyOrganicThresholdHours: number;
  fertilizerBuyNormalCount: number;
  fertilizerBuyNormalThresholdHours: number;
  fertilizerBuyCheckIntervalMinutes: number;
  /** 每天检查邮箱奖励的时间（0-23 点，默认 10 点）；到点后每天只触发一次。 */
  emailClaimHour: number;
  bagSeedPriority: number[];
  /** 是否为明确排在前面的多格背包种子保留尚未连成布局的空地。 */
  bagSeedMultiLandReservationEnabled: boolean;
  /** 背包种子优先级面板已见过的种子 ID（用于排序展示与新增种子识别）。 */
  bagSeedKnownIds: number[];
  /** 金虫放置：背包保留数量（低于该数量的金虫不投放）。 */
  goldenBugKeepCount: number;
  /** 金虫放置：单轮投放上限。 */
  goldenBugRoundLimit: number;
  /** seedId -> 允许种植的土地类型。缺 key 视为不限制。 */
  bagSeedLandTypes: Record<string, FertilizerLandType[]>;
  bagSeedFallbackStrategy: BagSeedFallbackStrategy;
  autoAcceptFriendMinLevel: number;
  autoAcceptRequireOwnLevel: boolean;
  autoAcceptHarvestStealEnabled: boolean;
  autoAcceptHarvestStealHarvest: number;
  autoAcceptHarvestStealSteal: number;
}

export interface OfflineReminder {
  channel: string;
  /** 离线提醒是否附加重登录链接：none / qq_link / qr_link。 */
  reloginUrlMode: string;
  endpoint: string;
  token: string;
  secret: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
}

export interface UIConfig {
  theme: 'light' | 'dark';
}

export interface LoginSettings {
  wechatQrLogin: boolean;
  qqQrLogin: boolean;
  napCatEndpoint: string;
  napCatSignature: string;
}

export interface DeviceInfo {
  os: string;
  clientVersion: string;
  sysSoftware: string;
  network: string;
  memory: string;
  deviceId: string;
  userAgent: string;
}

export interface SystemConfig {
  serverUrl: string;
  clientVersion: string;
  clientVersionUpdatedAt?: number;
  wxClientVersion: string;
  wxClientVersionUpdatedAt?: number;
  platform: string;
  os: string;
  timeZone: string;
  deviceInfo: DeviceInfo;
}

export interface GlobalConfig {
  accountConfigs: Record<string, AccountConfig>;
  defaultAccountConfig: AccountConfig;
  ui: UIConfig;
  loginSettings: LoginSettings;
  offlineReminder: OfflineReminder;
  systemConfig: SystemConfig | null;
}
