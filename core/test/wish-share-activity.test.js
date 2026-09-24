const test = require('node:test');
const assert = require('node:assert/strict');
const protobuf = require('protobufjs');
const path = require('node:path');
const { getItemById, getItemImageById } = require('../src/config/gameConfig');
const {
  isWishSignActive, isShareRewardActive,
  normalizeWishSignActivity, normalizeShareRewardActivity,
} = require('../src/services/activity');

let root;
async function getProtocol() {
  if (!root) {
    root = new protobuf.Root();
    await root.load([
      path.join(__dirname, '../src/proto/corepb.proto'),
      path.join(__dirname, '../src/proto/activitypb.proto'),
    ], { keepCase: true });
  }
  return root;
}

test('official encoder reconstructions preserve activity ID, command, and choice', async () => {
  const type = (await getProtocol()).lookupType('gamepb.activitypb.OperateRequest');
  const cases = [
    [{ id: 2026092401, cmd: 51, wish_sign_draw: { choose_id: 2 } }, '08f1ee8ec6071033ba09020802'],
    [{ id: 2026092401, cmd: 52, wish_sign_claim: { choose_id: 2 } }, '08f1ee8ec6071034c209020802'],
    [{ id: 2026092501, cmd: 73 }, '08d5ef8ec6071049'],
    [{ id: 2026092501, cmd: 69 }, '08d5ef8ec6071045'],
    [{ id: 2026092501, cmd: 70 }, '08d5ef8ec6071046'],
  ];
  for (const [input, hex] of cases) {
    const encoded = Buffer.from(type.encode(type.create(input)).finish());
    assert.equal(encoded.toString('hex'), hex);
    assert.equal(type.decode(encoded).id.toString(), String(input.id));
  }
});

test('captured wish and share state bodies decode and normalize without private sharing tokens', async () => {
  const protocol = await getProtocol();
  const wish = protocol.lookupType('gamepb.activitypb.ActivityBodyWishSign').decode(Buffer.from('10011a0d0802100a1801220508f12e1014', 'hex'));
  const normalizedWish = normalizeWishSignActivity({ wish_sign: wish }, 1790179200);
  assert.equal(normalizedWish.pending.chooseId, 2);
  assert.equal(normalizedWish.pending.rewards[0].itemId, 6001);
  assert.equal(normalizedWish.pending.rewards[0].itemCount, 20);
  const share = protocol.lookupType('gamepb.activitypb.ActivityBodyShareReward').decode(Buffer.from('0a57100a1a06100118012003220210052a0e0801100a1a060882f104100120022a0e080210141a06088df104100120012a0d0803101e1a0508ea07103220012a0e0804103c1a0608babf051001200130053805420410011801', 'hex'));
  const normalizedShare = normalizeShareRewardActivity({ share_reward: share }, 1790179200);
  assert.equal(normalizedShare.currentScore, 10);
  assert.equal(normalizedShare.milestones[0].state, 2);
  assert.equal(normalizedShare.milestones[0].rewards[0].itemId, 80002);
  assert.equal('ark' in normalizedShare, false);
});

test('both activities enforce exact inclusive time windows', () => {
  for (const [check, start, end] of [[isWishSignActive, 1790179200, 1791388799], [isShareRewardActive, 1790179200, 1791820799]]) {
    assert.equal(check(start - 1), false);
    assert.equal(check(start), true);
    assert.equal(check(end), true);
    assert.equal(check(end + 1), false);
  }
});

test('wish pool uses official day rewards and all reward images are local', () => {
  const wish = normalizeWishSignActivity({ wish_sign: { activity_day: 1, remaining_count: 0 } }, 1790179200);
  assert.equal(wish.rewardPool.length, 14);
  assert.deepEqual(wish.rewardPool.map(reward => reward.dayId), Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(wish.rewardPool[0].itemId, 6001);
  assert.equal(wish.rewardPool[0].itemCount, 20);
  assert.equal(wish.rewardPool[1].itemId, 26030);
  assert.equal(wish.rewardPool[1].itemCount, 48);
  assert.equal(wish.rewardPool[13].itemId, 204010);
  const expectedImages = new Map([
    [6001, '/activity/wish-sign/firework.png'],
    [26030, '/activity/wish-sign/moon-beauty-seed.png'],
    [80002, '/activity/wish-sign/fertilizer-4h.png'],
    [80003, '/activity/wish-sign/fertilizer-8h.png'],
    [80004, '/activity/wish-sign/fertilizer-12h.png'],
    [80013, '/activity/wish-sign/organic-fertilizer-8h.png'],
    [80014, '/activity/wish-sign/organic-fertilizer-12h.png'],
    [1002, '/activity/wish-sign/coupon.png'],
    [20435, '/activity/wish-sign/lily-seed.png'],
    [204010, '/activity/wish-sign/moon-rabbit-skin.png'],
    [90042, '/activity/wish-sign/cute-bear-skin.png'],
  ]);
  for (const [itemId, imagePath] of expectedImages) {
    assert.equal(getItemImageById(itemId), imagePath);
  }
  assert.equal(getItemById(6001).can_use, 1);
});
