import type { WxCredentialRecord, WxCredentialSnapshot } from './types';
export {};

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDataFile } = require('../../config/runtime-paths');
const { storageError } = require('../json-db');

const DEFAULT_EXPIRES_IN_SECONDS = 7200;

interface CredentialStoreOptions {
  filePath?: string;
  now?: () => number;
}

interface PublicCredentialStatus {
  bound: boolean;
  blocked: boolean;
  credentialReady: boolean;
  expiresAt: number;
  lastSuccessAt: number;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** 凭据身份只由长凭据本身计算：新扫码改变身份后，旧的「明确失效」阻断应自动解除。 */
function credentialFingerprint(record: Pick<WxCredentialSnapshot, 'openid' | 'loginBuffer' | 'refreshToken' | 'observedAt'>): string {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([
      String(record.openid || ''),
      String(record.loginBuffer || ''),
      String(record.refreshToken || ''),
      safeNumber(record.observedAt),
    ]))
    .digest('hex');
  return digest.slice(0, 24);
}

function buildRecord(raw: unknown, previous: WxCredentialRecord | null, now: number): WxCredentialRecord | null {
  const merged = { ...(previous || {}), ...asRecord(raw) };
  const openid = String(merged.openid || '').trim();
  const loginBuffer = String(merged.loginBuffer || '').trim();
  if (!openid || !loginBuffer) return null;
  const base: WxCredentialRecord = {
    openid,
    loginBuffer,
    refreshToken: String(merged.refreshToken || '').trim(),
    accessToken: String(merged.accessToken || '').trim(),
    loginType: String(merged.loginType || 'WX').trim() || 'WX',
    expiresAt: safeNumber(merged.expiresAt),
    expiresIn: safeNumber(merged.expiresIn, DEFAULT_EXPIRES_IN_SECONDS),
    observedAt: safeNumber(merged.observedAt, now),
    fingerprint: '',
    blocked: merged.blocked === true,
    blockedFingerprint: String(merged.blockedFingerprint || ''),
    lastSuccessAt: safeNumber(merged.lastSuccessAt),
    updatedAt: now,
  };
  if (!base.expiresAt) base.expiresAt = now + (base.expiresIn || DEFAULT_EXPIRES_IN_SECONDS) * 1000;
  base.fingerprint = credentialFingerprint(base);
  return base;
}

function ensureSecureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // 仅新建目录时给 0700；已有 core/data 由多个模块共用，不能整体 chmod。
}

function createWxCredentialStore(options: CredentialStoreOptions = {}) {
  const filePath = String(options.filePath || getDataFile('wx-credentials.json'));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const accounts: Record<string, WxCredentialRecord> = Object.create(null);
  let loaded = false;

  function load(): Record<string, WxCredentialRecord> {
    if (loaded) return accounts;
    loaded = true;
    if (!fs.existsSync(filePath)) return accounts;
    let parsed: any;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error: any) {
      throw storageError('读取', filePath, error);
    }
    const source = asRecord(asRecord(parsed).accounts);
    const timestamp = now();
    for (const [id, value] of Object.entries(source)) {
      const key = String(id || '').trim();
      if (!key) continue;
      const record = buildRecord(value, null, timestamp);
      if (record) accounts[key] = record;
    }
    try {
      fs.chmodSync(filePath, 0o600);
    } catch (chmodErr: any) {
      // 旧版本留下的宽松权限可能位于只读挂载上；不阻断读取，但告知运维凭据文件权限可能宽松。
      process.stderr.write(`[wx-credentials] 无法设置凭据文件权限 (${filePath}): ${chmodErr?.message || chmodErr}\n`);
    }
    return accounts;
  }

  function persist(): void {
    ensureSecureParentDir(filePath);
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, accounts }, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
      try {
        fs.chmodSync(filePath, 0o600);
      } catch {}
    } catch (error: any) {
      throw storageError('保存', filePath, error);
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
    }
  }

  function keyOf(accountId: unknown): string {
    return String(accountId || '').trim();
  }

  function get(accountId: unknown): WxCredentialRecord | null {
    const record = load()[keyOf(accountId)];
    return record ? { ...record } : null;
  }

  function set(accountId: unknown, credential: WxCredentialSnapshot): WxCredentialRecord | null {
    const key = keyOf(accountId);
    if (!key) return null;
    const timestamp = now();
    const record = buildRecord({
      ...credential,
      blocked: false,
      blockedFingerprint: '',
      lastSuccessAt: timestamp,
    }, null, timestamp);
    if (!record) return null;
    load()[key] = record;
    persist();
    return { ...record };
  }

  function update(accountId: unknown, patch: Partial<WxCredentialRecord>): WxCredentialRecord | null {
    const key = keyOf(accountId);
    const data = load();
    const previous = data[key];
    if (!previous) return null;
    const record = buildRecord(patch, previous, now());
    if (!record) return null;
    data[key] = record;
    persist();
    return { ...record };
  }

  function deleteCredential(accountId: unknown): boolean {
    const key = keyOf(accountId);
    const data = load();
    if (!data[key]) return false;
    delete data[key];
    persist();
    return true;
  }

  function isBlocked(accountId: unknown): boolean {
    const record = get(accountId);
    if (!record || !record.blocked) return false;
    return record.blockedFingerprint === record.fingerprint;
  }

  function markBlocked(accountId: unknown): boolean {
    const record = get(accountId);
    if (!record) return false;
    update(accountId, { blocked: true, blockedFingerprint: record.fingerprint });
    return true;
  }

  function clearBlocked(accountId: unknown): boolean {
    if (!get(accountId)) return false;
    update(accountId, { blocked: false, blockedFingerprint: '' });
    return true;
  }

  function describe(accountId: unknown): PublicCredentialStatus {
    const record = get(accountId);
    return {
      bound: !!record,
      blocked: isBlocked(accountId),
      credentialReady: !!record && !!record.loginBuffer && !!record.refreshToken,
      expiresAt: record ? record.expiresAt : 0,
      lastSuccessAt: record ? record.lastSuccessAt : 0,
    };
  }

  function listAccountIds(): string[] {
    return Object.keys(load());
  }

  return {
    filePath,
    get,
    set,
    update,
    delete: deleteCredential,
    isBlocked,
    markBlocked,
    clearBlocked,
    describe,
    listAccountIds,
  };
}

const wxCredentialStore = createWxCredentialStore();

module.exports = {
  createWxCredentialStore,
  wxCredentialStore,
  credentialFingerprint,
};
