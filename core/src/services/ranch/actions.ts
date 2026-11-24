import type { RanchFeedStage } from '../../config/ranch-automation';
import { RANCH_FEED_STAGES, RANCH_NEAR_HARVEST_MS } from '../../config/ranch-automation';
export {};

const { rpc, inScene } = require('./transport');
const { loadBag, loadRaw, snapshot, balance, taskList, catalog, market, canCatalog, ranchMallCatalog, canLockRanchItem, resourceBalance, salePrices, shedAwaitingActivation } = require('./state');
const { animalMap, cubMap, canMap, facilityMap, itemMap, taskMap, error, positiveId, positiveCount, quantity, itemDto, sumItems, signature } = require('./model');
const reservations = require('./operation-state');
const { recordOperation } = require('../stats');
const { getServerTimeSec } = require('../../utils/utils');
// 生产确认与货架上架是两个时点，直投后要原地等一小段再读格子。
const { setTimeout: wait } = require('node:timers/promises');

const { ACTIONS } = require('./contract');
// 这四个动作不改动资源交易，界面可以直接执行、不必先报价再确认（上游 #165）。
const DIRECT_ACTIONS = new Set(['feed', 'produce', 'harvest', 'clean']);
const FRIEND_INTERACTIONS = new Set(['stroke', 'putMosquito', 'cleanFriend', 'produceFriend']);
const LABELS: Record<string, string> = {
    buy: '购买牧场商品', place: '放养幼崽', addGrass: '补充牧草', useCan: '添加罐头', feed: '喂养动物',
    produce: '牧场生产', harvest: '牧场收获', sell: '出售牧场产物', clean: '清理牧场', activateShed: '解锁牧场棚',
    upgrade: '升级牧场设施',
    speedUpUpgrade: '沙漏加速升级',
    completeUpgrade: '完成牧场升级', claimTasks: '领取牧场任务', reportEntry: '完成牧场引导', exchange: '集市兑换',
    claimIllustrated: '领取牧场图鉴奖励',
    claimDailyShare: '领取每日首次分享礼包',
    buyCan: '购买牧场罐头', buyMall: '购买牧场商城商品', setItemLock: '设置物品锁定',
    release: '放生动物',
};

function selectedAnimals(raw: any, input: any, eligible: (animal: any) => boolean): any[] {
    const all = raw.cells.facilities.flatMap((facility: any) => facility.ranch?.animals || []);
    if (input.all === true) return all.filter(eligible);
    const ranchId = positiveId(input.ranchId, '牧场设施');
    const animalId = positiveCount(input.animalId);
    const animal = all.find((entry: any) => quantity(entry.ranch_inst_id) === ranchId && entry.animal_inst_id === animalId);
    if (!animal || !eligible(animal)) throw error('RANCH_STATE_CHANGED', '动物状态已变化，请刷新后重新操作');
    return [animal];
}

function animalRefs(animals: any[]): any[] {
    return animals.map(animal => ({ ranch_inst_id: quantity(animal.ranch_inst_id), animal_inst_id: animal.animal_inst_id }));
}

/** 各阶段时长，索引与 animal.stage 对齐（0 为幼年期占位）。 */
function feedDurations(config: any): number[] {
    return [0, config.infant_sec, config.grow_sec, config.product_round_sec, config.mature_sec];
}

function isFeedStage(value: unknown): value is RanchFeedStage {
    return typeof value === 'string' && (RANCH_FEED_STAGES as readonly string[]).includes(value);
}

/**
 * 判断动物是否命中选定的罐头使用时机。
 * 「最长阶段」用配置里的各阶段时长比较，不能拿 nextAtMs 近似：剩余时间会被罐头改短。
 */
function matchesFeedStage(animal: any, stage: RanchFeedStage, nowMs: number): boolean {
    if (stage === 'to_production') return animal.stage === 2;
    if (stage === 'near_harvest') {
        const remaining = Number(animal.mature_ready_at_ms) - nowMs;
        return animal.stage === 4 && remaining > 0 && remaining <= RANCH_NEAR_HARVEST_MS;
    }
    if (stage === 'longest') {
        const config = animalMap.get(Number(animal.animal_id));
        if (!config) return false;
        const durations = feedDurations(config);
        const current = durations[animal.stage];
        return current > 0 && current === Math.max(...durations);
    }
    return true;
}

function isClientReportedTask(task: any): boolean {
    if (!task?.unlocked || task.claimed) return false;
    if (BigInt(task.total) <= 0n || BigInt(task.progress) >= BigInt(task.total)) return false;
    return taskMap.get(Number(task.id))?.condition === '客户端上报进度';
}

/** 服务端的升级结束时间有秒和毫秒两种口径，按量级区分，避免把秒当毫秒算出几十年的剩余时间。 */
function upgradeEndMs(value: unknown): number {
    const end = Number(value);
    return end < 100_000_000_000 ? end * 1000 : end;
}

function remainingUpgradeSeconds(endMs: number): number {
    return Math.max(0, Math.ceil(endMs / 1000) - getServerTimeSec());
}

