import type { RanchAutomationConfig, RanchFeedStage } from '../../config/ranch-automation';
import type { RanchFriend } from './friend-roster';
import type { FriendPatrolProgress } from './friends';
import { getRanchFriendList, refreshRanchFriendStatus } from './friend-roster';
import { postToMaster } from '../friend/gid-manager';
export {};

const { RANCH_SWITCH_KEYS, RANCH_MARKET_SWITCH_KEYS, RANCH_MARKET_SWITCH_BY_CURRENCY, RANCH_NEAR_HARVEST_MS, isRanchMarketEnabled } = require('../../config/ranch-automation');
// 牧场黑名单的落盘改由主进程负责（子进程通过 postToMaster 请求），这里不再直接写库。
const { getAutomation, getRanchFriendBlacklist } = require('../../models/store');
const { inScene, isUnlocked } = require('./transport');
const { loadRaw, isPendingShed, shedAwaitingActivation, snapshot, inventory, catalog, market, readMarketRotation, balance } = require('./state');
const { cubMap, quantity } = require('./model');
const { prepareAction, operate } = require('./actions');
const { getServerTimeSec, log, randomDelay } = require('../../utils/utils');
const { getShopGoodsById } = require('../../config/gameConfig');
const reservations = require('./operation-state');
const { getAmbientSendContext, runWithSendContext } = require('./context');
const daily = require('./daily');
const interactions = require('./friends');

let nextCheckAt = 0;
// 上一轮巡查结束时间，用于 SCENE_REENTRY_MS 之外再给图鉴/一级棚留出快速复查窗口。
let lastCycleEndAt = 0;
// 失败后到 retryAt 之前不再被通知唤醒，避免服务端报错时被反复拉起。
let retryAt = 0;
let nextFriendIndex = 0;
let friendVisits = 0;
let pendingFriend: { gid: string; progress: FriendPatrolProgress } | null = null;
// 本次巡查用的牧场场景名单。首次同步可能跨多批，让路后复用它继续巡查。
let patrolFriends: RanchFriend[] | null = null;
// 好友状态批量刷新：attempted 记录本轮已核对的 GID，rejected 表示服务端拒绝后本轮不再尝试。
let patrolStatusRefresh = { attempted: new Set<number>(), lastAt: 0, rejected: false };
// 进不去的好友按下一次可重试时间退避，避免每轮都为同一个 GID 白跑一次进场景。
const friendRetryAt = new Map<number, number>();
let cycleStartedAt = 0;
let cycleChanged = false;
// 本轮是否已经为「收获/产出」重新打开过一次阶段标记，避免无限复查。
let ownRecheckUsed = false;
const completedPhases = new Set<string>();
const completedSteps = new Set<string>();
// 本轮收获过成熟动物后待补领的图鉴种类；让路时保留，下个切片继续。
const pendingBookKinds = new Set<'normal' | 'giant'>();
// 一级棚待激活标记：服务端下发 state=3 后置真，激活成功才清掉。
let shedCheckPending = true;
// 设施通知版本号：用来区分「本轮收到了新通知」和「过期标记」。
let shedNotifyRevision = 0;
const PATROL_SLICE_MS = 5000;
const SCENE_REENTRY_MS = 20_000;
// 好友状态数据超过这个时间就认为需要重新核对，避免用陈旧状态决定要不要进门。
const FRIEND_STATUS_FRESH_MS = 10_000;
// 进不去的好友半小时后才重试。
const FRIEND_ENTRY_RETRY_MS = 30 * 60_000;
// 仓鼠集市的两种货币各由独立开关控制：
// - 7002 便便（ranch_market_organic_poop）：兑 4 小时(80012) 优先，其次 1 小时(80011)，余额 3 起；
// - 1008 松果（ranch_market_organic_pinecone）：兑 8 小时(80013) 优先，其次 80012、80011，余额 1 起。
const MARKET_EXCHANGES = [
    { currencyId: 7002, rewardPriority: [80012, 80011], minBalance: 3n },
    { currencyId: 1008, rewardPriority: [80013, 80012, 80011], minBalance: 1n },
].map(exchange => ({ ...exchange, key: RANCH_MARKET_SWITCH_BY_CURRENCY[exchange.currencyId] }));
type MarketRotation = { periodDay: string; roundIndex: number; startsAt: number; endsAt: number; present: boolean };
// 有事可查而非仅定时轮询：到访通知/货币到账都会把它置 true。
let marketCheckPending = true;
let marketRunId = 0;
let lastMarketRotation: MarketRotation | null = null;
const lastMarketBalances = new Map<number, bigint>();

function resetCycle(keepFriendProgress = false): void {
    completedPhases.clear();
    completedSteps.clear();
    // 图鉴待补领状态跨轮次保留：让路时清掉会让已经探到的奖励永远等不到下一次。
    if (!keepFriendProgress) {
        friendVisits = 0;
        pendingFriend = null;
        patrolFriends = null;
        patrolStatusRefresh = { attempted: new Set<number>(), lastAt: 0, rejected: false };
    }
    cycleStartedAt = 0;
    cycleChanged = false;
    ownRecheckUsed = false;
}
const FRIEND_CONTROLS: Record<string, string> = { stroke: 'ranch_stroke', steal: 'ranch_friend_steal', cleanFriend: 'ranch_friend_clean', putMosquito: 'ranch_friend_mosquito' };
const enabled = (key: string) => getAutomation()[key] === true;
/** 罐头相关日志统一带事件名，方便在运行日志里区分普通罐头与有机罐头。 */
function logCanFeed(canLabel: string, message: string, result: 'skipped' | 'ok'): void {
    log('牧场', `${canLabel}：${message}`, {
        module: 'ranch', event: 'ranch_feed', result, accountId: process.env.FARM_ACCOUNT_ID,
    });
}
// 次数已用完的动作当天不再排队，等次日重置时间。
const canInteract = (action: string) => enabled(FRIEND_CONTROLS[action]) && !interactions.getInteractionQuotaResetAt(action);

