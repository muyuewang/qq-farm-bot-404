export {};
/**
 * 月卡礼包
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum, getSystemDateKey } = require('../utils/utils');

const DAILY_KEY: string = 'month_card_gift';
const CHECK_COOLDOWN_MS: number = 10 * 60 * 1000;

let doneDateKey: string = '';
let lastCheckAt: number = 0;
let lastClaimAt: number = 0;
let lastResult: string = '';
let lastHasCard: boolean | null = null;
let lastHasClaimable: boolean | null = null;

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

async function getMonthCardInfos(): Promise<any> {
    const body: Uint8Array = types.GetMonthCardInfosRequest.encode(types.GetMonthCardInfosRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMonthCardInfos', body);
    return types.GetMonthCardInfosReply.decode(replyBody);
}

async function claimMonthCardReward(goodsId: number): Promise<any> {
    const body: Uint8Array = types.ClaimMonthCardRewardRequest.encode(types.ClaimMonthCardRewardRequest.create({
        goods_id: Number(goodsId) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'ClaimMonthCardReward', body);
    return types.ClaimMonthCardRewardReply.decode(replyBody);
}

async function performDailyMonthCardGift(force: boolean = false): Promise<boolean> {
    const now: number = Date.now();
    if (!force && isDoneToday()) return false;
    if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS) return false;
    lastCheckAt = now;

    try {
        const rep: any = await getMonthCardInfos();
        const infos: any[] = Array.isArray(rep && rep.infos) ? rep.infos : [];
        lastHasCard = infos.length > 0;
        const claimable: any[] = infos.filter((x: any) => x && x.can_claim && Number(x.goods_id || 0) > 0);
        lastHasClaimable = claimable.length > 0;
        if (!infos.length) {
            markDoneToday();
            lastResult = 'none';
            log('月卡', '当前没有月卡或已过期', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        if (!claimable.length) {
            markDoneToday();
            lastResult = 'none';
            log('月卡', '今日暂无可领取月卡礼包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        let claimed: number = 0;
        for (const info of claimable) {
            try {
                const ret: any = await claimMonthCardReward(Number(info.goods_id || 0));
                const items: any[] = Array.isArray(ret && ret.items) ? ret.items : [];
                const reward: string = getRewardSummary(items);
                log('月卡', reward ? `领取成功 → ${reward}` : '领取成功', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                    goodsId: Number(info.goods_id || 0),
                });
                claimed += 1;
            } catch (e: any) {
                log('月卡', `领取失败(gid=${Number(info.goods_id || 0)}): ${e.message}`, {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'error',
                    goodsId: Number(info.goods_id || 0),
                });
            }
        }
        if (claimed > 0) {
            lastClaimAt = Date.now();
            markDoneToday();
            lastResult = 'ok';
            return true;
        }
        log('月卡', '本次未成功领取月卡礼包', {
            module: 'task',
            event: DAILY_KEY,
            result: 'none',
        });
        lastResult = 'none';
        return false;
    } catch (e: any) {
        lastResult = 'error';
        log('月卡', `查询月卡礼包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyMonthCardGift,
    getMonthCardDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        lastCheckAt,
        lastClaimAt,
        result: lastResult,
        hasCard: lastHasCard,
        hasClaimable: lastHasClaimable,
    }),
};
