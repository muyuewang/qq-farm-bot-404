import autumnConfig from '../activity-data/autumn-20260924.json';

export {};

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { getServerTimeSec, toNum } = require('../utils/utils');
const { getItemById, getItemImageById } = require('../config/gameConfig');
const config = autumnConfig;
const shareReward = require('./share-reward-activity');

const EVENTS = {
    wish: { groupId: 2026092400, id: 2026092401, field: 'wish_sign', title: '秋祈良愿' },
    happy: { groupId: 2026092500, id: 2026092501, field: 'share_reward', title: '快乐不独享' },
};

// Each account owns a worker/module instance. Serialize fresh checks with writes.
let mutationTail: Promise<any> = Promise.resolve();

function fail(code: string, message: string): never {
    throw Object.assign(new Error(message), { code });
}

function eventFor(key: string): any {
    return Object.hasOwn(EVENTS, key) ? EVENTS[key as keyof typeof EVENTS] : fail('INVALID_AUTUMN_ACTIVITY', '未知活动');
}

function reward(item: any): any {
    const id = toNum(item.id);
    return { id, count: toNum(item.count), name: getItemById(id)?.name || `物品 #${id}`, image: getItemImageById(id) };
}

function findEntry(entry: any, id: number): any {
    if (toNum(entry?.activity?.activity_id) === id) return entry;
    for (const child of entry?.children || []) {
        const found = findEntry(child, id);
        if (found) return found;
    }
    return null;
}

async function query(key: string): Promise<any> {
    const event = eventFor(key);
    const body = types.GetGroupRequest.encode({ group_id: event.groupId }).finish();
    const reply = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', body);
    const entry = findEntry(types.GetGroupReply.decode(reply.body).group, event.id);
    if (!entry?.[event.field]) fail('AUTUMN_STATE_UNAVAILABLE', '活动动态状态未返回，请稍后刷新');
    return entry;
}

function normalize(key: string, entry: any): any {
    const event = eventFor(key);
    const head = entry.activity;
    const now = getServerTimeSec();
    const startTime = toNum(head.begin_time);
    const endTime = toNum(head.end_time);
    const active = startTime <= now && endTime > now;
    let rules: string[] = [];
    try { rules = JSON.parse(Buffer.from(head.extra || []).toString('utf8')).tips.txt.filter((v: any) => typeof v === 'string').map((v: string) => v.replace(/<[^>]+>/g, '')); } catch {}
    const base = { key, id: String(event.id), title: event.title, serverTime: now * 1000, startTime: startTime * 1000, endTime: endTime * 1000, active, rules };
    if (key === 'wish') {
        const state = entry.wish_sign;
        const pending = state.pending && toNum(state.pending.text_id) > 0 ? state.pending : null;
        return {
            ...base,
            remaining: toNum(state.remaining_count), day: toNum(state.activity_day),
            choices: config.choices.map((v: any) => ({ id: v.choose_id, name: v.desc })),
            rewardDays: config.rewards.map((v: any) => {
                const [id, count] = v.reward.split(':').map(Number);
                return { day: v.day_id, reward: reward({ id, count }) };
            }),
            pending: pending ? {
                chooseId: toNum(pending.choose_id), textId: toNum(pending.text_id), day: toNum(pending.day_id),
                text: config.texts.find((v: any) => v.choose_id === toNum(pending.choose_id) && v.text_id === toNum(pending.text_id))?.desc || '',
                rewards: (pending.rewards || []).map(reward),
            } : null,
            canDraw: active && !pending && toNum(state.remaining_count) > 0,
            canClaim: active && !!pending,
        };
    }
    return fail('INVALID_AUTUMN_ACTIVITY', '未知活动');
}

async function getAutumnActivity(key: string): Promise<any> {
    if (key === 'happy') return shareReward.getShareRewardActivity(EVENTS.happy.id);
    return normalize(key, await query(key));
}

const OPERATIONS: Record<string, { key: string; cmd: number; field: string }> = {
    draw: { key: 'wish', cmd: 51, field: 'wish_sign_draw' },
    claim: { key: 'wish', cmd: 52, field: 'wish_sign_claim' },
};

function parameters(action: string, state: any, input: any): any {
    if (!state.active) fail('AUTUMN_ACTIVITY_ENDED', '活动尚未开放或已经结束');
    if (action === 'draw') {
        if (!state.canDraw) fail('WISH_DRAW_UNAVAILABLE', '请先领取待领取奖励，或等待明日祈愿');
        const chooseId = Number(input?.chooseId);
        if (!Number.isInteger(chooseId) || !state.choices.some((v: any) => v.id === chooseId)) fail('INVALID_WISH_CHOICE', '请选择有效的祈愿方向');
        return { choose_id: chooseId };
    }
    if (action === 'claim') {
        if (!state.canClaim) fail('WISH_CLAIM_UNAVAILABLE', '当前没有待领取的祈愿奖励');
        return { choose_id: state.pending.chooseId };
    }
    return {};
}

async function performOperation(key: string, action: string, input: any): Promise<any> {
    const event = eventFor(key);
    const operation = Object.hasOwn(OPERATIONS, action) ? OPERATIONS[action] : null;
    if (!operation || operation.key !== key) fail('INVALID_AUTUMN_OPERATION', '活动操作不匹配');
    const state = await getAutumnActivity(key);
    const params = parameters(action, state, input);
    const body = types.AutumnOperateRequest.encode({ activity_id: event.id, operate_type: operation.cmd, [operation.field]: params }).finish();
    const response = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', body);
    const reply = types.ActivityOperateReply.decode(response.body);
    if (toNum(reply.activity_id) !== event.id || toNum(reply.operate_type) !== operation.cmd || !reply[operation.field]) {
        fail('AUTUMN_RESPONSE_INVALID', '操作回包不完整，请刷新确认结果，勿重复提交');
    }
    const result = types.ActivityOperateReply.toObject(reply, { longs: String, bytes: String })[operation.field];
    const rewards = (reply[operation.field].awards || reply[operation.field].rewards || []).map(reward);
    // A completed mutation must not be reported as failed if the follow-up read fails.
    try { return { activity: await getAutumnActivity(key), result, rewards }; }
    catch { return { activity: null, result, rewards, refreshRequired: true }; }
}

function operateAutumnActivity(key: string, action: string, input: any = {}): Promise<any> {
    if (key === 'happy') return shareReward.operateShareRewardActivity(EVENTS.happy.id, action, input);
    const result = mutationTail.then(() => performOperation(key, action, input));
    mutationTail = result.catch(() => {});
    return result;
}

module.exports = { getAutumnActivity, operateAutumnActivity };
