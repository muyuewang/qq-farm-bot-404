export {};

const { wxCredentialHandoff } = require('./credential-handoff');
const { wxCredentialStore } = require('./credential-store');
const { isWxPlatform } = require('./constants');

function defaultFindAccount(accountId: string): any {
  const { getAccounts } = require('../../models/store');
  try {
    const data = getAccounts();
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    return accounts.find((account: any) => String(account?.id || '') === accountId) || null;
  } catch {
    return null;
  }
}

/**
 * 扫码换 Code 后，前端提交账号时由后端消费交接凭据并绑定到具体账号。
 * 平台以持久化账号为准，避免自定义请求把微信凭据绑到默认 QQ 账号；长凭据不会经过前端。
 */
function bindWxCredentialFromCode(accountId: unknown, code: unknown, payload: any, deps: any = {}): any | null {
  const id = String(accountId || '').trim();
  if (!id) return null;
  const findAccount = typeof deps.findAccount === 'function' ? deps.findAccount : defaultFindAccount;
  const persistedAccount = findAccount(id);
  const platform = String(persistedAccount?.platform || payload?.platform || '').trim().toLowerCase();
  if (!isWxPlatform(platform)) return null;
  const handoff = deps.credentialHandoff || wxCredentialHandoff;
  const store = deps.credentialStore || wxCredentialStore;
  const credential = handoff.peek(code);
  if (!credential) return null;
  const requestedWxid = String(payload?.wxid || '').trim();
  if (requestedWxid && requestedWxid !== credential.openid) return null;
  if (!store.set(id, credential)) return null;
  handoff.consume(code);
  return store.describe(id);
}

function forgetWxCredential(accountId: unknown, deps: any = {}): boolean {
  const store = deps.credentialStore || wxCredentialStore;
  return store.delete(accountId);
}

module.exports = {
  isWxPlatform,
  bindWxCredentialFromCode,
  forgetWxCredential,
};
