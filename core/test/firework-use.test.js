const assert = require('node:assert/strict');
const test = require('node:test');
const { createFireworkUse } = require('../src/services/firework-use');
const { loadProto, types } = require('../src/utils/proto');
const { registerAdminBagRoutes } = require('../src/controllers/admin-bag-routes');

function fixture(events = []) {
  const calls = [];
  const deps = {
    now: () => 100,
    getFarm: async () => { calls.push('query'); return { farm_social_events: events }; },
    place: async uid => { calls.push(['use', uid]); return { used_items: [{ id: 6001, count: 1 }], items: [] }; },
    ignite: async () => { calls.push('ignite'); },
  };
  return { deps, calls };
}

test('official encoder fixtures preserve placement target and ignition item ids', async () => {
  await loadProto();
  const cases = [
    [types.UseRequest, { item: { id: 6001, count: 1, uid: 42 }, target: { host_gid: 123, use_config_id: 0 } }, '0a0708f12e1001302a1204087b1800'],
    [types.FarmingRequest, { host_gid: 123, host_type: 0, reason: 0, clear_farm_social_item_ids: [6001] }, '107b180020002a02f12e'],
    [types.AllLandsReply, { farm_social_events: [{ item_id: 6001 }] }, '1a0308f12e'],
  ];
  for (const [type, value, hex] of cases) {
    const encoded = type.encode(type.create(value)).finish();
    assert.equal(Buffer.from(encoded).toString('hex'), hex);
    assert.equal(Buffer.from(type.encode(type.decode(Buffer.from(hex, 'hex'))).finish()).toString('hex'), hex);
  }
  // Sanitized event fixture: phase 1 runs from second 102 through 107.
  const event = types.AllLandsReply.decode(Buffer.from('1a0d08f12e107b186428013066386b', 'hex')).farm_social_events[0];
  assert.equal(event.phase, 1);
  assert.equal(Number(event.state_until), 107);
});

test('consecutive completed fireworks each use one item before ignition', async () => {
  const { deps, calls } = fixture();
  const use = createFireworkUse(deps);
  await use(1, 42);
  await use(1, 42);
  assert.deepEqual(calls, ['query', ['use', 42], 'ignite', 'query', ['use', 42], 'ignite']);
});

test('pending placement is resumed without consuming another item', async () => {
  const { deps, calls } = fixture([{ item_id: 6001, phase: 0 }]);
  const result = await createFireworkUse(deps)(1, 42);
  assert.equal(result.resumed, true);
  assert.deepEqual(result.used_items, []);
  assert.deepEqual(calls, ['query', 'ignite']);
});

test('burning state blocks use until the server time boundary', async () => {
  const event = { item_id: 6001, phase: 1, state_until: 101 };
  const { deps, calls } = fixture([event]);
  const use = createFireworkUse(deps);
  await assert.rejects(use(1, 42), /燃放中/);
  assert.deepEqual(calls, ['query']);
  event.state_until = 100;
  await use(1, 42);
  assert.deepEqual(calls.slice(1), ['query', ['use', 42], 'ignite']);
});

test('failed ignition is recoverable from server state, even in a new worker', async () => {
  const events = [];
  const { deps, calls } = fixture(events);
  deps.place = async () => { events.push({ item_id: 6001, phase: 0 }); calls.push('use'); return {}; };
  deps.ignite = async () => { throw new Error('timeout'); };
  await assert.rejects(createFireworkUse(deps)(1, 42), /已放置.*点燃未确认/);
  deps.ignite = async () => { calls.push('ignite'); };
  await createFireworkUse(deps)(1, 42);
  assert.deepEqual(calls, ['query', 'use', 'query', 'ignite']);
});

test('parallel use and bulk counts cannot consume additional fireworks', async () => {
  const { deps, calls } = fixture();
  let release;
  deps.ignite = () => new Promise(resolve => { release = resolve; });
  const use = createFireworkUse(deps);
  await assert.rejects(use(2, 42), /每次只能/);
  const first = use(1, 42);
  await assert.rejects(use(1, 42), /重复点击/);
  await new Promise(resolve => setImmediate(resolve));
  release();
  await first;
  assert.deepEqual(calls, ['query', ['use', 42]]);
});

test('placement failure never ignites and releases the lock', async () => {
  const { deps, calls } = fixture();
  deps.place = async () => { throw new Error('1001096 烟花燃放中，无法放置'); };
  const use = createFireworkUse(deps);
  await assert.rejects(use(1, 42), /烟花：燃放中/);
  await assert.rejects(use(1, 42), /烟花：燃放中/);
  assert.deepEqual(calls, ['query', 'query']);
});

test('expected firework errors are returned to the bag UI without HTTP 500', async () => {
  const routes = {};
  registerAdminBagRoutes({
    app: { get() {}, post(path, handler) { routes[path] = handler; } },
    provider: { getBag: async () => [], useItem: async () => { throw new Error('烟花：燃放中，请稍后再试'); } },
    getAccountIdFromRequest: () => 'test-account', canAccessAccount: () => true,
    sendProviderError: () => assert.fail('expected failure must not become HTTP 500'), emitRealtimeLog() {},
  });
  let payload;
  await routes['/api/bag/use']({ body: { itemId: 6001, count: 1 } }, { json(value) { payload = value; } });
  assert.equal(payload.ok, false);
  assert.match(payload.error, /燃放中/);
});

test('warehouse sends verified Use and Farming payloads, ordinary items stay single-step', async () => {
  await loadProto();
  const networkPath = require.resolve('../src/utils/network');
  const warehousePath = require.resolve('../src/services/warehouse');
  const originalNetwork = require.cache[networkPath];
  const originalWarehouse = require.cache[warehousePath];
  const calls = [];
  require.cache[networkPath] = { id: networkPath, filename: networkPath, loaded: true, exports: {
    networkEvents: new (require('node:events').EventEmitter)(),
    getUserState: () => ({ gid: 123 }),
    sendMsgAsync: async (service, method, payload) => {
      calls.push({ service, method, hex: Buffer.from(payload).toString('hex') });
      return { body: Buffer.alloc(0) };
    },
  } };
  delete require.cache[warehousePath];
  try {
    const { useItem } = require(warehousePath);
    await useItem(6001, 1, 42);
    assert.deepEqual(calls, [
      { service: 'gamepb.plantpb.PlantService', method: 'AllLands', hex: '' },
      { service: 'gamepb.itempb.ItemService', method: 'Use', hex: '0a0708f12e1001302a1204087b1800' },
      { service: 'gamepb.plantpb.PlantService', method: 'Farming', hex: '107b180020002a02f12e' },
    ]);
    calls.length = 0;
    await useItem(101304, 1, 42);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'Use');
    assert.equal(Object.hasOwn(types.UseRequest.decode(Buffer.from(calls[0].hex, 'hex')), 'target'), false);
  } finally {
    if (originalNetwork) require.cache[networkPath] = originalNetwork;
    else delete require.cache[networkPath];
    if (originalWarehouse) require.cache[warehousePath] = originalWarehouse;
    else delete require.cache[warehousePath];
  }
});
