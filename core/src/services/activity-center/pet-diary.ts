import catalog from '../../activity-data/pet-diary-2026090101.json';
import assets from '../../activity-data/pet-diary-assets.json';

const GROUP_ID = '2026090100';
const PET_ID = '2026090101';
const SEEDS_ID = '2026090102';
const SHOP_ID = '2026090103';
const DIAMOND_ID = '1004';
const base = catalog.ActivityPetTreasureHuntBase[0];
const fight = catalog.ActivityPetTreasureHuntFight[0];
const refresh = catalog.ActivityPetTreasureCharmRefresh[0];
const assetPaths = new Map(assets.map(entry => [entry.path.replace(/\/spriteFrame$/, ''), `/activity-assets/pet-diary/${entry.file}`]));

// IDs and selectors come from mini-program 1.14.0.1's encoder, not response lengths.
const OPERATIONS = {
    initialize: [27, 'pet_treasure_hunt_finish_cg'],
    feed: [29, 'pet_treasure_hunt_feed'],
    draw: [30, 'pet_treasure_hunt_draw'],
    story: [32, 'pet_treasure_hunt_claim_story'],
    refreshCharm: [41, 'pet_treasure_hunt_refresh_charm_pool'],
    equipCharm: [42, 'pet_treasure_hunt_equip_charms'],
    battle: [43, 'pet_treasure_hunt_start_battle'],
    openTreasure: [45, 'pet_treasure_hunt_open_treasure'],
    compensation: [46, 'pet_treasure_hunt_claim_plunder_compensation'],
    claimDog: [48, 'pet_treasure_hunt_claim_dog'],
    markStories: [49, 'pet_treasure_hunt_mark_story_animated'],
    skipBattle: [50, 'pet_treasure_hunt_set_skip_battle_cg'],
    seeds: [21, 'mega_event_claim_all'],
    exchange: [1, 'shop_buy'],
} as const;
type Action = keyof typeof OPERATIONS;