async function planAction(action: string, input: any, raw: any, produceTargets?: any[], feedStage?: RanchFeedStage): Promise<any> {
    if (!ACTIONS.includes(action)) throw error('INVALID_ARGUMENT', '不支持的牧场操作');
    const plan: any = { action, label: LABELS[action], route: action, payload: {}, costItems: [], marker: null, expectedRewards: [], count: 1 };
    if (action === 'buy') {
        const goodsId = positiveId(input.goodsId, '商品');
        const count = positiveCount(input.count);
        const shop = await catalog(raw, Number(input.shopId));
        const good = shop.goods.find((entry: any) => entry.id === goodsId);
        if (!good?.available) throw error('GOODS_UNAVAILABLE', '商品尚未解锁、已售罄或配置未确认');
        if (count > good.maxCount || (good.remaining !== null && count > good.remaining)) throw error('PURCHASE_LIMIT_EXCEEDED', '数量超过本次购买或限购上限');
        if (input.autoPlace === true && !good.animal) throw error('INVALID_ARGUMENT', '只有幼崽可以自动放养');
        if (input.autoPlace === true) {
            const kind = good.animal.husbandry_type === '窝' ? 1 : 2;
            const room = raw.cells.facilities.filter((f: any) => f.ranch?.husbandry_type === kind).reduce((sum: number, f: any) => sum + f.ranch.capacity - f.ranch.animal_count, 0);
            if (room < count) throw error('RANCH_FULL', '窝或棚的空位不足，请减少数量或先放入背包');
            plan.autoPlaceAnimalId = good.animal.id;
        }
        plan.payload = { goods_id: goodsId, num: count, price: good.price.count, auto_add: input.autoPlace === true };
        plan.costItems = [itemDto({ id: good.price.id, count: BigInt(good.price.count) * BigInt(count) })];
        plan.expectedRewards = [itemDto({ id: good.reward.id, count: BigInt(good.reward.count) * BigInt(count) })];
        plan.label = `购买${plan.expectedRewards[0].name} ×${plan.expectedRewards[0].count}`;
        plan.marker = shop.shopId;
    } else if (action === 'buyCan' || action === 'buyMall') {
        // 两个商城走同一个购买协议，只是目录判据不同：罐头商城只认罐头配置表里的奖励，
        // 礼包商城额外放行沙漏（1006）。route 统一落到 buyCan，避免多一条重复路由。
        const catalogFn = action === 'buyCan' ? canCatalog : ranchMallCatalog;
        const current = await catalogFn(raw, Number(input.slotType ?? 6));
        plan.route = 'buyCan';
        const id = positiveId(input.goodsId, '商城商品');
        const count = positiveCount(input.count);
        const good = current.goods.find((row: any) => row.id === id);
        if (!good?.available || count > good.maxCount || good.remaining !== null && count > good.remaining) throw error('GOODS_UNAVAILABLE', '商城商品不可购买或超过限购数量');
        plan.payload = { goods_id: id, count };
        plan.costItems = good.free ? [] : [itemDto({ id: good.price.id, count: BigInt(good.price.count) * BigInt(count) })];
        plan.expectedRewards = good.rewards.map((item: any) => itemDto({ id: item.id, count: BigInt(item.count) * BigInt(count) }));
        plan.marker = { slotType: current.slotType, free: good.free };
        plan.label = `${good.free ? '领取' : '购买'}${good.name} ×${count}`;
    } else if (action === 'setItemLock') {
        // 上锁/解锁共用一条动作：方向由 locked 决定，实际发的 RPC 也不同。
        const locked = input.locked;
        if (typeof locked !== 'boolean') throw error('INVALID_ARGUMENT', '请选择上锁或解锁');
        const requested = Array.isArray(input.itemUids) ? input.itemUids : [input.uid];
        if (!requested.length) throw error('INVALID_ARGUMENT', '请选择物品');
        const uids = [...new Set<string>(requested.map((uid: unknown) => positiveId(uid, '物品批次')))].sort();
        const byUid = new Map<string, any>(raw.bag.physical_items.map((item: any) => [quantity(item.uid), item]));
        const items = uids.map(uid => {
            const item = byUid.get(uid);
            if (!item || !canLockRanchItem(item)) throw error('RANCH_ITEM_NOT_LOCKABLE', '所选物品不支持锁定或已变化');
            return item;
        });
        // 已经是目标状态的物品不再发请求，否则服务端会按「无变化」回空包让结果无法确认。
        const changed = items.filter(item => item.is_locked !== locked);
        plan.route = locked ? 'lockItems' : 'unlockItems';
        plan.payload = { item_uids: changed.map(item => quantity(item.uid)) };
        plan.marker = { items: changed.map(item => ({ uid: quantity(item.uid), id: quantity(item.id) })), locked };
        plan.count = changed.length;
        if (!changed.length) plan.message = `所选物品已经${locked ? '上锁' : '解锁'}`;
        const target = changed.length === 1 ? itemDto(changed[0]).name : `${changed.length} 格物品`;
        plan.label = `${locked ? '锁定' : '解锁'}${target}`;
    } else if (action === 'place') {
        const ranchId = positiveId(input.ranchId, '牧场设施');
        const itemId = Number(positiveId(input.itemId, '幼崽'));
        const count = positiveCount(input.count);
        const animal = cubMap.get(itemId);
        const ranch = raw.cells.facilities.find((facility: any) => quantity(facility.instance_id) === ranchId)?.ranch;
        if (!animal || !ranch || ranch.husbandry_type !== (animal.husbandry_type === '窝' ? 1 : 2)) throw error('RANCH_ANIMAL_MISMATCH', '幼崽与窝或棚不匹配');
        if (count > ranch.capacity - ranch.animal_count) throw error('RANCH_FULL', '窝或棚的空位不足');
        plan.payload = { items: Array.from({ length: count }, () => ({ ranch_inst_id: ranchId, animal_id: animal.id, giant_cub_item_id: animal.giantCubItemId })) };
        plan.costItems = [itemDto({ id: itemId, count })];
        plan.label = `放养${plan.costItems[0].name} ×${count}`;
        plan.marker = { ranchId, animalId: animal.id, capacity: ranch.capacity, occupied: ranch.animal_count };
        plan.count = count;
    } else if (action === 'addGrass') {
        const facilityId = positiveId(input.facilityId, '牧草机');
        const count = positiveCount(input.count);
        const facility = raw.cells.facilities.find((entry: any) => quantity(entry.instance_id) === facilityId && entry.module_type === 8);
        if (raw.recipient && (!facility?.feed_machine || facility.state !== 1)) throw error('RANCH_STATE_CHANGED', '好友牧草机已变化，请刷新');
        if (!facility?.feed_machine || count > facility.capacity - facility.feed_machine.feed_count) throw error('RANCH_GRASS_CAPACITY', '牧草机剩余容量不足');
        plan.payload = { instance_id: facilityId, add_count: count, use_gold: false };
        if (raw.recipient) {
            plan.payload.host_gid = raw.recipient.gid;
            plan.label = `向${raw.recipient.name}赠送牧草`;
            plan.count = count;
        }
        plan.costItems = [itemDto({ id: 7001, count })];
        plan.marker = { capacity: facility.capacity, level: facility.level };
    } else if (action === 'useCan') {
        const uid = positiveId(input.uid, '罐头批次');
        const count = positiveCount(input.count);
        const item = raw.bag.physical_items.find((entry: any) => quantity(entry.uid) === uid);
        const config = item && canMap.get(Number(item.id));
        if (!config || item.is_locked || BigInt(quantity(item.count)) < BigInt(count)) throw error('RANCH_CAN_UNAVAILABLE', '罐头库存不足或已锁定');
        plan.payload = { item: { id: quantity(item.id), uid, count } };
        plan.costItems = [itemDto({ id: item.id, count })];
        plan.bucketId = config.feed_type === '有机罐头' ? 7004 : 7003;
        plan.marker = { uid, bucketId: plan.bucketId, seconds: config.speed_up_secs };
        plan.expectedSeconds = BigInt(config.speed_up_secs) * BigInt(count);
    } else if (action === 'feed') {
        const bucketType = Number(input.bucketType);
        if (![1, 2].includes(bucketType)) throw error('INVALID_ARGUMENT', '请选择有机或普通罐头');
        const feedable = selectedAnimals(raw, input, () => true).filter(animal => animal.can_feed);
        const unused = feedable.filter(animal => bucketType === 1 || !animal.limited_can_used);
        // 时机策略优先用自动化下发的值；界面直投则按桶类型读 normalStage / organicStage。
        const requested = bucketType === 1 ? input.organicStage : input.normalStage;
        const strategy: RanchFeedStage = feedStage ?? (isFeedStage(requested) ? requested : 'any');
        const nowSeconds = getServerTimeSec();
        const nowMs = nowSeconds * 1000;
        const animals = unused.filter((animal: any) => matchesFeedStage(animal, strategy, nowMs));
        // 区分「没动物可喂」和「罐头本轮已用」：否则界面只能给一个笼统的跳过提示。
        if (!animals.length) plan.message = feedable.length ? '普通罐头本轮已使用' : '当前没有可喂养的动物';
        // 有可喂动物但都不符合时机时，单独给一条更准确的提示。
        if (unused.length && !animals.length) {
            plan.message = strategy === 'longest' ? '当前没有处于最长生长阶段的可喂养动物' : '当前没有符合罐头使用时机的动物';
        }
        plan.payload = { targets: animalRefs(animals), bucket_type: bucketType };
        const maxSeconds = animals.reduce((sum, animal) => {
            const config = animalMap.get(Number(animal.animal_id));
            if (!config) throw error('RANCH_CONFIG_UNKNOWN', '动物阶段配置尚未同步');
            const durations = feedDurations(config);
            const deadlines = [0, animal.infant_ready_at_ms, animal.grow_ready_at_ms, animal.produce_ready_at_ms, animal.mature_ready_at_ms];
            const remaining = Math.max(0, Math.ceil(Number(deadlines[animal.stage]) / 1000) - nowSeconds);
            const upperBound = Math.max(durations[animal.stage] || 0, Math.ceil(remaining / 3600) * 3600);
            if (!upperBound) throw error('RANCH_PRICE_UNKNOWN', '当前阶段的罐头消耗无法确认');
            return sum + BigInt(upperBound);
        }, 0n);
        const bucketId = bucketType === 1 ? 7004 : 7003;
        const available = BigInt(balance(raw.bag, bucketId).total);
        // 罐头桶按类型分开报错，否则用户分不清是普通罐头还是有机罐头用完了。
        if (animals.length && available <= 0n) throw error('RANCH_BUCKET_EMPTY', `${bucketType === 1 ? '有机罐头' : '普通罐头'}不足，请先添加罐头`);
        // 没有可喂养动物时不挂费用，避免 skipping 分支还显示一堆待扣罐头。
        if (animals.length) plan.costItems = [itemDto({ id: bucketId, count: available < maxSeconds ? available : maxSeconds })];
        plan.bucketId = bucketId;
        plan.marker = animals.map(animal => [quantity(animal.ranch_inst_id), animal.animal_inst_id, animal.stage, animal.limited_can_used, quantity(animal.grow_ready_at_ms), quantity(animal.mature_ready_at_ms)]);
        plan.count = animals.length;
    } else if (action === 'release') {
        if (input.all === true) throw error('INVALID_ARGUMENT', '请逐只确认需要放生的动物');
        const animals = selectedAnimals(raw, input, animal => animal.can_donate);
        if ((await require('./friends').getInteractionTimes()).release <= 0) throw error('RANCH_INTERACTION_LIMIT', '今日放生次数已用完');
        const animal = animals[0];
        const name = `${animal.mutation?.mutation_type ? '巨大' : ''}${animalMap.get(Number(animal.animal_id))?.name || '动物'}`;
        plan.payload = { targets: animalRefs(animals) };
        plan.marker = { animalId: quantity(animal.animal_id), stage: animal.stage, mutation: animal.mutation?.mutation_type || 0 };
        plan.label = `放生${name}`;
        plan.message = `确定放生「${name}」吗？放生后动物将离开栏舍，已产出的产物会保留。`;
        plan.resultKeys = [`${quantity(animal.ranch_inst_id)}:1:${animal.animal_inst_id}`];
    } else if (action === 'produce' || action === 'harvest') {
        // 喂养后自动生产会传入只含刚进入可生产状态的动物，避免顺手把整栏都催产一遍。
        const animals = produceTargets ?? selectedAnimals(raw, input, animal => action === 'produce' ? animal.can_deliver : animal.can_harvest);
        const shelves = action === 'harvest' && input.all === true ? raw.cells.facilities.flatMap((f: any) => (f.ranch?.shelves || []).filter((s: any) => s.can_collect).map((s: any) => ({ ranch_inst_id: quantity(f.instance_id), slot_index: s.slot_index }))) : [];
        plan.payload = action === 'produce' ? { targets: input.all === true ? [] : animalRefs(animals) }
            : input.all === true ? { op: 1 } : { op: 4, animals: animalRefs(animals) };
        plan.marker = { animals: animalRefs(animals), shelves };
        plan.resultKeys = [...animals.map(animal => `${quantity(animal.ranch_inst_id)}:1:${animal.animal_inst_id}`), ...shelves.map(shelf => `${shelf.ranch_inst_id}:2:${shelf.slot_index}`)];
        plan.count = animals.length + shelves.length;
    } else if (action === 'clean') {
        const ids = raw.cells.facilities.filter((facility: any) => facility.ranch?.hazards.length).map((facility: any) => quantity(facility.instance_id));
        plan.payload = { ranch_inst_ids: ids };
        plan.marker = raw.cells.facilities.flatMap((f: any) => f.ranch?.hazards.map((hazard: any) => `${quantity(f.instance_id)}:3:${quantity(hazard.hazard_id)}`) || []);
        plan.resultKeys = plan.marker;
        plan.count = plan.marker.length;
    } else if (action === 'sell') {
        // 产物可能同一批标多种货币（金币 + 金券），统一走 salePrices 取完整报价，不只看第一条。
        let requested: Array<{ item: any; count: string | number; prices: any[] }>;
        if (input.all === true) {
            requested = raw.bag.physical_items.filter((item: any) => [106, 107].includes(itemMap.get(Number(item.id))?.type))
                .map((item: any) => ({ item, count: quantity(item.count), prices: salePrices(item) }))
                .filter((entry: any) => entry.prices.length);
        } else {
            const uid = positiveId(input.uid, '物品批次');
            const count = positiveCount(input.count);
            const item = raw.bag.physical_items.find((row: any) => quantity(row.uid) === uid);
            const prices = item && salePrices(item);
            if (!prices?.length || BigInt(quantity(item.count)) < BigInt(count)) throw error('RANCH_ITEM_UNAVAILABLE', '物品库存、锁定或出售条件已变化');
            requested = [{ item, count, prices }];
        }
        plan.payload.items = requested.map(({ item, count, prices }) => {
            plan.expectedRewards.push(...prices.map((price: any) => itemDto({ id: price.id, count: BigInt(quantity(price.count)) * BigInt(count) })));
            return { id: quantity(item.id), uid: quantity(item.uid), count };
        });
        plan.costItems = plan.payload.items.map(itemDto);
        plan.count = requested.length;
        // 单批出售给出具体物品名与数量，便于在日志里对上卖的是哪一条。
        if (input.all !== true) plan.label = `出售${plan.costItems[0].name} ×${plan.costItems[0].count}`;
    } else if (action === 'activateShed') {
        const id = positiveId(input.facilityId, '牧场棚');
        const shed = shedAwaitingActivation(raw);
        plan.count = Number(quantity(shed?.instance_id) === id);
        plan.payload = { instance_id: id };
        plan.marker = shed?.facility_id;
    } else if (action === 'upgrade' || action === 'speedUpUpgrade' || action === 'completeUpgrade') {
        const id = positiveId(input.facilityId, '牧场设施');
        const facility = raw.cells.facilities.find((row: any) => quantity(row.instance_id) === id && [6, 7, 8].includes(row.module_type));
        if (!facility || facility.state !== 1) throw error('RANCH_FACILITY_NOT_FOUND', '牧场设施尚未建造或未就绪');
        plan.payload = { inst_id: id };
        plan.marker = { facilityId: facility.facility_id, level: facility.level };
        if (action === 'upgrade') {
            const current = facilityMap.get(facility.facility_id); const next = facilityMap.get(current?.next_facility_id);
            const requirement = next?.upgrade_conditions?.match(/^RANCH_LEVEL:(\d+)$/);
            if (!next || !requirement || snapshot(raw).level < Number(requirement[1]) || facility.upgrade_state !== 0) throw error('RANCH_UPGRADE_UNAVAILABLE', '尚未满足等级要求、已满级或正在升级');
            const details = (await rpc('facility', { instance_id: id })).info;
            if (details.facility_id !== facility.facility_id || details.level !== facility.level) throw error('RANCH_STATE_CHANGED', '建筑等级已变化');
            plan.costItems = details.upgrade_cost.map(itemDto);
            if (!plan.costItems.length) throw error('RANCH_PRICE_UNKNOWN', '升级费用尚未确认');
            plan.next = next;
            plan.label = `升级${current.name}至${next.level}级（${next.upgrade_secs}秒）`;
        } else if (action === 'speedUpUpgrade') {
            // 加速只能用沙漏（1006），扣的秒数不能超过本次升级总时长，也不该超过剩余时间；
            // 剩余时间为 0 时直接给 skipped，让界面提示「已到时间，刷新完成升级」。
            const endMs = upgradeEndMs(facility.upgrade_end_time);
            if (facility.upgrade_state !== 1 || remainingUpgradeSeconds(endMs) <= 0) {
                plan.count = 0;
                plan.message = '当前没有进行中的升级';
            } else {
                const current = facilityMap.get(facility.facility_id);
                const next = facilityMap.get(current?.next_facility_id);
                if (!next) throw error('RANCH_CONFIG_UNKNOWN', '建筑目标等级配置尚未同步');
                const seconds = Math.min(positiveCount(input.seconds), next.upgrade_secs);
                plan.payload = { inst_id: id, count: seconds, item_id: 1006 };
                plan.marker.endMs = endMs;
                plan.next = next;
                plan.costItems = [itemDto({ id: 1006, count: seconds })];
                plan.label = `加速${current.name}升至${next.level}级`;
            }
        } else if (!facility.upgrade_state) {
            plan.count = 0;
        } else {
            const endMs = upgradeEndMs(facility.upgrade_end_time);
            if (facility.upgrade_state !== 2 && endMs > getServerTimeSec() * 1000) throw error('RANCH_UPGRADE_PENDING', '设施仍在升级中');
            plan.next = facilityMap.get(facilityMap.get(facility.facility_id)?.next_facility_id);
            if (!plan.next) throw error('RANCH_CONFIG_UNKNOWN', '建筑目标等级配置尚未同步');
        }
    } else if (action === 'claimTasks') {
        const tasks = taskList(await rpc('tasks', { global_scene_id: 2 }));
        const wanted = input.all === true ? tasks.filter((task: any) => task.canClaim) : [tasks.find((task: any) => task.id === positiveId(input.taskId, '任务'))];
        if (wanted.some((task: any) => !task?.canClaim)) throw error('RANCH_TASK_UNAVAILABLE', '任务尚未完成或已领取');
        plan.tasks = wanted;
        plan.marker = wanted.map((task: any) => ({ id: task.id, multiple: input.double === false ? 1 : Math.max(1, task.shareMultiple), rewards: task.rewards }));
        plan.count = wanted.length;
        for (const task of plan.marker) plan.expectedRewards.push(...task.rewards.map((item: any) => itemDto({ id: item.id, count: BigInt(item.count) * BigInt(task.multiple) })));
    } else if (action === 'reportEntry') {
        if (input.entry !== 'friends') throw error('INVALID_ARGUMENT', '该任务入口尚未验证');
        const tasks = taskList(await rpc('tasks', { global_scene_id: 2 }));
        plan.reportTasks = tasks.filter((task: any) => isClientReportedTask(task))
            .map((task: any) => ({ id: task.id, progress: task.total }));
        plan.payload = plan.reportTasks.map((task: any) => ({ task_id: task.id, progress: task.progress }));
        plan.route = 'reportTask';
        plan.marker = plan.reportTasks.map((task: any) => task.id);
        plan.count = plan.reportTasks.length;
    } else if (action === 'claimIllustrated') {
        plan.bookClaim = await require('./book').prepareBookClaim(input.kind);
        plan.label = plan.bookClaim.kind === 'normal' ? '领取牧场普通图鉴奖励' : '领取牧场巨大图鉴奖励';
        plan.marker = { kind: plan.bookClaim.kind, ids: plan.bookClaim.ids, rewards: plan.bookClaim.rewards };
        plan.expectedRewards = plan.bookClaim.rewards;
        plan.count = plan.bookClaim.count;
    } else if (action === 'claimDailyShare') {
        const state = await require('./daily-share').prepare();
        plan.count = state.claimed ? 0 : 1;
        plan.marker = { dateKey: state.dateKey };
        plan.expectedRewards = state.claimed ? [] : state.rewards;
    } else if (action === 'exchange') {
        const current = await market(raw);
        // 报价时带上轮次：如果自动流程排队期间集市场次已换或已结束，直接作废这一单，不按旧价成交。
        if (input.marketRotation && (current.periodDay !== input.marketRotation.periodDay
            || current.roundIndex !== input.marketRotation.roundIndex || getServerTimeSec() >= input.marketRotation.endsAt)) {
            throw error('RANCH_OFFER_CHANGED', '集市场次已变化或已结束');
        }
        const id = positiveId(input.goodsId, '兑换商品');
        const count = positiveCount(input.count);
        const good = current.goods.find((entry: any) => entry.id === id);
        if (!good?.available || (good.remaining !== null && count > good.remaining)) throw error('RANCH_EXCHANGE_UNAVAILABLE', '集市已离场、商品受限或限购已用完');
        plan.payload = { goods_id: id, count, period_day: current.periodDay, round_index: current.roundIndex };
        plan.costItems = [itemDto({ id: good.price.id, count: BigInt(good.price.count) * BigInt(count) })];
        plan.expectedRewards = [itemDto({ id: good.reward.id, count: BigInt(good.reward.count) * BigInt(count) })];
    }
    plan.costItems = sumItems(plan.costItems).filter((item: any) => BigInt(item.count) > 0n);
    plan.expectedRewards = sumItems(plan.expectedRewards);
    plan.costs = plan.costItems.map((item: any) => ({ resourceKey: `item:${item.id}`, amount: item.count }));
    plan.balances = [];
    for (const item of plan.costItems) plan.balances.push(await resourceBalance(raw, item.id));
    for (let index = 0; index < plan.costs.length; index++) {
        const available = BigInt(plan.balances[index].total) - BigInt(plan.balances[index].locked);
        if (available < BigInt(plan.costs[index].amount)) throw error('INSUFFICIENT_BALANCE', `${plan.costItems[index].name}不足`);
    }
    plan.signature = JSON.stringify({ action, payload: plan.payload, costs: plan.costs, rewards: plan.expectedRewards, marker: plan.marker });
    return plan;
}

