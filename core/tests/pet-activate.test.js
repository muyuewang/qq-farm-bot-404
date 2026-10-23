const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

// 真实抓包 ws_00148_SEND / ws_00149_RECV：宠物页对“有卡未激活”的比熊犬（90031）
// 点“激活”。请求只有 dog_id；回包 field 1 是激活后的 DogInfo（field 7 置 1）。
const CAPTURED_REQUEST = '08afbf05';
const CAPTURED_REPLY = '0a1c08afbf051209e6af94e7868ae78aac18882720012864300138015001';

async function loadDogTypes() {
    const root = new protobuf.Root();
    await root.load([path.join(__dirname, '../src/proto/dogpb.proto')], { keepCase: true });
    return {
        ActivateDogRequest: root.lookupType('gamepb.dogpb.ActivateDogRequest'),
        ActivateDogReply: root.lookupType('gamepb.dogpb.ActivateDogReply'),
    };
}

test('ActivateDog 请求与回包和真实抓包逐字节一致', async () => {
    const { ActivateDogRequest, ActivateDogReply } = await loadDogTypes();
    const request = ActivateDogRequest.encode(ActivateDogRequest.create({ dog_id: 90031 })).finish();
    assert.deepEqual(Buffer.from(request), Buffer.from(CAPTURED_REQUEST, 'hex'));

    const reply = ActivateDogReply.decode(Buffer.from(CAPTURED_REPLY, 'hex'));
    assert.equal(Number(reply.dog.id), 90031);
    assert.equal(reply.dog.name, '比熊犬');
    assert.equal(Number(reply.dog.owned), 1);
    // 激活回包同时带上 field 6（卡片）和 field 10（新获得），两者都不是业务判断依据。
    assert.equal(Number(reply.dog.field_6), 1);
    assert.equal(Number(reply.dog.field_10), 1);
});

const { buildPetSnapshot } = require('../dist/services/pets');
const { loadProto, types } = require('../dist/utils/proto');

// utils/proto.ts 的 types 是逐个注册的，新增协议容易只改 .proto 而漏掉注册，
// 漏掉时页面会报 “Cannot read properties of undefined (reading 'encode')”。
test('宠物协议用到的消息类型都已注册到 types', async () => {
    await loadProto();
    const required = [
        'GetDogInfoRequest', 'GetDogInfoReply',
        'ActivateDogRequest', 'ActivateDogReply',
        'DeployDogRequest', 'DeployDogReply',
        'WithdrawDogRequest', 'WithdrawDogReply',
        'AddFoodRequest', 'AddFoodReply',
        'GetProtectLogsRequest', 'GetProtectLogsReply',
    ];
    for (const name of required)
        assert.ok(types[name], `types.${name} 未在 utils/proto.ts 注册`);
});

function buildSnapshot(dogs, bagItems = [], extra = {}) {
    return buildPetSnapshot(
        { dogs, max_protect_time: 2592000, ...extra },
        { item_bag: { items: bagItems } },
    );
}

function findPet(snapshot, id) {
    return snapshot.dogs.find(dog => dog.id === id);
}

test('图鉴 field 6 置 1 的宠物是可激活而不是已获得', () => {
    const snapshot = buildSnapshot([
        { id: 90031, name: '比熊犬', price: 5000, status: 1, level: 100, field_6: 1 },
    ]);
    const pet = findPet(snapshot, 90031);
    assert.equal(pet.owned, false);
    assert.equal(pet.activatable, true);
    assert.equal(pet.active, false);
});

test('背包里的宠物卡同样让宠物变成可激活', () => {
    const snapshot = buildSnapshot(
        [{ id: 90011, name: '柯基', price: 5000, status: 1, level: 100 }],
        [{ id: 90011, count: 1, uid: 3069 }],
    );
    const pet = findPet(snapshot, 90011);
    assert.equal(pet.owned, false);
    assert.equal(pet.activatable, true);
});

test('锁定的宠物卡不算可激活', () => {
    const snapshot = buildSnapshot(
        [{ id: 90011, name: '柯基', price: 5000, status: 1, level: 100 }],
        [{ id: 90011, count: 1, uid: 3069, locked: true }],
    );
    const pet = findPet(snapshot, 90011);
    assert.equal(pet.activatable, false);
});

test('已获得（field 7）或上场中的宠物不再提示激活', () => {
    const snapshot = buildSnapshot(
        [
            { id: 90031, name: '比熊犬', price: 5000, status: 1, level: 100, owned: 1, field_6: 1 },
            { id: 90021, name: '护主犬', price: 5000, status: 1, level: 100 },
        ],
        [{ id: 90021, count: 1, uid: 3070 }],
        { current_dog_id: 90021 },
    );
    const activated = findPet(snapshot, 90031);
    assert.equal(activated.owned, true);
    assert.equal(activated.activatable, false);

    const deployed = findPet(snapshot, 90021);
    assert.equal(deployed.owned, true);
    assert.equal(deployed.active, true);
    assert.equal(deployed.activatable, false);
});

test('既没有卡片也没有 field 6 的图鉴项不可激活', () => {
    const snapshot = buildSnapshot([{ id: 90001, name: '田园犬', price: 1000, status: 1, level: 100 }]);
    const pet = findPet(snapshot, 90001);
    assert.equal(pet.owned, false);
    assert.equal(pet.activatable, false);
});
