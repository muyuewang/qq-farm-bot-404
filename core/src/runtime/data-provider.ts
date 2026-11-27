export {};
const { findAccountByRef, normalizeAccountRef, resolveAccountId: resolveAccountIdByList } = require('../services/account-resolver');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');

interface DataProviderOptions {
    workers: Record<string, any>;
    globalLogs: any[];
    accountLogs: any[];
    store: any;
    getAccounts: () => any;
    callWorkerApi: (accountId: string, method: string, ...args: any[]) => Promise<any>;
    buildDefaultStatus: (accountId: string) => any;
    normalizeStatusForPanel: (data: any, accountId: string, accountName: string) => any;
    filterLogs: (list: any[], filters?: any) => any[];
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    nextConfigRevision: () => number;
    broadcastConfigToWorkers: (accountId?: string) => void;
    buildConfigSnapshotForAccount: (accountId: string) => any;
    broadcastGameConfigReload?: () => void;
    startWorker: (account: any) => boolean;
    stopWorker: (accountId: string) => void;
    restartWorker: (account: any) => void;
    onManualStart?: (accountId: string) => void;
    onManualStop?: (accountId: string) => void;
    onAccountDeleted?: (accountId: string) => void;
    onWxCredentialBound?: (accountId: string, status: any) => void;
    onWxReloginConfigChanged?: () => void;
    getWxRecoveryStatus?: (accountId: string) => any;
    prepareAccountForStart?: (accountId: string, options?: any) => Promise<any | null>;
}

