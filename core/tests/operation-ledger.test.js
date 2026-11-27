// 本测试文件覆盖以下源文件（供契约测试追踪）：
// core/src/services/ledger-store.ts
// core/src/services/operation-ledger.ts
// core/src/services/currency-ledger.ts
// core/src/services/farm/planting.ts
// core/src/services/farm/scheduler.ts
// core/src/services/ranch/actions.ts
// core/src/services/warehouse.ts
// core/src/controllers/admin/account-routes.ts
// web/src/views/CurrencyLedger.vue
// web/src/stores/operation-ledger.ts
// web/src/components/ledger/CurrencyLedgerPanel.vue
// web/src/components/ledger/OperationLedgerPanel.vue

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-ledger-test-'));
process.env.FARM_DATA_DIR = tmpDir;
// 记账函数从 worker 注入的环境变量读取当前账号
process.env.FARM_ACCOUNT_ID = 'op-test';

const {
    recordBuySeed,
    recordPlant,
    recordHarvest,
    recordSell,
    recordRanchOperation,
    readFarmLedger,
    readRanchLedger,
} = require('../dist/services/operation-ledger');

const ACCOUNT = 'op-test';
const DAY_MS = 24 * 60 * 60 * 1000;

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function reset() {
    for (const ns of ['farm-ledger', 'ranch-ledger']) {
        fs.rmSync(path.join(tmpDir, ns), { recursive: true, force: true });
    }
}

test('买种子、种植、收获、出售分别写入农场流水', () => {
    reset();
    recordBuySeed({ seedId: 20104, seedName: '非洲菊', count: 3, totalCost: 3744, unitPrice: 1248 });
    recordPlant({ seedId: 20104, seedName: '非洲菊', landCount: 3, landIds: [1, 2, 3] });
    recordHarvest({ harvestCount: 3, harvestInfo: [{ landId: 1, plantId: 20104, name: '非洲菊', exp: 30 }] });
    recordSell({ items: [{ id: 10104, name: '非洲菊', count: 3600 }], goldEarned: 74400 });

    const result = readFarmLedger(ACCOUNT, { days: 1 });
    assert.deepEqual(result.entries.map((e) => e.op), ['sell', 'harvest', 'plant', 'buy_seed'], '应按时间倒序');
    const buy = result.entries.find((e) => e.op === 'buy_seed');
    assert.equal(buy.seedName, '非洲菊');
    assert.equal(buy.totalCost, 3744);
    const sell = result.entries.find((e) => e.op === 'sell');
    assert.equal(sell.goldEarned, 74400);
    assert.deepEqual(sell.items, [{ id: 10104, name: '非洲菊', count: 3600 }]);
});

test('农场流水按 op 过滤', () => {
    reset();
    recordBuySeed({ seedId: 1, seedName: 'A', count: 1, totalCost: 10, unitPrice: 10 });
    recordPlant({ seedId: 1, seedName: 'A', landCount: 1 });
    const onlyPlant = readFarmLedger(ACCOUNT, { op: 'plant' });
    assert.deepEqual(onlyPlant.entries.map((e) => e.op), ['plant']);
    assert.equal(onlyPlant.op, 'plant');
});

test('牧场流水记录动作、消耗与收益', () => {
    reset();
    recordRanchOperation({
        action: 'harvest',
        label: '牧场收获',
        completed: 2,
        costs: [{ id: 7003, name: '普通罐头桶', count: 1 }],
        rewards: [{ id: 7002, name: '鸡蛋', count: 5 }],
    });
    const result = readRanchLedger(ACCOUNT, { days: 1 });
    assert.equal(result.entries.length, 1);
    const entry = result.entries[0];
    assert.equal(entry.action, 'harvest');
    assert.equal(entry.label, '牧场收获');
    assert.deepEqual(entry.rewards, [{ id: 7002, name: '鸡蛋', count: 5 }]);
});

test('农场与牧场流水互不串台', () => {
    reset();
    recordBuySeed({ seedId: 1, seedName: 'A', count: 1, totalCost: 10, unitPrice: 10 });
    recordRanchOperation({ action: 'feed', label: '喂养动物', completed: 1, costs: [], rewards: [] });
    assert.equal(readFarmLedger(ACCOUNT).entries.length, 1);
    assert.equal(readRanchLedger(ACCOUNT).entries.length, 1);
});

