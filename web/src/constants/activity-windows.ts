export const RAIN_POEM_ACTIVITY_WINDOW = {
  startMs: 1787709600 * 1000,
  endMs: 1788883199 * 1000,
  updatedMs: 1787709600 * 1000,
}

export const CHARITY_FLOWER_ACTIVITY_WINDOW = {
  startMs: 1788192000 * 1000,
  endMs: 1788969599 * 1000,
  updatedMs: 1788220800 * 1000,
}

// 萌宠日记（S3 比熊萌宠主题赛季）。时间窗取自官方 activity_windows 登记，
// 服务端时间为 UTC+8 秒级时间戳。
// 同步点：core/src/models/store.js 的 TIMED_ACTIVITY_AUTOMATION_GROUPS 有同一份字面量，
// 改这里必须同时改那里，否则设置页会显示后端已强制关闭的自动化开关。
export const PET_DIARY_ACTIVITY_WINDOW = {
  startMs: 1789005600 * 1000,
  endMs: 1791820799 * 1000,
  updatedMs: 1789005600 * 1000,
}

export const WISH_SIGN_ACTIVITY_WINDOW = {
  startMs: 1790179200 * 1000,
  endMs: 1791388799 * 1000,
  updatedMs: 1790179200 * 1000,
}

export const SHARE_REWARD_ACTIVITY_WINDOW = {
  startMs: 1790179200 * 1000,
  endMs: 1791820799 * 1000,
  updatedMs: 1790179200 * 1000,
}

// 快乐不独享的新接口按实例 ID 白名单读取（core/src/activity-data/share-reward-instances.json），
// 2026092501 是这期秋日分享活动的实例；奶茶组下的实例在 milk-tea 适配器里单独登记。
export const SHARE_REWARD_ACTIVITY_ID = '2026092501'

export function isWithinActivityWindowMs(window: { startMs: number, endMs: number }, nowMs = Date.now()) {
  return nowMs >= window.startMs && nowMs <= window.endMs
}

// 以薯换福（活动组 2026111707）：时间窗取文档登记的活动期 2026-11-25 ~ 2026-12-09（UTC+8）。
// 服务端目录时间才是权威；这里只供设置页自动化开关与列表卡片的时效判断。
export const YISHU_HUANFU_ACTIVITY_WINDOW = { startMs: 1795564800000, endMs: 1796860799000, updatedMs: 1795564800000 }

export const MILK_TEA_ACTIVITY_WINDOW = { startMs: 1792029600000, endMs: 1794844799000, updatedMs: 1792029600000 }
export const MILK_TEA_BUSINESS_WINDOW = { ...MILK_TEA_ACTIVITY_WINDOW, endMs: 1794671998000 }
