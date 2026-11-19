export {};
/**
 * 随机掉落活动服务 - 获取活动信息和奖励
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');

async function getActivityInfo(): Promise<any> {
    const body: Uint8Array = types.RandomDropGetActivityInfoRequest.encode(
        types.RandomDropGetActivityInfoRequest.create({})
    ).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.randomdroppb.RandomDropService', 'GetActivityInfo', body);
    return types.RandomDropGetActivityInfoReply.decode(replyBody);
}

module.exports = {
    getActivityInfo,
};
