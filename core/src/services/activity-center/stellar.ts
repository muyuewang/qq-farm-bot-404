import constellationCatalog from '../../activity-data/constellation-2026072701.json';
export {};

type Int64Like = any;

interface ConstellationStateIdentity {
    seasonId: string;
    activityId: string;
    catalogVersion: number;
}

function createStellarActivityService(deps: any) {
    const {
        types,
        sendMsgAsync,
        GatewayError,
        getBag,
        getServerTimeSec,
        mergeConstellationStates,
        stateRecordKey,
        loadConstellationState,
        persistConstellationState,
        stateFromDynamicNodes,
        stateWithNoClaimableDay,
        int64String,
        int64Number,
        compareInt64,
        bytesToText,
        textContent,
        parseJsonText,
        activityDto,
        itemDto,
        businessError,
        positiveDecimal,
        readBagBalances,
        settleRequest,
        settledValue,
        settledError,
        serializeMutation,
        getActivityCenterSnapshot,
    } = deps;

    const SHOP_ACTIVITY_TYPE = '3';
    const CONSTELLATION_ACTIVITY_TYPE = '13';
    const EXCHANGE_SHOP_OPERATE_TYPE = 1;
    const QUERY_SHOP_OPERATE_TYPE = 7;
    const LIGHT_CONSTELLATION_OPERATE_TYPE = 21;
    const SECONDS_PER_DAY = 86400;
    const BEIJING_UTC_OFFSET_SECONDS = 8 * 60 * 60;
    const lastConstellationState = new Map<string, any>();
    const lastConstellationDynamicState = new Map<string, any>();

    function constellationDayFromBeijingMidnight(startTimeSec: number, serverTimeSec: number): number | null {
        if (startTimeSec <= 0 || serverTimeSec < startTimeSec) return null;
        const startDateIndex = Math.floor((startTimeSec + BEIJING_UTC_OFFSET_SECONDS) / SECONDS_PER_DAY);
        const serverDateIndex = Math.floor((serverTimeSec + BEIJING_UTC_OFFSET_SECONDS) / SECONDS_PER_DAY);
        return serverDateIndex - startDateIndex + 1;
    }

    function passDto(pass: any) {
        if (!pass) return null;
        const currentLevel = int64String(pass.current_level ?? pass.field_2);
        const progress = int64String(pass.current_progress ?? pass.field_4);
        const progressMax = int64String(pass.progress_target ?? pass.field_5);
        const claimedThroughLevel = int64String(pass.claimed_through_level ?? pass.field_9);
        const nodes = (Array.isArray(pass.nodes) ? pass.nodes : []).map((node: any) => {
            const level = int64String(node.node_id);
            const claimed = level !== '0' && compareInt64(level, claimedThroughLevel) <= 0;
            const locked = level === '0' || compareInt64(level, currentLevel) > 0;
            return {
                id: level,
                level,
                keyLevel: !!(node.is_key_level ?? node.field_4),
                locked,
                claimed,
                claimable: !locked && !claimed,
                current: level !== '0' && compareInt64(level, currentLevel) === 0,
                rewards: (Array.isArray(node.rewards) ? node.rewards : []).map(itemDto),
            };
        });
        return {
            activityId: int64String(pass.activity_id),
            title: bytesToText(pass.title),
            level: currentLevel,
            progress,
            progressMax,
            claimedThroughLevel,
            nodeCount: int64String(pass.node_count),
            field11Code: int64String(pass.field_11),
            field13Code: int64String(pass.field_13),
            field18Code: int64String(pass.field_18),
            field14Items: (Array.isArray(pass.field_14) ? pass.field_14 : []).map(itemDto),
            rules: textContent(pass.rules_json),
            nodes,
        };
    }

    function solarTermDto(term: any) {
        if (!term) return null;
        const statusCode = int64String(term.status);
        return {
            id: int64String(term.term_id),
            name: bytesToText(term.name),
            statusCode,
            canClaim: statusCode === '2',
            startTime: int64String(term.begin_time),
            endTime: int64String(term.end_time),
            rewards: (Array.isArray(term.rewards) ? term.rewards : []).map(itemDto),
        };
    }

    function rawConstellationNode(node: any) {
        return {
            id: int64String(node?.node_id),
            field2: !!node?.field_2,
            field3: !!node?.field_3,
            field4: !!node?.field_4,
            rewards: (Array.isArray(node?.rewards) ? node.rewards : []).map(itemDto),
        };
    }

    function rawConstellationGroup(group: any) {
        return {
            id: int64String(group?.group_id),
            field2: !!group?.field_2,
            name: bytesToText(group?.name),
            links: parseJsonText(group?.links),
            config: parseJsonText(group?.config_json),
        };
    }

    function constellationStateIdentity(seasonReply: any, activity: any): ConstellationStateIdentity {
        return {
            seasonId: int64String(seasonReply?.season_info?.season_id),
            activityId: int64String(activity?.activity_id ?? activity?.id),
            catalogVersion: Number(constellationCatalog.catalogVersion) || 0,
        };
    }

    function loadMergedConstellationState(seasonReply: any, activity: any): any {
        const identity = constellationStateIdentity(seasonReply, activity);
        const memoryState = lastConstellationState.get(stateRecordKey(identity));
        return mergeConstellationStates(identity, loadConstellationState(identity), memoryState);
    }

    function constellationDto(activity: any, serverTimeValue: Int64Like, data?: any, confirmedState?: any) {
        const activityId = int64String(activity?.activity_id ?? activity?.id);
        const catalogSupported = activityId === String(constellationCatalog.activityId);
        const startTime = int64String(activity?.begin_time ?? activity?.startTime);
        const endTime = int64String(activity?.end_time ?? activity?.endTime);
        const serverTime = int64String(serverTimeValue);
        const activityMetadata = activityDto(activity);
    
        if (!catalogSupported) {
            return {
                activityId,
                typeCode: int64String(activity?.type ?? activity?.typeCode),
                displayName: activityMetadata.name,
                serverName: activityMetadata.name,
                startTime,
                endTime,
                serverTime,
                catalogVersion: null,
                catalogStatus: 'unsupported' as const,
                rules: null,
                currentDay: null,
                groups: [],
            };
        }
    
        const start = int64Number(startTime);
        const server = int64Number(serverTime);
        const calculatedDay = constellationDayFromBeijingMidnight(start, server);
        const currentDay = calculatedDay == null ? null : Math.max(1, Math.min(28, calculatedDay));
        const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
        const dynamicNodes = new Map<string, any>(nodes.map((node: any) => [int64String(node?.node_id), node]));
        const dynamicGroups = new Map<string, any>((Array.isArray(data?.groups) ? data.groups : [])
            .map((group: any) => [int64String(group?.group_id), group]));
        const confirmedOpenedNodeIds = new Set<string>(confirmedState?.confirmedOpenedNodeIds || []);
        const confirmedLitNodeIds = new Set<string>(confirmedState?.confirmedLitNodeIds || []);
        const noClaimableDays = confirmedState?.noClaimableDays || {};
    
        const groups = constellationCatalog.groups.map(group => {
            const id = String(group.id);
            const nodeId = String(group.nodeId);
            const dynamicNode = dynamicNodes.get(nodeId);
            const dynamicGroup = dynamicGroups.get(id);
            const confirmedOpened = confirmedOpenedNodeIds.has(nodeId);
            const confirmedLit = confirmedLitNodeIds.has(nodeId);
            const dynamicOpened = dynamicNode?.field_2 === true;
            const dynamicLit = dynamicNode?.field_3 === true;
            const dynamicLightable = dynamicOpened && dynamicNode?.field_3 === false;
            const noClaimable = currentDay === group.order && !!noClaimableDays[String(group.order)];
            let opened: boolean | null;
            let lit: boolean | null;
            let stateKnown: boolean;
            let visualState: 'lit' | 'lightable' | 'locked' | 'unknown' | 'claimableUnknown';
            let claimStatus: 'confirmed-no-claimable' | null = null;
            let statusSource: 'persisted' | 'authoritative' | 'server-rejection' | 'schedule';
    
            // field_2=已开放，field_3=已点亮；field_4 不参与状态判定。
            if (confirmedLit || dynamicLit || noClaimable) {
                opened = true;
                lit = true;
                stateKnown = true;
                visualState = 'lit';
                claimStatus = noClaimable ? 'confirmed-no-claimable' : null;
                statusSource = noClaimable ? 'server-rejection' : confirmedLit ? 'persisted' : 'authoritative';
            } else if (dynamicLightable) {
                opened = true;
                lit = false;
                stateKnown = true;
                visualState = 'lightable';
                statusSource = 'authoritative';
            } else if (currentDay != null && group.order > currentDay) {
                opened = false;
                lit = false;
                stateKnown = false;
                visualState = 'locked';
                statusSource = 'schedule';
            } else if (currentDay != null && group.order === currentDay) {
                opened = confirmedOpened || dynamicOpened ? true : null;
                lit = null;
                stateKnown = false;
                visualState = 'claimableUnknown';
                statusSource = confirmedOpened ? 'persisted' : dynamicOpened ? 'authoritative' : 'schedule';
            } else {
                opened = confirmedOpened || dynamicOpened ? true : null;
                lit = null;
                stateKnown = false;
                visualState = 'unknown';
                statusSource = confirmedOpened ? 'persisted' : dynamicOpened ? 'authoritative' : 'schedule';
            }
    
            return {
                id,
                nodeId,
                name: group.name,
                category: group.category,
                explain: group.explain,
                order: group.order,
                chartIndex: group.links.chartIndex,
                rewards: group.rewards.map(itemDto),
                linksRaw: group.linksRaw,
                nodeIds: group.links.nodeIds.map(String),
                visualState,
                opened,
                lit,
                stateKnown,
                claimStatus,
                statusSource,
                ...(dynamicNode || dynamicGroup ? {
                    raw: {
                        node: dynamicNode ? rawConstellationNode(dynamicNode) : null,
                        group: dynamicGroup ? rawConstellationGroup(dynamicGroup) : null,
                    },
                } : {}),
            };
        });
    
        return {
            activityId,
            typeCode: CONSTELLATION_ACTIVITY_TYPE,
            displayName: constellationCatalog.displayName,
            serverName: activityMetadata.name || constellationCatalog.serverName,
            startTime,
            endTime,
            serverTime,
            catalogVersion: constellationCatalog.catalogVersion,
            catalogStatus: 'supported' as const,
            rules: constellationCatalog.rules,
            currentDay,
            groups,
            ...(data ? {
                raw: {
                    field1Code: int64String(data.field_1),
                    field2Code: int64String(data.field_2),
                    field3Code: int64String(data.field_3),
                },
            } : {}),
        };
    }

    async function querySeason(): Promise<any> {
        const body = Buffer.from(types.GetSeasonInfoRequest.encode(types.GetSeasonInfoRequest.create({})).finish());
        const { body: replyBody } = await sendMsgAsync('gamepb.seasonpb.SeasonService', 'GetSeasonInfo', body);
        return types.GetSeasonInfoReply.decode(replyBody);
    }

    async function querySolarTerms(): Promise<any> {
        const body = Buffer.from(types.GetSolarTermsRequest.encode(types.GetSolarTermsRequest.create({})).finish());
        const { body: replyBody } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'GetSolarTerms', body);
        return types.GetSolarTermsReply.decode(replyBody);
    }

    function findSeasonActivity(seasonReply: any, typeCode: string): any | null {
        const activities = Array.isArray(seasonReply?.season_info?.activities) ? seasonReply.season_info.activities : [];
        return activities.find((activity: any) => int64String(activity?.type) === typeCode) || null;
    }

    function normalizeSeason(reply: any) {
        const season = reply?.season_info;
        if (!season) throw new Error('当前赛季数据为空');
        const rawActivities = Array.isArray(season.activities) ? season.activities : [];
        const constellationActivity = findSeasonActivity(reply, CONSTELLATION_ACTIVITY_TYPE);
        const shopActivity = findSeasonActivity(reply, SHOP_ACTIVITY_TYPE);
        return {
            id: int64String(season.season_id),
            title: bytesToText(season.name),
            statusCode: int64String(season.status),
            field4Code: int64String(season.field_4),
            startTime: int64String(season.begin_time),
            endTime: int64String(season.end_time),
            serverTime: int64String(season.server_time),
            activities: rawActivities.map(activityDto),
            constellationActivity: constellationActivity ? activityDto(constellationActivity) : null,
            shopActivity: shopActivity ? activityDto(shopActivity) : null,
            pass: passDto(season.pass),
        };
    }

    function normalizeSolarTerms(reply: any) {
        const serverTime = int64Number(reply?.server_time);
        const terms = (Array.isArray(reply?.terms) ? reply.terms : []).map(solarTermDto).filter(Boolean);
        const currentTerm = terms.find((term: any) => {
            const start = Number(term.startTime);
            const end = Number(term.endTime);
            return serverTime > 0 && start <= serverTime && serverTime <= end;
        }) || null;
        const configs = Array.isArray(reply?.configs) ? reply.configs : [];
        return {
            serverTime: int64String(reply?.server_time),
            currentTermId: currentTerm?.id || null,
            terms,
            currentConfig: reply?.current_config ? {
                id: int64String(reply.current_config.config_id),
                activityId: int64String(reply.current_config.activity_id),
                rules: textContent(reply.current_config.rules_json),
                field4: parseJsonText(reply.current_config.field_4),
            } : null,
            configs: configs.map((config: any) => ({
                id: int64String(config.config_id),
                activityId: int64String(config.activity_id),
                rules: textContent(config.rules_json),
                field4: parseJsonText(config.field_4),
            })),
        };
    }

    function isExplicitlyUnavailableShopStatus(_statusCode: string): boolean {
        // status=100 已在成功兑换后的目录中出现，不能视为售罄或禁用。
        // 尚无状态值被协议或抓包明确证实为禁用，因此目录存在且成本有效时交由服务端最终校验。
        return false;
    }

    function normalizeShopFromReply(seasonReply: any, shopActivity: any, reply: any, balances: Map<string, string> | null) {
        const goods = Array.isArray(reply.data?.catalog?.goods) ? reply.data.catalog.goods : [];
        const currencyIds: string[] = Array.from(new Set<string>(goods
            .map((entry: any) => int64String(entry?.cost?.item_id))
            .filter((id: string) => id !== '0')));
        const balanceKnown = balances !== null;
        const activityId = int64String(reply.activity_id);
        const goodsDtos = goods.map((entry: any) => {
            const statusCode = int64String(entry.status);
            const costId = int64String(entry?.cost?.item_id);
            const costCount = int64String(entry?.cost?.count);
            const costValid = costId !== '0' && BigInt(costCount) > 0n;
            const exchangeable = costValid && !isExplicitlyUnavailableShopStatus(statusCode);
            const balance = balanceKnown ? BigInt(balances!.get(costId) || '0') : 0n;
            const maxExchangeCount = exchangeable && balanceKnown
                ? (balance / BigInt(costCount)).toString()
                : '0';
            return {
                id: int64String(entry.goods_id),
                activityId,
                name: bytesToText(entry.name),
                category: bytesToText(entry.category),
                item: itemDto(entry.item),
                cost: itemDto(entry.cost),
                sortOrder: int64String(entry.sort_order),
                resource: parseJsonText(entry.resource_json),
                statusCode,
                owned: entry.owned === true,
                exchangeable,
                soldOut: false,
                balanceKnown,
                maxExchangeCount,
                maxExchangeCountKnown: balanceKnown,
                qualityCode: int64String(entry.field_10),
                field11Code: int64String(entry.field_11),
            };
        });
        const exchangeableCount = goodsDtos.filter((entry: any) => entry.exchangeable).length;
        const affordableCount = goodsDtos.filter((entry: any) => (
            entry.exchangeable && (!entry.maxExchangeCountKnown || BigInt(entry.maxExchangeCount) > 0n)
        )).length;
        return {
            activityId,
            name: bytesToText(reply.data?.activity?.name) || bytesToText(shopActivity.name),
            startTime: int64String(shopActivity.begin_time),
            endTime: int64String(shopActivity.end_time),
            serverTime: int64String(seasonReply?.season_info?.server_time),
            balanceKnown,
            currencies: currencyIds.map(id => ({
                ...itemDto({ item_id: id, count: balanceKnown ? balances!.get(id) || '0' : '0' }),
                balance: balanceKnown ? balances!.get(id) || '0' : null,
                balanceKnown,
            })),
            categories: Array.from(new Set(goods.map((entry: any) => bytesToText(entry.category)).filter(Boolean))),
            goods: goodsDtos,
            action: {
                supported: true,
                enabled: affordableCount > 0,
                available: affordableCount > 0,
                count: affordableCount,
                availabilityKnown: true,
                ...(exchangeableCount === 0
                    ? { reason: '当前目录没有明确可兑换的商品' }
                    : affordableCount === 0 ? { reason: '当前余额不足以兑换目录商品' } : {}),
            },
        };
    }

    async function queryShopCatalog(shopActivity: any): Promise<any> {
        const request = types.QueryActivityRequest.create({
            activity_id: shopActivity.activity_id,
            operate_type: QUERY_SHOP_OPERATE_TYPE,
        });
        const body = Buffer.from(types.QueryActivityRequest.encode(request).finish());
        const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', body);
        const reply = types.ActivityOperateReply.decode(replyBody);
        if (int64String(reply.activity_id) !== int64String(shopActivity.activity_id)) {
            throw businessError('SHOP_RESPONSE_INVALID', '活动商店查询返回了不匹配的活动 ID');
        }
        if (int64String(reply.operate_type) !== String(QUERY_SHOP_OPERATE_TYPE)) {
            throw businessError('SHOP_RESPONSE_INVALID', `活动商店查询返回了未知操作类型: ${int64String(reply.operate_type)}`);
        }
        if (!reply.data?.catalog || !Array.isArray(reply.data.catalog.goods)) {
            throw businessError('SHOP_RESPONSE_INVALID', '活动商店查询回包缺少商品目录');
        }
        return reply;
    }

    async function queryShopFromSeason(seasonReply: any) {
        const shopActivity = findSeasonActivity(seasonReply, SHOP_ACTIVITY_TYPE);
        if (!shopActivity) throw businessError('SHOP_UNAVAILABLE', '当前赛季未发现活动商店');
    
        const reply = await queryShopCatalog(shopActivity);
        const goods = reply.data.catalog.goods;
        const currencyIds: string[] = Array.from(new Set<string>(goods
            .map((entry: any) => int64String(entry?.cost?.item_id))
            .filter((id: string) => id !== '0')));
        let balances: Map<string, string> | null = null;
        try {
            balances = readBagBalances(await getBag(), currencyIds);
        } catch {
            // 商店目录仍可展示，但余额和基于余额的最大兑换数均不可确证。
        }
        return normalizeShopFromReply(seasonReply, shopActivity, reply, balances);
    }

    function buildActions(season: any, solarTerms: any, constellation: any = null, shop: any = null) {
        const hasPass = !!season?.pass;
        const claimablePassCount = hasPass
            ? season.pass.nodes.filter((node: any) => node.claimable).length
            : 0;
        const hasConstellation = !!season?.constellationActivity;
        const serverTime = int64Number(season?.serverTime);
        const constellationStartTime = int64Number(season?.constellationActivity?.startTime);
        const constellationEndTime = int64Number(season?.constellationActivity?.endTime);
        const constellationActive = hasConstellation
            && (serverTime <= 0 || constellationStartTime <= 0 || serverTime >= constellationStartTime)
            && (serverTime <= 0 || constellationEndTime <= 0 || serverTime <= constellationEndTime);
        const groups = Array.isArray(constellation?.groups) ? constellation.groups : [];
        const lightableGroups = groups.filter((group: any) => group.visualState === 'lightable');
        const attemptableGroups = groups.filter((group: any) => (
            group.visualState === 'lightable' || group.visualState === 'claimableUnknown'
        ));
        const currentGroups = groups.filter((group: any) => group.order === constellation?.currentDay);
        const availabilityKnown = lightableGroups.length > 0
            || (currentGroups.length > 0 && currentGroups.every((group: any) => group.stateKnown));
        const hasClaimableSolar = !!solarTerms?.terms?.some((term: any) => term.canClaim);
        return {
            claimPass: {
                supported: true,
                enabled: hasPass,
                available: claimablePassCount > 0,
                count: claimablePassCount,
            },
            lightConstellation: {
                supported: true,
                enabled: constellationActive && attemptableGroups.length > 0,
                available: lightableGroups.length > 0,
                attemptable: attemptableGroups.length > 0,
                availabilityKnown: !!constellation
                    && constellation.catalogStatus === 'supported'
                    && availabilityKnown,
                count: lightableGroups.length,
                attemptableCount: attemptableGroups.length,
            },
            claimSolar: { supported: true, enabled: hasClaimableSolar },
            exchange: {
                supported: true,
                enabled: !!shop?.action?.enabled,
                available: !!shop?.action?.available,
                availabilityKnown: !!shop,
                count: Number(shop?.action?.count) || 0,
                ...(!shop ? { reason: '活动商店目录当前不可用' } : shop.action?.reason ? { reason: shop.action.reason } : {}),
            },
        };
    }

    async function getCurrentSeasonEvent() {
        const seasonReply = await querySeason();
        const season = normalizeSeason(seasonReply);
        const activity = findSeasonActivity(seasonReply, CONSTELLATION_ACTIVITY_TYPE);
        const constellationIdentity = activity ? constellationStateIdentity(seasonReply, activity) : null;
        const constellation = activity && constellationIdentity
            ? constellationDto(
                activity,
                seasonReply?.season_info?.server_time,
                lastConstellationDynamicState.get(stateRecordKey(constellationIdentity)),
                loadMergedConstellationState(seasonReply, activity)
            )
            : null;
        const actions = buildActions(season, null, constellation);
        return { ...season, capabilities: { claimPass: true, lightConstellation: true }, actions };
    }

    async function getCurrentStarSandShop() {
        return queryShopFromSeason(await querySeason());
    }

    async function getCurrentSolarTerms() {
        const solarTerms = normalizeSolarTerms(await querySolarTerms());
        const actions = buildActions(null, solarTerms);
        return { ...solarTerms, capabilities: { claimSolar: true }, actions };
    }

    async function getCurrentStellarActivity() {
        const seasonReply = await querySeason();
        const season = normalizeSeason(seasonReply);
        const solarResult = await settleRequest(querySolarTerms);
        const shopResult = await settleRequest(() => queryShopFromSeason(seasonReply));
        const solarTerms = solarResult.status === 'fulfilled' ? normalizeSolarTerms(solarResult.value) : null;
        const shop = settledValue(shopResult);
        const constellationActivity = findSeasonActivity(seasonReply, CONSTELLATION_ACTIVITY_TYPE);
        const constellationIdentity = constellationActivity
            ? constellationStateIdentity(seasonReply, constellationActivity)
            : null;
        const constellation = constellationActivity && constellationIdentity
            ? constellationDto(
                constellationActivity,
                seasonReply?.season_info?.server_time,
                lastConstellationDynamicState.get(stateRecordKey(constellationIdentity)),
                loadMergedConstellationState(seasonReply, constellationActivity),
            )
            : null;
        const actions = buildActions(season, solarTerms, constellation, shop);
        return {
            serverTime: getServerTimeSec(),
            season,
            constellation,
            shop,
            solarTerms,
            capabilities: {
                claimPass: actions.claimPass.supported,
                lightConstellation: actions.lightConstellation.supported,
                claimSolar: actions.claimSolar.supported,
                exchange: actions.exchange.supported,
            },
            actions,
            errors: {
                solarTerms: settledError(solarResult),
                shop: settledError(shopResult),
            },
        };
    }

    async function claimBattlePassRewards() {
        return serializeMutation(async () => {
            const seasonReply = await querySeason();
            const pass = passDto(seasonReply?.season_info?.pass);
            if (!pass) throw new Error('服务端未发现可用游记');
            if (!pass.nodes.some((node: any) => node.claimable)) {
                throw new Error('当前没有可领取的游记奖励');
            }
    
            const body = Buffer.from(types.ClaimBattlePassRewardsRequest.encode(
                types.ClaimBattlePassRewardsRequest.create({})
            ).finish());
            const { body: replyBody } = await sendMsgAsync(
                'gamepb.seasonpb.SeasonService',
                'ClaimBattlePassRewards',
                body
            );
            const reply = types.ClaimBattlePassRewardsReply.decode(replyBody);
            return {
                rewards: (Array.isArray(reply.rewards) ? reply.rewards : []).map(itemDto),
                field2Codes: (Array.isArray(reply.field_2) ? reply.field_2 : []).map(int64String),
                pass: passDto(reply.pass),
                snapshot: await getActivityCenterSnapshot(),
            };
        });
    }

    async function exchangeStarSandGoods(goodsIdInput: unknown, countInput: unknown) {
        const goodsId = positiveDecimal(goodsIdInput, 'INVALID_SHOP_GOODS_ID', 'goodsId');
        const count = positiveDecimal(countInput, 'INVALID_EXCHANGE_COUNT', 'count');
    
        return serializeMutation(async () => {
            const seasonReply = await querySeason();
            const shopActivity = findSeasonActivity(seasonReply, SHOP_ACTIVITY_TYPE);
            if (!shopActivity) throw businessError('SHOP_UNAVAILABLE', '当前赛季未发现活动商店');
    
            const catalogReply = await queryShopCatalog(shopActivity);
            const catalogGoods = catalogReply.data.catalog.goods;
            const rawGoods = catalogGoods.find((entry: any) => int64String(entry?.goods_id) === goodsId);
            if (!rawGoods) throw businessError('SHOP_GOODS_NOT_FOUND', '活动商店中未找到指定商品');
    
            const currencyId = int64String(rawGoods?.cost?.item_id);
            const unitCostText = int64String(rawGoods?.cost?.count);
            const unitCost = BigInt(unitCostText);
            if (currencyId === '0' || unitCost <= 0n) {
                throw businessError('SHOP_RESPONSE_INVALID', '商品兑换成本无效，请刷新商店后重试');
            }
    
            let balances: Map<string, string>;
            try {
                balances = readBagBalances(await getBag(), [currencyId]);
            } catch {
                throw businessError('SHOP_BALANCE_UNAVAILABLE', '无法确认当前星砂余额，请稍后重试');
            }
            const shopBefore = normalizeShopFromReply(seasonReply, shopActivity, catalogReply, balances);
            const normalizedGoods = shopBefore.goods.find((entry: any) => entry.id === goodsId);
            if (!normalizedGoods) throw businessError('SHOP_GOODS_NOT_FOUND', '活动商店中未找到指定商品');
            if (!normalizedGoods.exchangeable || normalizedGoods.soldOut) {
                throw businessError('SHOP_GOODS_UNAVAILABLE', '该商品当前不可兑换，请刷新商店后重试');
            }
    
            const purchaseCount = BigInt(count);
            const totalCost = unitCost * purchaseCount;
            const balance = BigInt(balances.get(currencyId) || '0');
            if (balance < totalCost) {
                throw businessError('INSUFFICIENT_STAR_SAND', '星砂余额不足，无法完成本次兑换');
            }
    
            const request = types.ExchangeShopRequest.create({
                activity_id: shopActivity.activity_id,
                operate_type: EXCHANGE_SHOP_OPERATE_TYPE,
                exchange_shop_operate: {
                    goods_id: goodsId,
                    count,
                },
            });
            const body = Buffer.from(types.ExchangeShopRequest.encode(request).finish());
            // 写操作只发送一次；任何超时或网络错误均直接返回，不自动重试。
            const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', body);
            const reply = types.ActivityOperateReply.decode(replyBody);
            if (int64String(reply.activity_id) !== int64String(shopActivity.activity_id)) {
                throw businessError('SHOP_RESPONSE_INVALID', '活动商店兑换返回了不匹配的活动 ID');
            }
            if (int64String(reply.operate_type) !== String(EXCHANGE_SHOP_OPERATE_TYPE)) {
                throw businessError('SHOP_RESPONSE_INVALID', `活动商店兑换返回了未知操作类型: ${int64String(reply.operate_type)}`);
            }
            if (!reply.data?.catalog || !Array.isArray(reply.data.catalog.goods)) {
                throw businessError('SHOP_RESPONSE_INVALID', '活动商店兑换回包缺少最新商品目录');
            }
    
            const responseCurrencyIds: string[] = Array.from(new Set<string>(reply.data.catalog.goods
                .map((entry: any) => int64String(entry?.cost?.item_id))
                .filter((id: string) => id !== '0')));
            let latestBalances: Map<string, string> | null = null;
            try {
                latestBalances = readBagBalances(await getBag(), responseCurrencyIds);
            } catch {
                // 兑换已经由服务端确认成功；刷新背包失败不能把写操作伪装成失败，以免诱导重试。
            }
            const shop = normalizeShopFromReply(seasonReply, shopActivity, reply, latestBalances);
            const snapshot = await getActivityCenterSnapshot(shop);
            const unitItemCount = BigInt(int64String(rawGoods?.item?.count));
            const totalItemCount = (unitItemCount > 0n ? unitItemCount * purchaseCount : 0n).toString();
            const receivedItem = itemDto({
                item_id: rawGoods?.item?.item_id,
                count: totalItemCount,
            });
            const rewards = receivedItem.id !== '0' && totalItemCount !== '0' ? [receivedItem] : [];
            return {
                purchaseCount: count,
                totalItemCount,
                totalCost: totalCost.toString(),
                rewards,
                receivedItems: rewards,
                message: `兑换成功，共消耗 ${totalCost.toString()} ${normalizedGoods.cost.name || '星砂'}`,
                shop,
                snapshot,
            };
        });
    }

    async function lightConstellation() {
        return serializeMutation(async () => {
            const seasonReply = await querySeason();
            const activity = findSeasonActivity(seasonReply, CONSTELLATION_ACTIVITY_TYPE);
            if (!activity) throw new Error('服务端未发现星座活动');
    
            const identity = constellationStateIdentity(seasonReply, activity);
            const stateKey = stateRecordKey(identity);
            const serverTime = int64String(seasonReply?.season_info?.server_time);
            const startTime = int64Number(activity.begin_time);
            const serverTimeNumber = int64Number(serverTime);
            const currentDay = constellationDayFromBeijingMidnight(startTime, serverTimeNumber) ?? 0;
            const activityEndTime = int64Number(activity.end_time);
            const activityActive = serverTimeNumber > 0
                && startTime > 0
                && serverTimeNumber >= startTime
                && (activityEndTime <= 0 || serverTimeNumber <= activityEndTime);
            const request = types.OperateConstellationRequest.create({
                activity_id: activity.activity_id,
                operate_type: LIGHT_CONSTELLATION_OPERATE_TYPE,
                field_119: {},
            });
            const body = Buffer.from(types.OperateConstellationRequest.encode(request).finish());
            let replyBody: Buffer;
            try {
                ({ body: replyBody } = await sendMsgAsync(
                    'gamepb.activitypb.ActivityService',
                    'Operate',
                    body,
                    { expectedErrorCodes: [1034038] }
                ));
            } catch (error: any) {
                if (!(error instanceof GatewayError)
                    || error.code !== 1034038
                    || !activityActive
                    || currentDay < 1
                    || currentDay > 28) {
                    throw error;
                }
    
                const rejectionState = stateWithNoClaimableDay(identity, currentDay, serverTime);
                const mergedState = mergeConstellationStates(
                    identity,
                    loadMergedConstellationState(seasonReply, activity),
                    rejectionState
                );
                lastConstellationState.set(stateKey, mergedState);
                let persistenceWarning: string | undefined;
                try {
                    lastConstellationState.set(stateKey, persistConstellationState(mergedState, identity));
                } catch (persistenceError: any) {
                    persistenceWarning = String(persistenceError?.message || persistenceError || '观星状态持久化失败');
                }
                const snapshot = await getActivityCenterSnapshot();
                return {
                    outcome: 'nothingToClaim' as const,
                    noClaimable: true,
                    message: '今日星宿奖励已经领取，无需重复操作',
                    snapshot,
                    ...(persistenceWarning ? { persistenceWarning } : {}),
                };
            }
    
            const reply = types.ActivityOperateReply.decode(replyBody!);
            if (int64String(reply.activity_id) !== identity.activityId) {
                throw new Error('星座操作返回了不匹配的活动 ID');
            }
            if (int64String(reply.operate_type) !== String(LIGHT_CONSTELLATION_OPERATE_TYPE)) {
                throw new Error(`星座操作返回了未知操作类型: ${int64String(reply.operate_type)}`);
            }
            const constellationState = reply.data?.constellation;
            if (!constellationState) throw new Error('星座操作成功但回包缺少动态状态');
    
            // 回包 field_2/field_3 的 true 单调并入内存与持久状态；false 不覆盖既有确认。
            lastConstellationDynamicState.set(stateKey, constellationState);
            const mergedState = mergeConstellationStates(
                identity,
                loadMergedConstellationState(seasonReply, activity),
                stateFromDynamicNodes(identity, constellationState.nodes)
            );
            lastConstellationState.set(stateKey, mergedState);
            let persistenceWarning: string | undefined;
            try {
                lastConstellationState.set(stateKey, persistConstellationState(mergedState, identity));
            } catch (persistenceError: any) {
                persistenceWarning = String(persistenceError?.message || persistenceError || '观星状态持久化失败');
            }
            const snapshot = await getActivityCenterSnapshot();
            return {
                outcome: 'lighted' as const,
                rewards: [],
                activity: reply.data?.activity ? activityDto(reply.data.activity) : activityDto(activity),
                constellation: snapshot.constellation,
                snapshot,
                ...(persistenceWarning ? { persistenceWarning } : {}),
            };
        });
    }

    async function claimSolarTerm(termId: string) {
        return serializeMutation(async () => {
            if (!/^[1-9]\d*$/.test(termId)) throw new Error('termId 必须是正十进制整数');
            const solarReply = await querySolarTerms();
            const term = (Array.isArray(solarReply?.terms) ? solarReply.terms : [])
                .find((entry: any) => int64String(entry?.term_id) === termId);
            if (!term) throw new Error('服务端未发现指定节令');
            if (int64String(term.status) !== '2') throw new Error('指定节令当前不可领取');
    
            const body = Buffer.from(types.ClaimSolarTermsRequest.encode(
                types.ClaimSolarTermsRequest.create({ term_id: term.term_id })
            ).finish());
            const { body: replyBody } = await sendMsgAsync(
                'gamepb.solartermspb.SolarTermsService',
                'ClaimSolarTerms',
                body
            );
            const reply = types.ClaimSolarTermsReply.decode(replyBody);
            return {
                rewards: (Array.isArray(reply.rewards) ? reply.rewards : []).map(itemDto),
                term: solarTermDto(reply.term),
                snapshot: await getActivityCenterSnapshot(),
            };
        });
    }

    function constellationFromSeasonReply(seasonReply: any) {
        const activity = findSeasonActivity(seasonReply, CONSTELLATION_ACTIVITY_TYPE);
        const identity = activity ? constellationStateIdentity(seasonReply, activity) : null;
        return activity && identity
            ? constellationDto(
                activity,
                seasonReply?.season_info?.server_time,
                lastConstellationDynamicState.get(stateRecordKey(identity)),
                loadMergedConstellationState(seasonReply, activity),
            )
            : null;
    }

    return {
        querySeason,
        querySolarTerms,
        normalizeSeason,
        normalizeSolarTerms,
        queryShopFromSeason,
        buildActions,
        constellationFromSeasonReply,
        getCurrentSeasonEvent,
        getCurrentStarSandShop,
        getCurrentSolarTerms,
        getCurrentStellarActivity,
        claimBattlePassRewards,
        exchangeStarSandGoods,
        lightConstellation,
        claimSolarTerm,
    };
}

module.exports = { createStellarActivityService };
