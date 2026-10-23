const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActivityDirectory } = require('../dist/services/activity-center');

test('milk tea and identically named share reward instances keep independent directory entries', () => {
    const windows = ['2026110100', '2026110101', '2026110102', '2026110103', '2026110104']
        .map(id => ({ id, name: '奶茶热销中', beginTime: 100, endTime: 200 }));
    windows.push({ id: '2026092501', name: '快乐不独享', beginTime: 100, endTime: 200 });
    const directory = buildActivityDirectory(windows, null, null, null, null);
    const milk = directory.find(entry => entry.gameplayKey === 'milk');
    assert.deepEqual(milk.activityIds, ['2026110100', '2026110101', '2026110102', '2026110103']);
    const share = directory.filter(entry => entry.gameplayKey === 'happy');
    assert.equal(share.length, 2);
    for (const id of ['2026110104', '2026092501']) {
        const instance = share.find(entry => entry.instanceId === id);
        assert.equal(instance.name, '快乐不独享');
        assert.deepEqual(instance.activityIds, [id]);
        assert.equal(instance.detailTarget, 'happy');
    }
});
