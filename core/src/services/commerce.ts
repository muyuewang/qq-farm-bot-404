export {};

const { getItemById, getItemImageById } = require('../config/gameConfig');
const { getServerTimeSec, toNum } = require('../utils/utils');
const mallService = require('./mall');
const mysteryShopService = require('./mystery-shop');

let purchaseTail: Promise<void> = Promise.resolve();

function businessError(code: string, message: string): Error {
    const error: any = new Error(message);
    error.code = code;
    return error;
}

function positiveInteger(value: unknown, code: string, label: string): number {
    const text = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(text)) throw businessError(code, `${label} must be a positive integer`);
    const result = Number(text);
    if (!Number.isSafeInteger(result)) throw businessError(code, `${label} is too large`);
    return result;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    const result = Number(value);
    return Number.isInteger(result) && result >= min && result <= max ? result : fallback;
}

function itemDto(item: any, fallbackName = ''): any {
    const id = Math.max(0, toNum(item?.id));
    const metadata = id > 0 ? getItemById(id) : null;
    return {
        id,
        count: Math.max(0, toNum(item?.count)),
        name: String(metadata?.name || fallbackName || (id > 0 ? `物品 #${id}` : '未知物品')),
        image: id > 0 ? getItemImageById(id) : '',
        rarity: Math.max(0, Number(metadata?.rarity) || 0),
    };
}

async function currencyBalances(ids: number[]): Promise<Record<string, number>> {
    const wanted = new Set(ids.filter(id => id > 0));
    const balances: Record<string, number> = {};
    if (!wanted.size) return balances;
    try {
        const warehouse = require('./warehouse');
        const reply = await warehouse.getBag();
        for (const item of warehouse.getBagItems(reply)) {
            const id = toNum(item?.id);
            if (wanted.has(id)) balances[String(id)] = (balances[String(id)] || 0) + Math.max(0, toNum(item?.count));
        }
        for (const id of wanted) balances[String(id)] ??= 0;
    } catch {
        // Catalog data remains useful while a balance refresh is unavailable.
    }
    if (wanted.has(1004)) {
        try {
            const pay = require('./pay');
            balances['1004'] = Math.max(0, toNum(await pay.getDiamondBalance()));
        } catch {
            delete balances['1004'];
        }
    }
    return balances;
}

function limitDto(limit: any): any {
    if (!limit || toNum(limit.limit_type) === 0) return null;
    const bought = Math.max(0, toNum(limit.bought_count));
    const max = Math.max(0, toNum(limit.limit_count));
    return {
        type: Math.max(0, toNum(limit.limit_type)),
        bought,
        max,
        remaining: Math.max(0, max - bought),
    };
}

function mallAvailability(goods: any, limit: any, slotType: number): { status: string; reason: string } {
    if (goods?.is_owned) return { status: 'owned', reason: '已拥有该商品' };
    if (limit?.remaining === 0) {
        return { status: 'sold_out', reason: goods?.is_free ? '奖励已领取' : '商品已售罄，已达到限购上限' };
    }
    if (goods?.ad_only) return { status: 'ad_required', reason: '请在游戏内观看广告领取' };
    if (goods?.share?.share_only && toNum(goods.share.share_status) !== 2) {
        return { status: 'share_required', reason: '请在游戏内完成分享条件' };
    }
    // Normal unrestricted products omit field 8 in live replies. The official
    // client uses restriction presence/type to distinguish unlimited purchases.
    // SVIP still requires its own availability flag and membership check.
    if (goods?.is_available !== true && !(slotType === 1 && !limit)) {
        return { status: 'unavailable', reason: '商品当前不可购买' };
    }
    return { status: 'available', reason: '' };
}

