// 施肥写入农作物流水（core/src/services/farm/api.ts）、每日福利罐头写入牧场流水
// （core/src/services/ranch/daily-benefit.ts）。网络层全部替换为固定回包，不连接服务端。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-fertilize-can-test-'));
process.env.FARM_DATA_DIR = tmpDir;
process.env.FARM_ACCOUNT_ID = 'fert-test';
const ACCOUNT = 'fert-test';

const networkPath = require.resolve('../dist/utils/network');
const protoPath = require.resolve('../dist/utils/proto');
const utilsPath = require.resolve('../dist/utils/utils');

const outcomes = [];
require.cache[networkPath] = {
    id: networkPath,
    filename: networkPath,
    loaded: true,
    exports: {
        sendMsgAsync: async () => {
            const next = outcomes.shift();
            if (!next) return { body: {} };
            return { body: await next() };
        },
        getUserState: () => ({ gid: 1 }),
    },
};
require.cache[protoPath] = {
    id: protoPath,
    filename: protoPath,
    loaded: true,
    exports: {
        types: {
            FertilizeRequest: { create: value => value, encode: () => ({ finish: () => Buffer.alloc(0) }) },
            FertilizeReply: { decode: body => body },
        },
    },
};
// 账本按服务器时区切天，需要真实的日期工具；只把等待类函数换成立即返回
const realUtils = require(utilsPath);
require.cache[utilsPath].exports = { ...realUtils, sleep: async () => {}, randomDelay: async () => {}, log() {}, logWarn() {} };

const { fertilize, fertilizeBatch, fertilizeOrganicLoop } = require('../dist/services/farm/api');
const { readFarmLedger } = require('../dist/services/operation-ledger');

function reset() {
    outcomes.length = 0;
    fs.rmSync(path.join(tmpDir, 'farm-ledger'), { recursive: true, force: true });
}

function fertilizeEntries() {
    return readFarmLedger(ACCOUNT, { days: 1, op: 'fertilize' }).entries;
}

function gatewayError(code) {
    return Object.assign(new Error(`PlantService.Fertilize 错误: code=${code}`), { code });
}

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test('批量施肥只把回包确认的目标地块记入农作物流水', async () => {
    reset();
    outcomes.push(() => ({ land: [{ id: 1 }, { id: 9 }] }));
    await fertilizeBatch([1, 2], 1011);
    const entries = fertilizeEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fertilizerName, '普通化肥');
    assert.equal(entries[0].times, 1);
    assert.deepEqual(entries[0].landIds, [1], '回包中不在请求里的地块不算');
});

test('批量施肥没有成功地块或请求失败时不入账', async () => {
    reset();
    outcomes.push(() => ({ land: [] }));
    await fertilizeBatch([1], 1012);
    outcomes.push(() => { throw gatewayError(1000019); });
    await assert.rejects(fertilizeBatch([1], 1012));
    assert.equal(fertilizeEntries().length, 0);
});

test('逐块施肥跳过不可施肥地块，成功部分合并成一条', async () => {
    reset();
    outcomes.push(() => ({}), () => { throw gatewayError(1001025); }, () => ({}));
    assert.equal(await fertilize([1, 2, 3], 1011, false), 2);
    const entries = fertilizeEntries();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].landIds, [1, 3]);
    assert.equal(entries[0].times, 2);
});

test('逐块施肥中途抛错时，已成功的施肥仍然入账', async () => {
    reset();
    outcomes.push(() => ({}), () => { throw gatewayError(1000019); });
    await assert.rejects(fertilize([1, 2, 3], 1011, true));
    const entries = fertilizeEntries();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].landIds, [1]);
});

test('有机肥循环按成功次数记账，地块去重', async () => {
    reset();
    outcomes.push(() => ({}), () => ({}), () => ({}), () => { throw gatewayError(1000019); });
    assert.equal(await fertilizeOrganicLoop([5, 6], false), 3);
    const entries = fertilizeEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fertilizerName, '有机化肥');
    assert.equal(entries[0].times, 3);
    assert.equal(entries[0].landCount, 2);
    assert.deepEqual(entries[0].landIds, [5, 6]);
});

function dailyBenefitHarness(options = {}) {
    const recorded = [];
    const reward = { id: 80021, count: 5 };
    const good = {
        goods_id: '2001', is_free: true, price: { count: 0 }, is_available: true, is_owned: false, ad_only: false,
        purchase_limit: { limit_type: 1, limit_count: '1', bought_count: options.claimed ? '1' : '0' },
        reward_items: [reward],
    };
    const imports = {
        './transport': {
            inScene: fn => fn(),
            rpc: async (route) => {
                if (route === 'canShop') return { goods_list: [good] };
                if (options.buyError) throw options.buyError;
                return { success: true, goods_id: '2001', reward_items: [reward], purchase_limit: { limit_type: 1, bought_count: '1' } };
            },
        },
        './model': {
            quantity: value => String(value ?? '0'),
            itemDto: item => ({ id: Number(item.id), count: String(item.count), name: '罐头(1小时)' }),
            signature: items => items.map(item => `${item.id}:${item.count}`).sort().join('|'),
            error: (code, message) => Object.assign(new Error(message), { code }),
        },
        './operation-state': { forCurrentAccount: () => ({ withLock: fn => fn(), spend: (_, fn) => fn() }) },
        './daily-share': { getState: () => ({ dateKey: '2026-11-28' }) },
        '../operation-ledger': { recordRanchOperation: entry => recorded.push(entry) },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/services/ranch/daily-benefit.js'), 'utf8'), {
        exports: module.exports, module, BigInt, require: name => { assert.ok(name in imports, name); return imports[name]; },
    });
    return { claim: module.exports.claim, recorded };
}

test('每日福利罐头领取成功后记入牧场流水', async () => {
    const { claim, recorded } = dailyBenefitHarness();
    const result = await claim();
    assert.equal(result.claimed, true);
    // 记录对象来自 vm 沙箱，原型不同，序列化后再比较
    assert.deepEqual(JSON.parse(JSON.stringify(recorded)), [{
        action: 'claimDailyBenefit',
        label: '领取每日福利',
        completed: 1,
        costs: [],
        rewards: [{ id: 80021, name: '罐头(1小时)', count: 5 }],
    }]);
});

test('每日福利已领取或领取失败时不写牧场流水', async () => {
    const claimed = dailyBenefitHarness({ claimed: true });
    assert.equal((await claimed.claim()).skipped, true);
    assert.equal(claimed.recorded.length, 0);

    const failed = dailyBenefitHarness({ buyError: new Error('network down') });
    await assert.rejects(failed.claim());
    assert.equal(failed.recorded.length, 0);
});
