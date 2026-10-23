export {};

const { getItemById } = require('../config/gameConfig');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, logWarn, toNum } = require('../utils/utils');

const DOG_SKILL_GIFT_ITEM_ID: number = 101351;
let pendingClaim: Promise<any> | null = null;

async function getDogInfo(): Promise<any> {
    const body: Uint8Array = types.GetDogInfoRequest.encode(
        types.GetDogInfoRequest.create({}),
    ).finish();
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.dogpb.DogService',
        'GetDogInfo',
        body,
    );
    return types.GetDogInfoReply.decode(replyBody);
}

async function claimSkillGifts(): Promise<any> {
    const body: Uint8Array = types.ClaimSkillGiftsRequest.encode(
        types.ClaimSkillGiftsRequest.create({}),
    ).finish();
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.dogpb.DogService',
        'ClaimSkillGifts',
        body,
    );
    return types.ClaimSkillGiftsReply.decode(replyBody);
}

function getPendingGiftCount(reply: any): number {
    return Math.max(0, toNum(reply?.pending_gift_count ?? reply?.pendingGiftCount));
}

function getFarmingSkillGiftCount(reply: any): number {
    const results: any[] = Array.isArray(reply?.results) ? reply.results : [];
    return results.reduce((total: number, result: any) => {
        const reward: any = result?.reward;
        return toNum(reward?.id) === DOG_SKILL_GIFT_ITEM_ID
            ? total + Math.max(0, toNum(reward?.count))
            : total;
    }, 0);
}

async function checkAndClaimDogSkillGifts(pendingCountHint?: any, propagateErrors: boolean = false): Promise<any> {
    if (pendingClaim) return pendingClaim;

    const request: Promise<any> = (async () => {
        try {
            const hintedCount: number = toNum(pendingCountHint);
            const pendingCount: number = hintedCount > 0
                ? hintedCount
                : getPendingGiftCount(await getDogInfo());
            if (pendingCount <= 0) {
                return { claimed: 0, pending: 0, item: null };
            }

            const reply: any = await claimSkillGifts();
            const item: any = reply?.item || null;
            const itemId: number = toNum(item?.id);
            const itemCount: number = Math.max(0, toNum(item?.count));
            const claimedCount: number = Math.max(0, toNum(reply?.claimed_count ?? reply?.claimedCount)) || itemCount;
            const itemInfo: any = itemId > 0 ? getItemById(itemId) : null;
            const itemName: string = String(itemInfo?.name || (itemId > 0 ? `物品#${itemId}` : '宠物礼包'));

            if (claimedCount > 0) {
                log('宠物', `拾取${itemName} x${claimedCount}`, {
                    module: 'dog',
                    event: '领取同气连枝礼包',
                    result: 'ok',
                    itemId,
                    count: claimedCount,
                });
            }
            return { claimed: claimedCount, pending: Math.max(0, pendingCount - claimedCount), item };
        } catch (error: any) {
            logWarn('宠物', `拾取同气连枝礼包失败: ${error?.message || error}`, {
                module: 'dog',
                event: '领取同气连枝礼包',
                result: 'error',
            });
            if (propagateErrors) throw error;
            return {
                claimed: 0,
                pending: Math.max(0, toNum(pendingCountHint)),
                item: null,
                error: String(error?.message || error),
            };
        }
    })();

    pendingClaim = request;
    try {
        return await request;
    } finally {
        if (pendingClaim === request) pendingClaim = null;
    }
}

module.exports = {
    DOG_SKILL_GIFT_ITEM_ID,
    getDogInfo,
    claimSkillGifts,
    getPendingGiftCount,
    getFarmingSkillGiftCount,
    checkAndClaimDogSkillGifts,
};