function mallGoodsDto(goods: any, balances: Record<string, number>, slotType: number): any {
    const price = itemDto(goods?.price);
    const originalPrice = price.count;
    const discountPrice = Math.max(0, toNum(goods?.discount_price));
    const promotionStart = toNum(goods?.promotion_start_time);
    const promotionEnd = toNum(goods?.promotion_end_time);
    const now = getServerTimeSec();
    const promotionActive = discountPrice > 0 && promotionStart <= now && promotionEnd > now;
    if (promotionActive) price.count = discountPrice;
    const limit = limitDto(goods?.purchase_limit);
    const isFree = goods?.is_free === true && price.count === 0;
    const availability = mallAvailability(goods, limit, slotType);
    const balance = price.id > 0 && Object.hasOwn(balances, String(price.id))
        ? balances[String(price.id)]
        : null;
    return {
        id: Math.max(0, toNum(goods?.goods_id)),
        name: String(goods?.name || ''),
        type: Math.max(0, toNum(goods?.goods_type)),
        rewards: (Array.isArray(goods?.reward_items) ? goods.reward_items : []).map((item: any) => itemDto(item)),
        price: { ...price, balance },
        originalPrice: promotionActive ? originalPrice : null,
        isFree,
        limit,
        isLimited: !!limit,
        productType: toNum(goods?.product_type),
        purchaseStatus: availability.status,
        unavailableReason: availability.reason,
        discountText: discountPrice > 0 && !promotionActive ? '' : String(goods?.discount_text || ''),
        isDiscounted: discountPrice > 0 ? promotionActive : !!goods?.is_discounted,
        discountEndTime: Math.max(0, discountPrice > 0 ? promotionEnd : toNum(goods?.discount_end_time)) * 1000,
        available: availability.status === 'available',
        purchasable: availability.status === 'available',
    };
}

async function getMallCatalog(slotTypeInput: unknown = 1, subSlotTypeInput: unknown = 0): Promise<any> {
    const slotType = boundedInteger(slotTypeInput, 1, 1, 100);
    const subSlotType = boundedInteger(subSlotTypeInput, 0, 0, 100);
    let membership: any = null;
    if (slotType === 4) {
        const vip = require('./qqvip');
        const status = await vip.getQQVipRewardsStatus();
        membership = { isSvip: status.is_qq_vip === true, remainingDays: toNum(status.remaining_days) };
    }
    const reply = await mallService.getMallListBySlotType(slotType, subSlotType);
    const goods = Array.isArray(reply?.goods_list) ? reply.goods_list : [];
    const currencyIds = goods.map((entry: any) => Math.max(0, toNum(entry?.price?.id))).filter(Boolean);
    const balances = await currencyBalances(currencyIds);
    return {
        slotType,
        subSlotType,
        membership,
        serverTime: getServerTimeSec() * 1000,
        refreshCountdown: Math.max(0, toNum(reply?.refresh_countdown)),
        currencies: Array.from(new Set(currencyIds), id => ({ ...itemDto({ id, count: balances[String(id)] || 0 }), balanceKnown: Object.hasOwn(balances, String(id)) })),
        goods: goods.map((entry: any) => {
            const product = mallGoodsDto(entry, balances, slotType);
            return membership && !membership.isSvip
                ? { ...product, available: false, purchasable: false, purchaseStatus: 'svip_required', unavailableReason: '需要 SVIP 会员身份' }
                : product;
        }),
    };
}

function serializePurchase<T>(operation: () => Promise<T>): Promise<T> {
    const result = purchaseTail.then(operation, operation);
    purchaseTail = result.then(() => undefined, () => undefined);
    return result;
}

