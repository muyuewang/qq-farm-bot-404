const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture(fetch) {
    let now = 1000;
    const exports = {};
    const context = { module: { exports }, process: { env: {} }, Date: { now: () => now },
        require: name => {
            if (name === './friend-api') return { getAllFriends: fetch };
            if (name === '../utils/utils') return { toNum: Number, log() {} };
            if (name === '../utils/network') return { getUserState: () => ({ gid: 99 }) };
            return {};
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/friend-land-analyzer.js'), 'utf8'), context);
    return { ...context.module.exports, advance: ms => { now += ms; } };
}
test('shared list cache merges concurrent reads and refreshes after five minutes', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return { game_friends: [{ gid: calls, name: 'friend' }] }; });
    const [a, b] = await Promise.all([f.getFriendsList(), f.getFriendsList(true)]);
    assert.equal(calls, 1); assert.equal(a, b);
    await f.getFriendsList(); assert.equal(calls, 1);
    f.advance(300000); await f.getFriendsList(); assert.equal(calls, 2);
    f.setFriendsListCache(null); await f.getFriendsList(); assert.equal(calls, 3);
});
test('empty and failed friend refreshes are rate limited but recover', async () => {
    for (const fails of [true, false]) {
        let calls = 0;
        const f = fixture(async () => { calls++; if (fails && calls === 1) throw Error('offline'); return { game_friends: [] }; });
        await f.getFriendsList(); await f.getFriendsList(); assert.equal(calls, 1);
        f.advance(300000); await f.getFriendsList(); assert.equal(calls, 2);
    }
});

test('empty visitor discovery retries after cooldown and keeps existing excluded GIDs', async () => {
    let now = 1000, calls = 0, known = [9];
    const context = { module: { exports: {} }, process: { env: {} }, Date: { now: () => now },
        require: name => {
            if (name === '../models/store') return { getKnownFriendGids: () => known,
                getFriendBlacklist: () => [9], applyConfigSnapshot: patch => { known = patch.knownFriendGids; } };
            if (name === '../utils/utils') return { toNum: Number, log() {}, logWarn() {} };
            if (name === './interact') return { getInteractRecords: async () => {
                calls++; return calls === 1 ? [] : [{ visitorGid: 10 }];
            } };
            return {};
        } };
    const source = fs.readFileSync(path.join(__dirname, '../src/services/friend-api.js'), 'utf8');
    vm.runInNewContext(`${source}\nmodule.exports.retryVisitors = syncKnownFriendGidsFromRecentVisitorsOnce;`, context);
    const retry = context.module.exports.retryVisitors;
    await retry(true); await retry(true); assert.equal(calls, 1);
    now += 300000; await retry(true); assert.equal(calls, 2);
    assert.deepEqual(Array.from(known), [9, 10]);
    now += 300000; await retry(true); assert.equal(calls, 2);
});