/** 通知类唤醒：只在对应开关打开、当前没有正在跑的轮次、且不在退避期时才提前排期。 */
function wakeRanchCheck(key: string): void {
    if (enabled(key) && !cycleStartedAt && Date.now() >= retryAt) {
        nextCheckAt = Math.min(nextCheckAt, lastCycleEndAt + SCENE_REENTRY_MS);
    }
}

/** 设施变更通知：只关心「待激活的一级棚」，重复通知不重复排队。 */
function noteRanchFacilities(facilities: any[]): boolean {
    if (!facilities.some(isPendingShed)) return false;
    shedNotifyRevision++;
    if (shedCheckPending) return false;
    shedCheckPending = true;
    wakeRanchCheck('ranch_activate_shed');
    return true;
}

/** 图鉴红点通知：记录待补领种类，返回是否真的改变了状态。 */
function noteBookReward(kind: 'normal' | 'giant', available: boolean): boolean {
    if (pendingBookKinds.has(kind) === available) return false;
    if (available) {
        pendingBookKinds.add(kind);
        wakeRanchCheck('ranch_illustrated');
    } else pendingBookKinds.delete(kind);
    return true;
}

function marketRotation(raw: any): MarketRotation {
    return { periodDay: quantity(raw.period_day), roundIndex: raw.round_index, startsAt: Number(raw.shop_start_time),
        endsAt: Number(raw.shop_end_time), present: raw.present };
}

function sameMarketRound(a: Pick<MarketRotation, 'periodDay' | 'roundIndex'>, b: MarketRotation): boolean {
    return a.periodDay === b.periodDay && a.roundIndex === b.roundIndex;
}

function marketIsOpen(rotation: MarketRotation | null): rotation is MarketRotation {
    const now = getServerTimeSec();
    return !!rotation?.present && rotation.startsAt <= now && now < rotation.endsAt;
}

function requestMarketCheck(): void {
    marketCheckPending = true;
    marketRunId++;
    completedPhases.delete('market-organic');
}

/** 收到集市到访通知：同一轮次重复推送不重复排队，返回是否真正唤醒了例程。 */
function noteMarketVisit(raw: any): boolean {
    const rotation = marketRotation(raw);
    const previous = lastMarketRotation;
    if (previous && sameMarketRound(previous, rotation) && previous.present === rotation.present
        && previous.startsAt === rotation.startsAt && previous.endsAt === rotation.endsAt) return false;
    lastMarketRotation = rotation;
    if (!marketIsOpen(rotation)) {
        marketRunId++;
        return false;
    }
    requestMarketCheck();
    return true;
}
const due = (state: any) => !state.doneToday && Date.now() >= (state.nextCheckAt || 0);

function getRoutineState(): any {
    // 未解锁时不再返回 nextCheckAt=0，避免外层每一轮都尝试切场景。
    if (!isUnlocked()) return { doneToday: true, nextCheckAt: Infinity };
    const auto = getAutomation();
    const strokeReset = auto.ranch_stroke ? interactions.getInteractionQuotaResetAt('stroke') : 0;
    const mosquitoReset = auto.ranch_friend_mosquito ? interactions.getInteractionQuotaResetAt('putMosquito') : 0;
    // 互动次数用完后仍要保留一个未来的唤醒时间（次日重置），否则当天再也不巡查。
    const work = auto.ranch_stroke && !strokeReset || auto.ranch_friend_mosquito && !mosquitoReset
        || RANCH_SWITCH_KEYS.some((key: string) => ![
            'ranch_task', 'ranch_illustrated', 'ranch_share', 'ranch_daily_benefit', 'ranch_activate_shed', 'ranch_grass_buy',
            'ranch_market_organic', ...RANCH_MARKET_SWITCH_KEYS, 'ranch_stroke', 'ranch_friend_mosquito',
        ].includes(key) && auto[key]);
    // 图鉴待补领与一级棚待激活都是「有事要办」的信号，不能因为其余开关都关着就判定无事可做。
    const routineDue = work || auto.ranch_activate_shed && shedCheckPending || auto.ranch_illustrated && pendingBookKinds.size > 0
        || auto.ranch_task && due(daily.getTaskRoutineState()) || auto.ranch_share && due(daily.getShareRoutineState())
        || auto.ranch_daily_benefit && due(daily.getBenefitRoutineState());
    const pending = routineDue || isRanchMarketEnabled(auto) && marketCheckPending;
    return {
        doneToday: !pending,
        nextCheckAt: pending ? nextCheckAt : Math.min(strokeReset || Infinity, mosquitoReset || Infinity),
    };
}