function createDataProvider(options: DataProviderOptions) {
    const {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        buildConfigSnapshotForAccount,
        broadcastGameConfigReload: broadcastGameConfigReloadOpt,
        startWorker,
        stopWorker,
        restartWorker,
        onManualStart,
        onManualStop,
        onAccountDeleted,
        onWxCredentialBound,
        onWxReloginConfigChanged,
        getWxRecoveryStatus,
        prepareAccountForStart,
    } = options;

    // 启动/重启需要先异步换 Code；每次操作带序号，等待期间用户停止时迟到结果不得覆盖停止意图。
    const startIntent = new Map<string, number>();

    function nextIntent(accountId: string): number {
        const key = String(accountId || '');
        const next = (startIntent.get(key) || 0) + 1;
        startIntent.set(key, next);
        return next;
    }

    function isCurrentIntent(accountId: string, value: number): boolean {
        return (startIntent.get(String(accountId || '')) || 0) === value;
    }

    async function prepareForStart(account: any, accountId: string, freshCode: boolean, failureMessage: string): Promise<any> {
        if (typeof prepareAccountForStart !== 'function') return account;
        const prepared = await prepareAccountForStart(accountId, { freshCode });
        if (!prepared) throw new Error(failureMessage);
        return prepared;
    }

    function getStoredAccountsList(): any[] {
        const data = getAccounts();
        return Array.isArray(data.accounts) ? data.accounts : [];
    }

    function resolveAccountRefId(accountRef: string): string {
        const raw = normalizeAccountRef(accountRef);
        if (!raw) return '';
        const resolved = resolveAccountIdByList(getStoredAccountsList(), raw);
        return resolved || raw;
    }

    function findAccountByAnyRef(accountRef: string): any {
        return findAccountByRef(getStoredAccountsList(), accountRef);
    }

    return {
        resolveAccountId: (accountRef: string) => resolveAccountRefId(accountRef),

        getStatus: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return buildDefaultStatus('');
            const w = workers[accountId];
            if (!w || !w.status) return buildDefaultStatus(accountId);
            return {
                ...buildDefaultStatus(accountId),
                ...normalizeStatusForPanel(w.status, accountId, w.name),
                wsError: w.wsError || null,
            };
        },

        getLogs: (accountRef: string, optionsOrLimit?: any) => {
            const opts = (typeof optionsOrLimit === 'object' && optionsOrLimit) ? optionsOrLimit : { limit: optionsOrLimit };
            const max = Math.max(1, Number(opts.limit) || 100);
            const rawRef = normalizeAccountRef(accountRef);
            const accountId = resolveAccountRefId(accountRef);
            if (!rawRef || rawRef === 'all') {
                return filterLogs(globalLogs, opts).slice(-max);
            }
            if (!accountId) return [];
            const accId = String(accountId || '');
            return filterLogs(globalLogs.filter(l => String(l.accountId || '') === accId), opts).slice(-max);
        },

        getAccountLogs: (limit: number) => accountLogs.slice(-limit).reverse(),
        addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => addAccountLog(action, msg, accountId, accountName, extra),

        clearLogs: (accountRef: string) => {
            const rawRef = normalizeAccountRef(accountRef);
            const accountId = resolveAccountRefId(accountRef);

            if (!rawRef || rawRef === 'all') {
                globalLogs.length = 0;
                return { cleared: 'all' };
            }

            if (!accountId) return { cleared: 0 };

            const accId = String(accountId || '');
            const before = globalLogs.length;
            for (let i = globalLogs.length - 1; i >= 0; i--) {
                if (String(globalLogs[i].accountId || '') === accId) {
                    globalLogs.splice(i, 1);
                }
            }
            const after = globalLogs.length;
            return { cleared: before - after, accountId };
        },

        getLands: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getLands', true),
        getIllustratedSnapshot: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getIllustratedSnapshot'),
        getCollectionsSnapshot: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCollectionsSnapshot'),
        operateCollections: (accountRef: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'operateCollections', action, input),
        getRanchState: (accountRef: string, view: string, shopId?: number, hostGid?: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getRanchState', view, shopId, hostGid),
        clearRanchIllustratedNew: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'clearRanchIllustratedNew'),
        prepareRanchAction: (accountRef: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'prepareRanchAction', action, input),
        operateRanch: (accountRef: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'operateRanch', action, input),
        claimIllustratedRewards: (accountRef: string, type: number) => callWorkerApi(resolveAccountRefId(accountRef), 'claimIllustratedRewards', type),
        clearIllustratedNew: (accountRef: string, fruitIds: number[]) => callWorkerApi(resolveAccountRefId(accountRef), 'clearIllustratedNew', fruitIds),
        getSolarCalendar: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getSolarCalendar'),
        operateSolarCalendar: (accountRef: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'operateSolarCalendar', action, input),
        getFriends: (accountRef: string, forceSync = false) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriends', forceSync, true),
        getFriendsCache: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriendsCache'),
        clearFriendsCache: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'clearFriendsCache'),
        getInteractRecords: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getInteractRecords'),
        getFriendLands: (accountRef: string, gid: number) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriendLands', gid, true),
        getFriendInteractionItems: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getFriendInteractionItems', true)
        ),
        useFriendInteractionItemBatch: (accountRef: string, gid: unknown, itemId: unknown, landIds: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useFriendInteractionItemBatch', gid, itemId, landIds, true)
        ),
        useFriendFarmInteractionItem: (accountRef: string, gid: unknown, itemId: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useFriendFarmInteractionItem', gid, itemId, true)
        ),
        getSelfInteractionItems: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getSelfInteractionItems', true)
        ),
        useSelfInteractionItemBatch: (accountRef: string, itemId: unknown, landIds: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useSelfInteractionItemBatch', itemId, landIds, true)
        ),
        doFriendOp: (accountRef: string, gid: number, opType: string) => callWorkerApi(resolveAccountRefId(accountRef), 'doFriendOp', gid, opType, true),
        delFriend: (accountRef: string, gid: number) => callWorkerApi(resolveAccountRefId(accountRef), 'delFriend', gid),
        getBag: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getBag'),
        getBagSeeds: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getBagSeeds'),
        getDiamondBalance: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getDiamondBalance'),
        useItem: (accountRef: string, itemId: number, count: number, uid = 0) => callWorkerApi(resolveAccountRefId(accountRef), 'useItem', itemId, count, uid),
        sellItems: (accountRef: string, items: any[]) => callWorkerApi(resolveAccountRefId(accountRef), 'sellItems', items),
        setItemsLocked: (accountRef: string, itemUids: unknown, locked: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'setItemsLocked', itemUids, locked)
        ),
        getDogSkillGiftStatus: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getDogSkillGiftStatus')
        ),
        claimDogSkillGifts: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'claimDogSkillGifts')
        ),
        getPetInfo: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getPetInfo')
        ),
        activateDog: (accountRef: string, dogId: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'activateDog', dogId)
        ),
        deployDog: (accountRef: string, dogId: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'deployDog', dogId)
        ),
        withdrawDog: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'withdrawDog')
        ),
        useDogFood: (accountRef: string, itemId: unknown, count: unknown = 1, uid: unknown = 0) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useDogFood', itemId, count, uid)
        ),
        getPetProtectLogs: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getPetProtectLogs')
        ),
        getDailyGifts: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getDailyGiftOverview', true),
        getActivityDirectorySnapshot: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getActivityDirectorySnapshot'),
        getRanchActivityDirectorySnapshot: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getRanchActivityDirectorySnapshot'),
        getActivityCenterSnapshot: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getActivityCenterSnapshot'),
        getCurrentSeasonEvent: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentSeasonEvent'),
        getCurrentStellarActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentStellarActivity'),
        getCurrentStarSandShop: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentStarSandShop'),
        getCurrentSolarTerms: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentSolarTerms'),
        getCurrentQixiActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentQixiActivity'),
        getCurrentCharityRedFlowerActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentCharityRedFlowerActivity'),
        getPetDiary: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getPetDiary'),
        operatePetDiary: (accountRef: string, action: unknown, params: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'operatePetDiary', action, params),
        getPetDiaryRecords: (accountRef: string, kind: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'getPetDiaryRecords', kind),
        getPetDiaryFriend: (accountRef: string, gid: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'getPetDiaryFriend', gid),
        claimCharityRedFlowerSeeds: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimCharityRedFlowerSeeds'),
        donateCharityRedFlowerLove: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'donateCharityRedFlowerLove'),
        claimCharityRedFlowerDailyGift: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimCharityRedFlowerDailyGift'),
        claimCharityRedFlowerProgressReward: (accountRef: string, target: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'claimCharityRedFlowerProgressReward', target),
        getCurrentWeatherActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentWeatherActivity'),
        buyWeatherBottle: (accountRef: string, count: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'buyWeatherBottle', count),
        collectWeatherBottle: (accountRef: string, targetGid: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'collectWeatherBottle', targetGid),
        lightWeatherResearch: (accountRef: string, nodeId: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'lightWeatherResearch', nodeId),
        summonWeatherRain: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'summonWeatherRain'),
        claimBattlePassRewards: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimBattlePassRewards'),
        exchangeStarSandGoods: (accountRef: string, goodsId: unknown, count: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'exchangeStarSandGoods', goodsId, count)
        ),
        lightConstellation: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'lightConstellation'),
        claimSolarTerm: (accountRef: string, termId: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimSolarTerm', termId),
        getCurrentQingMeiActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentQingMeiActivity'),
        claimQingMeiDailySeed: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimQingMeiDailySeed'),
        startQingMeiBrew: (accountRef: string, ingredients: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'startQingMeiBrew', ingredients),
        continueQingMeiBrew: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'continueQingMeiBrew'),
        settleQingMeiBrew: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'settleQingMeiBrew'),
        claimQixiBridgeRewards: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimQixiBridgeRewards'),
        giftQixiSachet: (accountRef: string, friendGid: unknown, messageTextId: unknown = 15) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'giftQixiSachet', friendGid, messageTextId)
        ),
        exchangeWeatherCollectorBottle: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'exchangeWeatherCollectorBottle')
        ),
        getWeatherFriends: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getWeatherFriends')
        ),
        scanWeatherFriends: (accountRef: string, friendGids: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'scanWeatherFriends', friendGids)
        ),
        useWeatherCollectorBottle: (accountRef: string, friendGid: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useWeatherCollectorBottle', friendGid)
        ),
        useWeatherSummonBottle: (accountRef: string) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useWeatherSummonBottle')
        ),
        useWeatherFrogBottle: (accountRef: string, friendGid: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useWeatherFrogBottle', friendGid)
        ),
        useWeatherCloudBottle: (accountRef: string, friendGid: unknown, landId: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'useWeatherCloudBottle', friendGid, landId)
        ),
        advanceWeatherResearch: (accountRef: string, nodeId: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'advanceWeatherResearch', nodeId)
        ),
        getMugeActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getMugeActivity'),
        operateMugeActivity: (accountRef: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'operateMugeActivity', action, input),
        getMilkTeaActivity: (accountRef: string, page: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'getMilkTeaActivity', page, input),
        operateMilkTeaActivity: (accountRef: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'operateMilkTeaActivity', action, input),
        getShareRewardActivity: (accountRef: string, activityId: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getShareRewardActivity', activityId),
        operateShareRewardActivity: (accountRef: string, activityId: string, action: string, input: any) => callWorkerApi(resolveAccountRefId(accountRef), 'operateShareRewardActivity', activityId, action, input),
        getAutumnActivity: (accountRef: string, key: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getAutumnActivity', key),
        operateAutumnActivity: (accountRef: string, key: string, action: string, input: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'operateAutumnActivity', key, action, input),
        getCurrentYishuHuanfuActivity: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getCurrentYishuHuanfuActivity'),
        queryYishuHuanfuCatalog: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'queryYishuHuanfuCatalog'),
        queryYishuHuanfuRecords: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'queryYishuHuanfuRecords'),
        claimYishuHuanfuCommission: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimYishuHuanfuCommission'),
        claimYishuHuanfuSeeds: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'claimYishuHuanfuSeeds'),
        queryYishuHuanfuShop: (accountRef: string, friendGid: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'queryYishuHuanfuShop', friendGid)
        ),
        scanYishuHuanfuFriendShops: (accountRef: string, options: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'scanYishuHuanfuFriendShops', options)
        ),
        exchangeYishuHuanfuGoods: (accountRef: string, index: unknown, count: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'exchangeYishuHuanfuGoods', index, count)
        ),
        sellYishuHuanfuSweetPotato: (accountRef: string, friendGid: unknown, count: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'sellYishuHuanfuSweetPotato', friendGid, count)
        ),
        refreshYishuHuanfuQuote: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'refreshYishuHuanfuQuote'),
        shareYishuHuanfuShop: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'shareYishuHuanfuShop'),
        getPropsShop: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getPropsShop'),
        purchaseProps: (accountRef: string, goodsId: unknown, count: unknown, expectedOffer: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'purchaseProps', goodsId, count, expectedOffer)
        ),
        getMallCatalog: (accountRef: string, slotType: unknown, subSlotType: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'getMallCatalog', slotType, subSlotType)
        ),
        purchaseMallProduct: (accountRef: string, goodsId: unknown, count: unknown, slotType: unknown, expectedPrice?: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'purchaseMallProduct', goodsId, count, slotType, expectedPrice)
        ),
        getMysteryShop: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getMysteryShop'),
        purchaseMysteryOffer: (accountRef: string, npcId: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'purchaseMysteryOffer', npcId)
        ),
        getSeeds: (accountRef: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getSeeds', true),
        purchaseSeed: (accountRef: string, goodsId: unknown, count: unknown) => callWorkerApi(resolveAccountRefId(accountRef), 'purchaseSeed', goodsId, count),

        setAutomation: async (accountRef: string, key: string, value: any) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            store.setAutomation(key, value, accountId);
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return { automation: store.getAutomation(accountId), configRevision: rev };
        },

        doFarmOp: (accountRef: string, opType: string, targetLandId: unknown = null) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'doFarmOp', opType, targetLandId, true)
        ),
        fertilizeOwnLand: (accountRef: string, landId: unknown, fertilizerType: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'fertilizeOwnLand', landId, fertilizerType)
        ),
        fertilizeAllOwnLands: (accountRef: string, fertilizerType: unknown, landIds?: unknown) => (
            callWorkerApi(resolveAccountRefId(accountRef), 'fertilizeAllOwnLands', fertilizerType, landIds)
        ),

        doAnalytics: (accountRef: string, sortBy: string) => callWorkerApi(resolveAccountRefId(accountRef), 'getAnalytics', sortBy),
        buyFertilizer: (accountRef: string, type: string, count: number) => callWorkerApi(resolveAccountRefId(accountRef), 'buyFertilizer', type, count, true),
        checkAndBuyFertilizer: (accountRef: string, options: any) => callWorkerApi(resolveAccountRefId(accountRef), 'checkAndBuyFertilizer', options, true),
        saveSettings: async (accountRef: string, payload: any) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            const body = (payload && typeof payload === 'object') ? payload : {};
            const snapshot: Record<string, any> = {};
            const copyIfPresent = (sourceKey: string, targetKey: string = sourceKey): void => {
                if (Object.hasOwn(body, sourceKey)) {
                    snapshot[targetKey] = body[sourceKey];
                }
            };

            copyIfPresent('plantingStrategy');
            if (!Object.hasOwn(snapshot, 'plantingStrategy')) copyIfPresent('strategy', 'plantingStrategy');
            copyIfPresent('prioritize2x2Crops');
            copyIfPresent('prioritizeGrowthTasks');
            copyIfPresent('preferredSeedId');
            if (!Object.hasOwn(snapshot, 'preferredSeedId')) copyIfPresent('seedId', 'preferredSeedId');
            for (const key of [
                'automation',
                'intervals',
                'friendQuietHours',
                'stealDelaySeconds',
                'plantOrderRandom',
                'plantDelaySeconds',
                'fertilizerBuyOrganicCount',
                'fertilizerBuyOrganicThresholdHours',
                'fertilizerBuyNormalCount',
                'fertilizerBuyNormalThresholdHours',
                'fertilizerBuyCheckIntervalMinutes',
                'emailClaimHour',
                'bagSeedPriority',
                'bagSeedKnownIds',
                'goldenBugKeepCount',
                'goldenBugRoundLimit',
                'bagSeedMultiLandReservationEnabled',
                'bagSeedLandTypes',
                'bagSeedFallbackStrategy',
                'autoAcceptFriendMinLevel',
                'autoAcceptRequireOwnLevel',
                'autoAcceptHarvestStealEnabled',
                'autoAcceptHarvestStealHarvest',
                'autoAcceptHarvestStealSteal',
            ]) {
                copyIfPresent(key);
            }

            // One apply performs the only persistence for this save request.
            store.applyConfigSnapshot(snapshot, { accountId });
            const rev = nextConfigRevision();
            const config = buildConfigSnapshotForAccount(accountId);
            const { ui: _ui, ...savedConfig } = store.getConfigSnapshot(accountId);
            const result: Record<string, any> = {
                ...savedConfig,
                strategy: savedConfig.plantingStrategy,
                preferredSeed: savedConfig.preferredSeedId,
                saved: true,
                configRevision: rev,
            };

            const targetWorker = workers[accountId];
            if (!targetWorker || targetWorker.stopping || targetWorker.terminalHandled) {
                return {
                    ...result,
                    status: 'stopped',
                    stopped: true,
                    confirmed: false,
                    appliedRevision: null,
                };
            }

            try {
                const ack = await callWorkerApi(accountId, 'applyRuntimeConfigSnapshot', config);
                const appliedRevision = Number(ack && ack.appliedRevision);
                if (!Number.isFinite(appliedRevision) || appliedRevision < rev) {
                    const error: any = new Error(`Worker applied revision ${appliedRevision || 0}, expected at least ${rev}`);
                    error.code = 'CONFIG_ACK_REVISION_MISMATCH';
                    throw error;
                }
                return {
                    ...result,
                    status: 'confirmed',
                    stopped: false,
                    confirmed: true,
                    appliedRevision,
                };
            } catch (e: any) {
                const message = String(e?.message || e || 'Worker configuration ACK failed');
                const code = e?.code || (message === 'API Timeout' ? 'CONFIG_ACK_TIMEOUT' : 'CONFIG_ACK_FAILED');
                return {
                    ...result,
                    status: 'unconfirmed',
                    stopped: false,
                    confirmed: false,
                    unconfirmed: true,
                    appliedRevision: null,
                    confirmationError: {
                        code: String(code),
                        message,
                    },
                };
            }
        },

        setUITheme: async (theme: string) => {
            const snapshot = store.setUITheme(theme);
            return { ui: snapshot.ui || store.getUI() };
        },

        broadcastConfig: (accountId: string) => {
            broadcastConfigToWorkers(accountId);
        },

        broadcastGameConfigReload: () => {
            if (typeof broadcastGameConfigReloadOpt === 'function') broadcastGameConfigReloadOpt();
        },

        setRuntimeAccountName: (accountRef: string, accountName: string) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return;
            const worker = workers[accountId];
            if (worker) {
                worker.name = String(accountName || worker.name || accountId);
            }
        },

        getAccounts: () => {
            const data = getAccounts();
            data.accounts.forEach((a: any) => {
                const worker = workers[a.id];
                a.running = !!worker;
                if (worker && worker.status && worker.status.status && worker.status.status.name) {
                    a.nick = worker.status.status.name;
                }
                if (worker && worker.status && worker.status.status && worker.status.status.avatarUrl) {
                    a.avatar = worker.status.status.avatarUrl;
                }
            });
            return data;
        },

        startAccount: async (accountRef: string, startOptions: any = {}) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            const targetId = accountId || String(acc.id || '');
            const intent = nextIntent(targetId);
            // 先完成启动前准备再落盘状态：准备失败时账号不应被误标记为自动启动，
            // 也不应提前取消已经排好的自动连回。
            const prepared = await prepareForStart(
                acc,
                targetId,
                startOptions.freshCode === true,
                '微信账号启动前自动换 Code 失败，请检查网络或重新扫码一次',
            );
            if (!isCurrentIntent(targetId, intent) || workers[targetId]) return true;
            if (typeof onManualStart === 'function') onManualStart(targetId);
            // 只有 Worker 真正拉起后才落盘自动启动标记；startWorker 抛错或返回 false 时
            // 账号保持未启用，避免下次服务重启按错误状态自动恢复。
            const started = startWorker(prepared);
            if (started !== false && typeof store.addOrUpdateAccount === 'function') {
                store.addOrUpdateAccount({ id: targetId, autoStart: true });
            }
            return true;
        },

        stopAccount: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            const targetId = accountId || String(acc.id || '');
            nextIntent(targetId);
            if (typeof store.addOrUpdateAccount === 'function') {
                store.addOrUpdateAccount({ id: targetId, autoStart: false });
            }
            if (typeof onManualStop === 'function') onManualStop(targetId);
            if (targetId) stopWorker(targetId);
            return true;
        },

        restartAccount: async (accountRef: string, restartOptions: any = {}) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            const targetId = accountId || String(acc.id || '');
            const intent = nextIntent(targetId);
            // 与手动启动一致：重启微信账号同样要用长凭据换全新 Code，绝不重放旧 Code。
            const prepared = await prepareForStart(
                acc,
                targetId,
                restartOptions.freshCode === true,
                '微信账号重启前自动换 Code 失败，请检查网络或重新扫码一次',
            );
            if (!isCurrentIntent(targetId, intent)) return true;
            if (typeof onManualStart === 'function') onManualStart(targetId);
            // restartWorker 是同步触发，不会抛出；仅在调用后持久化，与 startAccount 保持一致。
            restartWorker(prepared);
            if (typeof store.addOrUpdateAccount === 'function') {
                store.addOrUpdateAccount({ id: targetId, autoStart: true });
            }
            return true;
        },

        onWxCredentialBound: (accountId: string, status: any) => {
            if (typeof onWxCredentialBound === 'function') onWxCredentialBound(accountId, status);
        },

        onWxAccountDeleted: (accountId: string) => {
            if (typeof onAccountDeleted === 'function') onAccountDeleted(accountId);
        },

        onWxReloginConfigChanged: () => {
            if (typeof onWxReloginConfigChanged === 'function') onWxReloginConfigChanged();
        },

        getWxRecoveryStatus: (accountId: string) => (
            typeof getWxRecoveryStatus === 'function' ? getWxRecoveryStatus(accountId) : null
        ),

        isAccountRunning: (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            return !!(accountId && workers[accountId]);
        },

        getSchedulerStatus: async (accountRef: string) => {
            const accountId = resolveAccountRefId(accountRef);
            const runtime = getSchedulerRegistrySnapshot();
            let worker = null;
            let workerError = '';

            if (!accountId) {
                return { accountId: '', runtime, worker, workerError };
            }

            if (!workers[accountId]) {
                return { accountId, runtime, worker, workerError: '账号未运行' };
            }

            try {
                worker = await callWorkerApi(accountId, 'getSchedulers');
            } catch (e: any) {
                workerError = (e && e.message) ? e.message : String(e || 'unknown');
            }
            return { accountId, runtime, worker, workerError };
        },
    };
}

module.exports = {
    createDataProvider,
};
