const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');
const { createPetDiaryService } = require('../dist/services/activity-center/pet-diary');
const captured = require('./fixtures/pet-treasure-capture.json');
const root = new protobuf.Root().loadSync(path.resolve(__dirname, '../src/proto/activitypb.proto'), { keepCase: true });
const types = Object.fromEntries(['PetDiaryOperateRequest', 'PetDiaryOperateReply', 'PetDiaryGetGroupReply', 'GetGroupRequest'].map(name => [name, root.lookupType(`gamepb.activitypb.${name}`)]));
const bytes = fixture => Buffer.from(fixture.hex, 'hex');
const encode = (type, input) => Buffer.from(type.encode(type.fromObject(input)).finish());

test('unlocked treasure requests and every reply field match the independent official decoder', () => {
    for (const fixture of captured) {
        const type = fixture.direction === 'send' ? types.PetDiaryOperateRequest : types.PetDiaryOperateReply;
        if (fixture.direction === 'send') assert.deepEqual(encode(type, fixture.expected), bytes(fixture), fixture.file);
        else assert.deepEqual(type.toObject(type.decode(bytes(fixture)), { longs: String, arrays: true, objects: true }), fixture.expected, fixture.file);
    }
});

function harness() {
    const fixture = captured.find(f => f.file === '003506-recv.bin');
    const pet = structuredClone(fixture.expected.data);
    const treasure = pet.pet_treasure_hunt.pool.treasures[0];
    let now = Number(treasure.start_at) + 60;
    const calls = [];
    let tail = Promise.resolve();
    let logs;
    const service = createPetDiaryService({
        types,
        getServerTimeSec: () => now,
        int64String: n => String(n ?? '0'), int64Number: n => Number(n || 0),
        getBag: async () => [{ id: '1028', count: '32' }, { id: '1029', count: '1500' }], getBagItems: x => x,
        itemDto: x => ({ id: String(x?.id || '0'), count: String(x?.count || '0'), name: 'item', image: '' }),
        textContent: text => ({ paragraphs: (JSON.parse(text).tips?.txt || []).filter(x => typeof x === 'string').map(x => x.replace(/<[^>]*>/g, '')).filter(Boolean) }),
        getCurrentSolarTerms: async () => ({ terms: [] }),
        businessError: (code, message) => Object.assign(new Error(message), { code }),
        positiveDecimal: value => { assert.match(String(value), /^[1-9]\d*$/); return String(value); },
        serializeMutation: fn => { const p = tail.then(fn, fn); tail = p.catch(() => {}); return p; },
        sendMsgAsync: async (_service, method, data) => {
            if (method === 'GetGroup') return { body: encode(types.PetDiaryGetGroupReply, { group: { head: { id: '2026090100' }, children: [pet] } }) };
            const request = types.PetDiaryOperateRequest.toObject(types.PetDiaryOperateRequest.decode(data), { longs: String });
            calls.push(request);
            if (request.operate_type === '7') return { body: encode(types.PetDiaryOperateReply, { activity_id: '2026090103', operate_type: 7, data: { head: pet.head, shop: {} } }) };
            if (request.operate_type === '47') return { body: bytes(captured.find(f => f.file === '003216-recv.bin')) };
            if (request.operate_type === '44') return { body: logs ? encode(types.PetDiaryOperateReply, { ...fixture.expected, pet_treasure_hunt_get_plundered_log: { logs } }) : bytes(fixture) };
            assert.equal(request.operate_type, '45');
            treasure.status = 4;
            return { body: encode(types.PetDiaryOperateReply, { activity_id: '2026090101', operate_type: 45, pet_treasure_hunt_open_treasure: { rewards: [{ id: '1029', count: '350' }] } }) };
        },
    });
    return { service, treasure, calls, setTime: value => now = value, setLogs: value => logs = value };
}

test('real adult snapshot exposes escort value, challenge limit, fixed charms and dedicated rules', async () => {
    const { service } = harness();
    const state = await service.getPetDiary();
    assert.equal(state.nurture.adult, true);
    assert.equal(state.nurture.dogGranted, true);
    assert.equal(state.hunt.count, 1);
    assert.equal(state.hunt.canDraw, false); // Captured UI has 32 / 700 cakes.
    const t = state.treasures[0];
    assert.equal(t.status, 2);
    assert.equal(t.item.count, '350');
    assert.equal(t.originalCount, '350');
    assert.equal(t.protectedCount, '50');
    assert.equal(t.maxCount, '500');
    assert.equal(t.endTime - t.startTime, 4 * 3600000);
    assert.equal(t.createdTime, 1789014403000);
    assert.deepEqual([t.plunderCount, t.maxPlunderCount], [0, 3]);
    assert.deepEqual(t.sourceCharmIds, []);
    assert.equal(state.charms.all.length, 5);
    assert.equal(state.charms.equipped[0].id, 104);
    assert.equal(state.charms.equipped[0].useLimit, -1);
    assert.equal(state.charms.all.find(c => c.id === 105).remaining[0], 2);
    assert.ok(state.treasureRules.includes('1. 护送计时结束；'));
});

test('friend information uses its own info field and does not show the owner treasure as a friend treasure', async () => {
    const { service } = harness();
    const friend = await service.getPetDiaryFriend('900001');
    assert.deepEqual(friend, { gid: '900001', treasures: [], charms: [104] });
});

test('real empty plunder log stays empty and detailed log mapping keeps challenge and both sides of charms', async () => {
    const h = harness();
    assert.deepEqual(await h.service.getPetDiaryRecords('plunder'), []);
    // Synthetic edge case, explicitly distinct from the live empty log above.
    h.setLogs([{ ts: 1789014500, attacker_gid: '99', attacker_name: '测试好友', attacker_level: 38, attacker_won: true, treasure_id: h.treasure.id, challenge_item_id: 80102, attacker_charm: [104], defender_charm: [105], lost_items: [{ id: 1029, count: 75 }], injected_items: [{ id: 1029, count: 15 }], is_fake: true }]);
    const [log] = await h.service.getPetDiaryRecords('plunder');
    assert.equal(log.treasureId, h.treasure.id);
    assert.equal(log.challenge.id, '80102');
    assert.deepEqual(log.attackerCharms, [104]);
    assert.deepEqual(log.defenderCharms, [105]);
    assert.equal(log.lost[0].count, '75');
    assert.equal(log.injected[0].count, '15');
    assert.equal(log.fake, true);
});

test('escort claim waits for completion, settles once and rejects waiting or missing end times', async () => {
    const h = harness();
    await assert.rejects(h.service.operatePetDiary('openTreasure'), /还没有/);
    const end = h.treasure.end_at;
    h.treasure.end_at = '0';
    await assert.rejects(h.service.operatePetDiary('openTreasure'), /还没有/);
    h.treasure.end_at = end;
    h.treasure.status = 1;
    h.setTime(Number(end) + 1);
    await assert.rejects(h.service.operatePetDiary('openTreasure'), /还没有/);
    h.treasure.status = 2;
    const results = await Promise.allSettled([h.service.operatePetDiary('openTreasure'), h.service.operatePetDiary('openTreasure')]);
    assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
    assert.equal(h.calls.filter(c => c.operate_type === '45').length, 1);
    assert.equal(results[0].value.rewards[0].count, '350');
});
