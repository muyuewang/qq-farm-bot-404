const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config/gameConfig');

const gameConfigDir = path.join(__dirname, '../src/gameConfig');
const activityDir = path.join(__dirname, '../../web/public/activity');

// 别名借用不能凭空造 URL：解析出的地址必须指向真实存在的本地文件。
function assertImageResolves(url, label) {
  assert.ok(url, `${label}: empty image`);
  const local = url.startsWith('/game-config/')
    ? path.join(gameConfigDir, decodeURIComponent(url.slice('/game-config/'.length)))
    : url.startsWith('/activity/')
      ? path.join(activityDir, decodeURIComponent(url.slice('/activity/'.length).split('?')[0]))
      : null;
  assert.ok(local, `${label}: unexpected image root ${url}`);
  assert.ok(fs.existsSync(local), `${label}: missing file for ${url}`);
  return local;
}

// 文件名前缀就是该物品自己的导出图，不算别名借用。
function isOwnImage(url, itemId) {
  return new RegExp(`seed_images_named/${itemId}(?:_|\\.)`).test(url);
}

test('known borrowed icons resolve to the primary item’s exported image', () => {
  // 22254 天山红枫种子没有自己的落盘图，借用 42254 天山红枫的模型图。
  const borrowed = config.getItemImageById(22254);
  assert.equal(borrowed, '/game-config/seed_images_named/42254.png');
  assertImageResolves(borrowed, '22254');
});

test('items without their own image reuse an existing local file via the alias index', () => {
  const items = JSON.parse(fs.readFileSync(path.join(gameConfigDir, 'ItemInfo.json'), 'utf8'));
  const aliasHits = [];
  for (const item of items) {
    const image = config.getItemImageById(item.id);
    if (!image || isOwnImage(image, item.id)) continue;
    aliasHits.push({ id: item.id, image });
    assertImageResolves(image, String(item.id));
  }
  assert.ok(aliasHits.length >= 7, `expected alias reuse, got ${aliasHits.length}`);
});

test('every seed resolves to an existing image without a server', () => {
  const seeds = config.getAllSeeds();
  assert.ok(seeds.length > 0);
  for (const seed of seeds) assertImageResolves(seed.image, `seed ${seed.seedId} ${seed.name}`);
});
