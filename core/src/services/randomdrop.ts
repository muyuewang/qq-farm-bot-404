export {};
/**
 * 随机掉落活动服务 - 获取活动信息和奖励
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum } = require('../utils/utils');

async function getActivityInfo(): Promise<any> {
    const body: Uint8Array = types.RandomDropGetActivityInfoRequest.encode(
        types.RandomDropGetActivityInfoRequest.create({})
    ).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.randomdroppb.RandomDropService', 'GetActivityInfo', body);
    return types.RandomDropGetActivityInfoReply.decode(replyBody);
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

module.exports = {
    getActivityInfo,
};