type GrassRecipient = { gid: string; name: string };

function inActionScene(action: string, input: any, run: (cells: any, recipient?: GrassRecipient) => Promise<any>): Promise<any> {
    if (action === 'addGrass' && input.hostGid !== undefined) {
        return require('./friends').withFriendVisit(input.hostGid, (entry: any, host: string) =>
            run(entry.homestead_cells, { gid: host, name: entry.basic.name }));
    }
    return inScene(run);
}

async function prepareAction(action: string, input: any = {}, feedStage?: RanchFeedStage): Promise<any> {
    if (action === 'steal') return require('./friends').prepareSteal(input);
    if (FRIEND_INTERACTIONS.has(action)) return require('./friends').prepareInteraction(action, input);
    return inActionScene(action, input, async (cells, recipient) => {
        // 图鉴领奖只用 book/weightBook 两个接口，不需要整份牧场快照，省一次 cells + bag 读取。
        const raw = action === 'claimIllustrated' ? null : { ...await loadRaw(cells), recipient };
        const plan = await planAction(action, input, raw, undefined, feedStage);
        return { action, label: plan.label, costs: plan.costs, costItems: plan.costItems, rewards: plan.expectedRewards, count: plan.count,
            expected: { signature: plan.signature }, skipped: plan.count === 0, message: plan.message };
    });
}

