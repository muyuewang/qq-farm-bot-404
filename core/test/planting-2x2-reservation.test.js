const test = require('node:test');
const assert = require('node:assert/strict');

const { select2x2Reservations } = require('../src/services/planting-service');

function growingLand(id, matureAt, level = 0) {
  return {
    id,
    level,
    unlocked: true,
    plant: {
      id: 1,
      season: 1,
      phases: [{ phase: 6, begin_time: matureAt }],
    },
  };
}

test('keeps an existing same-grade reservation when clear time and lock cost are equivalent', () => {
  const groupA = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const groupB = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };

  const now = Math.floor(Date.now() / 1000);
  const firstLands = [
    growingLand(1, now + 100),
    growingLand(2, now + 100),
    growingLand(5, now + 100),
    growingLand(6, now + 100),
    growingLand(3, now + 200),
    growingLand(4, now + 200),
    growingLand(7, now + 200),
    growingLand(8, now + 200),
  ];
  const first = select2x2Reservations([groupA, groupB], [], 1, firstLands);
  assert.deepEqual(first.map(group => group.key), [groupA.key]);

  // 同品级、近似清空时间且锁地成本相同时保持旧预留，避免无收益漂移。
  const secondLands = [
    growingLand(1, now + 300),
    growingLand(2, now + 300),
    growingLand(5, now + 300),
    growingLand(6, now + 300),
    growingLand(3, now + 306),
    growingLand(4, now + 306),
    growingLand(7, now + 306),
    growingLand(8, now + 306),
  ];
  const second = select2x2Reservations([groupA, groupB], [], 1, secondLands);

  assert.deepEqual(second.map(group => group.key), [groupA.key]);
});

test('prefers materially earlier clearing over a group with three empty lands', () => {
  const almostReady = { key: '9-10-13-14', masterLandId: 13, landIds: [13, 14, 9, 10] };
  const earlier = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const now = Math.floor(Date.now() / 1000);
  const lands = [
    { id: 10, unlocked: true },
    { id: 13, unlocked: true },
    { id: 14, unlocked: true },
    growingLand(9, now + 300),
    { id: 3, unlocked: true },
    growingLand(4, now + 100),
    growingLand(7, now + 100),
    growingLand(8, now + 100),
  ];

  const selected = select2x2Reservations(
    [earlier, almostReady],
    [3, 10, 13, 14],
    1,
    lands,
  );

  assert.deepEqual(selected.map(group => group.key), [earlier.key]);
});

test('prefers the lower lock cost when adjacent groups clear at nearly the same time', () => {
  select2x2Reservations([], [], 0, []);
  const upper = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const lower = { key: '7-8-11-12', masterLandId: 11, landIds: [11, 12, 7, 8] };
  const now = Math.floor(Date.now() / 1000);
  const lands = [
    growingLand(3, now + 106),
    growingLand(4, now + 106),
    growingLand(7, now + 100),
    growingLand(8, now + 100),
    growingLand(11, now + 100),
    growingLand(12, now + 100),
  ];

  const selected = select2x2Reservations([lower, upper], [], 1, lands);

  assert.deepEqual(selected.map(group => group.key), [lower.key]);
});

test('still prefers a materially earlier clearing group over the earlier land ids', () => {
  select2x2Reservations([], [], 0, []);
  const upper = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const lower = { key: '7-8-11-12', masterLandId: 11, landIds: [11, 12, 7, 8] };
  const now = Math.floor(Date.now() / 1000);
  const lands = [
    growingLand(3, now + 200),
    growingLand(4, now + 200),
    growingLand(7, now + 100),
    growingLand(8, now + 100),
    growingLand(11, now + 100),
    growingLand(12, now + 100),
  ];

  const selected = select2x2Reservations([upper, lower], [], 1, lands);

  assert.deepEqual(selected.map(group => group.key), [lower.key]);
});

