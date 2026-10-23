export {};

const { sendMsgAsync, sendMsgNoReply } = require('../utils/network');
const { types } = require('../utils/proto');

const MYSTERY_SHOP_SERVICE = 'gamepb.mysteryshoppb.MysteryShopService';

async function getActiveNPC(): Promise<any> {
    const body: Uint8Array = types.GetActiveNPCRequest
        .encode(types.GetActiveNPCRequest.create({}))
        .finish();
    const { body: replyBody } = await sendMsgAsync(MYSTERY_SHOP_SERVICE, 'GetActiveNPC', body);
    return types.GetActiveNPCReply.decode(replyBody);
}

async function buy(npcId: number): Promise<void> {
    const body: Uint8Array = types.MysteryShopBuyRequest
        .encode(types.MysteryShopBuyRequest.create({ npc_id: npcId }))
        .finish();
    await sendMsgNoReply(MYSTERY_SHOP_SERVICE, 'Buy', body);
}

module.exports = {
    getActiveNPC,
    buy,
};