function unknown(action: string, reason: string): never {
    throw error('RANCH_RESULT_UNKNOWN', `${LABELS[action]}结果未能确认：${reason}，请刷新核对，勿重复提交`);
}

/**
 * 动物类动作的回包已带变动栏舍的完整详情，可以直接拼回 cells 复用，省掉一次整场景重读。
 * 只要有一个栏舍对不上就返回 undefined，让调用方退回完整 loadRaw，避免拿到半份脏快照。
 */
function cellsFromReceipt(cells: any, reply: any): any {
    const ranches = new Map<string, any>(reply.ranches.map((ranch: any) => [quantity(ranch.ranch_inst_id), ranch]));
    if (!ranches.size || reply.op_results.some((row: any) => !ranches.has(quantity(row.facility_inst_id)))) return undefined;
    let matched = 0;
    const facilities = cells.facilities.map((facility: any) => {
        const ranch = ranches.get(quantity(facility.instance_id));
        if (!ranch) return facility;
        matched++;
        return { ...facility, ranch };
    });
    return matched === ranches.size ? { ...cells, facilities } : undefined;
}

/** 从回包的 op_results 里挑出 kind=1（动物）的行，再回原始栏舍里取完整动物详情。 */
function animalsInResults(ranches: any[], rows: any[]): any[] {
    const ids = new Set(rows.filter(row => row.kind === 1).map(row => `${quantity(row.facility_inst_id)}:${quantity(row.target_id)}`));
    return ranches.flatMap(ranch => ranch.animals.filter((animal: any) => ids.has(`${quantity(ranch.ranch_inst_id)}:${animal.animal_inst_id}`)));
}

