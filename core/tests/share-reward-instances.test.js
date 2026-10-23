const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protobuf = require('protobufjs');
const root = new protobuf.Root().loadSync(['activitypb.proto', 'autumn-activities.proto'].map(n => path.join(__dirname, '../src/proto', n)), { keepCase: true });
const types = Object.fromEntries(['GetGroupRequest', 'GetGroupReply', 'AutumnOperateRequest', 'ActivityOperateReply'].map(name => [name, root.lookupType(`gamepb.activitypb.${name}`)]));
const encode = (type, value) => type.encode(type.fromObject(value)).finish();
function harness() {
    const groups = { '2026092500': '2026092501', '2026110100': '2026110104' };
    const calls = [];
    let wrongReply = false;
    let ended = false;
    const mock = (name, exports) => { const id = require.resolve(`../dist/${name}`); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    mock('utils/proto', { types });
    mock('utils/utils', { toNum: Number, getServerTimeSec: () => 1000 });
    mock('config/gameConfig', { getItemById: id => ({ name: `物品${id}` }), getItemImageById: () => '' });
    mock('utils/network', { sendMsgAsync: async (_service, method, body) => {
        if (method === 'GetGroup') {
            const groupId = String(types.GetGroupRequest.decode(body).group_id);
            const id = groups[groupId];
            const entry = { activity: { activity_id: id, begin_time: 1, end_time: ended ? 999 : 2000 }, share_reward: { summary: { daily: { claim_limit: 5 }, current_score: id.endsWith('04') ? 10 : 50, milestones: [{ tier_id: 1, threshold: 10, state: 2, rewards: [{ id: id.endsWith('04') ? 1042 : 80011, count: 2 }] }] } } };
            return { body: encode(types.GetGroupReply, { group: { activity: { activity_id: groupId }, children: [entry] } }) };
        }
        const request = types.AutumnOperateRequest.toObject(types.AutumnOperateRequest.decode(body), { longs: String });
        calls.push(request);
        return { body: encode(types.ActivityOperateReply, { activity_id: wrongReply ? '2026092501' : request.activity_id, operate_type: request.operate_type, share_reward_share: { granted_score: 5, ark_biz_param: Buffer.from('private') } }) };
    } });
    const id = require.resolve('../dist/services/share-reward-activity'); delete require.cache[id];
    return { api: require(id), calls, wrong: () => wrongReply = true, end: () => ended = true };
}
test('share reward instances keep their own group, score and awards', async () => {
    const h = harness();
    const old = await h.api.getShareRewardActivity('2026092501');
    const current = await h.api.getShareRewardActivity('2026110104');
    assert.equal(old.score, 50); assert.equal(current.score, 10);
    assert.equal(old.milestones[0].rewards[0].id, 80011);
    assert.equal(current.milestones[0].rewards[0].id, 1042);
    const result = await h.api.operateShareRewardActivity('2026110104', 'share');
    assert.equal(h.calls[0].activity_id, '2026110104'); assert.equal(h.calls[0].operate_type, '70');
    assert.deepEqual(Object.keys(result.result), ['granted_score']);
    await assert.rejects(h.api.getShareRewardActivity('unregistered'), /未知/);
});
test('wrong-instance replies and expired activities cannot be accepted', async () => {
    const h = harness(); h.wrong();
    await assert.rejects(h.api.operateShareRewardActivity('2026110104', 'share'), /回包不完整/);
    h.end();
    await assert.rejects(h.api.operateShareRewardActivity('2026110104', 'share'), /已经结束/);
    assert.equal(h.calls.length, 1);
});
