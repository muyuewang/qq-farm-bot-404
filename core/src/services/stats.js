const process = require('node:process');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

// ─── 持久化路径 ───

function getStatsFilePath(accountId) {
  const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  return path.join(baseDir, 'stats', `${accountId  }.json`);
}

/** 获取 YYYY-MM-DD 格式的当天日期键 */
function getTodayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadPersistedStats(accountId) {
  const filePath = getStatsFilePath(accountId);
  return readJsonFile(filePath, null);
}

function savePersistedStats(accountId, data) {
  try {
    const filePath = getStatsFilePath(accountId);
    writeJsonFileAtomic(filePath, data);
  } catch {}
}

// ─── 运行状态 ───

/** 每日操作计数（按类型） */
const operations = {
  harvest: 0,
  water: 0,
  weed: 0,
  bug: 0,
  farming: 0,
  fertilize: 0,
  plant: 0,
  steal: 0,
  helpWater: 0,
  helpWeed: 0,
  helpBug: 0,
  goldenBugClear: 0,
  goldenBugPut: 0,
  taskClaim: 0,
  sell: 0,
  upgrade: 0,
  levelUp: 0,
  tongQiGift: 0
};

/** 同气连枝礼包计数 */
let tongQiGiftCount = 0;
/** 当前日期键，跨天时自动重置 */
let currentDateKey = null;

/** 上次记录的金币/经验/点券值（用于计算增量） */
const lastState = {
  gold: -1,
  exp: -1,
  coupon: -1
};

/** 初始值（会话开始时记录） */
const initialState = {
  gold: null,
  exp: null,
  coupon: null
};

/** 会话期间累计增益 */
const session = {
  goldGained: 0,
  expGained: 0,
  couponGained: 0,
  lastExpGain: 0,
  lastGoldGain: 0
};

let sessionStartedAt = Date.now();

let currentAccountId = null;
let saveTimer = null;

// ─── 公开 API ───

/**
 * 记录一次操作
 * @param {string} opType - 操作类型（harvest/plant/steal 等）
 * @param {number} count - 次数，默认 1
 */
function recordOperation(opType, count = 1) {
  checkAndResetDailyStats();
  if (operations[opType] !== undefined) {
    operations[opType] += count;
    scheduleSave();
  }
}

/** 记录同气连枝礼包 */
function recordTongQiGift(count = 1) {
  checkAndResetDailyStats();
  tongQiGiftCount += count;
  operations.tongQiGift = tongQiGiftCount;
  scheduleSave();
}

function getTongQiGiftCount() {
  checkAndResetDailyStats();
  return tongQiGiftCount;
}

function getTongQiGiftLimit() {
  return null; // 当前无限制
}

/** 检查是否跨天，若跨天则重置每日统计 */
function checkAndResetDailyStats() {
  if (!currentAccountId) return;
  const todayKey = getTodayKey();
  if (currentDateKey && currentDateKey !== todayKey) {
    console.warn(`[统计] 检测到跨天，重置每日统计 (${currentDateKey} -> ${todayKey})`);
    Object.keys(operations).forEach(k => { operations[k] = 0; });
    tongQiGiftCount = 0;
  }
  currentDateKey = todayKey;
}

/** 延迟 2 秒后保存（防抖） */
function scheduleSave() {
  if (!currentAccountId) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    doSave();
  }, 2000);
}

function doSave() {
  if (!currentAccountId) return;
  const todayKey = getTodayKey();
  const ops = { ...operations };
  const init = { ...initialState };
  const data = {
    date: todayKey,
    operations: ops,
    tongQiGiftCount,
    initialState: init,
    savedAt: Date.now()
  };
  savePersistedStats(currentAccountId, data);
}

/**
 * 初始化统计（设置初始金币/经验/点券）
 * @param {number} gold - 当前金币
 * @param {number} exp - 当前经验
 * @param {number} coupon - 当前点券（默认 0）
 */
function initStats(gold, exp, coupon = 0) {
  sessionStartedAt = Date.now();
  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  lastState.gold = g;
  lastState.exp = e;
  lastState.coupon = c;
  initialState.gold = g;
  initialState.exp = e;
  initialState.coupon = c;
}

/**
 * 初始化统计并加载持久化数据
 * @param {string} accountId - 账号 ID
 * @param {number} gold - 金币
 * @param {number} exp - 经验
 * @param {number} coupon - 点券（默认 0）
 */
function initStatsWithPersistence(accountId, gold, exp, coupon = 0) {
  currentAccountId = accountId;
  const todayKey = getTodayKey();
  currentDateKey = todayKey;
  // 重置运行时状态
  Object.keys(operations).forEach(k => { operations[k] = 0; });
  tongQiGiftCount = 0;
  lastState.gold = -1;
  lastState.exp = -1;
  lastState.coupon = -1;
  initialState.gold = null;
  initialState.exp = null;
  initialState.coupon = null;
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastExpGain = 0;
  session.lastGoldGain = 0;

  // 尝试恢复今日持久化数据
  const persisted = loadPersistedStats(accountId);
  if (persisted && persisted.date === todayKey) {
    Object.keys(persisted.operations || {}).forEach(k => {
      if (operations[k] !== undefined) {
        operations[k] = Number(persisted.operations[k]) || 0;
      }
    });
    tongQiGiftCount = Number(persisted.tongQiGiftCount) || Number(operations.tongQiGift) || 0;
    operations.tongQiGift = tongQiGiftCount;
    console.warn(`[统计] 已恢复今日统计数据: ${JSON.stringify(persisted.operations)}, 同气连枝礼包: ${tongQiGiftCount}`);
  } else if (persisted) {
    console.warn(`[统计] 日期已变更，重置统计 (${persisted.date} -> ${todayKey})`);
  } else {
    console.warn('[统计] 新账号初始化，无历史数据');
  }
  initStats(gold, exp, coupon);
}

