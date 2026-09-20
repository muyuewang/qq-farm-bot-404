const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-bag-seeds-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');
const { compareBagSeedGameOrder } = require('../src/utils/bag-seed-order');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function seed(seedId, requiredLevel, options = {}) {
  return {
    seedId,
    requiredLevel,
    count: options.count ?? 1,
    plantSize: options.plantSize ?? 1,
  };
}

test('bag seed priority follows game rarity, exp and id order', () => {
  const result = store.syncBagSeedPriority('game-sort', [
    { ...seed(26032, 1), rarity: 3, plantExp: 1440 },
    { ...seed(20002, 1), rarity: 1, plantExp: 1 },
    { ...seed(20261, 21), rarity: 2, plantExp: 1440 },
    { ...seed(20129, 81), rarity: 2, plantExp: 1680 },
    { ...seed(20329, 1), rarity: 3, plantExp: 688 },
    { ...seed(21037, 1), rarity: 3, plantExp: 1680 },
  ], { persist: false });

  assert.deepEqual(result.priority, [20129, 21037, 20261, 26032, 20329, 20002]);
  assert.deepEqual(result.seeds.map(item => item.seedId), result.priority);
  assert.equal(result.changed, true);
});

test('activity planting priority places red flower seed first', () => {
  const result = store.syncBagSeedPriority('event-seed-first', [
    { ...seed(29003, 1), rarity: 3, plantExp: 7680 },
    { ...seed(20883, 1), rarity: 3, plantExp: 960, plantingPriority: 1000 },
    { ...seed(20129, 81), rarity: 2, plantExp: 1680 },
  ], { persist: false });

  assert.deepEqual(result.priority, [20883, 29003, 20129]);
  assert.equal(result.seeds[0].seedId, 20883);
});

test('personal bag seed tab matches the official client order', () => {
  const seeds = [
    [29003, '星语铃花', 3, 7680],
    [20129, '勿忘我', 2, 1680],
    [21037, '银星海棠', 3, 1680],
    [21050, '萱草', 3, 1680],
    [21353, '紫薇', 3, 1680],
    [21380, '梧桐', 3, 1680],
    [21404, '月光花', 3, 1680],
    [20108, '铃兰', 2, 1440],
    [20185, '似何莲', 2, 1440],
    [20261, '针垫花', 2, 1440],
    [20264, '帝王血', 2, 1440],
    [21251, '紫茉莉', 3, 1440],
    [26032, '月见草', 3, 1440],
    [20329, '发财红包', 3, 688],
    [20002, '白萝卜', 1, 1],
  ].reverse().map(([id, name, rarity, plantExp]) => ({ id, name, rarity, plantExp }));

  seeds.sort(compareBagSeedGameOrder);

  assert.deepEqual(seeds.map(item => item.name), [
    '星语铃花', '勿忘我', '银星海棠', '萱草', '紫薇',
    '梧桐', '月光花', '铃兰', '似何莲', '针垫花',
    '帝王血', '紫茉莉', '月见草', '发财红包', '白萝卜',
  ]);
});

test('saved custom order survives inventory synchronization', () => {
  const accountId = 'replace-old';
  store.applyConfigSnapshot({
    bagSeedPriority: [103, 102, 101],
    bagSeedKnownIds: [103, 102, 101],
  }, { accountId, persist: false });

  const result = store.syncBagSeedPriority(accountId, [
    { ...seed(101, 1), rarity: 1, plantExp: 10 },
    { ...seed(103, 3), rarity: 2, plantExp: 20 },
    { ...seed(102, 2), rarity: 2, plantExp: 30 },
  ], { persist: false });

  assert.deepEqual(result.priority, [103, 102, 101]);
  assert.equal(result.changed, false);
});

