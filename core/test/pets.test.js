const assert = require('node:assert/strict');
const test = require('node:test');

const { buildPetSnapshot, BICHON_DOG_ID, getDogActivationState } = require('../src/services/pets');
const { _test: storeTest } = require('../src/models/store');
const { findNearestMatureSeconds } = require('../src/services/capital-mode');

test('pet snapshot uses current protocol ownership and bag food inventory', () => {
  const snapshot = buildPetSnapshot({
    dogs: [{ id: 90001, name: '小黄狗', owned: 1, level: 2 }],
    current_dog_id: 90001,
    protect_time: 3600,
    max_protect_time: 2592000,
    foods: [{ id: 90004, duration: 86400, status: 1 }]
  }, { items: [{ id: 90004, count: 3 }] });
  assert.equal(snapshot.deployedId, 90001);
  assert.equal(snapshot.dogs.find(dog => dog.id === 90001).owned, true);
  assert.equal(snapshot.foods.find(food => food.id === 90004).count, 3);
  assert.equal(snapshot.foodSeconds, 3600);
});

test('capital mode defaults off and clamps its lead time', () => {
  assert.deepEqual(storeTest.normalizeCapitalMode(null), { enabled: false, dogId: 0, leadSeconds: 10 });
  assert.deepEqual(storeTest.normalizeCapitalMode({ enabled: true, selectedDogId: '90002', secondsBeforeMature: 1 }), { enabled: true, dogId: 90002, leadSeconds: 5 });
  assert.equal(storeTest.normalizeCapitalMode({ leadSeconds: 999 }).leadSeconds, 300);
});

test('capital mode detects already harvestable land immediately', () => {
  assert.equal(findNearestMatureSeconds([], { harvestable: [1] }), 0);
});

test('bichon metadata and official image resolve for owned and unowned pets', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const { getItemById, getItemImageById } = require('../src/config/gameConfig');
  const { entries } = require('../src/gameConfig/seed_images_named/pet-sources.json');
  const source = entries.find(entry => entry.id === 90031);
  const image = getItemImageById(90031);
  assert.equal(getItemById(90031).name, '比熊犬');
  assert.equal(image, `/game-config/seed_images_named/${source.file}`);
  const bytes = fs.readFileSync(path.join(__dirname, '../src/gameConfig/seed_images_named', source.file));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
  const unowned = buildPetSnapshot({}).dogs.find(dog => dog.id === 90031);
  assert.equal(unowned.name, '比熊犬');
  assert.equal(unowned.owned, false);
  const owned = buildPetSnapshot({ current_dog_id: 90031, dogs: [{ id: 90031, owned: 1, level: 3 }] }).dogs;
  assert.equal(owned.filter(dog => dog.id === 90031).length, 1);
  assert.deepEqual({ ...owned.find(dog => dog.id === 90031) }, {
    ...unowned, owned: true, activatable: false, deployed: true, level: 3
  });
  assert.equal(unowned.image, image);
  assert.match(unowned.desc, /比熊润田/);
});

test('pet snapshot exposes unlocked cards as manually activatable', () => {
  const snapshot = buildPetSnapshot({
    dogs: [{ id: 90011, name: '柯基' }]
  }, { items: [
    { id: 90011, count: 1 },
    { id: 90021, count: 1, locked: true },
  ] });
  assert.equal(snapshot.dogs.find(dog => dog.id === 90011).activatable, true);
  assert.equal(snapshot.dogs.find(dog => dog.id === 90021).activatable, false);
});

test('bichon activation requires server activatable marker and stops after ownership', () => {
  const pending = getDogActivationState({
    dogs: [{ id: BICHON_DOG_ID, field_6: 1 }]
  }, BICHON_DOG_ID);
  assert.equal(pending.owned, false);
  assert.equal(pending.activatable, true);

  const tooEarly = getDogActivationState({
    dogs: [{ id: BICHON_DOG_ID }]
  }, BICHON_DOG_ID);
  assert.equal(tooEarly.activatable, false);

  const owned = getDogActivationState({
    dogs: [{ id: BICHON_DOG_ID, field_6: 1, owned: 1 }]
  }, BICHON_DOG_ID);
  assert.equal(owned.owned, true);
  assert.equal(owned.activatable, false);
});

test('ActivateDog request for bichon matches decrypted HAR bytes', () => {
  const protobuf = require('protobufjs');
  const path = require('node:path');
  const root = new protobuf.Root();
  root.loadSync(path.join(__dirname, '../src/proto/dogpb.proto'), { keepCase: true });
  const request = root.lookupType('gamepb.dogpb.ActivateDogRequest');
  const bytes = request.encode(request.create({ dog_id: BICHON_DOG_ID })).finish();
  assert.equal(Buffer.from(bytes).toString('hex'), '08afbf05');
});
