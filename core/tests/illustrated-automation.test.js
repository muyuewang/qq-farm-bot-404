const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

function harness(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'illustrated-auto-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const clock = { now: 1000, enabled: true, fail: 0, refreshFailure: false, diskFull: false };
    const env = { FARM_ACCOUNT_ID: 'first' };
    const accounts = new Map();
    const calls = [];
    const logs = [];

    function books() {
        if (!accounts.has(env.FARM_ACCOUNT_ID)) accounts.set(env.FARM_ACCOUNT_ID, {
            1: [{ level: 29, can_claim: true, claimed: false }],
            2: [{ level: 12, can_claim: true, claimed: false }],
        });
        return accounts.get(env.FARM_ACCOUNT_ID);
    }

    const service = {
        getIllustratedLevels: async type => ({ level_list: books()[type] }),
        claimIllustratedRewards: async (type, options) => {
            if (!options.canContinue()) return null;
            const available = books()[type].filter(level => level.can_claim && !level.claimed);
            if (!available.length) return null;
            options.beforeSend(available.map(level => level.level));
            calls.push([env.FARM_ACCOUNT_ID, type]);
            if (clock.fail === type) throw new Error('reply timeout');
            for (const level of available) { level.claimed = true; level.can_claim = false; }
            const dto = type => ({ levels: books()[type].map(level => ({ level: level.level, claimed: level.claimed })) });
            return {
                claimedLevels: available.map(level => level.level), rewards: [{ itemId: 1002, count: 200 }],
                snapshot: clock.refreshFailure ? null : { crop: dto(1), mutant: dto(2) },
            };
        },
    };

    function load() {
        const filename = require.resolve('../dist/services/illustrated-automation');
        const localRequire = createRequire(filename);
        const module = { exports: {} };
        const overrides = {
            '../config/runtime-paths': { getDataDir: () => dir },
            '../models/store': { getAutomation: () => ({ farm_illustrated: clock.enabled }) },
            './illustrated': service,
            './json-db': { writeJsonFileAtomic(file, value) {
                if (clock.diskFull) throw new Error('disk full');
                localRequire('./json-db').writeJsonFileAtomic(file, value);
            } },
            '../utils/utils': { log: (...args) => logs.push(args), logWarn: (...args) => logs.push(args) },
        };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports, process: { env },
            Date: class extends Date { static now() { return clock.now; } },
            require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
        }, { filename });
        return module.exports;
    }

    return { clock, env, books, calls, logs, load, dir };
}

test('关闭开关不发包；开启后两本图鉴各领一次并节流并发检查', async (t) => {
    const h = harness(t);
    const auto = h.load();
    h.clock.enabled = false;
    assert.equal(auto.isDue(), false);
    await auto.run();
    assert.equal(h.calls.length, 0);
    assert.deepEqual(fs.readdirSync(h.dir), []);

    h.clock.enabled = true;
    await Promise.all([auto.run(), auto.run(), auto.run()]);
    assert.deepEqual(h.calls, [['first', 1], ['first', 2]]);
    assert.equal(auto.isDue(), false);
    h.clock.now += 300_000;
    assert.equal(auto.isDue(), true);
    await auto.run();
    assert.equal(h.calls.length, 2, '已领取的等级不能再次发包');
});

test('结果未知的记录跨重启保留，只有服务端确认已领才解除', async (t) => {
    const h = harness(t);
    h.clock.fail = 1;
    await h.load().run();
    assert.deepEqual(h.calls, [['first', 1], ['first', 2]]);

    h.clock.fail = 0;
    await h.load().run();
    assert.equal(h.calls.length, 2, '重启后不能盲目重放超时的领奖');

    h.books()[1][0].claimed = true;
    h.books()[1][0].can_claim = false;
    await h.load().run();
    assert.equal(h.calls.length, 2);
    assert.ok(h.logs.some(row => row[2]?.result === 'reconciled'));
});

test('回读失败时保留待核对记录，直到后续查询确认已领取', async (t) => {
    const h = harness(t);
    h.clock.refreshFailure = true;
    await h.load().run();
    assert.equal(h.calls.length, 2);
    h.clock.refreshFailure = false;
    await h.load().run();
    assert.equal(h.calls.length, 2);
    assert.equal(h.logs.filter(row => row[2]?.result === 'reconciled').length, 2);
});

test('待核对记录按账号隔离，排队后被关闭的检查不发包', async (t) => {
    const h = harness(t);
    h.clock.fail = 1;
    const auto = h.load();
    await auto.run();
    h.clock.fail = 0;
    h.env.FARM_ACCOUNT_ID = 'second';
    await auto.run();
    assert.deepEqual(h.calls, [['first', 1], ['first', 2], ['second', 1], ['second', 2]]);

    h.env.FARM_ACCOUNT_ID = 'third';
    await auto.run({ canContinue: () => false });
    assert.equal(h.calls.length, 4);
});