/**
 * 更新金币/经验差值追踪
 * @param {number} gold - 当前金币
 * @param {number} exp - 当前经验
 */
function updateStats(gold, exp) {
  if (lastState.gold === -1) lastState.gold = gold;
  if (lastState.exp === -1) lastState.exp = exp;

  // 金币增量
  if (gold > lastState.gold) {
    session.lastGoldGain = gold - lastState.gold;
  } else if (gold < lastState.gold) {
    session.lastGoldGain = 0;
  }
  lastState.gold = gold;

  // 经验增量（带同值去重，避免短时间内重复计算）
  if (exp > lastState.exp) {
    const gain = exp - lastState.exp;
    const now = Date.now();
    // 如果和上次增量相同且时间间隔 < 5s，跳过（去重）
    if (gain === session.lastExpGain && now - (session.lastExpTime || 0) < 5000) {
      // skip duplicate
    } else {
      session.lastExpGain = gain;
      session.lastExpTime = now;
    }
  } else {
    session.lastExpGain = 0;
  }
  lastState.exp = exp;
}

function recordGoldExp(gold, exp) {
  updateStats(gold, exp);
}

function setInitialValues(gold, exp, coupon = 0) {
  initStats(gold, exp, coupon);
}

/** 重置会话增益 */
function resetSessionGains() {
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastGoldGain = 0;
  session.lastExpGain = 0;
  session.lastExpTime = 0;
}

/** 根据初始值重新计算会话总增益 */
function recomputeSessionTotals(gold, exp, coupon) {
  if (initialState.gold === null || initialState.exp === null || initialState.coupon === null) {
    initialState.gold = gold;
    initialState.exp = exp;
    initialState.coupon = coupon;
  }
  session.goldGained = gold - initialState.gold;
  session.expGained = exp - initialState.exp;
  session.couponGained = coupon - initialState.coupon;
}

/**
 * 获取完整统计快照（供 API 返回）
 * @param {object} farmUser - 农场用户数据
 * @param {object} userState - 用户状态（含 gold/exp/coupon）
 * @param {boolean} connected - 是否连接中
 * @param {object} limits - 操作次数限制
 */
function getStats(farmUser, userState, connected, limits) {
  checkAndResetDailyStats();
  const fu = farmUser && typeof farmUser === 'object' ? farmUser : {};
  const us = userState && typeof userState === 'object' ? userState : {};

  const gold = us.gold ?? fu.gold;
  const exp = us.exp ?? fu.exp;
  const coupon = us.coupon ?? fu.coupon;
  const diamond = us.diamond ?? fu.diamond;
  const goldBean = us.goldBean ?? fu.goldBean;

  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  const d = Number.isFinite(Number(diamond)) ? Number(diamond) : 0;
  const gb = Number.isFinite(Number(goldBean)) ? Number(goldBean) : 0;

  // 如果已连接，更新内部追踪并重新计算会话增益
  if (connected) {
    updateStats(g, e);
    recomputeSessionTotals(g, e, c);
  }

  const ops = { ...operations, tongQiGift: tongQiGiftCount };

  return {
    connection: { connected },
    status: {
      name: us.name || fu.name,
      level: fu.level || us.level || 0,
      gold: g,
      coupon: Number.isFinite(Number(us.coupon)) ? Number(us.coupon) : 0,
      diamond: d,
      goldBean: gb,
      exp: e,
      platform: fu.platform || us.platform || 'qq',
      gid: us.gid || fu.gid || 0,
      openId: us.openId || fu.openId || fu.open_id || '',
      avatar: us.avatar || fu.avatar || fu.avatarUrl || fu.avatar_url || ''
    },
    uptime: process.uptime(),
    sessionElapsedSeconds: Math.max(0, (Date.now() - sessionStartedAt) / 1000),
    operations: ops,
    tongQiGiftCount,
    tongQiGiftLimit: null,
    sessionExpGained: session.expGained,
    sessionGoldGained: session.goldGained,
    sessionCouponGained: session.couponGained,
    lastExpGain: session.lastExpGain,
    lastGoldGain: session.lastGoldGain,
    limits
  };
}

function saveStats() {
  doSave();
}

module.exports = {
  recordOperation,
  recordTongQiGift,
  getTongQiGiftCount,
  getTongQiGiftLimit,
  initStats,
  initStatsWithPersistence,
  updateStats,
  setInitialValues,
  recordGoldExp,
  resetSessionGains,
  getStats,
  saveStats,
  getTodayKey,
  loadPersistedStats,
  checkAndResetDailyStats
};