function selectAnimal(goods: any[], settings: RanchAutomationConfig, kind: number): any {
    const strategy = settings.ranch_strategy === 'bag_priority' ? settings.ranch_bag_fallback : settings.ranch_strategy;
    const preferred = kind === 1 ? settings.ranch_coop_animal : settings.ranch_shed_animal;
    const candidates = goods.filter(good => good.available && good.animal?.enable_flag
        && good.animal.husbandry_type === (kind === 1 ? '窝' : '棚') && good.price.id === 1007 && BigInt(good.price.count) > 0n);
    if (strategy === 'preferred') return candidates.find(good => good.animal.id === preferred);
    const level = (good: any) => Number(getShopGoodsById(Number(good.id))?.conds?.match(/:(\d+)$/)?.[1] || good.requiredLevel || 0);
    return candidates.sort((a, b) => level(b) - level(a) || b.animal.id - a.animal.id)[0];
}

async function run(options: { farmDeadline?: () => number; canContinue?: () => boolean } = {}): Promise<void> {
    if (getRoutineState().doneToday) return;
    const auto: RanchAutomationConfig = getAutomation();
    if (!cycleStartedAt) cycleStartedAt = Date.now();
    nextCheckAt = cycleStartedAt + auto.ranch_check_minutes * 60_000;
    // 记下进门时的通知版本，用来区分「本轮中途收到新通知」与「上一轮留下的旧标记」。
    const shedNotifyAtStart = shedNotifyRevision;
    try {
        // 名单改为进牧场场景后按 global_scene_id=2 单独同步：牧场好友资格以牧场回包为准，
        // 农场名单里的好友不一定开了牧场。名单同步在 friends 阶段内做，避免带着农场名单切场景。
        if (options.canContinue?.() === false || Date.now() >= (options.farmDeadline?.() ?? Infinity)) {
            nextCheckAt = Date.now() + SCENE_REENTRY_MS;
            return;
        }
        await inScene(async (cells: any) => {
            const startedAt = Date.now();
            let steps = 0;
            const markStep = (action?: string) => {
                steps++;
                // 收获/产出之外的写操作都可能让自家地块又有新产出，放开复查额度。
                if (action !== 'harvest' && action !== 'produce') ownRecheckUsed = false;
            };
            const shouldYield = (friendActed = false) => options.canContinue?.() === false
                || Date.now() >= (options.farmDeadline?.() ?? Infinity)
                || (steps > 0 || friendActed) && Date.now() >= startedAt + PATROL_SLICE_MS;
            const checkpoint = (checkDeadline = false) => {
                if (shouldYield(checkDeadline)) {
                    throw Object.assign(new Error('牧场巡查让路'), { code: 'RANCH_PATROL_YIELD' });
                }
            };
            async function phase(name: string, work: () => Promise<any>): Promise<void> {
                if (completedPhases.has(name)) return;
                await work();
                completedPhases.add(name);
            }
            checkpoint();
            let raw = await loadRaw(cells);
            let nextActionAt = Infinity;
            const available = (id: number) => {
                const funds = balance(raw.bag, id);
                return BigInt(funds.total) - BigInt(funds.locked) - BigInt(reservations.forCurrentAccount().reserved(`item:${id}`));
            };
            const updateDeadline = (reopenOwn = false) => {
                const state = snapshot(raw);
                // 罐头有量、开关开着、时机不是「随时」，就说明喂养本身需要等到点，要参与唤醒计算。
                const normalStage = auto.ranch_feed_normal && available(7003) > 0n && auto.ranch_feed_normal_stage;
                const organicStage = auto.ranch_feed_organic && available(7004) > 0n && auto.ranch_feed_organic_stage;
                const timedFeed = normalStage && normalStage !== 'any' || organicStage && organicStage !== 'any';
                const upcoming = state.facilities.flatMap((f: any) => [
                    // 收获还要盯产物真正上架的时点：deliveringUntilMs 晚于 nextAtMs。
                    ...(auto.ranch_harvest || auto.ranch_produce || timedFeed ? (f.ranch?.animals || []).flatMap((a: any) =>
                        [a.nextAtMs, auto.ranch_harvest ? a.deliveringUntilMs : 0]) : []),
                    auto.ranch_upgrade && f.upgradeState ? (f.upgradeEndTime < 100_000_000_000 ? f.upgradeEndTime * 1000 : f.upgradeEndTime) : 0,
                ]);
                // 「快收获时再喂」只在收获窗口内才有意义，所以单独把窗口起点排进唤醒时间，
                // 否则巡查会按动物原定收获时间跑，等到点已经来不及喂了。
                if (normalStage === 'near_harvest' || organicStage === 'near_harvest') {
                    for (const facility of raw.cells.facilities) {
                        for (const animal of facility.ranch?.animals || []) {
                            if (animal.stage !== 4 || !animal.can_feed || (organicStage !== 'near_harvest' && animal.limited_can_used)) continue;
                            const harvestAt = Number(animal.mature_ready_at_ms);
                            if (harvestAt > state.serverTime) upcoming.push(Math.max(state.serverTime + 1000, harvestAt - RANCH_NEAR_HARVEST_MS));
                        }
                    }
                }
                const future = upcoming.filter((at: any) => at > state.serverTime);
                nextActionAt = future.length ? Date.now() + Math.min(...future) - state.serverTime : Infinity;
                // 续跑期间出现新成熟动物时，先处理自家产出，再接着原来的进度。
                // reopenOwn 只允许用一次，否则每轮都重开会把长巡查拖住。
                for (const [action, flag] of [['harvest', 'can_harvest'], ['produce', 'can_deliver']]) {
                    const ready = raw.cells.facilities.some((f: any) => f.ranch?.animals.some((a: any) => a[flag])
                        || action === 'harvest' && f.ranch?.shelves.some((s: any) => s.can_collect));
                    if (ready && enabled(action === 'harvest' ? 'ranch_harvest' : 'ranch_produce')) {
                        if (reopenOwn && completedPhases.delete(action)) {
                            completedSteps.delete(`${action}:{"all":true}`);
                            ownRecheckUsed = true;
                        }
                        nextActionAt = Math.min(nextActionAt, Date.now());
                    }
                }
            };
            // 已完成的产出可以提前复查，随后先给本轮其他待办一次执行机会。
            updateDeadline(!ownRecheckUsed);
            const affordable = (good: any, wanted: number) => {
                const money = available(good.price.id);
                const count = money > 0n ? money / BigInt(good.price.count) : 0n;
                return Number(count < BigInt(wanted) ? count : BigInt(wanted));
            };
            async function act(key: string, action: string, input: any = {}, currency?: number, progress?: string, expectedRewardId?: number): Promise<boolean> {
                // 桶类型决定读哪个时机配置：普通罐头与有机罐头各有一套。
                const feedStageKey = action === 'feed'
                    ? input.bucketType === 2 ? 'ranch_feed_normal_stage' : 'ranch_feed_organic_stage'
                    : undefined;
                const feedStage: RanchFeedStage | undefined = feedStageKey ? getAutomation()[feedStageKey] : undefined;
                // 喂养的日志要能看出用的是哪种罐头、按什么时机筛的目标。
                const canLabel = key === 'ranch_feed_organic' ? '有机罐头'
                    : key === 'ranch_feed_normal' ? (feedStage === 'longest' ? '普通罐头（仅最长阶段）' : '普通罐头') : '';
                // 时机配置在请求过程中可能被改掉，那就让本次写入直接放弃，而不是按旧策略落库。
                const isEnabled = () => enabled(key) && (key !== 'ranch_grass_buy' || enabled('ranch_grass'))
                    && (!feedStageKey || getAutomation()[feedStageKey] === feedStage);
                if (!isEnabled()) return false;
                const step = `${action}:${JSON.stringify(input)}${progress === undefined ? '' : `:${progress}`}`;
                if (completedSteps.has(step)) return false;
                checkpoint(action === 'exchange');
                let label = action;
                try {
                    const quote = await prepareAction(action, input, feedStage);
                    label = quote.label;
                    // 兑换要同时校验货币与奖励条目：集市有同名商品但货币不同，只看货币会兑错货。
                    if (quote.skipped || currency && quote.costItems.some((cost: any) => cost.id !== currency)
                        || expectedRewardId !== undefined && (quote.rewards.length !== 1 || Number(quote.rewards[0].id) !== expectedRewardId)) {
                        // 罐头没喂成时把原因写清楚，否则界面上只看到「本轮没喂」不知道为什么。
                        if (canLabel) logCanFeed(canLabel, quote.message || '本轮未找到喂养目标', 'skipped');
                        completedSteps.add(step);
                        markStep(action);
                        return false;
                    }
                    if (!isEnabled()) return false;
                    checkpoint(action === 'exchange');
                    const parent = getAmbientSendContext();
                    const result = await runWithSendContext({
                        check: (service: string, method: string) => parent?.check(service, method) || (isEnabled() ? null
                            : Object.assign(new Error('牧场操作设置已变化'), { code: 'RANCH_AUTOMATION_DISABLED' })),
                        onSent: (service: string, method: string) => parent?.onSent(service, method),
                    }, () => operate(action, { ...input, expected: quote.expected }, feedStage));
                    completedSteps.add(step);
                    markStep(action);
                    if (result.status === 'skipped') {
                        if (canLabel) logCanFeed(canLabel, result.notice || '动物状态已变化，本轮未喂养', 'skipped');
                        return false;
                    }
                    cycleChanged = true;
                    // 喂养成功时给出目标数、消耗时长与桶内余量，方便判断还能喂多久。
                    if (canLabel) {
                        const used = result.costs?.[0]?.count ?? 0;
                        logCanFeed(canLabel, `喂养完成，目标 ${quote.count} 只，消耗 ${used} 秒，桶内剩余 ${result.bucketRemainingSeconds} 秒`, 'ok');
                    } else {
                        log('牧场', `${quote.label}${result.notice ? `：${result.notice}` : '完成'}`, { module: 'ranch', event: `ranch_${action}`, result: 'ok' });
                    }
                    raw = await loadRaw();
                    updateDeadline();
                    return true;
                } catch (error: any) {
                    // 状态或余额变化交给下一次巡查重新报价；已发出但结果未知的写入由持久账本保护。
                    // 罐头容器已满不是失败：只跳过本次，等动物消耗后再来，不必每轮重试。
                    const canBucketFull = action === 'useCan' && error.code === 1003002
                        && /罐头容器已(?:达到上限|满)/.test(error.errorMessage ?? error.message);
                    if (canBucketFull || ['INSUFFICIENT_BALANCE', 'RESERVE_PROTECTED', 'PENDING_CONFIRMATION', 'RANCH_OFFER_CHANGED', 'RANCH_EXCHANGE_UNAVAILABLE', 'GOODS_UNAVAILABLE', 'RANCH_STATE_CHANGED'].includes(error.code)) {
                        // 图鉴报价失效说明确实还有可领奖励，留到下个切片再核对，不要就此丢掉待补领标记。
                        if (action === 'claimIllustrated' && error.code === 'RANCH_OFFER_CHANGED') pendingBookKinds.add(input.kind);
                        completedSteps.add(step);
                        markStep(action);
                        if (canLabel) logCanFeed(canLabel, `暂未执行：${error.message}`, 'skipped');
                        else log('牧场', `${label} 暂未执行：${error.message}`, { module: 'ranch', event: `ranch_${action}`, result: 'skipped' });
                        return false;
                    }
                    throw error;
                }
            }

            // 收获后空位会变多，清掉补栏阶段的完成标记，让本轮的补栏重新按最新空位计算。
            await phase('harvest', async () => {
                if (await act('ranch_harvest', 'harvest', { all: true })) completedPhases.delete('buy');
            });
            await phase('produce', () => act('ranch_produce', 'produce', { all: true }));
            await phase('clean', () => act('ranch_clean', 'clean'));
            await phase('sell', () => act('ranch_sell', 'sell', { all: true }));

            // 集市有到访通知（RotationShopNotify）会把 marketCheckPending 置真；
            // 同时保留「货币到账就唤醒」的兜底，避免通知漏发时错过一轮。
            if (isRanchMarketEnabled(auto) && marketCheckPending) completedPhases.delete('market-organic');
            await phase('market-organic', async () => {
                if (!isRanchMarketEnabled(getAutomation())) return;
                const stockReady = MARKET_EXCHANGES.some(({ key, currencyId, minBalance }) => {
                    const stock = available(currencyId);
                    return enabled(key) && stock >= minBalance && stock > (lastMarketBalances.get(currencyId) ?? 0n);
                });
                if (!marketCheckPending && !stockReady && marketIsOpen(lastMarketRotation)) return;
                // 兑换前重新核对一次截止时间：真正花钱的动作不该在被叫停后还继续发。
                checkpoint(true);
                const runId = marketRunId;
                const rawRotation = await readMarketRotation();
                let rotation = rawRotation ? marketRotation(rawRotation) : null;
                let current = null;
                if (marketIsOpen(rotation)) {
                    checkpoint(true);
                    current = await market(raw);
                }
                // 场次必须与 ShopProfiles 读到的一致，否则报价可能已被换货。
                if (current && marketIsOpen(rotation) && current.opened && current.present && sameMarketRound(current, rotation)) {
                    for (const { key, currencyId, rewardPriority } of MARKET_EXCHANGES) {
                        if (!enabled(key)) continue;
                        const goods = current.goods.filter((entry: any) => entry.available && Number(entry.price.id) === currencyId
                            && BigInt(entry.price.count) > 0n && rewardPriority.includes(Number(entry.reward.id)));
                        goods.sort((a: any, b: any) => rewardPriority.indexOf(Number(a.reward.id)) - rewardPriority.indexOf(Number(b.reward.id)));
                        for (const good of goods) {
                            // 循环里重新判开关：运行中关掉某一项后要立刻停手，不能把剩余额度兑完。
                            while (enabled(key) && good.remaining !== 0 && marketIsOpen(rotation)) {
                                const stock = available(currencyId);
                                const count = affordable(good, Math.min(good.remaining ?? 2147483647, 2147483647));
                                if (count < 1) break;
                                const exchanged = await act(key, 'exchange', { goodsId: good.id, count, marketRotation: rotation },
                                    currencyId, `${runId}:${good.id}:${stock}`, Number(good.reward.id));
                                if (!exchanged) break;
                                if (good.remaining !== null) good.remaining = Math.max(0, good.remaining - count);
                            }
                        }
                    }
                } else if (current) rotation = null;
                for (const { currencyId } of MARKET_EXCHANGES) lastMarketBalances.set(currencyId, available(currencyId));
                // 旧一轮结束时保留执行期间收到的到访或到账待办。
                if (runId === marketRunId) {
                    lastMarketRotation = rotation;
                    marketCheckPending = false;
                }
            });

            // 21 级开放的棚不是「升级」出来的：服务端下发 state=3 的待激活实例，
            // 必须单独发 ActivateFacility 才会变成可用设施，所以放在 upgrade 阶段之前单独处理。
            // 一级棚激活免费但会改动账号状态，因此受独立开关 ranch_activate_shed 控制。
            if (enabled('ranch_activate_shed')) {
                const shed = shedAwaitingActivation(raw);
                if (shed) {
                    shedCheckPending = true;
                    if (await act('ranch_activate_shed', 'activateShed', { facilityId: quantity(shed.instance_id) })) shedCheckPending = false;
                } else if (shedNotifyAtStart === shedNotifyRevision) {
                    // 进门时没有待激活实例，且本轮也没有收到新通知，说明标记已经过期。
                    shedCheckPending = false;
                }
            }

            await phase('upgrade', async () => {
                if (enabled('ranch_upgrade')) {
                    for (const facility of snapshot(raw).facilities) {
                        const end = facility.upgradeEndTime < 100_000_000_000 ? facility.upgradeEndTime * 1000 : facility.upgradeEndTime;
                        if (facility.active && facility.upgradeState && (facility.upgradeState === 2 || end <= getServerTimeSec() * 1000)) {
                            await act('ranch_upgrade', 'completeUpgrade', { facilityId: facility.id });
                        } else if (facility.next?.available) {
                            await act('ranch_upgrade', 'upgrade', { facilityId: facility.id }, 1007);
                        }
                    }
                }
            });

            // 成熟动物腾栏后可能达成新的图鉴等级，在补栏前核对一次；
            // 让路时尚未核对的种类保留在 pendingBookKinds 里，下个切片继续。
            for (const kind of ['normal', 'giant'] as const) {
                if (!enabled('ranch_illustrated') || !pendingBookKinds.delete(kind)) continue;
                completedSteps.delete(`claimIllustrated:${JSON.stringify({ kind })}`);
                try {
                    await act('ranch_illustrated', 'claimIllustrated', { kind });
                } catch (cause: any) {
                    // 结果未知时不再重试，避免重复领取；其余错误保留标记下轮再来。
                    if (cause.outcomeUnknown || cause.code === 'RANCH_RESULT_UNKNOWN') pendingBookKinds.delete(kind);
                    else pendingBookKinds.add(kind);
                    throw cause;
                }
            }

            // 补栏：先把背包里适用本设施的幼崽按优先顺序放养，缺额才在商店购买。
            // 放养不放在 phase 内：收获后空位会变多，即使本轮 buy 已跑过也要能重新补栏。
            if (enabled('ranch_buy')) {
                const bagFirst = auto.ranch_strategy === 'bag_priority';
                const pens: any[] = raw.cells.facilities.filter((f: any) => f.state === 1 && f.ranch?.animal_count < f.ranch?.capacity);
                const vacancies = (id: string) => {
                    const ranch = raw.cells.facilities.find((f: any) => quantity(f.instance_id) === id)?.ranch;
                    return ranch ? Math.max(0, ranch.capacity - ranch.animal_count) : 0;
                };
                async function placeCubs(pen: any, animalId?: number): Promise<boolean> {
                    const ranchId = quantity(pen.instance_id);
                    const isCoop = pen.ranch.husbandry_type === 1;
                    // 旧配置可能没有这两个键，缺省按空顺序处理（退化为等级从高到低）。
                    const ordered: number[] = (isCoop ? auto.ranch_coop_cub_priority : auto.ranch_shed_cub_priority) ?? [];
                    const ranks = new Map(ordered.map((id, index) => [id, index]));
                    const stock = inventory(raw).filter((item: any) => !item.locked && item.animalId && BigInt(item.count) > 0n
                        && cubMap.get(item.id).husbandry_type === (isCoop ? '窝' : '棚') && (bagFirst || item.animalId === animalId));
                    // 背包优先时按配置顺序，未配置的排在后面再按等级从高到低；指定动物时只比等级。
                    stock.sort((a: any, b: any) => (bagFirst ? (ranks.get(a.id) ?? ordered.length) - (ranks.get(b.id) ?? ordered.length) : 0)
                        || b.animalId - a.animalId || a.id - b.id);
                    for (const item of stock) {
                        const room = BigInt(vacancies(ranchId));
                        if (room === 0n) break;
                        const usable = available(item.id);
                        const count = Number(room < usable ? room : usable);
                        // 库存和空位都重新确认后才续放；已有未决操作时不转去购买同一栏位。
                        if (count > 0 && !await act('ranch_buy', 'place', { ranchId, itemId: item.id, count }, undefined, `${usable}:${room}`)) return false;
                    }
                    return true;
                }

                // 续跑也按最新空位放养：先处理窝和棚的背包库存，之后才读取购买备选。
                const purchasePens: any[] = [];
                for (const pen of pens) {
                    if ((!bagFirst || await placeCubs(pen)) && vacancies(quantity(pen.instance_id)) > 0) purchasePens.push(pen);
                }
                if (purchasePens.length) {
                    await phase('buy', async () => {
                        checkpoint();
                        const shop = await catalog(raw, 5);
                        for (const pen of purchasePens) {
                            const selected = selectAnimal(shop.goods, auto, pen.ranch.husbandry_type);
                            if (!selected || !bagFirst && !await placeCubs(pen, selected.animal.id)) continue;
                            const id = quantity(pen.instance_id);
                            const count = affordable(selected, Math.min(vacancies(id), selected.maxCount, selected.remaining ?? Infinity));
                            if (count > 0) await act('ranch_buy', 'buy', { shopId: 5, goodsId: selected.id, count, autoPlace: true }, 1007, `${id}:${available(1007)}`);
                        }
                    });
                }
            }

            await phase('grass', async () => {
                if (enabled('ranch_grass')) {
                    for (const original of raw.cells.facilities.filter((f: any) => f.state === 1 && f.feed_machine)) {
                        const id = quantity(original.instance_id);
                        let room = original.capacity - original.feed_machine.feed_count;
                        if (room <= 0 || original.feed_machine.feed_count * 100 >= original.capacity * auto.ranch_grass_threshold_percent) continue;
                        let stock = Math.max(0, Number(available(7001)));
                        if (stock < room && enabled('ranch_grass_buy')) {
                            const shop = await catalog(raw, 6);
                            const good = shop.goods.find((g: any) => g.available && g.reward.id === 7001 && g.reward.count === '1' && g.price.id === 1007 && BigInt(g.price.count) > 0n);
                            if (good) {
                                while (stock < room) {
                                    const count = affordable(good, Math.min(room - stock, good.maxCount, good.remaining ?? Infinity));
                                    // 按已到账库存区分限购批次，续跑时重新读取缺额，沿用农场到期让路。
                                    if (count <= 0 || !await act('ranch_grass_buy', 'buy', { shopId: 6, goodsId: good.id, count }, 1007, `${id}:${stock}`)) break;
                                    if (good.remaining !== null) good.remaining -= count;
                                    const current = raw.cells.facilities.find((f: any) => quantity(f.instance_id) === id);
                                    room = current.capacity - current.feed_machine.feed_count;
                                    stock = Math.max(0, Number(available(7001)));
                                }
                            }
                        }
                        const count = Math.min(room, Number(available(7001)));
                        if (count > 0) await act('ranch_grass', 'addGrass', { facilityId: id, count });
                    }
                }
            });

            await phase('cans', async () => {
                if (enabled('ranch_fill_cans')) {
                    for (const item of inventory(raw).filter((item: any) => item.can && !item.locked)) {
                        const count = Number(BigInt(item.count) < available(item.id) ? BigInt(item.count) : available(item.id));
                        if (count > 0) await act('ranch_fill_cans', 'useCan', { uid: item.uid, count });
                    }
                }
            });

            await phase('feed-normal', async () => {
                if (!enabled('ranch_feed_normal')) return;
                // 普通罐头的使用时机由设置决定，act() 会按桶类型自己读取对应配置。
                const normalStage = getAutomation().ranch_feed_normal_stage;
                if (available(7003) <= 0n) {
                    logCanFeed(normalStage === 'longest' ? '普通罐头（仅最长阶段）' : '普通罐头', '罐头桶没有可用时长，本轮未喂养', 'skipped');
                    return;
                }
                await act('ranch_feed_normal', 'feed', { all: true, bucketType: 2 });
            });
            await phase('feed-organic', async () => {
                if (!enabled('ranch_feed_organic')) return;
                if (available(7004) <= 0n) {
                    logCanFeed('有机罐头', '罐头桶没有可用时长，本轮未喂养', 'skipped');
                    return;
                }
                await act('ranch_feed_organic', 'feed', { all: true, bucketType: 1 });
            });

            async function claimDailyRewards(): Promise<void> {
                if (cycleChanged && !completedPhases.has('tasks')) daily.markTasksChanged();
                await phase('tasks', async () => { if (enabled('ranch_task') && due(daily.getTaskRoutineState())) { checkpoint(); await daily.claimTasks(); markStep(); } });
                await phase('share', async () => { if (enabled('ranch_share') && due(daily.getShareRoutineState())) { checkpoint(); await daily.claimShare(); markStep(); } });
                await phase('benefit', async () => { if (enabled('ranch_daily_benefit') && due(daily.getBenefitRoutineState())) { checkpoint(); await daily.claimBenefit(); markStep(); } });
            }
            // 大名单会跨多个切片，到期的每日奖励在继续巡查前先执行，避免拖到最后被让路截断。
            if (pendingFriend || friendVisits > 0) await claimDailyRewards();
            await phase('friends', async () => {
                if (Object.keys(FRIEND_CONTROLS).some(canInteract)) {
                    checkpoint();
                    // 牧场名单按 global_scene_id=2 单独同步：回包带 big_farm_status 的才算牧场好友。
                    // 首次同步可能跨多批，每完成一批都记一步并让路一次。
                    patrolFriends ??= await getRanchFriendList((completedBatch: boolean) => {
                        if (completedBatch) markStep();
                        checkpoint();
                    });
                    // 牧场黑名单与农场好友黑名单分开：牧场好友名单本身是单独同步的。
                    const blacklist = new Set(getRanchFriendBlacklist(process.env.FARM_ACCOUNT_ID));
                    const friends = patrolFriends.filter(friend => !blacklist.has(friend.gid));
                    if (!friends.length) return;
                    // 偷取/清理不消耗次数，不必先查次数；只有摸头/放蚊才需要。
                    const hasBulkWork = enabled('ranch_friend_steal') || enabled('ranch_friend_clean');
                    const times = hasBulkWork ? {} : await interactions.getInteractionTimes();
                    const wanted = (action: string) => canInteract(action) && times[action] !== 0;
                    // 摸头和放蚊都用完次数时，只能靠好友状态名单决定还要不要进门。
                    const statusDecides = () => !wanted('stroke') && !wanted('putMosquito');
                    if (Object.keys(FRIEND_CONTROLS).some(wanted)) {
                        // 沿用本轮巡查，每轮最多拜访三位，避免长期占用农牧场共用连接。
                        // scanned 与 friendVisits 分开：跳过的好友不计入拜访名额。
                        for (let scanned = 0; scanned < friends.length && friendVisits < Math.min(3, friends.length)
                            && Object.keys(FRIEND_CONTROLS).some(wanted); scanned++, nextFriendIndex++) {
                            checkpoint();
                            const friend = (pendingFriend && friends.find(row => String(row.gid) === pendingFriend?.gid))
                                || friends[nextFriendIndex % friends.length];
                            const gid = String(friend.gid);
                            // 黑名单可能在巡查过程中被主进程更新，每次进门前重新读一次。
                            const canVisit = () => !getRanchFriendBlacklist(process.env.FARM_ACCOUNT_ID).includes(friend.gid);
                            if (!canVisit() || (friendRetryAt.get(friend.gid) ?? 0) > Date.now()) {
                                pendingFriend = null;
                                continue;
                            }
                            if (pendingFriend?.gid !== gid && statusDecides() && !patrolStatusRefresh.rejected
                                && !patrolStatusRefresh.attempted.has(friend.gid) && Date.now() - friend.statusAtMs > FRIEND_STATUS_FRESH_MS) {
                                // 批量刷新状态有频率限制，两次之间至少隔一秒。
                                if (Date.now() - patrolStatusRefresh.lastAt < 1000) await randomDelay(500, 1000);
                                checkpoint(true);
                                try {
                                    const queried = await refreshRanchFriendStatus(friends, nextFriendIndex % friends.length);
                                    for (const id of queried) patrolStatusRefresh.attempted.add(id);
                                } catch (error: any) {
                                    // 服务端不支持该接口时本轮改为直接进门核对，不当作失败。
                                    if (error.name !== 'GatewayError') throw error;
                                    patrolStatusRefresh.rejected = true;
                                    log('牧场', `好友状态刷新失败，本轮进门核对：${error.message}`, { module: 'ranch', event: 'ranch_friend', result: 'skipped' });
                                }
                                patrolStatusRefresh.lastAt = Date.now();
                                markStep();
                                checkpoint();
                            }
                            // 状态足够新时直接用状态判断：没得偷也没得帮就不进门。
                            if (!canVisit() || (pendingFriend?.gid !== gid && statusDecides() && Date.now() - friend.statusAtMs <= FRIEND_STATUS_FRESH_MS
                                && !(wanted('steal') && friend.canSteal) && !(wanted('cleanFriend') && friend.canHelp))) {
                                pendingFriend = null;
                                continue;
                            }
                            if (pendingFriend?.gid !== gid) pendingFriend = { gid, progress: {} };
                            try {
                                // 昵称以牧场回包为准，回包里没有时才退回名单上的名字。
                                // 动作开关与黑名单在每次小动作前都重新判断，运行中被关掉就停手。
                                const result = await interactions.automateFriend(friend.gid, (action: string) => wanted(action) && canVisit(), shouldYield, (outcome: any, nickname: string) => {
                                    const confirmed = outcome.status === 'confirmed';
                                    if (confirmed) daily.markTasksChanged();
                                    ownRecheckUsed = false;
                                    log('牧场', `${nickname || friend.name}：${outcome.notice}`, {
                                        module: 'ranch', event: `ranch_${outcome.action}`, result: confirmed ? 'ok' : 'skipped',
                                    });
                                }, pendingFriend.progress);
                                Object.assign(times, result.times);
                                if (result.yielded) {
                                    // 保留 pendingFriend，下次进牧场从这位好友的断点续跑。
                                    throw Object.assign(new Error('牧场好友巡查让路'), { code: 'RANCH_PATROL_YIELD' });
                                }
                                friendRetryAt.delete(friend.gid);
                                markStep();
                            } catch (error: any) {
                                if (error.name !== 'GatewayError' || error.serviceName !== 'gamepb.visitpb.VisitService'
                                    || error.methodName !== 'EnterHomestead') throw error;
                                markStep();
                                // 进不去的好友先退避半小时，避免每轮都为同一个 GID 白跑一次进场景请求。
                                friendRetryAt.set(friend.gid, Date.now() + FRIEND_ENTRY_RETRY_MS);
                                // 只有服务端明确说是「非好友」时才请求主进程写黑名单，其他失败只跳过。
                                const nonFriend = error.code === 1002002
                                    && /不是(?:你的)?好友|非好友|(?:没有|不存在)好友关系|\bnot (?:a |your )?friend\b/i.test(error.errorMessage);
                                if (!nonFriend || !postToMaster({ type: 'ranch_friend_blacklist_add', gid: friend.gid, friendName: friend.name })) {
                                    log('牧场', `暂不能拜访 ${friend.name}：${error.message}`, { module: 'ranch', event: 'ranch_friend', result: 'skipped' });
                                }
                            }
                            pendingFriend = null;
                            friendVisits++;
                        }
                    }
                }
            });

            await claimDailyRewards();
            lastCycleEndAt = Date.now();
            // 图鉴待补领与一级棚待激活不等到下个常规间隔，本轮结束就立刻再排一次。
            const bookDue = enabled('ranch_illustrated') && pendingBookKinds.size > 0;
            const shedDue = enabled('ranch_activate_shed') && shedCheckPending && shedNotifyAtStart !== shedNotifyRevision;
            const nextRoutine = Math.min(nextCheckAt, nextActionAt, cycleChanged ? lastCycleEndAt + 30_000 : Infinity);
            nextCheckAt = Math.max(lastCycleEndAt + SCENE_REENTRY_MS, bookDue || shedDue ? lastCycleEndAt : nextRoutine);
            retryAt = 0;
            resetCycle();
        });
    } catch (error: any) {
        if (error.code === 'RANCH_PATROL_YIELD') {
            nextCheckAt = Date.now() + SCENE_REENTRY_MS;
            return;
        }
        // 好友巡查没跑完时保留进度，切场景异常不再让整轮从头开始。
        resetCycle(pendingFriend !== null);
        if (error.code === 'RANCH_AUTOMATION_DISABLED') return;
        nextCheckAt = Date.now() + Math.max(auto.ranch_check_minutes, 10) * 60_000;
        // 失败后进入退避，通知类唤醒在此期间不再提前排期。
        retryAt = nextCheckAt;
        log('牧场', `日常牧场巡查失败：${error.message}`, { module: 'ranch', event: 'ranch_automation', result: 'error' });
    }
}

module.exports = {
    run, getRoutineState, selectAnimal, requestMarketCheck, noteMarketVisit, noteBookReward, noteRanchFacilities,
    resetSchedule: () => {
        requestMarketCheck();
        nextCheckAt = 0;
        lastMarketRotation = null;
        lastMarketBalances.clear();
        friendRetryAt.clear();
        shedCheckPending = true;
        shedNotifyRevision++;
        retryAt = 0;
        resetCycle();
    },
};
