export {};

export const TARGET_APP_ID = 'wx5306c5978fdb76e4';

export function isWxPlatform(platform: unknown): boolean {
  const value = String(platform || '').trim().toLowerCase();
  return value === 'wx' || value === 'wechat';
}
