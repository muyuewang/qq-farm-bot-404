const config = require('../activity-data/solar-calendar.json');
const { sendMsgAsync, isConnected } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');
const { getItemById, getItemImageById } = require('../config/gameConfig');

// 官方 SolarTermsV2Service（1.15.0.2_20261001）。V1 的 SolarTermsService 保持不变，此处不替换旧接口。
const SERVICE = 'gamepb.solartermspb.SolarTermsV2Service';

// 写操作（领取/答题/领季度）串行执行，避免并发重复提交。
let tail = Promise.resolve();

function rewards(values = []) {
    return values.map(item => ({
        id: toNum(item.id),
        count: toNum(item.count),
        name: getItemById(toNum(item.id))?.name || `物品${toNum(item.id)}`,
        image: getItemImageById(toNum(item.id)),
    }));
}

async function rpc(method, input = {}) {
    const Request = types[`${method}Request`];
    const Reply = types[`${method}Reply`];
    const body = Request.encode(Request.fromObject(input)).finish();
    const reply = await sendMsgAsync(SERVICE, method, body);
    return Reply.decode(reply.body);
}

function eventDto(value, now) {
    const id = toNum(value.id);
    const entry = config.events.find(v => v.id === id);
    const startTime = toNum(value.open_start_time);
    const endTime = toNum(value.open_end_time);
    const open = toNum(value.window_status) === 2 && now >= startTime && now <= endTime;
    const options = entry?.answer ? entry.answer.split(';') : [];
    const answerIndex = entry?.answer_index;
    let rules = [];
    try {
        rules = JSON.parse(entry?.help || '{}').tips?.txt?.map(
            text => text.replace(/<br\s*(?:\/\s*)?>/gi, '\n').replace(/<[^>]+>/g, ''),
        ) || [];
    } catch { /* 官方文案缺失时保持为空。 */ }
    return {
        id,
        name: entry?.name || `节令 ${id}`,
        description: entry?.description || '',
        startTime,
        endTime,
        status: toNum(value.window_status),
        directClaimed: !!value.direct_claimed,
        quizClaimed: !!value.quiz_claimed,
        quizWrongToday: !!value.quiz_wrong_today,
        wrongOptions: (value.wrong_options || []).map(toNum),
        question: entry?.question || '',
        options,
        errorTips: entry?.error_tips || '',
        rules,
        answerIndex: entry?.question
            && typeof answerIndex === 'number'
            && Number.isInteger(answerIndex)
            && answerIndex >= 0
            && answerIndex < options.length ? answerIndex : null,
        rewards: rewards(value.rewards),
        questionRewards: rewards(value.question_rewards),
        canClaim: open && !value.direct_claimed,
        canAnswer: open && !!entry?.question && !value.quiz_claimed && !value.quiz_wrong_today,
    };
}

async function getSolarCalendar() {
    if (!isConnected()) throw new Error('账号未连接');
    const reply = await rpc('GetSolarTermsV2');
    if (!Object.hasOwn(reply, 'server_time')) throw new Error('节令日历回包不完整');
    const serverTime = toNum(reply.server_time);
    return {
        serverTime,
        defaultEventId: toNum(reply.default_event_id),
        events: (reply.events || []).map(v => eventDto(v, serverTime)),
        seasons: (reply.seasons || []).map(v => {
            const entry = config.seasons.find(c => c.id === toNum(v.id));
            return {
                id: toNum(v.id),
                name: entry?.name || '',
                year: entry?.year || '',
                description: entry?.description || '',
                eventIds: (v.event_ids || []).map(toNum),
                litCount: toNum(v.lit_count),
                totalCount: toNum(v.total_count),
                claimed: !!v.reward_claimed,
                canClaim: !!v.reward_claimable && !v.reward_claimed && !!v.rewards?.length,
                rewards: rewards(v.rewards),
            };
        }),
    };
}

async function perform(action, input) {
    if (!['claim', 'answer', 'season'].includes(action)) throw new Error('未知的节令操作');
    const id = Number(input.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('节令编号无效');
    const state = await getSolarCalendar();
    let method;
    const params = { id };
    if (action === 'season') {
        if (!state.seasons.find(v => v.id === id)?.canClaim) throw new Error('当前季度奖励不可领取');
        method = 'ClaimSolarSeason';
    } else {
        const event = state.events.find(v => v.id === id);
        if (!event || (action === 'claim' ? !event.canClaim : !event.canAnswer)) {
            throw new Error('节令尚未开放、已结束或今日操作已完成');
        }
        if (action === 'answer') {
            const index = input.optionIndex;
            if (!Number.isInteger(index) || index < 0 || index >= event.options.length || event.wrongOptions.includes(index)) {
                throw new Error('请选择有效答案');
            }
            if (input.expectedQuestion !== event.question) throw new Error('题目已变化，请刷新后重新选择');
            params.option_index = index;
        }
        method = action === 'claim' ? 'ClaimSolarTermsV2' : 'AnswerSolarTerms';
    }
    const reply = await rpc(method, params);
    const updated = action === 'season' ? reply.updated_season : reply.updated_event;
    if (!updated || toNum(updated.id) !== id) throw new Error('操作回包不完整，请刷新确认结果，勿重复提交');
    const result = { rewards: rewards(reply.rewards), correct: action === 'answer' ? !!reply.correct : undefined };
    try {
        return { ...result, calendar: await getSolarCalendar() };
    } catch {
        return { ...result, calendar: null, refreshRequired: true };
    }
}

function operateSolarCalendar(action, input = {}) {
    const operation = tail.then(() => perform(action, input));
    tail = operation.catch(() => {});
    return operation;
}

module.exports = { getSolarCalendar, operateSolarCalendar };
