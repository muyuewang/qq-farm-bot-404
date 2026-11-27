import type { WxKickoutReloginConfig } from '../../types/config';
export {};

const MINUTE_MS = 60_000;
const BACKOFF_STEPS_MS = [5 * MINUTE_MS, 30 * MINUTE_MS, 60 * MINUTE_MS, 3 * 60 * MINUTE_MS];
const MAX_DAILY_LIMIT = 999;
const MAX_CONSECUTIVE_FAILURES = 3;

const DEFAULT_WX_KICKOUT_RELOGIN: WxKickoutReloginConfig = {
  enabled: true,
  delayMinutes: 0,
  dailyLimit: 5,
  validUntil: '',
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeWxKickoutRelogin(input: unknown): WxKickoutReloginConfig {
  const src = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const enabled = typeof src.enabled === 'boolean' ? src.enabled : true;
  const validUntil = typeof src.validUntil === 'string' ? src.validUntil.trim().slice(0, 64) : '';
  const dailyLimit = src.dailyLimit === undefined || src.dailyLimit === null || src.dailyLimit === ''
    ? DEFAULT_WX_KICKOUT_RELOGIN.dailyLimit
    : clampInt(src.dailyLimit, 0, MAX_DAILY_LIMIT, DEFAULT_WX_KICKOUT_RELOGIN.dailyLimit);
  return {
    enabled,
    delayMinutes: clampInt(src.delayMinutes, 0, 4320, 0),
    dailyLimit,
    validUntil,
  };
}

function kickoutBackoffMs(attemptIndex: number): number {
  const index = Math.max(0, Math.floor(Number(attemptIndex) || 0));
  return BACKOFF_STEPS_MS[Math.min(index, BACKOFF_STEPS_MS.length - 1)];
}

/** 自定义延迟必须带明确时区；datetime-local 的裸字符串不按服务器时区猜测。 */
function isCustomDelayActive(cfg: WxKickoutReloginConfig, now = Date.now()): boolean {
  const delayMinutes = Number(cfg?.delayMinutes) || 0;
  if (delayMinutes <= 0) return false;
  const raw = String(cfg?.validUntil || '').trim();
  if (!raw) return true;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return false;
  const validUntil = Date.parse(raw);
  return Number.isFinite(validUntil) && validUntil > now;
}

function resolveKickoutDelayMs(cfg: WxKickoutReloginConfig, attemptIndex: number, now = Date.now()): number {
  return isCustomDelayActive(cfg, now)
    ? Math.max(1, Math.floor(Number(cfg.delayMinutes) || 0)) * MINUTE_MS
    : kickoutBackoffMs(attemptIndex);
}

function isReloginBudgetExhausted(cfg: WxKickoutReloginConfig, recovery: { attempts: number; failures: number }): boolean {
  const limit = Number(cfg?.dailyLimit) || 0;
  if (limit <= 0) return false;
  return Number(recovery?.attempts) >= limit || Number(recovery?.failures) >= MAX_CONSECUTIVE_FAILURES;
}

module.exports = {
  DEFAULT_WX_KICKOUT_RELOGIN,
  MAX_CONSECUTIVE_FAILURES,
  normalizeWxKickoutRelogin,
  kickoutBackoffMs,
  isCustomDelayActive,
  resolveKickoutDelayMs,
  isReloginBudgetExhausted,
};