test('待核对记录落盘失败会阻止发包，格式损坏时直接报错', async (t) => {
    const h = harness(t);
    h.clock.diskFull = true;
    await h.load().run();
    assert.equal(h.calls.length, 0);

    h.clock.diskFull = false;
    h.clock.fail = 1;
    await h.load().run();
    const dir = path.join(h.dir, 'illustrated-automation');
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    fs.writeFileSync(file, JSON.stringify({ 1: { levels: [], createdAt: 1 } }));
    const before = h.calls.length;
    await assert.rejects(h.load().run(), /待核对记录格式错误/);
    assert.equal(h.calls.length, before);
});

test('农场图鉴开关与牧场图鉴开关按账号独立保存', () => {
    const { DEFAULT_ACCOUNT_CONFIG, globalConfig, normalizeAccountConfig } = require('../dist/models/store/shared-state');
    const { applyConfigSnapshot, getAccountConfigSnapshot } = require('../dist/models/store/account-config');
    const first = '__illustrated_first__';
    const second = '__illustrated_second__';
    try {
        assert.equal(DEFAULT_ACCOUNT_CONFIG.automation.farm_illustrated, true);
        assert.equal(normalizeAccountConfig({}).automation.farm_illustrated, true);
        applyConfigSnapshot({ automation: { farm_illustrated: false, ranch_illustrated: true } }, { accountId: first, persist: false });
        applyConfigSnapshot({ automation: { farm_illustrated: true, ranch_illustrated: false } }, { accountId: second, persist: false });
        const a = getAccountConfigSnapshot(first).automation;
        const b = getAccountConfigSnapshot(second).automation;
        assert.deepEqual([a.farm_illustrated, a.ranch_illustrated], [false, true]);
        assert.deepEqual([b.farm_illustrated, b.ranch_illustrated], [true, false]);
    } finally {
        delete globalConfig.accountConfigs[first];
        delete globalConfig.accountConfigs[second];
    }
});

test('手动领奖复用同一条串行链，跳过无可领并支持发送前取消', async () => {
    const filename = require.resolve('../dist/services/illustrated');
    const localRequire = createRequire(filename);
    const protobuf = localRequire('protobufjs');
    const root = new protobuf.Root().loadSync(path.join(__dirname, '../src/proto/illustratedpb.proto'), { keepCase: true });
    const types = Object.fromEntries(['GetIllustratedLevelListV2Request', 'GetIllustratedLevelListV2Reply', 'ClaimAllRewardsV2Request', 'ClaimAllRewardsV2Reply', 'GetIllustratedListV2Request', 'GetIllustratedListV2Reply'].map(name => [name, root.lookupType(`gamepb.illustratedpb.${name}`)]));
    const sent = [];
    const levels = [{ level: 29, can_claim: true, claimed: false }];
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    mock('utils/proto', { types });
    mock('utils/utils', { toNum: Number, toLong: value => value });
    mock('config/gameConfig', { getItemById: id => ({ name: `物品${id}` }), getItemImageById: () => '', getPlantBySeedId: () => null, getPlantByFruitId: () => null, getPlantNameBySeedId: () => '', getIllustratedTypeByParam: () => '', getIllustratedSortByParam: () => 1, getIllustratedBuffsByLevel: () => [], getIllustratedBuffs: () => [], getAllSeeds: () => [] });
    mock('services/farm', { getAvailableSeeds: async () => [] });
    mock('utils/network', { sendMsgAsync: async (_service, method, body, options) => {
        const request = types[`${method}Request`].decode(body);
        if (method === 'ClaimAllRewardsV2') {
            const blocked = options.beforeSend?.();
            if (blocked) throw blocked;
            sent.push(request.type);
            for (const level of levels) { level.claimed = true; level.can_claim = false; }
            return { body: types[`${method}Reply`].encode({ claimed_level_ids: [29], total_rewards: [{ id: 1002, count: 200 }] }).finish() };
        }
        return { body: types[`${method}Reply`].encode(method === 'GetIllustratedLevelListV2'
            ? { level_list: levels }
            : { list: [] }).finish() };
    } });
    delete require.cache[filename];
    const service = require(filename);

    let cancelled = false;
    let beforeSendLevels = null;
    const result = await service.claimIllustratedRewards(1, {
        canContinue: () => !cancelled,
        skipUnavailable: true,
        beforeSend: levels => { beforeSendLevels = levels; },
    });
    assert.deepEqual(beforeSendLevels, [29]);
    assert.deepEqual(sent, [1]);
    assert.deepEqual(result.claimedLevels, [29]);

    assert.equal(await service.claimIllustratedRewards(1, { skipUnavailable: true }), null, '没有可领等级时静默跳过');
    await assert.rejects(service.claimIllustratedRewards(1), /暂无/);
    cancelled = true;
    assert.equal(await service.claimIllustratedRewards(1, { canContinue: () => !cancelled }), null);
    assert.equal(sent.length, 1, '关闭开关后不能发领奖包');
});
