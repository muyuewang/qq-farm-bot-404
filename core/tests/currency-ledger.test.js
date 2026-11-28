const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// 账本按 FARM_DATA_DIR 定位数据目录，必须在加载模块前指向临时目录
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'currency-ledger-test-'));
process.env.FARM_DATA_DIR = tmpDir;

const {
    ATTRIBUTION_LOGIN_SYNC,
    accountKey,
    dateKeyOf,
    describeMethod,
    observeBalance,
    observeDelta,
    pickAttribution,
    readLedger,
    resetLedgerWritersForTest,
} = require('../dist/services/currency-ledger');

const ACCOUNT = 'ledger-test';
const DAY_MS = 24 * 60 * 60 * 1000;
const BUY = { key: 'ShopService.BuyGoods', label: '商店购买', method: 'ShopService.BuyGoods' };
const SELL = { key: 'ItemService.Sell', label: '出售', method: 'ItemService.Sell' };

function accountDir() {
    return path.join(tmpDir, 'currency-ledger', ACCOUNT);
}

function reset() {
    resetLedgerWritersForTest();
    fs.rmSync(accountDir(), { recursive: true, force: true });
}

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

test('首次观测只建立基线，不产生流水', () => {
    reset();
    assert.equal(observeBalance(ACCOUNT, 'gold', 100000, BUY), null);
    assert.equal(readLedger(ACCOUNT).entries.length, 0);
});

test('余额变化按差值记账并带上原因', () => {
    reset();
    observeBalance(ACCOUNT, 'gold', 100000, null);
    const entry = observeBalance(ACCOUNT, 'gold', 98752, { ...BUY, candidates: ['PlantService.Plant'] });
    assert.equal(entry.delta, -1248);
    assert.equal(entry.balanceBefore, 100000);
    assert.equal(entry.balanceAfter, 98752);
    assert.equal(entry.reason, '商店购买');
    assert.equal(entry.method, 'ShopService.BuyGoods');
    assert.deepEqual(entry.candidates, ['PlantService.Plant']);
    assert.deepEqual(readLedger(ACCOUNT).entries.map(item => item.id), [entry.id]);
});

test('同一笔变化被多条推送重复报告时只记一次', () => {
    reset();
    observeBalance(ACCOUNT, 'gold', 100000, null);
    observeBalance(ACCOUNT, 'gold', 174400, SELL);
    assert.equal(observeBalance(ACCOUNT, 'gold', 174400, SELL), null);
    assert.equal(readLedger(ACCOUNT).entries.length, 1);
});

test('缺少原因时标为服务端推送', () => {
    reset();
    observeBalance(ACCOUNT, 'coupon', 10, null);
    assert.equal(observeBalance(ACCOUNT, 'coupon', 70, null).reasonKey, 'server_push');
});

test('只有增量的推送在本次进程建立可信余额前忽略', () => {
    reset();
    assert.equal(observeDelta(ACCOUNT, 'coupon', 60, BUY), null);
    observeBalance(ACCOUNT, 'coupon', 2000, null);
    const entry = observeDelta(ACCOUNT, 'coupon', -300, BUY);
    assert.equal(entry.delta, -300);
    assert.equal(entry.balanceAfter, 1700);
});

test('重启后首次观测与上次保存余额不同，记为登录校准', () => {
    reset();
    observeBalance(ACCOUNT, 'goldBean', 500, null);
    resetLedgerWritersForTest();
    assert.equal(observeDelta(ACCOUNT, 'goldBean', 10, BUY), null, '重启后未重新观测前不能用增量记账');
    const entry = observeBalance(ACCOUNT, 'goldBean', 800, BUY);
    assert.equal(entry.delta, 300);
    assert.equal(entry.reasonKey, ATTRIBUTION_LOGIN_SYNC.key);
    const next = observeBalance(ACCOUNT, 'goldBean', 780, BUY);
    assert.equal(next.reason, '商店购买');
});

test('非法余额与未知货币不记账', () => {
    reset();
    observeBalance(ACCOUNT, 'gold', 100, null);
    assert.equal(observeBalance(ACCOUNT, 'gold', -1, BUY), null);
    assert.equal(observeBalance(ACCOUNT, 'gold', Number.NaN, BUY), null);
    assert.equal(observeBalance(ACCOUNT, 'ticket', 5, BUY), null);
    assert.equal(observeBalance('', 'gold', 200, BUY), null);
    assert.equal(readLedger(ACCOUNT).entries.length, 0);
});

test('汇总按货币和原因统计收支，并支持货币筛选', () => {
    reset();
    observeBalance(ACCOUNT, 'gold', 100000, null);
    observeBalance(ACCOUNT, 'coupon', 100, null);
    observeBalance(ACCOUNT, 'gold', 98752, BUY);
    observeBalance(ACCOUNT, 'gold', 97504, BUY);
    observeBalance(ACCOUNT, 'gold', 171904, SELL);
    observeBalance(ACCOUNT, 'coupon', 160, null);

    const all = readLedger(ACCOUNT);
    assert.equal(all.summary.gold.income, 74400);
    assert.equal(all.summary.gold.expense, 2496);
    assert.equal(all.summary.gold.net, 71904);
    assert.equal(all.summary.gold.count, 3);
    assert.deepEqual(all.summary.gold.reasons.map(r => [r.reasonKey, r.income, r.expense, r.count]), [
        ['ItemService.Sell', 74400, 0, 1],
        ['ShopService.BuyGoods', 0, 2496, 2],
    ]);
    assert.equal(all.summary.coupon.income, 60);

    const couponOnly = readLedger(ACCOUNT, { currency: 'coupon' });
    assert.deepEqual(couponOnly.entries.map(e => e.currency), ['coupon']);
    assert.deepEqual(Object.keys(couponOnly.summary), ['coupon']);
});

