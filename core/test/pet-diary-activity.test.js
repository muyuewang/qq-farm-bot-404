const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePetDiaryPhotoWall,
  normalizePetDiaryEscort,
  normalizePetDiaryPouch,
  normalizePetDiaryPet,
  isPetDiaryWithinWindow,
} = require('../src/services/activity');
const { loadProto, types } = require('../src/utils/proto');

// 官方客户端 2026-09-10 明文响应中 ActivityNode 字段 115 的原始字节。
// 来源：HAR 抓包（List 响应 / Operate 响应），仅替换为十六进制字面量以便回归。
const PET_DIARY_BODY_LIST_HEX =
  '0a02200112001a08220608840810bc0522240a0208010a0208020a0208030a0208040a0208050a0208060a0208070a0208080a020809320d120166220608691001180230013a0042004a00';
const PET_DIARY_BODY_OPERATE_HEX =
  '0a07080118bc052001120208011a0a1864220608840810bc0522d7010ab40108011001180122a9017b2270686f746f223a20226775692f746578747572652f536561736f6e2f53332f533350686f746f57616c6c50686f746f732f696d675f733350686f746f57616c6c5f70686f746f302f7370726974654672616d65222c2022736179223a226775692f746578747572652f536561736f6e2f53332f533350686f746f57616c6c50686f746f732f696d675f733350686f746f57616c6c5f736179302f7370726974654672616d65227d28010a0208020a0208030a0208040a0208050a0208060a0208070a0208080a020809320d120166220608691001180230013a0042004a00';

async function decodeBody(hex) {
  if (!types.ActivityBodyPetDiary) await loadProto();
  return types.ActivityBodyPetDiary.decode(Buffer.from(hex, 'hex'));
}

test('pet diary body decodes the official locked photo wall', async () => {
  const body = await decodeBody(PET_DIARY_BODY_LIST_HEX);

  assert.deepEqual(normalizePetDiaryPet(body.pet), { stage: 0, progress: 0, state: 1 });
  assert.deepEqual(normalizePetDiaryEscort(body.escort), {
    guard: 0,
    cake: { itemId: 1028, count: 700, name: '萌宠元气糕' },
  });
  assert.deepEqual(normalizePetDiaryPouch(body.pouch), {
    flag: 'f',
    state: 1,
    slot: { id: 105, type: 1, count: 2 },
  });

  const wall = normalizePetDiaryPhotoWall(body.photo_wall);
  assert.equal(wall.slots.length, 9);
  assert.equal(wall.unlockedCount, 0);
  assert.equal(wall.claimableCount, 0);
  assert.deepEqual(wall.slots.map((slot) => slot.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(wall.slots[0].photo, '');
});

test('pet diary body decodes an unlocked and claimed photo slot', async () => {
  const body = await decodeBody(PET_DIARY_BODY_OPERATE_HEX);

  assert.deepEqual(normalizePetDiaryEscort(body.escort), {
    guard: 100,
    cake: { itemId: 1028, count: 700, name: '萌宠元气糕' },
  });

  const wall = normalizePetDiaryPhotoWall(body.photo_wall);
  assert.equal(wall.unlockedCount, 1);
  assert.equal(wall.claimedCount, 1);
  assert.equal(wall.claimableCount, 0);
  assert.equal(wall.slots[0].unlocked, true);
  assert.equal(wall.slots[0].claimed, true);
  assert.equal(
    wall.slots[0].photo,
    'gui/texture/Season/S3/S3PhotoWallPhotos/img_s3PhotoWall_photo0/spriteFrame',
  );
  assert.equal(
    wall.slots[0].say,
    'gui/texture/Season/S3/S3PhotoWallPhotos/img_s3PhotoWall_say0/spriteFrame',
  );
  assert.equal(wall.slots[1].unlocked, false);
});

test('pet diary window is inclusive on both boundaries', () => {
  assert.equal(isPetDiaryWithinWindow(1789005599), false);
  assert.equal(isPetDiaryWithinWindow(1789005600), true);
  assert.equal(isPetDiaryWithinWindow(1791820799), true);
  assert.equal(isPetDiaryWithinWindow(1791820800), false);
});

test('pet diary photo wall tolerates malformed content', () => {
  const wall = normalizePetDiaryPhotoWall({
    entries: [
      { id: 1, unlocked: 1, claimed: 0, content: 'not-json' },
      { id: 2, unlocked: 0, content: '{"photo":"a","say":"b"}' },
    ],
  });
  assert.deepEqual(wall.slots[0], {
    id: 1,
    unlocked: true,
    claimed: false,
    claimable: true,
    progress: 0,
    photo: '',
    say: '',
  });
  assert.equal(wall.slots[1].unlocked, false);
  assert.equal(wall.slots[1].photo, 'a');
});
