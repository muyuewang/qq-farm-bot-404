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
    recordFertilize,
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

function actionOf(summary, key) {
    return summary.actions.find((a) => a.key === key);
}

test('农场汇总只列发生过的动作，按次数排序，覆盖整个时间范围且不随筛选变化', () => {
    reset();
    recordBuySeed({ seedId: 20104, seedName: '非洲菊', count: 2, totalCost: 2496, unitPrice: 1248 });
    recordPlant({ seedId: 20104, seedName: '非洲菊', landCount: 1 });
    recordPlant({ seedId: 20104, seedName: '非洲菊', landCount: 1 });
    recordHarvest({ harvestCount: 2, harvestInfo: [{ landId: 1, exp: 30 }, { landId: 2, exp: 30 }] });
    recordSell({ items: [{ id: 10104, name: '非洲菊', count: 1200 }, { id: 10105, name: '玫瑰', count: 300 }], goldEarned: 50000 });

    const all = readFarmLedger(ACCOUNT, { days: 1 });
    const { summary } = all;
    assert.equal(summary.expLabel, '经验');
    assert.deepEqual(summary.currency, { id: 1001, name: '金币' });
    assert.deepEqual(summary.actions.map((a) => a.key), ['plant', 'buy_seed', 'harvest', 'sell'], '次数多的在前，同次数按流程顺序，未发生的施肥不出现');
    assert.deepEqual(actionOf(summary, 'buy_seed'), { key: 'buy_seed', label: '买种子', times: 1, exp: 0, income: 0, expense: 2496 });
    assert.deepEqual(actionOf(summary, 'plant'), { key: 'plant', label: '种植', times: 2, exp: 0, income: 0, expense: 0 });
    assert.deepEqual(actionOf(summary, 'harvest'), { key: 'harvest', label: '收获', times: 1, exp: 60, income: 0, expense: 0 });
    assert.deepEqual(actionOf(summary, 'sell'), { key: 'sell', label: '出售', times: 1, exp: 0, income: 50000, expense: 0 });
    assert.deepEqual(summary.total, { times: 5, exp: 60, income: 50000, expense: 2496 });

    const sell = all.entries.find((e) => e.op === 'sell');
    assert.deepEqual(sell.metrics, { exp: 0, income: 50000, expense: 0 }, '明细附带同口径指标');
    assert.equal(sell.actionLabel, '出售');
    assert.deepEqual(all.entries.find((e) => e.op === 'harvest').metrics, { exp: 60, income: 0, expense: 0 });

    const filtered = readFarmLedger(ACCOUNT, { days: 1, op: 'sell' });
    assert.deepEqual(filtered.entries.map((e) => e.op), ['sell']);
    assert.deepEqual(filtered.summary, all.summary);
});

test('筛选中的动作在范围内没有记录时仍保留在汇总里，次数为 0', () => {
    reset();
    recordPlant({ seedId: 1, seedName: 'A', landCount: 1 });
    const result = readFarmLedger(ACCOUNT, { days: 1, op: 'fertilize' });
    assert.deepEqual(result.entries, []);
    assert.deepEqual(actionOf(result.summary, 'fertilize'), { key: 'fertilize', label: '施肥', times: 0, exp: 0, income: 0, expense: 0 });
    assert.equal(actionOf(readFarmLedger(ACCOUNT, { days: 1 }).summary, 'fertilize'), undefined, '不筛选时不列出未发生的动作');
});

