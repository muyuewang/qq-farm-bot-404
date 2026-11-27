export {};

const { createScheduler } = require('../services/scheduler');
const { TARGET_APP_ID, isWxPlatform } = require('../services/wx-login/constants');
const {
    isDefinitiveWxCredentialError,
    shouldRefreshForCodeError,
    sanitizeWxCredentialError,
} = require('../services/wx-login/credential-errors');
const {
    DEFAULT_WX_KICKOUT_RELOGIN,
    normalizeWxKickoutRelogin,
    resolveKickoutDelayMs,
    isCustomDelayActive,
    isReloginBudgetExhausted,
} = require('../services/wx-login/reconnect-config');

const KEEPALIVE_AHEAD_MIN_MS = 35 * 60_000;
const KEEPALIVE_AHEAD_MAX_MS = 45 * 60_000;
const KEEPALIVE_MIGRATION_MIN_MS = 2_000;
const KEEPALIVE_MIGRATION_MAX_MS = 8_000;
const KEEPALIVE_RETRY_BASE_MS = 5 * 60_000;
const KEEPALIVE_RETRY_MAX_MS = 20 * 60_000;
const CREDENTIAL_NEAR_EXPIRY_MS = KEEPALIVE_AHEAD_MAX_MS;

interface RecoveryDeps {
    store: any;
    credentialStore: any;
    startWorker: (account: any) => boolean;
    isAccountRunning?: (accountId: string) => boolean;
    issueCode: (loginBuffer: string, appId: string) => Promise<string>;
    refreshLoginBuffer: (credential: any, options?: any) => Promise<any>;
    scheduler?: any;
    log?: (tag: string, msg: string, extra?: any) => void;
    addAccountLog?: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    now?: () => number;
    random?: () => number;
}

interface CodeRefreshResult {
    ok: boolean;
    account: any | null;
    started: boolean;
}

type CodeRefreshMode = 'relogin' | 'startup';

