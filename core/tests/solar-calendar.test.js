const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protobuf = require('protobufjs');
const root = new protobuf.Root().loadSync(path.join(__dirname, '../src/proto/solartermspb.proto'), { keepCase: true });
const types = {};
for (const method of ['GetSolarTermsV2', 'ClaimSolarTermsV2', 'AnswerSolarTerms', 'ClaimSolarSeason']) {
    for (const suffix of ['Request', 'Reply']) types[method + suffix] = root.lookupType(`gamepb.solartermspb.${  method  }${suffix}`);
}
function harness() {
    const writes = [];
    const now = 1792252900;
    const event = { id: 401, window_status: 2, open_start_time: now - 100, open_end_time: now + 86400, rewards: [{ id: 1002, count: 200 }], question_rewards: [{ id: 1002, count: 100 }] };
    const season = { id: 4, event_ids: [401], reward_claimable: true, rewards: [{ id: 1002, count: 10 }] };
    let failRefresh = false;
    const mock = (name, exports) => { const id = require.resolve(`../dist/${  name}`); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    mock('utils/proto', { types });
    mock('utils/utils', { toNum: v => Number(v) || 0 });
    mock('config/gameConfig', { getItemById: () => ({ name: '点券' }), getItemImageById: () => '' });
    mock('utils/network', { sendMsgAsync: async (service, method, body) => {
        assert.equal(service, 'gamepb.solartermspb.SolarTermsV2Service');
        const request = types[`${method  }Request`].toObject(types[`${method  }Request`].decode(body), { longs: Number });
        let reply;
        if (method === 'GetSolarTermsV2') {
            if (failRefresh && writes.length) throw new Error('offline');
            reply = { server_time: now, default_event_id: 401, events: [event], seasons: [season] };
        } else {
            writes.push({ method, request });
            if (method === 'ClaimSolarTermsV2') { event.direct_claimed = true; reply = { updated_event: event, rewards: event.rewards }; }
            if (method === 'AnswerSolarTerms') {
                const correct = request.option_index === 0;
                event.quiz_claimed = correct;
                event.quiz_wrong_today = !correct;
                reply = { correct, updated_event: event, rewards: correct ? event.question_rewards : [] };
            }
            if (method === 'ClaimSolarSeason') { season.reward_claimed = true; reply = { updated_season: season, rewards: season.rewards }; }
        }
        return { body: types[`${method  }Reply`].encode(types[`${method  }Reply`].fromObject(reply)).finish() };
    } });
    const id = require.resolve('../dist/services/solar-calendar'); delete require.cache[id];
    return { service: require(id), event, season, writes, failRefresh: () => { failRefresh = true; } };
}
test('calendar uses server status and the official answer index', async () => {
    const h = harness();
    const state = await h.service.getSolarCalendar();
    assert.equal(state.events[0].name, '重阳');
    assert.match(state.events[0].description, /农历 九月初九/);
    assert.deepEqual(state.events[0].options, ['A.敬老节', 'B.儿童节', 'C.母亲节', 'D.教师节']);
    assert.equal(state.events[0].canClaim, true);
    assert.equal(state.events[0].canAnswer, true);
    assert.equal(state.events[0].answerIndex, 0);
    h.event.id = 402;
    const frost = (await h.service.getSolarCalendar()).events[0];
    assert.equal(frost.answerIndex, 2);
    assert.equal(frost.options[frost.answerIndex], 'C.最后一个');
    h.event.id = 101;
    assert.equal((await h.service.getSolarCalendar()).events[0].answerIndex, null);
    h.event.id = 999;
    assert.equal((await h.service.getSolarCalendar()).events[0].answerIndex, null);
    h.event.id = 401;
    for (const status of [0, 1, 3]) {
        h.event.window_status = status;
        await assert.rejects(h.service.operateSolarCalendar('claim', { id: 401 }));
    }
    h.event.window_status = 2;
    h.event.open_end_time = 1;
    await assert.rejects(h.service.operateSolarCalendar('answer', { id: 401, optionIndex: 0 }));
    assert.equal(h.writes.length, 0);
});

test('calendar omits answer hints when the configured index is missing or invalid', async () => {
    const config = require('../dist/activity-data/solar-calendar.json');
    const entry = config.events.find(v => v.id === 401);
    const original = entry.answer_index;
    try {
        const h = harness();
        for (const value of [undefined, null, -1, 4, 0.5, '0']) {
            entry.answer_index = value;
            const event = (await h.service.getSolarCalendar()).events[0];
            assert.equal(event.answerIndex, null);
            assert.equal(event.canAnswer, true);
        }
    } finally {
        entry.answer_index = original;
    }
});
test('calendar serializes claims and retains the actual reward if refresh fails', async () => {
    const h = harness(); h.failRefresh();
    const reply = await h.service.operateSolarCalendar('claim', { id: 401 });
    assert.equal(reply.rewards[0].count, 200);
    assert.equal(reply.refreshRequired, true);
    assert.deepEqual(h.writes, [{ method: 'ClaimSolarTermsV2', request: { id: 401 } }]);
    const next = harness();
    const results = await Promise.allSettled([next.service.operateSolarCalendar('claim', { id: 401 }), next.service.operateSolarCalendar('claim', { id: 401 })]);
    assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
    assert.equal(next.writes.length, 1);
});
test('calendar verifies current question, option index and daily quiz restrictions', async () => {
    const h = harness();
    const input = { id: 401, expectedQuestion: '重阳节又被称为什么节？', optionIndex: 0 };
    await assert.rejects(h.service.operateSolarCalendar('answer', { ...input, expectedQuestion: 'stale' }), /题目已变化/);
    await assert.rejects(h.service.operateSolarCalendar('answer', { ...input, optionIndex: 4 }), /有效答案/);
    for (const optionIndex of [null, false, '0', 0.5]) {
        await assert.rejects(h.service.operateSolarCalendar('answer', { ...input, optionIndex }), /有效答案/);
    }
    const result = await h.service.operateSolarCalendar('answer', input);
    assert.equal(result.correct, true);
    assert.deepEqual(h.writes[0].request, { id: 401, option_index: 0 });
    await assert.rejects(h.service.operateSolarCalendar('answer', input));
    const other = harness();
    assert.equal((await other.service.operateSolarCalendar('answer', { ...input, optionIndex: 1 })).correct, false);
    await assert.rejects(other.service.operateSolarCalendar('answer', input));
    assert.equal(other.writes.length, 1);
});

test('expired calendar entries keep descriptions and rewards without allowing claims', async () => {
    const h = harness();
    h.event.window_status = 3;
    h.event.open_end_time = 1;
    h.event.direct_claimed = true;
    const state = await h.service.getSolarCalendar();
    assert.equal(state.events.length, 1);
    assert.match(state.events[0].description, /九月初九/);
    assert.equal(state.events[0].rewards[0].count, 200);
    assert.equal(state.events[0].directClaimed, true);
    assert.equal(state.events[0].canClaim, false);
    assert.equal(state.events[0].canAnswer, false);
    await assert.rejects(h.service.operateSolarCalendar('claim', { id: 401 }));
    assert.equal(h.writes.length, 0);
});
test('calendar only claims configured, unclaimed season rewards', async () => {
    const h = harness();
    h.season.rewards = [];
    await assert.rejects(h.service.operateSolarCalendar('season', { id: 4 }));
    h.season.rewards = [{ id: 1002, count: 10 }];
    assert.equal((await h.service.operateSolarCalendar('season', { id: 4 })).rewards[0].count, 10);
    await assert.rejects(h.service.operateSolarCalendar('season', { id: 4 }));
    await assert.rejects(h.service.operateSolarCalendar('unknown', { id: 4 }));
});