test('牧场汇总与农场同一结构：动作用通用短名归类，牧场经验与金券归入标准指标', () => {
    reset();
    recordRanchOperation({ action: 'harvest', label: '牧场收获', completed: 2, costs: [], rewards: [{ id: 7101, name: '鸡蛋', count: 4 }, { id: 1102, name: '牧场经验', count: 40 }] });
    recordRanchOperation({ action: 'harvest', label: '牧场收获', completed: 1, costs: [], rewards: [{ id: 7101, name: '鸡蛋', count: 2 }, { id: 1102, name: '牧场经验', count: 20 }] });
    recordRanchOperation({ action: 'sell', label: '出售牧场产物', completed: 6, costs: [{ id: 7101, name: '鸡蛋', count: 6 }], rewards: [{ id: 1007, name: '金券', count: 900 }] });
    recordRanchOperation({ action: 'buy', label: '购买火鸡 ×1', completed: 1, costs: [{ id: 1007, name: '金券', count: 300 }], rewards: [{ id: 1102, name: '牧场经验', count: 5 }] });
    recordRanchOperation({ action: 'mysteryAction', label: '未登记动作', completed: 1, costs: [], rewards: [] });

    const result = readRanchLedger(ACCOUNT, { days: 1 });
    const { summary } = result;
    assert.equal(summary.expLabel, '牧场经验');
    assert.deepEqual(summary.currency, { id: 1007, name: '金券' });
    assert.deepEqual(summary.actions, [
        { key: 'harvest', label: '收获', times: 2, exp: 60, income: 0, expense: 0 },
        { key: 'buy', label: '购买', times: 1, exp: 5, income: 0, expense: 300 },
        { key: 'mysteryAction', label: 'mysteryAction', times: 1, exp: 0, income: 0, expense: 0 },
        { key: 'sell', label: '出售', times: 1, exp: 0, income: 900, expense: 0 },
    ], '按次数从多到少，次数相同按动作键排序；具体对象名不进入分类');
    assert.deepEqual(summary.total, { times: 5, exp: 65, income: 900, expense: 300 });
    assert.deepEqual(Object.keys(summary).sort(), ['actions', 'currency', 'expLabel', 'standardItemIds', 'total'], '汇总不再累计其他物品，物品只在各条明细里出现');
    const buy = result.entries.find((e) => e.action === 'buy');
    assert.deepEqual(buy.metrics, { exp: 5, income: 0, expense: 300 });
    assert.equal(buy.actionLabel, '购买');
    assert.equal(buy.label, '购买火鸡 ×1', '明细保留具体内容');
});

test('明细按服务器时区标注日期，并返回筛选后的逐日条数', () => {
    reset();
    const now = Date.now();
    recordPlant({ seedId: 1, seedName: 'A', landCount: 1 }, now - 2 * DAY_MS);
    recordPlant({ seedId: 1, seedName: 'A', landCount: 1 }, now);
    recordSell({ items: [], goldEarned: 1 }, now);
    const result = readFarmLedger(ACCOUNT, { days: 7, now });
    const today = result.today;
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(result.entries[0].day, today);
    const olderDay = result.entries[result.entries.length - 1].day;
    assert.notEqual(olderDay, today);
    assert.deepEqual(result.dayCounts, { [today]: 2, [olderDay]: 1 });

    const filtered = readFarmLedger(ACCOUNT, { days: 7, now, op: 'plant', limit: 1 });
    assert.equal(filtered.entries.length, 1, '分页只影响明细');
    assert.deepEqual(filtered.dayCounts, { [today]: 1, [olderDay]: 1 }, '逐日条数按筛选后的全部记录计算');
});

test('施肥一次调用合并成一条，次数与去重地块数分开记录', () => {
    reset();
    recordFertilize({ fertilizerId: 1012, landIds: [1, 2, 1, 2, 1] });
    recordFertilize({ fertilizerId: 1011, landIds: [3] });
    recordFertilize({ fertilizerId: 1011, landIds: [] });

    const result = readFarmLedger(ACCOUNT, { days: 1 });
    assert.equal(result.entries.length, 2, '没有成功施肥的调用不入账');
    const organic = result.entries.find((e) => e.fertilizerId === 1012);
    assert.equal(organic.op, 'fertilize');
    assert.equal(organic.fertilizerName, '有机化肥');
    assert.equal(organic.times, 5);
    assert.equal(organic.landCount, 2);
    assert.deepEqual(organic.landIds, [1, 2]);
    const normal = result.entries.find((e) => e.fertilizerId === 1011);
    assert.equal(normal.fertilizerName, '普通化肥');
    assert.equal(normal.times, 1);

    assert.deepEqual(actionOf(result.summary, 'fertilize'), { key: 'fertilize', label: '施肥', times: 2, exp: 0, income: 0, expense: 0 });
    assert.deepEqual(readFarmLedger(ACCOUNT, { op: 'fertilize' }).entries.map((e) => e.op), ['fertilize', 'fertilize']);
});
