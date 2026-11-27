import type { WxCredentialSnapshot } from './types';
export {};

const crypto = require('node:crypto');

const HANDOFF_TTL_MS = 5 * 60_000;
const MAX_PENDING = 64;

interface HandoffOptions {
    now?: () => number;
    /** 超过上限或 TTL 清理时通知调用方，避免静默丢弃仍待绑定的凭据。 */
    onEvicted?: (count: number) => void;
}

interface PendingEntry {
    createdAt: number;
    credential: WxCredentialSnapshot;
}

/** 用一次性 Code 的摘要做键，避免内存里保留 Code 原文。 */
function hashCode(code: string): string {
    return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function cloneCredential(credential: WxCredentialSnapshot): WxCredentialSnapshot {
    return {
        openid: String(credential?.openid || ''),
        loginBuffer: String(credential?.loginBuffer || ''),
        refreshToken: String(credential?.refreshToken || ''),
        accessToken: String(credential?.accessToken || ''),
        loginType: String(credential?.loginType || 'WX'),
        expiresAt: Number(credential?.expiresAt) || 0,
        expiresIn: Number(credential?.expiresIn) || 7200,
        observedAt: Number(credential?.observedAt) || Date.now(),
    };
}

function createCredentialHandoff(options: HandoffOptions = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const onEvicted = typeof options.onEvicted === 'function' ? options.onEvicted : () => {};
    const pending = new Map<string, PendingEntry>();

    function cleanup(): number {
        const current = now();
        let evicted = 0;
        for (const [key, entry] of pending) {
            if (current - entry.createdAt > HANDOFF_TTL_MS) {
                pending.delete(key);
                evicted += 1;
            }
        }
        while (pending.size > MAX_PENDING) {
            const oldest = pending.keys().next().value;
            if (oldest === undefined) break;
            pending.delete(oldest);
            evicted += 1;
        }
        if (evicted > 0) {
            try { onEvicted(evicted); } catch {}
        }
        return evicted;
    }

    function register(code: unknown, credential: WxCredentialSnapshot | null | undefined): boolean {
        const raw = String(code || '').trim();
        // 与 credentialStore.describe().credentialReady 保持一致：没有 refreshtoken 的凭据
        // 无法续期，不应向前端报告「自动连回凭据已保存」。
        if (!raw || !credential?.loginBuffer || !credential?.openid || !credential?.refreshToken) return false;
        cleanup();
        pending.set(hashCode(raw), { createdAt: now(), credential: cloneCredential(credential) });
        return true;
    }

    /** 校验阶段只读，成功后才由 consume 删除，避免校验失败丢凭据。 */
    function peek(code: unknown): WxCredentialSnapshot | null {
        const raw = String(code || '').trim();
        if (!raw) return null;
        cleanup();
        const entry = pending.get(hashCode(raw));
        return entry ? cloneCredential(entry.credential) : null;
    }

    function consume(code: unknown): WxCredentialSnapshot | null {
        const raw = String(code || '').trim();
        if (!raw) return null;
        cleanup();
        const key = hashCode(raw);
        const entry = pending.get(key);
        if (!entry) return null;
        pending.delete(key);
        return cloneCredential(entry.credential);
    }

    function clear(): void {
        pending.clear();
    }

    return { register, peek, consume, clear, size: () => pending.size };
}

const wxCredentialHandoff = createCredentialHandoff({
    onEvicted: count => console.warn(`[wx-login] 已清理 ${count} 条过期待绑定凭据交接`),
});

module.exports = {
    HANDOFF_TTL_MS,
    MAX_PENDING,
    createCredentialHandoff,
    wxCredentialHandoff,
};
