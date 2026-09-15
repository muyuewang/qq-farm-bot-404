const test = require('node:test');
const assert = require('node:assert/strict');
const { getGrowthPlantingNeeds, plantGrowthTasks } = require('../src/services/growth-planting');
const task = (overrides = {}) => ({ id: 100003, is_unlocked: true, is_claimed: false, progress: 2, total_progress: 6, ...overrides });

test('only verified unlocked unfinished planting tasks produce needs', () => {
  assert.deepEqual(getGrowthPlantingNeeds([
    task(), task({ is_unlocked: false }), task({ is_claimed: true }),
    task({ id: 9999 }), task({ id: 100004 }), task({ progress: 6 }),
    task({ total_progress: 0 }), task({ progress: -1 }),
  ]), [{ seedId: 20003, count: 4 }]);
});

function setup(tasks = [task()], owned = 2) {
  const calls = [];
  const deps = {
    getTasks: async () => tasks,
    getBagSeeds: async () => [{ seedId: 20003, count: owned }],
    getPlant: () => ({ size: 1 }),
    isLocked: () => false,
    buySeed: async (...args) => { calls.push(['buy', ...args]); return args[1]; },
    plantSeeds: async (id, lands) => {
      calls.push(['plant', id, lands]);
      return { planted: lands.length, plantedLandIds: lands, occupiedLandIds: lands };
    },
  };
  return { deps, calls };
}

test('uses inventory and purchases only deficit; leaves other land for original strategy', async () => {
  const { deps, calls } = setup();
  const result = await plantGrowthTasks([1, 2, 3, 4, 5, 6], deps);
  assert.deepEqual(calls, [['buy', 20003, 2, 2], ['plant', 20003, [1, 2, 3, 4]]]);
  assert.deepEqual(result.remainingLandIds, [5, 6]);
});

test('no purchase when owned stock covers currently empty land', async () => {
  const { deps, calls } = setup();
  await plantGrowthTasks([1], deps);
  assert.deepEqual(calls, [['plant', 20003, [1]]]);
});

test('completed task is skipped and newly unlocked task is read on next invocation', async () => {
  const { deps, calls } = setup([task({ progress: 6 })]);
  assert.deepEqual((await plantGrowthTasks([1, 2], deps)).remainingLandIds, [1, 2]);
  assert.equal(calls.length, 0);
  deps.getTasks = async () => [task({ progress: 6 }), task({ id: 100008, progress: 5 })];
  await plantGrowthTasks([1, 2], deps);
  assert.deepEqual(calls, [['buy', 20059, 1, 0], ['plant', 20059, [1]]]);
});

test('unaffordable purchase still uses owned inventory', async () => {
  const { deps } = setup();
  deps.buySeed = async () => 0;
  assert.deepEqual((await plantGrowthTasks([1, 2, 3], deps)).remainingLandIds, [3]);
});

test('locked plants never trigger purchases', async () => {
  const { deps, calls } = setup();
  deps.isLocked = () => true;
  await plantGrowthTasks([1], deps);
  assert.equal(calls.length, 0);
});

test('partial planting prevents fallback on uncertain land state', async () => {
  const { deps } = setup();
  deps.plantSeeds = async () => ({ planted: 1, plantedLandIds: [1], occupiedLandIds: [1] });
  const result = await plantGrowthTasks([1, 2, 3], deps);
  assert.equal(result.interrupted, true);
  assert.deepEqual(result.remainingLandIds, []);
});

test('task lookup failure propagates without planting or buying', async () => {
  const { deps, calls } = setup();
  deps.getTasks = async () => { throw new Error('offline'); };
  await assert.rejects(plantGrowthTasks([1], deps), /offline/);
  assert.equal(calls.length, 0);
});
