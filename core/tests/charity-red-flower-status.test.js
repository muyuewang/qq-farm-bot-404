const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    charityRedFlowerDto,
    reconcileCharityProgressState,
} = require('../dist/services/activity-center');
const {
    loadCharityRedFlowerState,
    persistCharityRedFlowerState,
} = require('../dist/services/activity-center-state');

function makeEntry({ flowStatus, donatedLove = '30', progressRewards }) {
    const now = Math.floor(Date.now() / 1000);
    return {
        activity: {
            activity_id: '2026090901',
            name: '公益小红花',
            begin_time: String(now - 60),
            end_time: String(now + 3600),
        },
        charity_red_flower: {
            love_item_id: '1040',
            donated_love: donatedLove,
            global_donated_love: '1',
            global_target_love: '100',
            flow_status: flowStatus,
            progress_rewards: progressRewards || [
                { target: '30', status: '1', reward: { item_id: '80013', count: '1' } },
            ],
        },
    };
}

test('charity daily gift follows the red-flower flow status', () => {
    const notHarvested = charityRedFlowerDto(makeEntry({ flowStatus: '1' }));
    assert.equal(notHarvested.dailyGift.harvestedToday, false);
    assert.equal(notHarvested.dailyGift.claimed, false);
    assert.equal(notHarvested.actions.claimDailyGift.enabled, false);

    const harvested = charityRedFlowerDto(makeEntry({ flowStatus: '2' }));
    assert.equal(harvested.dailyGift.harvestedToday, true);
    assert.equal(harvested.dailyGift.claimed, false);
    assert.equal(harvested.actions.claimDailyGift.enabled, true);

    const claimed = charityRedFlowerDto(makeEntry({ flowStatus: '3' }));
    assert.equal(claimed.dailyGift.harvestedToday, true);
    assert.equal(claimed.dailyGift.claimed, true);
    assert.equal(claimed.actions.claimDailyGift.enabled, false);
});

test('charity activity uses the activity window when detail timing is stale', () => {
    const now = Math.floor(Date.now() / 1000);
    const entry = makeEntry({ flowStatus: '2' });
    entry.activity.begin_time = '0';
    entry.activity.end_time = '0';
    const activity = charityRedFlowerDto(entry, null, {
        id: '2026090901',
        begin_time: String(now + 3600),
        end_time: String(now + 7200),
    });

    assert.equal(activity.active, false);
    assert.equal(activity.startTime, String(now + 3600));
    assert.equal(activity.actions.claimSeeds.enabled, false);
    assert.equal(activity.actions.donateLove.enabled, false);
    assert.equal(activity.actions.claimDailyGift.enabled, false);
    assert.equal(activity.seedReward.claimable, false);
    assert.equal(activity.progressRewards[0].claimable, false);
});

test('charity progress capture maps the claimed prefix, pending frontier, and locked suffix', () => {
    const entry = makeEntry({
        flowStatus: '2',
        donatedLove: '62',
        progressRewards: [
            { target: '30', status: '1', reward: { item_id: '80013', count: '1' } },
            { target: '60', status: '1', reward: { item_id: '1002', count: '50' } },
            { target: '90', status: '0', reward: { item_id: '80013', count: '2' } },
        ],
    });
    const progressState = reconcileCharityProgressState(entry);
    const activity = charityRedFlowerDto(entry, progressState);

    assert.deepEqual(progressState.claimedProgressTargets, ['30']);
    assert.deepEqual(progressState.pendingProgressTargets, ['60']);
    assert.deepEqual(activity.progressRewards.map(reward => ({
        target: reward.target,
        reached: reward.reached,
        claimed: reward.claimed,
        claimable: reward.claimable,
    })), [
        { target: '30', reached: true, claimed: true, claimable: false },
        { target: '60', reached: true, claimed: false, claimable: true },
        { target: '90', reached: false, claimed: false, claimable: false },
    ]);
});

test('charity progress keeps known pending rewards when another milestone is reached', () => {
    const entry = makeEntry({
        flowStatus: '2',
        donatedLove: '91',
        progressRewards: [
            { target: '30', status: '1', reward: { item_id: '80013', count: '1' } },
            { target: '60', status: '1', reward: { item_id: '1002', count: '50' } },
            { target: '90', status: '1', reward: { item_id: '80013', count: '2' } },
        ],
    });
    const progressState = reconcileCharityProgressState(entry, {
        activityId: '2026090901',
        initialized: true,
        claimedProgressTargets: ['30'],
        pendingProgressTargets: ['60'],
    });

    assert.deepEqual(progressState.claimedProgressTargets, ['30']);
    assert.deepEqual(progressState.pendingProgressTargets, ['60', '90']);
});

test('charity progress claim state survives a process restart', (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-charity-state-'));
    const filePath = path.join(tempDir, 'activity-center-state.json');
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    persistCharityRedFlowerState({
        activityId: '2026090901',
        initialized: true,
        claimedProgressTargets: ['30'],
        pendingProgressTargets: ['60'],
    }, '2026090901', 'test-account', { filePath });

    assert.deepEqual(
        loadCharityRedFlowerState('2026090901', 'test-account', { filePath }),
        {
            activityId: '2026090901',
            initialized: true,
            claimedProgressTargets: ['30'],
            pendingProgressTargets: ['60'],
        },
    );
});
