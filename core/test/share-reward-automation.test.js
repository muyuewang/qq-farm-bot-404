const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const store = require('../src/models/store');

const source = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
const start = source.indexOf('        if (shareRewardShareEnabled || claimShareDailyEnabled || claimShareMilestonesEnabled)');
const end = source.indexOf('        if (buyRainPoemBottleEnabled', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

async function run({ enabled = true, awarded = false, active = true, fail = false } = {}) {
    const calls = [];
    const errors = [];
    let shared = awarded;
    const service = {
        isShareRewardActive: () => active,
        getShareRewardActivity: async () => {
            calls.push('query');
            return { active, daily: { firstShareAwarded: shared, rewardClaimed: true },
                milestones: [{ state: shared ? 2 : 1 }] };
        },
        operateShareReward: async (action) => {
            calls.push(action);
            if (fail) throw new Error('fixture failure');
            if (action === 'share') shared = true;
        },
    };
    await vm.runInNewContext(`(async () => { ${block} })()`, {
        shareRewardShareEnabled: enabled, claimShareDailyEnabled: false,
        claimShareMilestonesEnabled: enabled,
        require: () => service, log: (...args) => errors.push(args),
    });
    return { calls, errors };
}

test('automatic share refreshes score before claiming newly unlocked milestones', async () => {
    assert.deepEqual((await run()).calls, ['query', 'share', 'query', 'milestones']);
});

test('automatic share skips awarded, disabled, and inactive states', async () => {
    assert.deepEqual((await run({ awarded: true })).calls, ['query', 'milestones']);
    assert.deepEqual((await run({ enabled: false })).calls, []);
    assert.deepEqual((await run({ active: false })).calls, []);
});

test('share failures are observable and contained', async () => {
    const result = await run({ fail: true });
    assert.deepEqual(result.calls, ['query', 'share']);
    assert.equal(result.errors.length, 1);
});

test('automatic share defaults off and is cleared outside inclusive activity window', () => {
    assert.equal(store.getDefaultAccountConfig().automation.share_reward_share, false);
    for (const [now, expected] of [[1790179199, false], [1790179200, true], [1791820799, true], [1791820800, false]]) {
        const automation = { share_reward_share: true };
        store._test.disableHiddenActivityAutomation(automation, now);
        assert.equal(automation.share_reward_share, expected);
    }
});

test('expired share switch is persisted off at startup and when activity ends', () => {
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    for (const startup of [true, false]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-reward-expiry-'));
        try {
            fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accountConfigs: {
                fixture: { automation: { share_reward_share: true } },
            } }));
            execFileSync(process.execPath, ['-e', `
                const assert = require('node:assert/strict');
                Date.now = () => ${startup ? 1791820800 : 1790179200} * 1000;
                const store = require('./src/models/store');
                Date.now = () => 1791820800 * 1000;
                store.persistInactiveActivityAutomation();
                assert.equal(store.getAutomation('fixture').share_reward_share, false);
            `], { cwd: path.join(__dirname, '..'), env: { ...process.env, FARM_DATA_DIR: dir }, stdio: 'pipe' });
            const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json')));
            assert.equal(saved.accountConfigs.fixture.automation.share_reward_share, false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});
