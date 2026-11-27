export {};
const { fork } = require('node:child_process');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const store = require('../models/store');
const { updateRuntimeConfig } = require('../config/config');
const { sendPushooMessage } = require('../services/push');
const { createDataProvider } = require('./data-provider');
const { createReloginReminderService } = require('./relogin-reminder');
const { createRuntimeState } = require('./runtime-state');
const { createWorkerManager } = require('./worker-manager');
const { createWxKickoutRecoveryService } = require('./wx-kickout-recovery');
const { createAccountStartupService } = require('./account-startup');
const { WxLoginService } = require('../services/wx-login/service');
const { getNativeWxLoginCode } = require('../services/wx-login/native-protocol');
const { wxCredentialStore } = require('../services/wx-login/credential-store');

const OPERATION_KEYS = ['harvest', 'farming', 'fertilize', 'plant', 'steal', 'helpFarming', 'taskClaim', 'sell', 'upgrade'];

interface RuntimeEngineOptions {
    processRef?: any;
    mainEntryPath?: string;
    workerScriptPath?: string;
    runtimeMode?: string;
    onStatusSync?: (accountId: string, status: any, accountName?: string) => void;
    onLog?: (entry: any, accountId?: string, accountName?: string) => void;
    onAccountLog?: (entry: any) => void;
    startAdminServer?: (dataProvider: any) => void;
}