function createPetDiaryService(deps: any) {
    const { types, sendMsgAsync, getBag, getBagItems, getServerTimeSec, itemDto,
        int64String: str, int64Number: num, textContent, businessError, positiveDecimal,
        serializeMutation, getCurrentSolarTerms } = deps;
    let pendingRead: Promise<any> | null = null;
    const fail = (message: string) => { throw businessError('PET_DIARY_UNAVAILABLE', message); };
    const list = (value: any): any[] => Array.isArray(value) ? value : [];
    const items = (value: any) => list(value).map(itemDto);
    const localImage = (value: unknown): string => assetPaths.get(String(value || '').replace(/\/spriteFrame$/, '')) || '';
    const json = (value: unknown): any => { try { return JSON.parse(String(value || '{}')); } catch { return {}; } };
    const plain = (type: string, value: any) => types.PetDiaryOperateReply.root.lookupType(`gamepb.activitypb.${type}`).toObject(value, { longs: String, defaults: true });

    async function rpc(method: string, type: string, replyType: string, input: any) {
        const request = types[type].fromObject(input);
        const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', method, Buffer.from(types[type].encode(request).finish()));
        return types[replyType].decode(body);
    }
    async function operate(activityId: string, command: number, selector?: string, params: any = {}) {
        const reply = await rpc('Operate', 'PetDiaryOperateRequest', 'PetDiaryOperateReply', {
            activity_id: activityId, operate_type: command, ...(selector ? { [selector]: params } : {}),
        });
        if (str(reply.activity_id) !== activityId || num(reply.operate_type) !== command) fail('活动响应不匹配，请刷新后查看结果');
        if (selector && !Object.hasOwn(reply, selector)) fail('活动响应缺少操作结果，请刷新后查看结果');
        return reply;
    }
    async function readGroup() {
        const reply = await rpc('GetGroup', 'GetGroupRequest', 'PetDiaryGetGroupReply', { group_id: GROUP_ID });
        if (str(reply.group?.head?.id) !== GROUP_ID) fail('服务端未返回萌宠成长日记活动');
        const children = list(reply.group.children);
        const pet = children.find(entry => str(entry.head?.id) === PET_ID);
        if (!pet?.pet_treasure_hunt) fail('服务端未返回萌宠养成状态');
        return { pet, seeds: children.find(entry => str(entry.head?.id) === SEEDS_ID), shop: children.find(entry => str(entry.head?.id) === SHOP_ID) };
    }
    function isActive(head: any) {
        const now = getServerTimeSec();
        return num(head?.start_time) > 0 && now >= num(head.start_time) && now <= num(head.end_time);
    }
    async function balances() {
        const result = new Map<string, string>();
        for (const item of getBagItems(await getBag())) {
            const id = str(item.id);
            result.set(id, (BigInt(result.get(id) || '0') + BigInt(str(item.count))).toString());
        }
        return result;
    }
    function costsAvailable(costs: any[], bag: Map<string, string> | null, count = '1') {
        if (!bag || !costs.length) return false;
        const totals = new Map<string, bigint>();
        for (const item of costs) {
            const id = str(item.id);
            if (id === DIAMOND_ID || id === '0' || BigInt(str(item.count)) <= 0n) return false;
            totals.set(id, (totals.get(id) || 0n) + BigInt(str(item.count)) * BigInt(count));
        }
        return [...totals].every(([id, amount]) => BigInt(bag.get(id) || '0') >= amount);
    }
    const feedCosts = () => base.feed_items.split(';').map(value => { const [id, count] = value.split(':'); return { id, count }; });
    const charmRefreshCost = () => ({ id: String(refresh.manual_refresh_cost_id), count: String(refresh.manual_refresh_cost_count) });
    const charmNeedsChoice = (battle: any) => list(battle.charm_equipped).length > 0 && battle.charm_pick_used !== true;
    function treasureDto(value: any) {
        return {
            id: String(value.id), status: num(value.status), item: itemDto({ id: value.item_id, count: value.count }),
            protectedCount: str(value.protected_count), originalCount: str(value.original_count), maxCount: str(value.max_count),
            startTime: num(value.start_at) * 1000, endTime: num(value.end_at) * 1000,
            createdTime: num(value.created_at) * 1000, sourceCharmIds: list(value.source_charm_ids).map(Number),
            plunderCount: num(value.plunder_count), maxPlunderCount: num(value.max_plunder_count),
            previews: list(value.battle_previews).map(p => ({ challengeId: str(p.challenge_item_id), canStart: p.can_start === true,
                maxProfit: itemDto(p.max_profit), maxLoss: itemDto(p.max_loss), plunderableCount: str(p.plunderable_count) })),
        };
    }
    function normalize(group: any, bag: Map<string, string> | null, solar: any = null, warnings: string[] = []) {
        const state = group.pet.pet_treasure_hunt;
        const nurture = state.nurture || {}; const hunt = state.hunt || {}; const battle = state.battle || {};
        const active = isActive(group.pet.head);
        const adult = num(nurture.stage) === 2;
        const availableSeeds = list(group.seeds?.mega_event?.rewards);
        const charmDto = (id: number) => {
            const config = catalog.ActivityPetTreasureHuntCharm.find(entry => entry.charm_id === id);
            return { id, name: config?.name || `锦囊 ${id}`, description: config?.desc || '', shortDescription: config?.short_desc || config?.desc || '',
                useLimit: config?.use_limit ?? 0, image: localImage(config?.icon_path),
                remaining: list(battle.charm_effect_remaining_count).filter(e => num(e.charm_id) === id).map(e => num(e.remaining_count)) };
        };
        const goods = list(group.shop?.shop?.goods).map(g => {
            const limit = BigInt(str(g.purchase_limit)); const purchased = BigInt(str(g.purchased_count));
            const remaining = limit > 0n ? (limit > purchased ? limit - purchased : 0n).toString() : null;
            const safeCosts = list(g.cost).length > 0 && list(g.cost).every(c => str(c.id) !== DIAMOND_ID) && num(g.diamond_cost_count) === 0;
            return { id: str(g.id), name: String(g.name), image: localImage(json(g.desc).res) || itemDto(list(g.item)[0]).image,
                rewards: items(g.item), costs: items(g.cost), limit: str(g.purchase_limit), purchased: str(g.purchased_count), remaining,
                exchangeable: active && isActive(group.shop?.head) && safeCosts && remaining !== '0' && costsAvailable(list(g.cost), bag),
                safeCosts, order: num(g.order), category: String(g.category_tag || '游记好礼') };
        }).sort((a,b) => a.order - b.order);
        const growth = num(nurture.growth);
        const canClaimSeeds = availableSeeds.some(r => r.claimable === true && r.claimed !== true);
        const freeRefreshRemaining = Math.max(0, refresh.free_refresh_daily_limit - num(battle.charm_free_refresh_count));
        const paidRefreshCount = num(battle.charm_paid_refresh_count);
        const paidRefreshRemaining = Math.max(0, refresh.manual_refresh_daily_limit - paidRefreshCount);
        const canChooseCharm = active && adult && battle.charm_pick_used !== true && list(battle.charm_daily_pool).length > 0;
        return {
            activityId: PET_ID, groupId: GROUP_ID, title: '萌宠成长日记', active,
            startTime: num(group.pet.head.start_time) * 1000, endTime: num(group.pet.head.end_time) * 1000, serverTime: getServerTimeSec() * 1000,
            rules: textContent(group.pet.head.desc).paragraphs, warnings,
            treasureRules: textContent(JSON.stringify({ tips: json(group.pet.head.desc).tips2 || {} })).paragraphs,
            balances: [1028,1029,80101,80102,80103,1002].map(id => ({ ...itemDto({ id, count: bag?.get(String(id)) || '0' }), known: bag !== null })),
            nurture: { initialized: nurture.cg_played === true, adult, growth, adultGrowth: base.growth_adult_threshold, dogGranted: nurture.dog_granted === true,
                feedCount: num(state.feed?.feed_count), feedLimit: base.daily_feed_limit, feedCosts: items(feedCosts()),
                canFeed: active && !adult && num(nurture.stage) === 1 && num(state.feed?.feed_count) < base.daily_feed_limit && costsAvailable(feedCosts(), bag) },
            hunt: { count: num(hunt.treasure_count), limit: base.daily_treasure_limit, total: str(hunt.treasure_total), luckyStarTotal: str(hunt.lucky_star_gained_total),
                costs: items(hunt.treasure_cost), canDraw: active && adult && num(hunt.treasure_count) < base.daily_treasure_limit && costsAvailable(list(hunt.treasure_cost), bag),
                canPlunder: active && hunt.can_play_plunder === true && num(battle.battle_count) < fight.daily_battle_limit },
            seeds: { canClaim: active && isActive(group.seeds?.head) && canClaimSeeds,
                days: availableSeeds.map(r => ({ day: num(r.unlock_day), claimed: r.claimed === true, claimable: r.claimable === true, rewards: items(r.reward) })) },
            stories: list(state.story?.stories).map(s => { const desc = json(s.selected_desc); return { order: num(s.order), unlocked: s.unlocked === true,
                claimed: s.claimed === true, animated: s.animated === true, photo: localImage(desc.photo) }; }),
            charms: { pool: list(battle.charm_daily_pool).map(charmDto), equipped: list(battle.charm_equipped).map(charmDto), all: catalog.ActivityPetTreasureHuntCharm.map(c => charmDto(c.charm_id)),
                picked: battle.charm_pick_used === true, canChoose: canChooseCharm,
                freeRefreshRemaining, freeRefreshLimit: refresh.free_refresh_daily_limit,
                paidRefreshCount, paidRefreshRemaining, paidRefreshLimit: refresh.manual_refresh_daily_limit,
                refreshCost: itemDto(charmRefreshCost()), refreshBalance: bag ? bag.get(String(refresh.manual_refresh_cost_id)) || '0' : null,
                canRefresh: active && adult && !charmNeedsChoice(battle) && (freeRefreshRemaining > 0 || (paidRefreshRemaining > 0 && costsAvailable([charmRefreshCost()], bag))),
                refreshNote: `每日免费 ${refresh.free_refresh_daily_limit} 次，之后每次 ${refresh.manual_refresh_cost_count} 点券，今日还可付费刷新 ${paidRefreshRemaining} 次。点券不足时不刷新。` },
            treasures: list(state.pool?.treasures).map(treasureDto), compensationCount: str(state.plunder?.plunder_compensation_count),
            battleCount: num(battle.battle_count), battleLimit: fight.daily_battle_limit, skipBattle: battle.is_skip_battle_cg === true,
            shop: goods, solarTerms: solar ? { ...solar, terms: list(solar.terms).filter(term => (
                Number(term.endTime) >= num(group.pet.head.start_time) && Number(term.startTime) <= num(group.pet.head.end_time)
            )) } : null,
            plants: [20516,29004,25995,21625,20154,21072].map(id => itemDto({ id, count: bag?.get(String(id)) || '0' })),
        };
    }
    async function readSnapshot() {
        const group = await readGroup();
        const warnings: string[] = [];
        try { const shop = await operate(SHOP_ID, 7); if (!shop.data?.shop) fail('拾物小铺目录缺失'); group.shop = shop.data; }
        catch (error: any) { group.shop = null; warnings.push(`拾物小铺：${error.message}`); }
        let bag = null; let solar = null;
        try { bag = await balances(); } catch { warnings.push('背包读取失败，消耗资源的操作已暂停'); }
        try { solar = await getCurrentSolarTerms(); } catch { warnings.push('节令小礼读取失败，请稍后刷新'); }
        return normalize(group, bag, solar, warnings);
    }
    function getPetDiary() {
        if (pendingRead) return pendingRead;
        pendingRead = readSnapshot().finally(() => { pendingRead = null; });
        return pendingRead;
    }
    async function getPetDiaryRecords(kind: unknown) {
        if (kind !== 'interact' && kind !== 'plunder') fail('未知记录类型');
        const selector = kind === 'interact' ? 'pet_treasure_hunt_get_log' : 'pet_treasure_hunt_get_plundered_log';
        const reply = await operate(PET_ID, kind === 'interact' ? 31 : 44, selector);
        return list(reply[selector].logs).map(entry => kind === 'interact'
            ? { time: num(entry.ts) * 1000, type: num(entry.type), costs: items(entry.costs), rewards: items(entry.rewards), dogId: str(entry.dog_id), skins: list(entry.dog_skin_ids).map(str) }
            : { time: num(entry.ts) * 1000, attackerGid: str(entry.attacker_gid), name: String(entry.attacker_name), won: entry.attacker_won === true,
                treasureId: String(entry.treasure_id || ''), challenge: itemDto({ id: entry.challenge_item_id, count: 1 }), level: num(entry.attacker_level),
                attackerCharms: list(entry.attacker_charm).map(Number), defenderCharms: list(entry.defender_charm).map(Number),
                lost: items(entry.lost_items), injected: items(entry.injected_items), fake: entry.is_fake === true });
    }
    async function getPetDiaryFriend(gidInput: unknown) {
        const gid = positiveDecimal(gidInput, 'INVALID_FRIEND_GID', '好友 GID');
        const reply = await operate(PET_ID, 47, 'pet_treasure_hunt_get_friend_activity_info', { friend_gid: gid });
        const result = reply.pet_treasure_hunt_get_friend_activity_info;
        if (str(result.gid) !== gid) fail('好友响应不匹配');
        return { gid, treasures: list(result.info?.treasures).map(treasureDto), charms: list(result.info?.defender_charm_ids) };
    }
    async function operatePetDiary(actionInput: unknown, input: any = {}) {
        if (actionInput === 'solar') return claimPetDiarySolarTerm(input?.termId);
        if (typeof actionInput !== 'string' || !Object.hasOwn(OPERATIONS, actionInput)) fail('未知萌宠操作');
        const action = actionInput as Action;
        return serializeMutation(async () => {
            const group = await readGroup();
            if (!isActive(group.pet.head)) fail('萌宠成长日记当前不在活动时间内');
            const state = group.pet.pet_treasure_hunt; const nurture = state.nurture || {}; const battle = state.battle || {};
            let params: any = {}; let id = PET_ID;
            if (action === 'feed' || action === 'draw') {
                if (action === 'feed' && (num(nurture.stage) !== 1 || num(state.feed?.feed_count) >= base.daily_feed_limit)) fail('当前不可投喂');
                if (action === 'draw' && (num(nurture.stage) !== 2 || num(state.hunt?.treasure_count) >= base.daily_treasure_limit)) fail('当前不可寻宝');
                const costs = action === 'feed' ? feedCosts() : list(state.hunt?.treasure_cost);
                if (!costsAvailable(costs, await balances())) fail('萌宠元气糕不足，请先种植活动作物');
            } else if (action === 'initialize' && nurture.cg_played) fail('已领养比熊，请刷新状态');
            else if (action === 'claimDog' && (num(nurture.stage) !== 2 || nurture.dog_granted)) fail('比熊尚未成年或已经领取');
            else if (action === 'story') {
                const order = positiveDecimal(input?.order, 'INVALID_STORY', '手记编号');
                if (!list(state.story?.stories).some(s => str(s.order) === order && s.unlocked && !s.claimed)) fail('手记尚未解锁或已领取');
                params = { order: Number(order) };
            } else if (action === 'seeds') {
                if (!isActive(group.seeds?.head) || !list(group.seeds?.mega_event?.rewards).some(r => r.claimable && !r.claimed)) fail('当前没有可领取的种子礼包');
                id = SEEDS_ID;
            } else if (action === 'refreshCharm') {
                if (num(nurture.stage) !== 2) fail('比熊成年后才可刷新锦囊');
                if (charmNeedsChoice(battle)) fail('请先替换或保留当前锦囊，再刷新');
                const free = num(battle.charm_free_refresh_count) < refresh.free_refresh_daily_limit;
                // Payment/counter are panel preconditions, not fields in the game's empty request.
                // A stale free click must never turn into paid refresh, nor may a repeated paid click spend twice.
                if (input?.allowDiamonds || (input?.payment && !['free', 'tickets'].includes(input.payment))) fail('锦囊刷新不支持使用钻石');
                if (free) {
                    if (input?.payment && input.payment !== 'free') fail('刷新次数已变化，请刷新状态后重试');
                } else {
                    if (input?.payment !== 'tickets') fail('免费刷新已用完，请确认点券费用后再操作');
                    const paidCount = num(battle.charm_paid_refresh_count);
                    if (paidCount >= refresh.manual_refresh_daily_limit) fail('今日付费刷新次数已用完');
                    if (!Number.isSafeInteger(input?.expectedPaidRefreshCount) || input.expectedPaidRefreshCount !== paidCount) fail('刷新次数已变化，请刷新状态后重试');
                    // Live command 41 deducts 1002 x30. Re-read tickets immediately before sending;
                    // the official client falls back to diamonds when tickets are insufficient.
                    if (!costsAvailable([charmRefreshCost()], await balances())) fail('点券不足，已停止刷新，不使用钻石');
                }
            } else if (action === 'equipCharm') {
                const charmId = Number(positiveDecimal(input?.charmId, 'INVALID_CHARM', '锦囊编号'));
                const choices = [...list(battle.charm_daily_pool), ...list(battle.charm_equipped)].map(Number);
                if (num(nurture.stage) !== 2 || battle.charm_pick_used || !choices.includes(charmId)) fail('该锦囊不可选择或本轮已经选择');
                params = { charm_ids: [charmId] };
            } else if (action === 'openTreasure') {
                if (!list(state.pool?.treasures).some(t => num(t.status) === 3 || (num(t.status) === 2 && num(t.end_at) > 0 && num(t.end_at) <= getServerTimeSec()))) fail('还没有完成护送的宝藏');
            } else if (action === 'compensation' && num(state.plunder?.plunder_compensation_count) <= 0) fail('当前没有可领取的夺宝补偿');
            else if (action === 'exchange') {
                id = SHOP_ID;
                const goodsId = positiveDecimal(input?.goodsId, 'INVALID_GOODS', '商品编号');
                const count = positiveDecimal(input?.count ?? '1', 'INVALID_COUNT', '兑换数量');
                const shop = await operate(SHOP_ID, 7);
                if (!isActive(shop.data?.head)) fail('拾物小铺当前不可兑换');
                const goods = list(shop.data?.shop?.goods).find(g => str(g.id) === goodsId);
                if (!goods) fail('服务端目录未发现该商品');
                if (num(goods.diamond_cost_count) > 0 || list(goods.cost).some(c => str(c.id) === DIAMOND_ID)) fail('该商品可能消耗钻石，已阻止兑换');
                if (BigInt(str(goods.purchase_limit)) > 0n && BigInt(str(goods.purchased_count)) + BigInt(count) > BigInt(str(goods.purchase_limit))) fail('兑换数量超过剩余限购次数');
                if (!costsAvailable(list(goods.cost), await balances(), count)) fail('兑换余额不足');
                params = { goods_id: goodsId, count };
            } else if (action === 'battle') {
                if (!state.hunt?.can_play_plunder || num(battle.battle_count) >= fight.daily_battle_limit) fail('当前不可夺宝');
                const gid = positiveDecimal(input?.gid, 'INVALID_FRIEND_GID', '好友 GID');
                const challengeId = positiveDecimal(input?.challengeId, 'INVALID_CHALLENGE', '挑战书编号');
                if (![80101,80102,80103].includes(Number(challengeId))) fail('挑战书类型无效');
                const friend = await getPetDiaryFriend(gid);
                const treasure = friend.treasures.find(t => t.id === String(input?.treasureId));
                if (!treasure || treasure.status !== 2 || !treasure.previews.some(p => p.challengeId === challengeId && p.canStart)) fail('好友宝藏状态已变化，请重新查看');
                if (!costsAvailable([{ id: challengeId, count: '1' }], await balances())) fail('对应挑战书不足');
                params = { defender_gid: gid, treasure_id: treasure.id, challenge_item_id: challengeId };
            } else if (action === 'skipBattle') {
                if (typeof input?.skip !== 'boolean') fail('跳过动画设置无效');
                params = { skip: input.skip };
            } else if (action === 'markStories') {
                const orders = list(input?.orders).map(Number);
                if (!orders.length || orders.some(order => !list(state.story?.stories).some(s => num(s.order) === order && s.unlocked))) fail('手记编号无效');
                params = { orders };
            }
            const [command, selector] = OPERATIONS[action];
            const reply = await operate(id, command, selector, params);
            const result = reply[selector];
            const rewards = items(result?.rewards || result?.awards);
            let snapshot = null; let refreshError = '';
            try { snapshot = await readSnapshot(); } catch (error: any) { refreshError = `操作已成功，刷新失败：${error.message}`; }
            return { action, rewards, costs: items(result?.costs), result: plain('PetDiaryOperateReply', reply)[selector], snapshot, refreshError,
                message: action === 'battle' ? (result.won ? '夺宝成功' : '本次夺宝未获胜，已按规则结算') : '操作成功' };
        });
    }
    async function claimPetDiarySolarTerm(termIdInput: unknown) {
        const termId = positiveDecimal(termIdInput, 'INVALID_SOLAR_TERM', '节令编号');
        return serializeMutation(async () => {
            const group = await readGroup();
            if (!isActive(group.pet.head)) fail('萌宠成长日记当前不在活动时间内');
            const solar = await getCurrentSolarTerms();
            const term = list(solar.terms).find(t => t.id === termId
                && Number(t.endTime) >= num(group.pet.head.start_time) && Number(t.startTime) <= num(group.pet.head.end_time));
            if (!term?.canClaim) fail('该节令当前不可领取');
            const request = types.ClaimSolarTermsRequest.fromObject({ term_id: termId });
            const { body } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'ClaimSolarTerms', Buffer.from(types.ClaimSolarTermsRequest.encode(request).finish()));
            const reply = types.ClaimSolarTermsReply.decode(body);
            if (str(reply.term?.term_id) !== termId || num(reply.term?.status) !== 3) fail('节令回包不匹配，请刷新确认领取状态');
            let snapshot = null; let refreshError = '';
            try { snapshot = await readSnapshot(); } catch (error: any) { refreshError = `领取已成功，刷新失败：${error.message}`; }
            return { action: 'solar', rewards: items(reply.rewards), snapshot, refreshError, message: '节令好礼领取成功' };
        });
    }
    return { getPetDiary, operatePetDiary, getPetDiaryRecords, getPetDiaryFriend, normalize };
}

module.exports = { createPetDiaryService, OPERATIONS };
