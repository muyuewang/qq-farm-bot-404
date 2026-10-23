export {};
/**
 * QQ 会员每日礼包
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum, getSystemDateKey } = require('../utils/utils');

const DAILY_KEY: string = 'vip_daily_gift';
const CHECK_COOLDOWN_MS: number = 10 * 60 * 1000;
const NOT_QQ_VIP_ERROR_CODE: number = 1021001;
const ALREADY_CLAIMED_ERROR_CODE: number = 1021002;

let doneDateKey: string = '';
let lastCheckAt: number = 0;
let lastClaimAt: number = 0;
let lastResult: string = '';
let lastError: string = '';
let lastIsVip: boolean | null = null;
let lastHasGift: boolean | null = null;
let lastCanClaim: boolean | null = null;

function markDoneToday(): void {
    doneDateKey = getSystemDateKey();
}

function isDoneToday(): boolean {
    return doneDateKey === getSystemDateKey();
}

function getRewardSummary(items: any[]): string {
    const list: any[] = Array.isArray(items) ? items : [];
    const summary: string[] = [];
    for (const it of list) {
        const id: number = toNum(it.id);
        const count: number = toNum(it.count);
        if (count <= 0) continue;
        if (id === 1 || id === 1001) summary.push(`金币${count}`);
        else if (id === 2 || id === 1101) summary.push(`经验${count}`);
        else if (id === 1002) summary.push(`点券${count}`);
        else summary.push(`物品#${id}x${count}`);
    }
    return summary.join('/');
}

function hasErrorCode(err: any, code: number): boolean {
    if (Number(err && err.code) === code) return true;
    return new RegExp(`\\bcode=${code}\\b`).test(String((err && err.message) || err || ''));
}

function isNotQQVipError(err: any): boolean {
    return hasErrorCode(err, NOT_QQ_VIP_ERROR_CODE);
}

function isAlreadyClaimedError(err: any): boolean {
    const msg: string = String((err && err.message) || '');
    return hasErrorCode(err, ALREADY_CLAIMED_ERROR_CODE) || msg.includes('今日已领取');
}

function recordFailure(stage: string, error: any): string {
    const message = `${stage}失败: ${String(error?.message || error).slice(0, 500)}`;
    log('会员', message, {
        module: 'task', event: DAILY_KEY, result: 'error', stage, code: error?.code,
    });
    return message;
}

function markNonMember(): void {
    markDoneToday();
    lastResult = 'none';
    lastError = '';
    lastIsVip = false;
    lastHasGift = false;
    lastCanClaim = false;
    log('会员', '非QQ会员，跳过会员礼包', {
        module: 'task', event: DAILY_KEY, result: 'none', reason: 'not_qq_vip',
    });
}

async function getQQVipRewardsStatus(): Promise<any> {
    const body: Uint8Array = types.GetQQVipRewardsStatusRequest.encode(types.GetQQVipRewardsStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'GetQQVipRewardsStatus', body);
    return types.GetQQVipRewardsStatusReply.decode(replyBody);
}

async function refreshVipInfo(): Promise<void> {
    const body: Uint8Array = types.RefreshVipInfoRequest.encode(types.RefreshVipInfoRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'RefreshVipInfo', body);
    types.RefreshVipInfoReply.decode(replyBody);
}

async function claimQQVipRewards(rewardTypes: number[]): Promise<any> {
    const body: Uint8Array = types.ClaimQQVipRewardsRequest.encode(types.ClaimQQVipRewardsRequest.create({
        reward_types: rewardTypes,
    })).finish();
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.qqvippb.QQVipService',
        'ClaimQQVipRewards',
        body,
        { expectedErrorCodes: [NOT_QQ_VIP_ERROR_CODE, ALREADY_CLAIMED_ERROR_CODE] },
    );
    return types.ClaimQQVipRewardsReply.decode(replyBody);
}

async function performDailyVipGift(force: boolean = false): Promise<boolean> {
    const now: number = Date.now();
    if (!force && isDoneToday()) return false;
    if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS) return false;
    lastCheckAt = now;
    // A forced recheck must not leave an earlier "done" flag hiding a failure.
    doneDateKey = '';
    lastError = '';
    lastIsVip = null;
    lastHasGift = null;
    lastCanClaim = null;

    let status: any;
    try {
        // Normal daily checks query entitlement directly, like the game client.
        // RefreshVipInfo syncs a subscription change and may fail independently.
        status = await getQQVipRewardsStatus();
    } catch (e: any) {
        if (isNotQQVipError(e)) {
            markNonMember();
        } else {
            lastResult = 'error';
            lastError = recordFailure('查询会员资格', e);
        }
        return false;
    }

    lastIsVip = status.is_qq_vip === true;
    if (!lastIsVip) {
        markNonMember();
        return false;
    }
    const rewardStatuses: any[] = Array.isArray(status.reward_statuses) ? status.reward_statuses : [];
    const rewardTypes: number[] = [...new Set<number>(rewardStatuses
        .filter((item: any) => item?.is_enable === true
            && (toNum(item.type) === 1 ? status.can_claim === true : status.rewards_can_claim === true))
        .map((item: any) => toNum(item.reward_type))
        .filter((rewardType: number) => Number.isSafeInteger(rewardType) && rewardType > 0))];
    const mallCanClaim = status.mall_free_can_claim === true;
    lastHasGift = rewardStatuses.some((item: any) => item?.is_enable === true) || mallCanClaim;
    lastCanClaim = rewardTypes.length > 0 || mallCanClaim;
    const errors: string[] = [];
    let claimed = false;
    let alreadyClaimed = status.claimed_today === true;

    // The two reward sources are independent. A mall failure must not prevent
    // ClaimQQVipRewards, and a daily reward failure must not hide the mall result.
    if (rewardTypes.length > 0) {
        try {
            const rep: any = await claimQQVipRewards(rewardTypes);
            const items: any[] = Array.isArray(rep?.items) ? rep.items : [];
            const reward = getRewardSummary(items);
            claimed = true;
            lastClaimAt = Date.now();
            log('会员', reward ? `会员礼包领取成功 → ${reward}` : '会员礼包领取成功', {
                module: 'task', event: DAILY_KEY, result: 'ok', count: items.length, rewardTypes,
            });
        } catch (e: any) {
            if (isNotQQVipError(e)) {
                markNonMember();
                return false;
            }
            if (isAlreadyClaimedError(e)) {
                alreadyClaimed = true;
                log('会员', '今日会员礼包已领取', { module: 'task', event: DAILY_KEY, result: 'ok' });
            } else {
                errors.push(recordFailure('领取会员礼包', e));
            }
        }
    }

    if (mallCanClaim) {
        try {
            if (await claimSvipMallFreeGift(status)) {
                claimed = true;
                lastClaimAt = Date.now();
                log('会员', 'SVIP 商城免费礼包领取成功', { module: 'task', event: DAILY_KEY, result: 'ok' });
            }
        } catch (e: any) {
            errors.push(recordFailure('领取 SVIP 商城免费礼包', e));
        }
    }

    if (errors.length) {
        lastResult = claimed || alreadyClaimed ? 'partial' : 'error';
        lastError = errors.join('；');
    } else {
        markDoneToday();
        lastCanClaim = false;
        lastResult = claimed || alreadyClaimed ? 'ok' : 'none';
        if (!claimed && !alreadyClaimed) {
            log('会员', '今日暂无可领取会员礼包', { module: 'task', event: DAILY_KEY, result: 'none' });
        }
    }
    return claimed;
}

async function claimSvipMallFreeGift(status: any): Promise<boolean> {
    if (status.is_qq_vip !== true || status.mall_free_can_claim !== true) return false;
    const mall = require('./mall');
    const reply = await mall.getMallListBySlotType(4);
    const goods = (reply.goods_list || []).filter((v: any) => v.is_free === true && v.is_available === true
        && toNum(v.price?.count) === 0 && !v.ad_only && !v.share?.share_only
        && !v.is_owned && (!v.purchase_limit || toNum(v.purchase_limit.limit_count) <= 0 || toNum(v.purchase_limit.bought_count) < toNum(v.purchase_limit.limit_count)));
    for (const product of goods) await mall.purchaseMallGoods(toNum(product.goods_id), 1, 4, { id: toNum(product.price?.id), count: 0 });
    return goods.length > 0;
}

module.exports = {
    getQQVipRewardsStatus,
    refreshVipInfo,
    claimSvipMallFreeGift,
    performDailyVipGift,
    getVipDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        lastCheckAt,
        lastClaimAt,
        result: lastResult,
        lastError,
        isVip: lastIsVip,
        hasGift: lastHasGift,
        canClaim: lastCanClaim,
    }),
};