function createRuntimeEngine(options: RuntimeEngineOptions = {}) {
    const processRef = options.processRef || process;
    // Detect if running from source (tsx) or compiled (node)
    const isRunningFromSource = __dirname.includes(`${path.sep}src${path.sep}`);
    const fileExt = isRunningFromSource ? '.ts' : '.js';
    const mainEntryPath = options.mainEntryPath || path.join(__dirname, `../../client${fileExt}`);
    const workerScriptPath = options.workerScriptPath || path.join(__dirname, `../core/worker${fileExt}`);
    const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase();
    const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null;
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null;
    const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null;

    const runtimeState = createRuntimeState({
        store,
        operationKeys: OPERATION_KEYS,
    });
    const {
        workers,
        globalLogs: GLOBAL_LOGS,
        accountLogs: ACCOUNT_LOGS,
        runtimeEvents,
        nextConfigRevision,
        buildConfigSnapshotForAccount,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildDefaultStatus,
        filterLogs,
    } = runtimeState;

    const reloginReminder = createReloginReminderService({
        store,
        sendPushooMessage,
        log,
    });

    const {
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        sendConfiguredPush,
    } = reloginReminder;

    const wxLogin = new WxLoginService();
    let wxRecovery: any = null;

    const { startWorker, stopWorker, restartWorker, callWorkerApi } = createWorkerManager({
        fork,
        WorkerThread: Worker,
        runtimeMode,
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs: GLOBAL_LOGS,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        sendConfiguredPush,
        addOrUpdateAccount: store.addOrUpdateAccount,
        deleteAccount: store.deleteAccount,
        onStatusSync: (accountId: string, status: any, accountName?: string) => {
            runtimeEvents.emit('status', { accountId, status, accountName });
            if (onStatusSync) onStatusSync(accountId, status, accountName);
        },
        onWorkerLog: (entry: any, accountId: string, accountName?: string) => {
            runtimeEvents.emit('worker_log', { entry, accountId, accountName });
            if (onLog) onLog(entry, accountId, accountName);
        },
        onTerminalEvent: (accountId: string, kind: 'kickout' | 'ws_400' | 'disconnect', payload: any) => {
            if (!wxRecovery) return false;
            return wxRecovery.onTerminalEvent(accountId, kind, payload);
        },
    });

    wxRecovery = createWxKickoutRecoveryService({
        store,
        credentialStore: wxCredentialStore,
        startWorker,
        isAccountRunning: (accountId: string) => !!workers[accountId],
        issueCode: (loginBuffer: string, appId: string) => getNativeWxLoginCode(loginBuffer, appId),
        refreshLoginBuffer: (credential: any, refreshOptions?: any) => wxLogin.refreshLoginBuffer(credential, refreshOptions),
        log,
        addAccountLog,
    });

    const accountStartup = createAccountStartupService({
        store,
        credentialStore: wxCredentialStore,
        refreshCodeForStartup: (accountId: string) => (
            wxRecovery ? wxRecovery.refreshCodeForStartup(accountId) : Promise.resolve(null)
        ),
        startWorker,
        log,
        addAccountLog,
        concurrency: 2,
    });

    const dataProvider = createDataProvider({
        workers,
        globalLogs: GLOBAL_LOGS,
        accountLogs: ACCOUNT_LOGS,
        store,
        getAccounts: store.getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        buildConfigSnapshotForAccount,
        broadcastGameConfigReload,
        startWorker,
        stopWorker,
        restartWorker,
        onManualStart: (accountId: string) => wxRecovery?.onManualStart(accountId),
        onManualStop: (accountId: string) => wxRecovery?.onManualStop(accountId),
        onAccountDeleted: (accountId: string) => wxRecovery?.forgetAccount(accountId),
        onWxCredentialBound: (accountId: string) => wxRecovery?.bindCredential(accountId),
        onWxReloginConfigChanged: () => wxRecovery?.rescheduleAll(),
        getWxRecoveryStatus: (accountId: string) => wxRecovery?.getStatus(accountId) || null,
        prepareAccountForStart: (accountId: string, prepareOptions?: any) => accountStartup.prepareAccountForStart(accountId, prepareOptions),
    });

    // 引擎创建时只挂载长凭据保活；账号是否自动恢复由 startAllAccounts 按 autoStart 判断。
    wxRecovery.rescheduleAll();

    runtimeEvents.on('log', (entry: any) => {
        if (onLog) onLog(entry, entry && entry.accountId ? entry.accountId : '', entry && entry.accountName ? entry.accountName : '');
    });
    runtimeEvents.on('account_log', (entry: any) => {
        if (onAccountLog) onAccountLog(entry);
    });

    function broadcastConfigToWorkers(targetAccountId = ''): void {
        const targetId = String(targetAccountId || '').trim();
        for (const [accId, worker] of Object.entries(workers)) {
            if (targetId && String(accId) !== targetId) continue;
            const snapshot = buildConfigSnapshotForAccount(accId);
            try {
                (worker as any).process.send({ type: 'config_sync', config: snapshot });
            } catch {
                // ignore IPC failures for exited workers
            }
        }
    }

    function broadcastGameConfigReload(): void {
        for (const worker of Object.values(workers)) {
            try {
                (worker as any).process.send({ type: 'reload_config' });
            } catch {
                // ignore IPC failures for exited workers
            }
        }
    }

    async function startAllAccounts(): Promise<number> {
        return accountStartup.startPersistedAccounts();
    }

    async function start(options: { startAdminServer?: boolean; autoStartAccounts?: boolean } = {}): Promise<void> {
        const shouldStartAdminServer = options.startAdminServer !== false;
        const shouldAutoStartAccounts = options.autoStartAccounts !== false;

        const savedSystemConfig = store.getSystemConfig();
        if (savedSystemConfig) {
            updateRuntimeConfig(savedSystemConfig);
            log('系统', `已加载系统配置: serverUrl=${savedSystemConfig.serverUrl}, clientVersion=${savedSystemConfig.clientVersion}, platform=${savedSystemConfig.platform}`);
        }

        if (shouldStartAdminServer && startAdminServer) {
            startAdminServer(dataProvider);
        }

        if (shouldAutoStartAccounts) {
            await startAllAccounts();
        }
    }

    function stopAllAccounts(): void {
        for (const accountId of Object.keys(workers)) {
            stopWorker(accountId);
        }
    }

    return {
        store,
        runtimeEvents,
        workers,
        dataProvider,
        start,
        startAllAccounts,
        stopAllAccounts,
        broadcastConfigToWorkers,
        broadcastGameConfigReload,
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        log,
        addAccountLog,
    };
}

module.exports = {
    createRuntimeEngine,
};
