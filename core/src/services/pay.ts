export {};

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');

const DEFAULT_RECHARGE_SOURCE: string = 'MallUI';

async function getRechargeInfo(source: string = DEFAULT_RECHARGE_SOURCE): Promise<any> {
    const body: Uint8Array = types.GetRechargeInfoRequest.encode(
        types.GetRechargeInfoRequest.create({
            source: String(source || DEFAULT_RECHARGE_SOURCE),
        }),
    ).finish();
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.paypb.PayService',
        'GetRechargeInfo',
        body,
    );
    return types.GetRechargeInfoReply.decode(replyBody);
}

async function getDiamondBalance(): Promise<number> {
    const reply: any = await getRechargeInfo();
    const infos: any[] = Array.isArray(reply?.recharge_infos) ? reply.recharge_infos : [];
    return Math.max(0, toNum(infos[0]?.balance));
}

module.exports = {
    DEFAULT_RECHARGE_SOURCE,
    getDiamondBalance,
    getRechargeInfo,
};