test('removed preferred strategies fall back to supported defaults', () => {
  const accountId = 'removed-preferred-strategy';
  store.applyConfigSnapshot({
    plantingStrategy: 'preferred',
    bagSeedFallbackStrategy: 'preferred',
  }, { accountId, persist: false });

  const config = store.getConfigSnapshot(accountId);
  assert.equal(config.plantingStrategy, 'max_exp');
  assert.equal(store.getBagSeedFallbackStrategy(accountId), 'level');
  assert.equal('preferredSeedId' in config, false);

  store.applyConfigSnapshot({
    bagSeedFallbackStrategy: 'task_priority',
  }, { accountId, persist: false });
  assert.equal(store.getBagSeedFallbackStrategy(accountId), 'level');
});

test('empty and 2x2 seeds are excluded from the 1x1 priority', () => {
  const result = store.syncBagSeedPriority('one-by-one-only', [
    seed(101, 1),
    seed(102, 9, { plantSize: 2 }),
    seed(103, 8, { count: 0 }),
  ], { persist: false });

  assert.deepEqual(result.priority, [101]);
  assert.deepEqual(result.knownIds, [101]);
  assert.deepEqual(result.seeds.map(item => item.seedId), [101]);
});

test('depleted seeds retain their position and new seeds are appended', () => {
  const accountId = 'inventory-changes';
  store.applyConfigSnapshot({ bagSeedPriority: [103, 101] }, { accountId, persist: false });
  const result = store.syncBagSeedPriority(accountId, [seed(101, 1), seed(102, 2)], { persist: false });
  assert.deepEqual(result.priority, [103, 101, 102]);
  const restored = store.syncBagSeedPriority(accountId, [seed(102, 2), seed(103, 3), seed(101, 1)], { persist: false });
  assert.deepEqual(restored.priority, [103, 101, 102]);
});

test('settings API persists task priority and custom bag order per account', async () => {
  const schedulerPath = require.resolve('../src/services/scheduler');
  const cachedScheduler = require.cache[schedulerPath];
  require.cache[schedulerPath] = { id: schedulerPath, filename: schedulerPath, loaded: true, exports: { getSchedulerRegistrySnapshot: () => [] } };
  const { createDataProvider } = require('../src/runtime/data-provider');
  if (cachedScheduler) require.cache[schedulerPath] = cachedScheduler;
  else delete require.cache[schedulerPath];
  const broadcasts = [];
  const provider = createDataProvider({
    store: { ...store, applyConfigSnapshot: (patch, options) => store.applyConfigSnapshot(patch, { ...options, persist: false }) },
    getAccounts: () => ({ accounts: [{ id: 'settings-one' }, { id: 'settings-two' }] }),
    nextConfigRevision: () => 1,
    broadcastConfigToWorkers: id => broadcasts.push(id),
  });
  await provider.saveSettings('settings-one', {
    prioritizeGrowthTasks: true,
    bagSeedPriority: [103, 101, 102],
    bagSeedKnownIds: [101, 102, 103],
  });
  assert.equal(store.getPrioritizeGrowthTasks('settings-one'), true);
  assert.equal(store.getPrioritizeGrowthTasks('settings-two'), false);
  assert.deepEqual(store.getBagSeedPriority('settings-one'), [103, 101, 102]);
  assert.deepEqual(broadcasts, ['settings-one']);
  await provider.saveSettings('settings-one', { prioritizeGrowthTasks: false });
  assert.equal(store.getPrioritizeGrowthTasks('settings-one'), false);
  assert.deepEqual(store.getBagSeedPriority('settings-one'), [103, 101, 102]);

  await provider.saveSettings('settings-one', {
    plantingStrategy: 'task_priority',
    prioritizeGrowthTasks: false,
  });
  assert.equal(store.getPlantingStrategy('settings-one'), 'task_priority');
  assert.equal(store.getPrioritizeGrowthTasks('settings-one'), true);
  assert.equal(store.getConfigSnapshot('settings-one').prioritizeGrowthTasks, true);

  await provider.saveSettings('settings-one', {
    plantingStrategy: 'max_exp',
    prioritizeGrowthTasks: false,
  });
  assert.equal(store.getPrioritizeGrowthTasks('settings-one'), false);
});