function createWxKickoutRecoveryService(deps: RecoveryDeps) {
    const {
        store,
        credentialStore,
        startWorker,
        isAccountRunning,
        issueCode,
        refreshLoginBuffer,
    } = deps;
    const scheduler = deps.scheduler || createScheduler('wx_kickout_recovery');
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const random = typeof deps.random === 'function' ? deps.random : () => Math.random();
    const log = typeof deps.log === 'function' ? deps.log : () => {};
    const addAccountLog = typeof deps.addAccountLog === 'function' ? deps.addAccountLog : () => {};

    const recoveryState = new Map<string, { date: string; attempts: number; failures: number }>();
    const generations = new Map<string, number>();
    const pending = new Map<string, { reason: string; details: any }>();
    // 自动连回与启动前换 Code 共用同一条 singleflight，避免并发签发两个 Code。
    const codeRefreshInFlight = new Map<string, Promise<CodeRefreshResult>>();
    const credentialLocks = new Map<string, Promise<any>>();
    const keepaliveFailures = new Map<string, number>();
    // 关闭开关时递增，用于取消已经发出网络请求的自动连回；不复用 generation，
    // 以免影响不受开关限制的「启动前换 Code」。
    let reloginEpoch = 0;

    function safeLog(tag: string, msg: string, extra: any = {}): void {
        try { log(tag, msg, extra); } catch {}
    }

    function safeAccountLog(action: string, msg: string, accountId: string, accountName: string, extra: any = {}): void {
        try { addAccountLog(action, msg, accountId, accountName, extra); } catch {}
    }

    function keyOf(accountId: unknown): string {
        return String(accountId || '').trim();
    }

    function getConfig(): any {
        let raw: any = {};
        try {
            raw = typeof store.getLoginSettings === 'function' ? store.getLoginSettings() : {};
        } catch {}
        return normalizeWxKickoutRelogin(raw?.wxKickoutRelogin || DEFAULT_WX_KICKOUT_RELOGIN);
    }

    function findAccount(accountId: string): any {
        try {
            const data = store.getAccounts();
            const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
            return accounts.find((item: any) => String(item?.id || '') === accountId) || null;
        } catch {
            return null;
        }
    }

    function getRecovery(accountId: string): { date: string; attempts: number; failures: number } {
        const key = keyOf(accountId);
        const date = new Date(now()).toISOString().slice(0, 10);
        const current = recoveryState.get(key);
        if (!current || current.date !== date) {
            const fresh = { date, attempts: 0, failures: 0 };
            recoveryState.set(key, fresh);
            return fresh;
        }
        return current;
    }

    /** 只读查看当日预算，避免状态轮询不断往 recoveryState 写条目。 */
    function peekRecovery(accountId: string): { date: string; attempts: number; failures: number } {
        const key = keyOf(accountId);
        const date = new Date(now()).toISOString().slice(0, 10);
        const current = recoveryState.get(key);
        return current && current.date === date ? current : { date, attempts: 0, failures: 0 };
    }

    function isReloginCurrent(epoch: number): boolean {
        return reloginEpoch === epoch && getConfig().enabled;
    }

    function generation(accountId: string): number {
        return generations.get(keyOf(accountId)) || 0;
    }

    function bumpGeneration(accountId: string): number {
        const key = keyOf(accountId);
        const next = generation(key) + 1;
        generations.set(key, next);
        return next;
    }

    function isCurrent(accountId: string, value: number): boolean {
        return generation(accountId) === value;
    }

    function reloginTaskName(accountId: string): string {
        return `relogin_${keyOf(accountId)}`;
    }

    function keepaliveTaskName(accountId: string): string {
        return `wx_keepalive_${keyOf(accountId)}`;
    }

    function isBlocked(accountId: string): boolean {
        try {
            return credentialStore.isBlocked(accountId) === true;
        } catch {
            return false;
        }
    }

    function clearRelogin(accountId: string): void {
        scheduler.clear(reloginTaskName(accountId));
        pending.delete(keyOf(accountId));
    }

    function blockCredential(accountId: string, accountName = ''): void {
        const key = keyOf(accountId);
        try { credentialStore.markBlocked(key); } catch {}
        scheduler.clear(reloginTaskName(key));
        scheduler.clear(keepaliveTaskName(key));
        pending.delete(key);
        bumpGeneration(key);
        safeAccountLog('wx_credential_blocked', '微信授权已明确失效，请重新扫码后再启用自动连回', key, accountName);
    }

    function randomBetween(minMs: number, maxMs: number): number {
        const low = Math.max(0, Math.floor(minMs));
        const high = Math.max(low, Math.floor(maxMs));
        const ratio = Math.max(0, Math.min(1, Number(random()) || 0));
        return low + Math.floor(ratio * (high - low + 1));
    }

    function keepaliveDelayMs(record: any, mode: 'normal' | 'retry'): number {
        if (mode === 'retry') {
            const failures = Math.max(1, keepaliveFailures.get(keyOf(record?.accountId)) || 1);
            const base = Math.min(KEEPALIVE_RETRY_MAX_MS, KEEPALIVE_RETRY_BASE_MS * (2 ** Math.min(2, failures - 1)));
            return base + randomBetween(0, 60_000);
        }
        const expiresAt = Number(record?.expiresAt) || 0;
        if (expiresAt <= 0) return randomBetween(KEEPALIVE_MIGRATION_MIN_MS, KEEPALIVE_MIGRATION_MAX_MS);
        const delay = expiresAt - now() - randomBetween(KEEPALIVE_AHEAD_MIN_MS, KEEPALIVE_AHEAD_MAX_MS);
        return delay > 0 ? Math.floor(delay) : randomBetween(KEEPALIVE_MIGRATION_MIN_MS, KEEPALIVE_MIGRATION_MAX_MS);
    }

    function withCredentialLock<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
        const key = keyOf(accountId);
        const previous = credentialLocks.get(key) || Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        credentialLocks.set(key, current);
        return current.finally(() => {
            if (credentialLocks.get(key) === current) credentialLocks.delete(key);
        });
    }

    /** 只刷新长凭据，不申请游戏 Code、不启动 Worker。 */
    async function refreshCredentialRecord(accountId: string, expectedGeneration: number, stillCurrent: () => boolean): Promise<any> {
        return withCredentialLock(accountId, async () => {
            const key = keyOf(accountId);
            const original = credentialStore.get(key);
            if (!original || !original.loginBuffer || !original.refreshToken) {
                throw new Error('缺少微信刷新凭证（refreshtoken），请重新扫码登录');
            }
            let lastFingerprint = String(original.fingerprint || '');
            const persistCheckpoint = (checkpoint: any): void => {
                const current = credentialStore.get(key);
                if (!current || String(current.fingerprint || '') !== lastFingerprint) return;
                const patch: any = {
                    openid: checkpoint.openid,
                    refreshToken: checkpoint.refreshToken,
                    accessToken: checkpoint.accessToken,
                    loginType: checkpoint.loginType,
                    expiresAt: checkpoint.expiresAt,
                    expiresIn: checkpoint.expiresIn,
                    observedAt: checkpoint.observedAt,
                };
                if (checkpoint.loginBuffer && checkpoint.loginBuffer !== current.loginBuffer) {
                    patch.loginBuffer = checkpoint.loginBuffer;
                }
                const updated = credentialStore.update(key, patch);
                if (updated) lastFingerprint = String(updated.fingerprint || '');
            };
            let result: any;
            try {
                result = await refreshLoginBuffer(original, {
                    shouldContinue: stillCurrent,
                    onCredentialsRefreshed: async (checkpoint: any) => { persistCheckpoint(checkpoint); },
                });
            } catch (error: any) {
                if (error?.rotatedCredential) persistCheckpoint(error.rotatedCredential);
                throw error;
            }
            if (!stillCurrent()) return null;
            persistCheckpoint(result);
            return credentialStore.get(key);
        });
    }

    /** 长凭据保活独立于自动连回开关：启动前换 Code 仍依赖有效 refresh token。 */
    function armKeepalive(accountId: string, mode: 'normal' | 'retry' = 'normal'): boolean {
        const key = keyOf(accountId);
        const taskName = keepaliveTaskName(key);
        scheduler.clear(taskName);
        if (isBlocked(key)) return false;
        let record: any;
        try { record = credentialStore.get(key); } catch { return false; }
        if (!record || !record.loginBuffer || !record.refreshToken) return false;
        const expectedGeneration = generation(key);
        const stillCurrent = () => isCurrent(key, expectedGeneration);
        const delayMs = keepaliveDelayMs({ ...record, accountId: key }, mode);
        scheduler.setTimeoutTask(taskName, delayMs, async () => {
            if (!stillCurrent()) return;
            try {
                const updated = await refreshCredentialRecord(key, expectedGeneration, stillCurrent);
                if (!updated || !stillCurrent()) return;
                credentialStore.update(key, { lastSuccessAt: now() });
                keepaliveFailures.delete(key);
                armKeepalive(key, 'normal');
            } catch (error: any) {
                if (!stillCurrent()) return;
                const message = sanitizeWxCredentialError(error);
                if (isDefinitiveWxCredentialError(error?.message || error)) {
                    const account = findAccount(key);
                    blockCredential(key, account?.name || '');
                    return;
                }
                const failures = (keepaliveFailures.get(key) || 0) + 1;
                keepaliveFailures.set(key, failures);
                const account = findAccount(key);
                safeAccountLog('wx_credential_refresh_failed', `微信凭据续期失败: ${message}`, key, account?.name || '', { failures });
                armKeepalive(key, 'retry');
            }
        });
        return true;
    }

    function formatDelay(ms: number): string {
        const minutes = Math.max(1, Math.round(ms / 60_000));
        return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} 小时` : `${minutes} 分钟`;
    }

    async function runCodeRefresh(accountId: string, reason: string, mode: CodeRefreshMode): Promise<CodeRefreshResult> {
        const key = keyOf(accountId);
        const failed: CodeRefreshResult = { ok: false, account: null, started: false };
        const cfg = getConfig();
        const epoch = reloginEpoch;
        if (mode === 'relogin' && !cfg.enabled) return failed;
        const account = findAccount(key);
        if (!account || !isWxPlatform(account.platform)) return failed;
        if (typeof isAccountRunning === 'function' && isAccountRunning(key)) return failed;
        let record: any;
        try { record = credentialStore.get(key); } catch { return failed; }
        if (!record || !record.loginBuffer || isBlocked(key)) return failed;
        const expectedGeneration = generation(key);
        const stillCurrent = () => isCurrent(key, expectedGeneration)
            && (mode !== 'relogin' || isReloginCurrent(epoch));
        const recovery = mode === 'relogin' ? getRecovery(key) : null;
        if (recovery && isReloginBudgetExhausted(cfg, recovery)) {
            safeAccountLog('auto_relogin_blocked', '自动连回已达每日上限或连续失败熔断，请检查网络或重新扫码', key, account.name, {
                reason, attempts: recovery.attempts, failures: recovery.failures, dailyLimit: cfg.dailyLimit,
            });
            return failed;
        }
        if (recovery) recovery.attempts += 1;
        let refreshed = false;
        try {
            const nearExpiry = !record.expiresAt || Number(record.expiresAt) <= now() + CREDENTIAL_NEAR_EXPIRY_MS;
            if (nearExpiry && record.refreshToken) {
                const updated = await refreshCredentialRecord(key, expectedGeneration, stillCurrent);
                if (!stillCurrent()) return failed;
                if (updated) { record = updated; refreshed = true; }
            }
            let code = '';
            try {
                code = String(await issueCode(record.loginBuffer, TARGET_APP_ID) || '').trim();
            } catch (error: any) {
                const message = String(error?.message || error || '');
                if (!refreshed && record.refreshToken && shouldRefreshForCodeError(message)) {
                    const updated = await refreshCredentialRecord(key, expectedGeneration, stillCurrent);
                    if (!stillCurrent()) return failed;
                    if (updated) { record = updated; refreshed = true; }
                    code = String(await issueCode(record.loginBuffer, TARGET_APP_ID) || '').trim();
                } else {
                    throw error;
                }
            }
            if (!stillCurrent()) return failed;
            if (!code) throw new Error('微信未返回新的 Code');
            // 一次性 Code 绝不重放；拿到与旧值相同的 Code 不能启动 Worker。
            if (code === String(account.code || '')) throw new Error('微信返回的 Code 与一次性旧 Code 相同');
            store.addOrUpdateAccount({ id: key, code, autoStart: true });
            const persisted = findAccount(key);
            if (!persisted || String(persisted.code || '') !== code) throw new Error('账号 Code 保存失败');
            credentialStore.update(key, { lastSuccessAt: now() });
            armKeepalive(key, 'normal');
            if (mode === 'relogin') {
                if (typeof isAccountRunning === 'function' && isAccountRunning(key)) return failed;
                if (!stillCurrent()) return failed;
                const started = startWorker(persisted);
                if (started === false) throw new Error('账号启动被拒绝');
                if (recovery) recovery.failures = 0;
                keepaliveFailures.delete(key);
                clearRelogin(key);
                safeAccountLog('auto_relogin', `自动换取新 Code 并重新连接成功: ${account.name}`, key, account.name, { reason });
                safeLog('系统', `账号 ${account.name} 已自动连回`, { accountId: key, accountName: account.name, reason });
                return { ok: true, account: persisted, started: true };
            }
            safeAccountLog('startup_code_refresh', `启动前已自动换取新 Code: ${account.name}`, key, account.name);
            return { ok: true, account: persisted, started: false };
        } catch (error: any) {
            const message = sanitizeWxCredentialError(error);
            if (mode === 'relogin') {
                // 开关关闭导致的取消不是失败，不应误记失败次数或阻断凭据。
                if (!isReloginCurrent(epoch)) return failed;
                if (isDefinitiveWxCredentialError(error?.message || error)) {
                    blockCredential(key, account.name);
                    safeAccountLog('auto_relogin_blocked', '微信授权已明确失效，请重新扫码后再继续自动连回', key, account.name, { reason });
                    return failed;
                }
                if (!stillCurrent()) return failed;
                if (recovery) recovery.failures += 1;
                safeAccountLog('auto_relogin_failed', `自动连回失败: ${message}`, key, account.name, {
                    reason, attempt: recovery?.attempts || 0, failures: recovery?.failures || 0,
                });
                safeLog('错误', `账号 ${account.name} 自动连回失败: ${message}`, { accountId: key, accountName: account.name, reason });
                if (recovery && isReloginBudgetExhausted(cfg, recovery)) {
                    safeAccountLog('auto_relogin_blocked', '自动连回已达每日上限或连续失败熔断，请检查网络或重新扫码', key, account.name, {
                        reason, attempts: recovery.attempts, failures: recovery.failures, dailyLimit: cfg.dailyLimit,
                    });
                }
                return failed;
            }
            if (isDefinitiveWxCredentialError(error?.message || error)) {
                blockCredential(key, account.name);
            }
            safeAccountLog('startup_code_refresh_failed', `启动前自动换 Code 失败: ${message}`, key, account.name);
            safeLog('错误', `账号 ${account.name} 启动前自动换 Code 失败: ${message}`, {
                accountId: key,
                accountName: account.name,
            });
            return failed;
        }
    }

    function withCodeRefresh(accountId: string, reason: string, mode: CodeRefreshMode): Promise<CodeRefreshResult> {
        const key = keyOf(accountId);
        const running = codeRefreshInFlight.get(key);
        if (running) return running;
        const task = runCodeRefresh(key, reason, mode);
        codeRefreshInFlight.set(key, task);
        return task.finally(() => {
            if (codeRefreshInFlight.get(key) === task) codeRefreshInFlight.delete(key);
        });
    }

    async function refreshAccountCode(accountId: string, reason = 'manual_relogin'): Promise<boolean> {
        const result = await withCodeRefresh(accountId, reason, 'relogin');
        return result.ok && result.started;
    }

    async function refreshCodeForStartup(accountId: string): Promise<any | null> {
        const result = await withCodeRefresh(accountId, 'startup_recovery', 'startup');
        return result.ok ? result.account : null;
    }

    function scheduleKickoutRelogin(accountId: string, reason: string, details: any = {}): boolean {
        const key = keyOf(accountId);
        const cfg = getConfig();
        if (!cfg.enabled) return false;
        const account = findAccount(key);
        if (!account || !isWxPlatform(account.platform)) return false;
        let record: any;
        try { record = credentialStore.get(key); } catch { return false; }
        if (!record || !record.loginBuffer) {
            safeAccountLog('auto_relogin_unavailable', '该账号没有可复用的微信凭据，请重新扫码一次后再启用自动连回', key, account.name);
            return false;
        }
        if (isBlocked(key)) return false;
        // 换码请求在途时不要重复排程；pending/scheduler 守卫无法覆盖 timer 回调已启动的阶段。
        if (codeRefreshInFlight.has(key)) return true;
        if (pending.has(key) && typeof scheduler.has === 'function' && scheduler.has(reloginTaskName(key))) return true;
        const recovery = getRecovery(key);
        if (isReloginBudgetExhausted(cfg, recovery)) {
            safeAccountLog('auto_relogin_blocked', '自动连回已达每日上限或连续失败熔断，请检查网络或重新扫码', key, account.name, {
                reason, attempts: recovery.attempts, failures: recovery.failures, dailyLimit: cfg.dailyLimit,
            });
            return false;
        }
        const delayMs = resolveKickoutDelayMs(cfg, recovery.attempts, now());
        const custom = isCustomDelayActive(cfg, now());
        const expectedGeneration = generation(key);
        const stillCurrent = () => isCurrent(key, expectedGeneration);
        const epoch = reloginEpoch;
        scheduler.clear(reloginTaskName(key));
        pending.set(key, { reason, details });
        scheduler.setTimeoutTask(reloginTaskName(key), delayMs, async () => {
            pending.delete(key);
            if (!stillCurrent() || !isReloginCurrent(epoch)) return;
            // Worker 未真正停机时不消耗每日预算反复重试，等后续离线事件重新排程。
            if (typeof isAccountRunning === 'function' && isAccountRunning(key)) {
                safeAccountLog('auto_relogin_skipped', '账号仍在运行，已跳过本次自动连回', key, account.name, { reason });
                return;
            }
            try {
                const ok = await refreshAccountCode(key, reason);
                if (!ok && stillCurrent() && isReloginCurrent(epoch) && !isBlocked(key)) scheduleKickoutRelogin(key, reason, details);
            } catch {
                if (stillCurrent() && isReloginCurrent(epoch) && !isBlocked(key)) scheduleKickoutRelogin(key, reason, details);
            }
        });
        // 等待期间只滚动长凭据，不提前申请 Code 或启动 Worker。
        armKeepalive(key, 'normal');
        const delayText = `${custom ? '自定义 ' : ''}${formatDelay(delayMs)}`;
        safeAccountLog('kickout_relogin_scheduled', `被踢下线或登录态失效，${delayText}后自动连回（今日第 ${recovery.attempts + 1} 次）`, key, account.name, {
            reason, delayMs, attempt: recovery.attempts + 1, custom,
        });
        safeLog('系统', `账号 ${account.name} ${delayText}后自动尝试连回`, {
            accountId: key, accountName: account.name, reason, delayMs, attempt: recovery.attempts + 1,
        });
        return true;
    }

    function onTerminalEvent(accountId: string, kind: string, payload: any = {}): boolean {
        const key = keyOf(accountId);
        if (kind === 'kickout') return scheduleKickoutRelogin(key, 'kickout', payload);
        // WS 400 表示旧登录态已被拒绝；普通 ws_close / heartbeat_timeout 保持既有停止策略。
        if (kind === 'ws_400') return scheduleKickoutRelogin(key, 'ws_400', payload);
        return false;
    }

    function bindCredential(accountId: string): any {
        const key = keyOf(accountId);
        bumpGeneration(key);
        clearRelogin(key);
        scheduler.clear(keepaliveTaskName(key));
        keepaliveFailures.delete(key);
        recoveryState.delete(key);
        try { credentialStore.clearBlocked(key); } catch {}
        armKeepalive(key, 'normal');
        const account = findAccount(key);
        safeAccountLog('wx_credential_bound', '已保存微信自动连回凭据', key, account?.name || '');
        return getStatus(key);
    }

    function onManualStart(accountId: string): void {
        const key = keyOf(accountId);
        bumpGeneration(key);
        clearRelogin(key);
        armKeepalive(key, 'normal');
    }

    function onManualStop(accountId: string): void {
        const key = keyOf(accountId);
        bumpGeneration(key);
        clearRelogin(key);
        // 手动停止只取消自动连回排程；长凭据仍需续期，否则长期停用后只能重新扫码。
        armKeepalive(key, 'normal');
    }

    function forgetAccount(accountId: string): void {
        const key = keyOf(accountId);
        bumpGeneration(key);
        clearRelogin(key);
        scheduler.clear(keepaliveTaskName(key));
        keepaliveFailures.delete(key);
        recoveryState.delete(key);
        try { credentialStore.delete(key); } catch {}
    }

    /** 内存里出现过的账号与已持久化凭据账号的并集。 */
    function allTrackedIds(): Set<string> {
        const ids = new Set<string>([
            ...recoveryState.keys(),
            ...pending.keys(),
            ...generations.keys(),
        ]);
        try {
            for (const id of credentialStore.listAccountIds()) ids.add(id);
        } catch {}
        return ids;
    }

    function cancelReloginTasks(): void {
        // 递增 epoch 会让所有在途的自动连回在下一个检查点退出；
        // 只影响自动连回，不影响不受开关限制的启动前换 Code 与凭据保活。
        reloginEpoch += 1;
        for (const id of allTrackedIds()) clearRelogin(id);
        pending.clear();
    }

    function rescheduleAll(): number {
        if (!getConfig().enabled) {
            cancelReloginTasks();
            return 0;
        }
        let count = 0;
        let ids: string[] = [];
        try { ids = credentialStore.listAccountIds(); } catch { return 0; }
        for (const id of ids) {
            const account = findAccount(id);
            if (!account || !isWxPlatform(account.platform) || isBlocked(id)) continue;
            if (armKeepalive(id, 'normal')) count += 1;
        }
        return count;
    }

    function getStatus(accountId: string): any {
        const key = keyOf(accountId);
        const cfg = getConfig();
        const recovery = peekRecovery(key);
        let credentialStatus: any = { bound: false, blocked: false, credentialReady: false, expiresAt: 0, lastSuccessAt: 0 };
        try { credentialStatus = credentialStore.describe(key); } catch {}
        let nextRunAt = 0;
        try {
            const snapshot = typeof scheduler.getSnapshot === 'function' ? scheduler.getSnapshot() : null;
            const task = snapshot?.tasks?.find((item: any) => item.name === reloginTaskName(key));
            nextRunAt = Number(task?.nextRunAt) || 0;
        } catch {}
        return {
            enabled: cfg.enabled,
            ...credentialStatus,
            pending: pending.has(key),
            nextRunAt,
            attempts: recovery.attempts,
            failures: recovery.failures,
            delayMinutes: cfg.delayMinutes,
            dailyLimit: cfg.dailyLimit,
            validUntil: cfg.validUntil,
        };
    }

    function shutdown(): void {
        cancelReloginTasks();
        for (const id of allTrackedIds()) scheduler.clear(keepaliveTaskName(id));
    }

    return {
        onTerminalEvent,
        scheduleKickoutRelogin,
        refreshAccountCode,
        refreshCodeForStartup,
        bindCredential,
        onManualStart,
        onManualStop,
        forgetAccount,
        rescheduleAll,
        getStatus,
        shutdown,
    };
}

module.exports = { createWxKickoutRecoveryService };
