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

export function isWithinActivityWindowMs(window: { startMs: number, endMs: number }, nowMs = Date.now()) {
  return nowMs >= window.startMs && nowMs <= window.endMs
}