test('materially earlier clearing supersedes a nearly cleared group', () => {
  const oldReservation = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const almostReady = { key: '9-10-13-14', masterLandId: 13, landIds: [13, 14, 9, 10] };
  const now = Math.floor(Date.now() / 1000);

  select2x2Reservations(
    [oldReservation],
    [1],
    1,
    [
      { id: 1, unlocked: true },
      growingLand(2, now + 100),
      growingLand(5, now + 100),
      growingLand(6, now + 100),
    ],
  );

  const selected = select2x2Reservations(
    [oldReservation, almostReady],
    [1, 10, 13, 14],
    1,
    [
      { id: 1, unlocked: true },
      growingLand(2, now + 100),
      growingLand(5, now + 100),
      growingLand(6, now + 100),
      growingLand(9, now + 200),
      { id: 10, unlocked: true },
      { id: 13, unlocked: true },
      { id: 14, unlocked: true },
    ],
  );

  assert.deepEqual(selected.map(group => group.key), [oldReservation.key]);
});

test('higher-grade anchor is reserved before a fully empty lower-grade group', () => {
  select2x2Reservations([], [], 0, []);
  const lowReady = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const highWaiting = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const now = Math.floor(Date.now() / 1000);
  const selected = select2x2Reservations(
    [lowReady, highWaiting],
    [1, 2, 5, 6],
    1,
    [
      { id: 1, unlocked: true },
      { id: 2, unlocked: true },
      { id: 5, level: 2, unlocked: true },
      { id: 6, unlocked: true },
      growingLand(3, now + 100),
      growingLand(4, now + 100),
      growingLand(7, now + 100, 5),
      growingLand(8, now + 100),
    ],
  );

  assert.deepEqual(selected.map(group => group.key), [highWaiting.key]);
});

test('higher-grade anchor supersedes an existing lower-grade reservation', () => {
  const low = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const high = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const now = Math.floor(Date.now() / 1000);
  select2x2Reservations([low], [], 1, [
    growingLand(1, now + 100), growingLand(2, now + 100),
    growingLand(5, now + 100, 2), growingLand(6, now + 100),
  ]);

  const selected = select2x2Reservations([low, high], [], 1, [
    growingLand(1, now + 100), growingLand(2, now + 100),
    growingLand(5, now + 100, 2), growingLand(6, now + 100),
    growingLand(3, now + 200), growingLand(4, now + 200),
    growingLand(7, now + 200, 5), growingLand(8, now + 200),
  ]);

  assert.deepEqual(selected.map(group => group.key), [high.key]);
});

test('same-grade groups with similar clear times prefer the lower lock cost', () => {
  select2x2Reservations([], [], 0, []);
  const scattered = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const synchronized = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const now = Math.floor(Date.now() / 1000);
  const selected = select2x2Reservations([scattered, synchronized], [], 1, [
    growingLand(1, now + 40), growingLand(2, now + 70),
    growingLand(5, now + 100, 4), growingLand(6, now + 100),
    growingLand(3, now + 95), growingLand(4, now + 96),
    growingLand(7, now + 100, 4), growingLand(8, now + 99),
  ]);

  assert.deepEqual(selected.map(group => group.key), [synchronized.key]);
});

test('unknown occupied land is not treated as immediately clear', () => {
  select2x2Reservations([], [], 0, []);
  const unknown = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const known = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const now = Math.floor(Date.now() / 1000);
  const selected = select2x2Reservations([unknown, known], [], 1, [
    { id: 1, unlocked: true }, { id: 2, unlocked: true },
    { id: 5, level: 3, unlocked: true }, { id: 6, unlocked: true },
    growingLand(3, now + 100), growingLand(4, now + 100),
    growingLand(7, now + 100, 3), growingLand(8, now + 100),
  ]);

  assert.deepEqual(selected.map(group => group.key), [known.key]);
});

test('global search avoids an overlapping choice when it can keep the same top grade and place more groups', () => {
  select2x2Reservations([], [], 0, []);
  const left = { key: '1-2-5-6', masterLandId: 5, landIds: [5, 6, 1, 2] };
  const middle = { key: '2-3-6-7', masterLandId: 6, landIds: [6, 7, 2, 3] };
  const right = { key: '3-4-7-8', masterLandId: 7, landIds: [7, 8, 3, 4] };
  const lands = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({
    id,
    level: id === 5 || id === 6 ? 5 : (id === 7 ? 4 : 1),
    unlocked: true,
  }));

  const selected = select2x2Reservations(
    [middle, left, right],
    lands.map(land => land.id),
    2,
    lands,
  );

  assert.deepEqual(selected.map(group => group.key).sort(), [left.key, right.key].sort());
});