test('按天数筛选，超出范围的历史不返回', () => {
    reset();
    const now = Date.now();
    observeBalance(ACCOUNT, 'gold', 1000, null, now - 3 * DAY_MS);
    observeBalance(ACCOUNT, 'gold', 900, BUY, now - 3 * DAY_MS);
    observeBalance(ACCOUNT, 'gold', 800, BUY, now);
    assert.equal(readLedger(ACCOUNT, { days: 1, now }).entries.length, 1);
    assert.equal(readLedger(ACCOUNT, { days: 7, now }).entries.length, 2);
    assert.equal(readLedger(ACCOUNT, { days: 999, now }).days, 30);
});

test('游标分页按时间倒序且不重复', () => {
    reset();
    const base = Date.now() - 60000;
    observeBalance(ACCOUNT, 'gold', 1000, null, base);
    for (let i = 1; i <= 7; i++) observeBalance(ACCOUNT, 'gold', 1000 + i, BUY, base + i * 1000);
    const page1 = readLedger(ACCOUNT, { limit: 3 });
    const page2 = readLedger(ACCOUNT, { limit: 3, before: page1.nextCursor });
    const page3 = readLedger(ACCOUNT, { limit: 3, before: page2.nextCursor });
    const balances = [...page1.entries, ...page2.entries, ...page3.entries].map(e => e.balanceAfter);
    assert.deepEqual(balances, [1007, 1006, 1005, 1004, 1003, 1002, 1001]);
    assert.equal(page1.hasMore, true);
    assert.equal(page3.hasMore, false);
    assert.equal(page3.nextCursor, '');
    assert.equal(page2.cursorInvalid, false);
});

test('游标不在查询范围内时标记失效，而不是伪装成没有更多数据', () => {
    reset();
    const now = Date.now();
    observeBalance(ACCOUNT, 'gold', 1000, null, now - 2 * DAY_MS);
    observeBalance(ACCOUNT, 'gold', 900, BUY, now - 2 * DAY_MS);
    observeBalance(ACCOUNT, 'gold', 800, BUY, now);
    const oldCursor = readLedger(ACCOUNT, { days: 7, now }).entries[1].id;
    const today = readLedger(ACCOUNT, { days: 1, now, before: oldCursor });
    assert.equal(today.cursorInvalid, true);
    assert.deepEqual(today.entries, []);
    assert.equal(today.hasMore, false);
    assert.equal(readLedger(ACCOUNT, { days: 1, now }).cursorInvalid, false);
});

test('写入时清理超过 30 天的流水文件，损坏行被跳过', () => {
    reset();
    const now = Date.now();
    fs.mkdirSync(accountDir(), { recursive: true });
    const oldFile = path.join(accountDir(), `${dateKeyOf(now - 40 * DAY_MS)}.ndjson`);
    fs.writeFileSync(oldFile, '{}\n');
    fs.writeFileSync(path.join(accountDir(), `${dateKeyOf(now)}.ndjson`), '{"broken\n');
    observeBalance(ACCOUNT, 'gold', 10, null, now);
    observeBalance(ACCOUNT, 'gold', 20, SELL, now);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(readLedger(ACCOUNT, { now }).entries.length, 1);
});

test('推断原因：等待回包的写请求优先，其次 2 秒内完成的请求', () => {
    const pending = [
        { serviceName: 'gamepb.itempb.ItemService', methodName: 'Bag', at: 1001 },
        { serviceName: 'gamepb.plantpb.PlantService', methodName: 'Harvest', at: 1000 },
        { serviceName: 'gamepb.shoppb.ShopService', methodName: 'BuyGoods', at: 900 },
    ];
    const fromPending = pickAttribution(pending, [], 1100);
    assert.equal(fromPending.key, 'PlantService.Harvest');
    assert.equal(fromPending.label, '收获');
    assert.deepEqual(fromPending.candidates, ['ShopService.BuyGoods', 'ItemService.Bag']);

    const recent = [{ serviceName: 'gamepb.plantpb.PlantService', methodName: 'UpgradeLand', at: 1000 }];
    assert.equal(pickAttribution([], recent, 2900).label, '升级土地');
    assert.equal(pickAttribution([], recent, 3100).key, 'server_push');
});

test('未登记的方法原样显示服务与方法名', () => {
    assert.deepEqual(describeMethod('gamepb.ranchpb.RanchService', 'BuyAnimal'), {
        key: 'RanchService.BuyAnimal', label: 'RanchService.BuyAnimal', method: 'RanchService.BuyAnimal',
    });
});

test('账号目录名只接受安全字符，其余哈希化', () => {
    assert.equal(accountKey('12'), '12');
    assert.match(accountKey('../escape'), /^[0-9a-f]{32}$/);
});