async function purchaseMallProduct(goodsIdInput: unknown, countInput: unknown, slotTypeInput: unknown = 1, expectedPrice?: any): Promise<any> {
    const goodsId = positiveInteger(goodsIdInput, 'INVALID_GOODS_ID', 'goodsId');
    const count = positiveInteger(countInput, 'INVALID_PURCHASE_COUNT', 'count');
    if (count > 9999) throw businessError('INVALID_PURCHASE_COUNT', 'count exceeds 9999');

    return serializePurchase(async () => {
        const slotType = Number(slotTypeInput);
        if (slotType !== 1 && slotType !== 4 && slotType !== 5) throw businessError('INVALID_MALL_SLOT', '不支持的商城分页');
        const before = await getMallCatalog(slotType, 0);
        const goods = before.goods.find((entry: any) => entry.id === goodsId);
        if (!goods) throw businessError('GOODS_NOT_FOUND', 'Mall goods not found');
        if (goods.purchaseStatus === 'sold_out') throw businessError('GOODS_SOLD_OUT', goods.unavailableReason);
        if (!goods.purchasable) throw businessError('GOODS_UNAVAILABLE', 'Mall goods is unavailable');
        if (expectedPrice && (Number(expectedPrice.id) !== goods.price.id || Number(expectedPrice.count) !== goods.price.count)) {
            throw businessError('MALL_PRICE_CHANGED', '商品价格已变化，请刷新商城后重新确认');
        }
        if (!goods.isFree && (goods.price.id <= 0 || goods.price.count <= 0 || goods.price.balance === null)) {
            throw businessError('MALL_BALANCE_UNAVAILABLE', '商品价格或余额未确认，请刷新后重试');
        }
        if (goods.limit?.remaining !== null && goods.limit?.remaining < count) {
            throw businessError('PURCHASE_LIMIT_EXCEEDED', 'Purchase count exceeds the remaining limit');
        }
        if (!goods.isFree && goods.price.balance !== null && goods.price.balance < goods.price.count * count) {
            throw businessError('INSUFFICIENT_BALANCE', 'Insufficient currency balance');
        }

        const reply = await mallService.purchaseMallGoods(goodsId, count);
        let catalog = null;
        try { catalog = await getMallCatalog(slotType, 0); } catch {}
        return {
            purchase: {
                goodsId: Math.max(0, toNum(reply?.goods_id)),
                count,
                rewards: (Array.isArray(reply?.reward_items) ? reply.reward_items : []).map((item: any) => itemDto(item)),
                limit: limitDto(reply?.purchase_limit),
            },
            catalog,
            refreshRequired: !catalog,
        };
    });
}

async function getMysteryShop(): Promise<any> {
    const reply = await mysteryShopService.getActiveNPC();
    const npc = reply?.npc;
    if (!npc || !reply?.is_active) {
        return { active: false, serverTime: getServerTimeSec() * 1000, npc: null };
    }
    const currencyId = Math.max(0, toNum(npc.currency_item_id));
    const rewardCount = Math.max(0, toNum(npc.reward_count));
    const unitPrice = Math.max(0, toNum(npc.price));
    const unitOriginalPrice = Math.max(0, toNum(npc.original_price));
    const balances = await currencyBalances([currencyId]);
    return {
        active: true,
        serverTime: getServerTimeSec() * 1000,
        activeTime: Math.max(0, toNum(reply.active_time)) * 1000,
        expireTime: Math.max(0, toNum(reply.expire_time)) * 1000,
        npc: {
            id: Math.max(0, toNum(npc.npc_id)),
            reward: itemDto({ id: npc.reward_item_id, count: rewardCount }, '神秘商品'),
            price: { ...itemDto({ id: currencyId, count: unitPrice * rewardCount }), balance: balances[String(currencyId)] ?? null },
            originalPrice: unitOriginalPrice * rewardCount,
            unitPrice,
            unitOriginalPrice,
            discountPercent: Math.max(0, toNum(npc.discount_percent)),
        },
    };
}

async function purchaseMysteryOffer(npcIdInput: unknown): Promise<any> {
    const npcId = positiveInteger(npcIdInput, 'INVALID_MYSTERY_NPC_ID', 'npcId');
    return serializePurchase(async () => {
        const before = await getMysteryShop();
        const offer = before.npc;
        if (!before.active || !offer || offer.id !== npcId) {
            throw businessError('MYSTERY_OFFER_STALE', 'Mystery shop offer is no longer available');
        }
        if (offer.price.balance !== null && offer.price.balance < offer.price.count) {
            throw businessError('INSUFFICIENT_BALANCE', 'Insufficient currency balance');
        }

        await mysteryShopService.buy(npcId);
        const shop = await getMysteryShop();
        if (shop.active && shop.npc?.id === npcId && shop.npc.reward.count >= offer.reward.count) {
            throw businessError('MYSTERY_PURCHASE_NOT_CONFIRMED', 'Mystery shop purchase was not confirmed');
        }
        return {
            purchase: {
                npcId,
                reward: offer.reward,
                price: offer.price,
                originalPrice: offer.originalPrice,
                discountPercent: offer.discountPercent,
            },
            shop,
        };
    });
}

module.exports = {
    getMallCatalog,
    purchaseMallProduct,
    getMysteryShop,
    purchaseMysteryOffer,
};