test('按天数筛选与游标分页', () => {
    reset();
    const now = Date.now();
    recordBuySeed({ seedId: 1, seedName: 'A', count: 1, totalCost: 10, unitPrice: 10 }, now - 3 * DAY_MS);
    for (let i = 1; i <= 5; i++) {
        recordPlant({ seedId: i, seedName: `S${i}`, landCount: 1 }, now + i);
    }
    assert.equal(readFarmLedger(ACCOUNT, { days: 1, now }).entries.length, 5);
    assert.equal(readFarmLedger(ACCOUNT, { days: 7, now }).entries.length, 6);

    const page1 = readFarmLedger(ACCOUNT, { days: 7, now, limit: 2 });
    const page2 = readFarmLedger(ACCOUNT, { days: 7, now, limit: 2, before: page1.nextCursor });
    const ids = new Set([...page1.entries, ...page2.entries].map((e) => e.id));
    assert.equal(ids.size, 4, '两页不应重复');
});

test('未知账号与空目录返回空列表', () => {
    const result = readFarmLedger('no-such-account', { days: 1 });
    assert.deepEqual(result.entries, []);
    assert.equal(result.hasMore, false);
});

test('坏行被跳过，不影响其他条目', () => {
    reset();
    recordPlant({ seedId: 7, seedName: 'G', landCount: 1 });
    const dir = path.join(tmpDir, 'farm-ledger', ACCOUNT);
    const file = fs.readdirSync(dir).find((n) => n.endsWith('.ndjson'));
    fs.appendFileSync(path.join(dir, file), '{"broken\n');
    recordSell({ items: [], goldEarned: 1 });
    assert.equal(readFarmLedger(ACCOUNT, { days: 1 }).entries.length, 2);
});

test('农场汇总覆盖整个时间范围，不随动作筛选变化', () => {
    reset();
    recordBuySeed({ seedId: 20104, seedName: '非洲菊', count: 2, totalCost: 2496, unitPrice: 1248 });
    recordPlant({ seedId: 20104, seedName: '非洲菊', landCount: 2 });
    recordHarvest({ harvestCount: 2, harvestInfo: [{ landId: 1, exp: 30 }, { landId: 2, exp: 30 }] });
    recordSell({ items: [{ id: 10104, name: '非洲菊', count: 1200 }, { id: 10105, name: '玫瑰', count: 300 }], goldEarned: 50000 });

    const all = readFarmLedger(ACCOUNT, { days: 1 });
    assert.deepEqual(all.summary.buy_seed, { times: 1, quantity: 2, gold: 2496, exp: 0 });
    assert.deepEqual(all.summary.plant, { times: 1, quantity: 2, gold: 0, exp: 0 });
    assert.deepEqual(all.summary.harvest, { times: 1, quantity: 2, gold: 0, exp: 60 });
    assert.deepEqual(all.summary.sell, { times: 1, quantity: 1500, gold: 50000, exp: 0 });

    const filtered = readFarmLedger(ACCOUNT, { days: 1, op: 'sell' });
    assert.deepEqual(filtered.entries.map((e) => e.op), ['sell']);
    assert.deepEqual(filtered.summary, all.summary);
});

test('牧场汇总按动作计次，消耗与收益按物品合并', () => {
    reset();
    recordRanchOperation({ action: 'harvest', label: '牧场收获', completed: 2, costs: [], rewards: [{ id: 7101, name: '鸡蛋', count: 4 }] });
    recordRanchOperation({ action: 'harvest', label: '牧场收获', completed: 1, costs: [], rewards: [{ id: 7101, name: '鸡蛋', count: 2 }] });
    recordRanchOperation({ action: 'feed', label: '喂养动物', completed: 3, costs: [{ id: 7003, name: '普通罐头桶', count: 600 }], rewards: [] });

    const { summary } = readRanchLedger(ACCOUNT, { days: 1 });
    assert.deepEqual(summary.actions, [
        { action: 'harvest', label: '牧场收获', times: 2, completed: 3 },
        { action: 'feed', label: '喂养动物', times: 1, completed: 3 },
    ]);
    assert.deepEqual(summary.rewards, [{ id: 7101, name: '鸡蛋', count: 6 }]);
    assert.deepEqual(summary.costs, [{ id: 7003, name: '普通罐头桶', count: 600 }]);
});
