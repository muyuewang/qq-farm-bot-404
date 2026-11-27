export {};

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');
const { ATTRIBUTION_BALANCE_REFRESH, observeBalance } = require('./currency-ledger');

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
    const balance = Math.max(0, toNum(infos[0]?.balance));
    // 钻石不进背包，主动查询到的余额也交给流水做差，捕获没有推送的变化
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    if (accountId) observeBalance(accountId, 'diamond', balance, ATTRIBUTION_BALANCE_REFRESH);
    return balance;
}

module.exports = {
    DEFAULT_RECHARGE_SOURCE,
    getDiamondBalance,
    getRechargeInfo,
};
