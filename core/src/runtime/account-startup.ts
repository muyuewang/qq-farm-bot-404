export {};

const { isWxPlatform } = require('../services/wx-login/constants');

interface AccountStartupDeps {
    store: any;
    credentialStore: any;
    refreshCodeForStartup: (accountId: string) => Promise<any | null>;
    startWorker: (account: any) => boolean;
    log?: (tag: string, msg: string, extra?: any) => void;
    addAccountLog?: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    /** 启动恢复的并发数；默认 2，避免串行等待多个微信换码。 */
    concurrency?: number;
}

interface PrepareOptions {
    /** 账号刚通过扫码/手工输入获得全新 Code，无需再换一次。 */
    freshCode?: boolean;
}

function createAccountStartupService(deps: AccountStartupDeps) {
    const { store, credentialStore, refreshCodeForStartup, startWorker } = deps;
    const log = typeof deps.log === 'function' ? deps.log : () => {};
    const addAccountLog = typeof deps.addAccountLog === 'function' ? deps.addAccountLog : () => {};
    const concurrency = Math.max(1, Math.min(4, Math.floor(Number(deps.concurrency) || 2)));

    function safeLog(tag: string, msg: string, extra: any = {}): void {
        try { log(tag, msg, extra); } catch {}
    }

    function safeAccountLog(action: string, msg: string, accountId: string, accountName: string): void {
        try { addAccountLog(action, msg, accountId, accountName); } catch {}
    }

    function findAccount(accountId: unknown): any {
        const id = String(accountId || '').trim();
        try {
            const data = store.getAccounts();
            const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
            return accounts.find((item: any) => String(item?.id || '') === id) || null;
        } catch {
            return null;
        }
    }

    /**
     * 启动前准备账号：非微信账号直接沿用现有 Code；微信账号用持久化的长凭据换全新 Code。
     * 未绑定长凭据的微信账号回退为沿用现有 Code，避免升级后旧账号或手工输入 Code 的账号
     * 既无法自动恢复、也无法手动启动。不受被踢自动连回开关或每日预算影响，也不自己启动 Worker。
     */
    async function prepareAccountForStart(accountId: unknown, options: PrepareOptions = {}): Promise<any | null> {
        const id = String(accountId || '').trim();
        const account = findAccount(id);
        if (!account) return null;
        if (options.freshCode === true || !isWxPlatform(account?.platform)) return account;

        let status: any;
        try {
            status = credentialStore.describe(id);
        } catch {
            status = null;
        }
        // 「没有长凭据」只代表自动连回不可用，不代表账号不能启动。
        if (!status?.bound || status.blocked || !status.credentialReady) {
            safeAccountLog(
                'startup_code_refresh_unavailable',
                '微信账号暂无可复用凭据，已沿用现有 Code 启动；自动连回需重新扫码一次',
                id,
                account.name || '',
            );
            safeLog('警告', `账号 ${account.name || id} 未绑定可复用微信凭据，已沿用现有 Code 启动，自动连回暂不可用`, {
                accountId: id,
                accountName: account.name || '',
            });
            return account;
        }

        const prepared = await refreshCodeForStartup(id);
        if (!prepared) {
            safeLog('警告', `账号 ${account.name || id} 启动前未能换取新 Code，已跳过本次启动，请检查网络或重新扫码`, {
                accountId: id,
                accountName: account.name || '',
            });
        }
        return prepared;
    }

    /** 进程重启后只恢复持久化标记为 autoStart 的账号。 */
    async function startPersistedAccounts(): Promise<number> {
        let accounts: any[] = [];
        try {
            const data = store.getAccounts();
            accounts = Array.isArray(data?.accounts) ? data.accounts : [];
        } catch {
            return 0;
        }
        const targets = accounts.filter(account => account?.autoStart === true);
        if (targets.length === 0) {
            safeLog('系统', '未发现需要自动恢复的账号');
            return 0;
        }
        safeLog('系统', `发现 ${targets.length} 个需自动恢复的账号，正在启动...`);

        let started = 0;
        let cursor = 0;

        async function startOne(account: any): Promise<void> {
            const id = String(account?.id || '').trim();
            if (!id) return;
            try {
                const prepared = await prepareAccountForStart(id);
                if (!prepared) return;
                const ok = startWorker(prepared);
                if (!ok) return;
                started += 1;
                if (typeof store.addOrUpdateAccount === 'function') {
                    store.addOrUpdateAccount({ id, autoStart: true });
                }
            } catch (error: any) {
                safeLog('错误', `账号 ${account.name || id} 自动恢复失败: ${error?.message || error}`, {
                    accountId: id,
                    accountName: account.name || '',
                });
            }
        }

        async function worker(): Promise<void> {
            for (;;) {
                const index = cursor++;
                if (index >= targets.length) return;
                await startOne(targets[index]);
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
        return started;
    }

    return {
        prepareAccountForStart,
        startPersistedAccounts,
    };
}

module.exports = { createAccountStartupService };