async function operate(action: string, input: any = {}, feedStage?: RanchFeedStage): Promise<any> {
    if (FRIEND_INTERACTIONS.has(action)) return require('./friends').interact(action, input);
    if (action === 'acknowledge') return inScene(async () => {
        reservations.forCurrentAccount().acknowledge(String(input.id));
        require('./automation').resetSchedule();
        return { status: 'confirmed', refreshRequired: true, costs: [], rewards: [] };
    });
    if (action === 'steal') return require('./friends').steal(input);

    /**
     * 执行体从 inScene 回调里抽出来：喂养后要沿用同一个场景再发一次生产，
     * 复用同一个 before 快照，不必再次进出场景。
     */
    async function run(action: string, input: any, before: any, produceTargets?: any[]): Promise<any> {
        // direct 只对不改动交易的四个动作开放，且不允许同时带 expected，
        // 否则等于绕开报价校验，其它动作仍然必须走报价确认。
        const direct = input.direct === true && input.expected === undefined && DIRECT_ACTIONS.has(action);
        const plan = await planAction(action, input, before, produceTargets, feedStage);
        if (plan.count === 0) return { status: 'skipped', snapshot: snapshot(before), costs: [], rewards: [], notice: plan.message };
        if (!direct && input.expected?.signature !== plan.signature) throw error('RANCH_OFFER_CHANGED', '牧场状态、商品或费用已变化，请重新确认');
        let after: any = null;
        // 本次喂养回包里的动物行，供后面判断「哪些是刚被喂到可生产状态」。
        let fedResults: any[] = [];
        const target = before.recipient ? `ranch:addGrass:${before.recipient.gid}:${plan.payload.instance_id}`
            : `ranch:${action}:${input.goodsId || input.facilityId || input.uid || input.taskId || input.ranchId || 'all'}`;
        const result = await reservations.forCurrentAccount().spend({ target, label: plan.label, costs: plan.costs, balances: plan.balances }, async () => {
            let reply: any; let rewards: any[] = []; let actualCosts = plan.costItems;
            // 图鉴领奖的「完成数」以回包确认的等级数为准，不能沿用 plan.count。
            let completed = plan.count;
            if (action === 'claimDailyShare') {
                const claimed = await require('./daily-share').claim();
                rewards = claimed.rewards;
                reply = { alreadyClaimed: claimed.skipped };
            } else if (action === 'claimIllustrated') {
                const claimed = await require('./book').claimBook(plan.bookClaim);
                rewards = claimed.rewards;
                completed = claimed.completed;
                reply = {};
            } else if (action === 'reportEntry') {
                for (const entry of plan.reportTasks) {
                    reply = await rpc('reportTask', { task_id: entry.id, progress: entry.progress }, true);
                    if (!taskList(reply).find((task: any) => task.id === entry.id)?.canClaim) unknown(action, '引导任务未完成');
                }
            } else if (action === 'claimTasks') {
                const allOrdinary = plan.marker.every((task: any) => task.multiple === 1);
                if (plan.tasks.length > 1 && allOrdinary) {
                    reply = await rpc('claimTasks', { ids: plan.tasks.map((task: any) => task.id) }, true);
                    if (taskList(reply).some((task: any) => plan.tasks.some((chosen: any) => chosen.id === task.id) && !task.claimed)) unknown(action, '任务仍显示未领取');
                    rewards.push(...reply.items);
                } else {
                    for (const task of plan.marker) {
                        if (task.multiple > 1) {
                            const shared = await rpc('reportShare', { share_id: 103, params: [task.id], doc_id: 2104 }, true);
                            require('../../utils/network').applyShareInfos(shared.share_infos);
                        }
                        reply = await rpc('claimTask', { id: task.id, do_shared: task.multiple > 1 }, true);
                        const remaining = taskList(reply).find((row: any) => row.id === task.id);
                        if (remaining && !remaining.claimed) unknown(action, '任务仍显示未领取');
                        rewards.push(...reply.items);
                    }
                }
                if (signature(rewards) !== signature(plan.expectedRewards)) unknown(action, '任务奖励不匹配');
            } else {
                let payload = plan.payload;
                if (action === 'speedUpUpgrade') {
                    // 报价到执行之间升级可能已经推进，按真实剩余时间截断，避免多扣沙漏。
                    const count = Math.min(payload.count, remainingUpgradeSeconds(plan.marker.endMs));
                    if (count <= 0) return { status: 'skipped', snapshot: null, refreshRequired: true, costs: [], rewards: [], notice: '已到升级时间，请刷新完成升级' };
                    payload = { ...payload, count };
                }
                reply = await rpc(plan.route, payload, true);
                if (before.recipient) {
                    const filled = reply.detail?.feed_count;
                    if (filled === undefined || filled < plan.count || filled > plan.marker.capacity) unknown(action, '好友牧草机回包不匹配');
                } else if (action === 'setItemLock') {
                    // 服务端只回真正变更的批次；和计划不一致说明期间状态被改动，按结果未知处理。
                    const confirmed = reply.item_uids.map(quantity).sort();
                    if (JSON.stringify(confirmed) !== JSON.stringify(plan.payload.item_uids)) unknown(action, '锁定回包与物品不符');
                } else if (action === 'buyCan' || action === 'buyMall') {
                    if (!reply.success || quantity(reply.goods_id) !== plan.payload.goods_id || signature(reply.reward_items) !== signature(plan.expectedRewards)) unknown(action, '商品或奖励不匹配');
                    rewards = reply.reward_items;
                } else if (action === 'buy') {
                    if (quantity(reply.goods?.id) !== plan.payload.goods_id || signature(reply.cost_items) !== signature(plan.costItems)) unknown(action, '商品或扣费不匹配');
                    // 自动放养返回放养经验，幼崽是否到账通过后续栏位状态确认。
                    if (!plan.autoPlaceAnimalId && signature(reply.get_items) !== signature(plan.expectedRewards)) unknown(action, '入包物品不匹配');
                    rewards = reply.get_items;
                } else if (action === 'sell') {
                    const sold = (items: any[]) => items.map(item => `${quantity(item.id)}:${quantity(item.uid)}:${quantity(item.count)}`).sort().join('|');
                    if (sold(reply.sell_items) !== sold(plan.payload.items) || signature(reply.get_items) !== signature(plan.expectedRewards)) unknown(action, '出售物品或收益不匹配');
                    rewards = reply.get_items;
                } else if (action === 'exchange') {
                    if (quantity(reply.card?.goods_id) !== plan.payload.goods_id || signature(reply.awards) !== signature(plan.expectedRewards)) unknown(action, '兑换商品或奖励不匹配');
                    rewards = reply.awards;
                } else if (action === 'feed') {
                    const used = BigInt(quantity(reply.deduct_secs));
                    const cap = BigInt(plan.costItems[0].count);
                    if (used <= 0n || used > cap || BigInt(quantity(reply.bucket_remain_secs)) !== BigInt(balance(before.bag, plan.bucketId).total) - used) unknown(action, '罐头消耗或余量不匹配');
                    actualCosts = [itemDto({ id: plan.bucketId, count: used })];
                    // 留下本次回包的动物行，喂养后自动生产只针对这几只。
                    fedResults = reply.op_results;
                } else if (action === 'activateShed') {
                    const shed = reply.facility;
                    if (quantity(shed?.instance_id) !== plan.payload.instance_id || shed.facility_id !== plan.marker
                        || shed.module_type !== 7 || shed.state !== 1 || !shed.ranch) unknown(action, '棚的激活状态不匹配');
                } else if (action === 'upgrade') {
                    if (quantity(reply.upgrade?.inst_id) !== plan.payload.inst_id || reply.upgrade.target_level !== plan.next.level || reply.upgrade.target_facility_id !== plan.next.facility_id) unknown(action, '建筑升级目标不匹配');
                } else if (action === 'speedUpUpgrade') {
                    // 三重核对：目标一致、只扣了一种且是沙漏、升级结束时间正好前移了扣掉的秒数。
                    const upgrade = reply.upgrade;
                    const consumed = sumItems(reply.consumed);
                    const seconds = BigInt(quantity(consumed[0]?.count));
                    if (quantity(upgrade?.inst_id) !== payload.inst_id || upgrade.target_facility_id !== plan.next.facility_id
                        || upgrade.target_level !== plan.next.level || consumed.length !== 1 || consumed[0].id !== 1006
                        || seconds <= 0n || seconds > BigInt(payload.count)
                        || plan.marker.endMs - upgradeEndMs(upgrade.end_time) !== Number(seconds) * 1000) {
                        unknown(action, '设施计时或沙漏消耗不匹配');
                    }
                    actualCosts = consumed;
                } else if (action === 'completeUpgrade') {
                    if (quantity(reply.facility?.instance_id) !== plan.payload.inst_id || reply.facility.level !== plan.next.level || reply.facility.facility_id !== plan.next.facility_id) unknown(action, '建筑等级不匹配');
                } else if (action === 'release') {
                    const target = plan.payload.targets[0];
                    const result = reply.op_results[0];
                    const ranch = reply.ranches.find((row: any) => quantity(row.ranch_inst_id) === target.ranch_inst_id);
                    if (reply.op_results.length !== 1 || !result || result.kind !== 1 || quantity(result.facility_inst_id) !== target.ranch_inst_id
                        || quantity(result.target_id) !== String(target.animal_inst_id) || result.costs.length
                        || !ranch || ranch.animals.some((animal: any) => animal.animal_inst_id === target.animal_inst_id)
                        || result.rewards.some((item: any) => BigInt(quantity(item.count)) <= 0n)) unknown(action, '放生目标或栏位变化不匹配');
                    rewards = result.rewards;
                } else if (reply.op_results) {
                    rewards = reply.op_results.flatMap((result: any) => result.rewards);
                    if (action === 'place' && reply.op_results.length !== plan.count) unknown(action, '放养数量不匹配');
                    if (plan.resultKeys) {
                        const keys = reply.op_results.map((row: any) => `${quantity(row.facility_inst_id)}:${row.kind}:${quantity(row.target_id)}`);
                        if (new Set(keys).size !== keys.length) unknown(action, '回包包含重复目标');
                        for (const [index, key] of keys.entries()) {
                            if (plan.resultKeys.includes(key)) continue;
                            const row = reply.op_results[index];
                            const facilityId = quantity(row.facility_inst_id);
                            const targetId = quantity(row.target_id);
                            // 一键操作以服务端执行时的状态为准，可能包含读取后刚成熟的动物、产物或新污物。
                            if (action === 'clean' && row.kind === 3 && BigInt(targetId) > 0n && plan.payload.ranch_inst_ids.includes(facilityId)) continue;
                            if (input.all === true && (action === 'harvest' || action === 'produce')) {
                                const ranch = before.cells.facilities.find((f: any) => quantity(f.instance_id) === facilityId)?.ranch;
                                if (row.kind === 1 && ranch?.animals.some((animal: any) => quantity(animal.animal_inst_id) === targetId)) continue;
                                if (action === 'harvest' && row.kind === 2 && ranch && BigInt(targetId) > 0n && BigInt(targetId) <= BigInt(ranch.capacity)) continue;
                            }
                            unknown(action, '回包目标超出本次操作范围');
                        }
                    }
                }
            }
            // 动物类动作的回包已含变动栏舍的完整详情，沿用同场景快照只补读背包；
            // 拼不上就退回完整读取，宁可慢一点也不要拿半份脏快照。
            let receiptCells = direct ? cellsFromReceipt(before.cells, reply) : undefined;
            if (direct && action === 'produce') {
                const produced = animalsInResults(reply.ranches, reply.op_results);
                const deadline = Math.max(0, ...produced.map((animal: any) => Number(animal.delivering_until_ms)));
                if (deadline > 0) {
                    // TriggerProduce 只确认生产开始，产物上架要晚一点；原地等到交付截止再读格子。
                    await wait(Math.min(2500, Math.max(0, deadline - getServerTimeSec() * 1000)));
                    receiptCells = undefined;
                }
            }
            try {
                // 好友赠送回包只含牧草机状态，读取当前账号背包确认实际扣量。
                after = before.recipient ? { ...before, bag: await loadBag() } : await loadRaw(receiptCells);
            } catch { /* Confirmed receipts remain useful if the view refresh fails. */ }
            if (plan.autoPlaceAnimalId) {
                if (!after) unknown(action, '自动放养后的栏位状态未能读取');
                const previous = new Set(before.cells.facilities.flatMap((f: any) => (f.ranch?.animals || []).map((animal: any) => `${quantity(f.instance_id)}:${animal.animal_inst_id}`)));
                const placed = after.cells.facilities.flatMap((f: any) => (f.ranch?.animals || []).filter((animal: any) => !previous.has(`${quantity(f.instance_id)}:${animal.animal_inst_id}`)));
                if (placed.length !== plan.payload.num || placed.some((animal: any) => Number(animal.animal_id) !== plan.autoPlaceAnimalId)) unknown(action, '自动放养的动物或数量不匹配');
            }
            // 沙漏加速扣的是沙漏库存，独立核对，和其它动作的「费用 → 库存减少」口径不同。
            if (action === 'speedUpUpgrade' && (!after || BigInt(balance(before.bag, 1006).total) - BigInt(balance(after.bag, 1006).total) !== BigInt(actualCosts[0].count))) {
                unknown(action, '沙漏库存扣减未能确认');
            }
            if (action === 'setItemLock') {
                // 上锁状态只认回读结果：回包成功不代表真的写进去了。
                if (!after) unknown(action, '未能读取背包的锁定状态');
                const byUid = new Map<string, any>(after.bag.physical_items.map((item: any) => [quantity(item.uid), item]));
                for (const target of plan.marker.items) {
                    const item = byUid.get(target.uid);
                    if (!item || quantity(item.id) !== target.id || item.is_locked !== plan.marker.locked) {
                        unknown(action, '未能确认所选物品的锁定状态');
                    }
                }
            }
            if (['place', 'addGrass', 'useCan', 'exchange', 'buyCan', 'buyMall'].includes(action)) {
                if (!after) unknown(action, '操作后的库存未能读取');
                for (const cost of plan.costItems) {
                    const actual = BigInt((await resourceBalance(before, cost.id)).total) - BigInt((await resourceBalance(after, cost.id)).total);
                    if (actual !== BigInt(cost.count)) unknown(action, '库存扣减与费用不匹配');
                }
                if (action === 'useCan' && BigInt(balance(after.bag, plan.bucketId).total) - BigInt(balance(before.bag, plan.bucketId).total) !== plan.expectedSeconds) unknown(action, '罐头桶增加时长不匹配');
                if (action === 'buyMall') {
                    // 礼包商城才卖沙漏，买到就核对秒数是否真的加上去了。
                    const hourglass = plan.expectedRewards.find((item: any) => item.id === 1006);
                    if (hourglass && BigInt(balance(after.bag, 1006).total) - BigInt(balance(before.bag, 1006).total) !== BigInt(hourglass.count)) {
                        unknown(action, '沙漏增加时长不匹配');
                    }
                }
            }
            // 解锁棚的校验已在上面 activateShed 分支做过，这里不再重复。
            // 回包没带 op_results 时（例如任务、图鉴这类接口）沿用计划里的份数。
            completed = reply.op_results?.length ?? completed;
            // direct 模式下 op_results 可能为空但动作确已生效（例如没有可操作目标），
            // 这类情况按 skipped 回报，避免界面提示「完成」而实际什么都没做。
            const skipped = reply.alreadyClaimed || direct && plan.resultKeys && !completed;
            // 牧场侧的收获/生产单独计数，跳过的一律不计，避免统计把空跑也算进去。
            if (!skipped && completed > 0 && (action === 'harvest' || action === 'produce')) {
                recordOperation(action, completed, 'ranch');
            }
            // 单批出售与放养一样给出具体收益，一键出售数量太多时仍沿用汇总提示。
            const notice = before.recipient ? `已向${before.recipient.name}赠送 ${completed} 份牧草`
                : action === 'release' || action === 'sell' && input.all !== true ? `${plan.label}完成${rewards.length ? `，获得 ${sumItems(rewards).map((item: any) => `${item.name} ×${item.count}`).join('、')}` : ''}`
                : plan.resultKeys && completed < plan.count ? `已完成 ${completed} / ${plan.count} 项，其余状态已变化，请刷新核对` : undefined;
            return { status: skipped ? 'skipped' : 'confirmed', snapshot: after && !before.recipient ? snapshot(after) : null,
                refreshRequired: !after || !!before.recipient, costs: actualCosts, notice,
                rewards: sumItems(rewards), completed,
                // 喂养直接执行时，界面要显示罐头桶剩余时长，否则用户不知道还能喂多久。
                bucketRemainingSeconds: action === 'feed' ? quantity(reply.bucket_remain_secs) : undefined,
                // 收获里 kind=1 是成熟动物：腾栏后可能达成新的图鉴奖励，交给自动化补领。
                harvestedAnimals: action === 'harvest' ? (reply.op_results ?? []).filter((entry: any) => entry.kind === 1).length : 0,
                // 本次收获里若含巨大动物，说明巨大图鉴可能新增条目，直接触发补领巡查。
                harvestedGiant: action === 'harvest' && animalsInResults(before.cells.facilities.flatMap((f: any) => f.ranch ? [f.ranch] : []), reply.op_results ?? [])
                    .some((animal: any) => animal.mutation?.mutation_type > 0) };
        });

        if (result.harvestedGiant) require('../../utils/network').networkEvents.emit('ranchBookReward', 'giant', true);
        // 只有界面明确要求「喂养并生产」时才顺手催产，普通的喂养不会额外改动动物状态。
        if (!direct || action !== 'feed' || input.produceAfterFeed !== true || result.status !== 'confirmed') return result;
        if (!after) throw error('RANCH_STATE_CHANGED', '喂养已完成，未能读取栏舍状态，未发起生产');
        const fedTargets = new Set(plan.payload.targets.map((target: any) => `${target.ranch_inst_id}:${target.animal_inst_id}`));
        const ready = animalsInResults(after.cells.facilities.flatMap((facility: any) => facility.ranch ? [facility.ranch] : []), fedResults)
            .filter((animal: any) => animal.can_deliver && fedTargets.has(`${quantity(animal.ranch_inst_id)}:${animal.animal_inst_id}`));
        if (!ready.length) return result;

        // 喂养已独立确认。沿用当前场景，只为本次喂养后进入可生产状态的动物发起生产。
        try {
            const production = await run('produce', { direct: true }, after, ready);
            return { ...result, snapshot: production.snapshot || result.snapshot, refreshRequired: production.refreshRequired,
                autoProduced: production.completed, autoProductionNotice: production.notice };
        } catch (cause: any) {
            // 喂养本身已经扣了罐头，这里必须明确告知「不要再喂」，避免重复消耗。
            const status = cause.outcomeUnknown || cause.code === 'RANCH_RESULT_UNKNOWN' ? '生产结果未知' : '生产未完成';
            const reason = cause.name === 'GatewayError' ? cause.errorMessage || '游戏服务拒绝生产' : cause.message;
            const message = `喂养已完成，${status}：${reason}。请刷新核对，勿重复喂养`;
            throw Object.assign(error(cause.code || 'RANCH_PRODUCTION_FAILED', message), { errorMessage: message, cause });
        }
    }

    return inActionScene(action, input, (cells, recipient) =>
        reservations.forCurrentAccount().withLock(async () => run(action, input, { ...await loadRaw(cells), recipient })));
}

module.exports = { prepareAction, operate, ACTIONS, planAction };
