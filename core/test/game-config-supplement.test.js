const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  getItemById,
  getItemImageById,
  getAllSeeds,
  getPlantBySeedId,
  getPlantGrowPhases,
} = require('../src/config/gameConfig');

const activityPlants = [
  { asset: 'Crop_9003', seedId: 29003, fruitId: 49003, plantId: 1029003, mutantId: 1049003, name: '星语铃花' },
  { asset: 'Crop_1353', seedId: 21353, fruitId: 41353, plantId: 1021353, mutantId: 1041353, name: '紫薇' },
  { asset: 'Crop_264', seedId: 20264, fruitId: 40264, plantId: 1020264, mutantId: 1040264, name: '帝王血' },
  { asset: 'Crop_1404', seedId: 21404, fruitId: 41404, plantId: 1021404, mutantId: 1041404, name: '月光花' },
  { asset: 'Crop_108', seedId: 20108, fruitId: 40108, plantId: 1020108, mutantId: 1040108, name: '铃兰' },
  { asset: 'Crop_1037', seedId: 21037, fruitId: 41037, plantId: 1021037, mutantId: 1041037, name: '银星海棠' },
  { asset: 'Crop_6032', seedId: 26032, fruitId: 46032, plantId: 1026032, mutantId: 1046032, name: '月见草' },
  { asset: 'Crop_1050', seedId: 21050, fruitId: 41050, plantId: 1021050, mutantId: 1041050, name: '萱草' },
  { asset: 'Crop_1251', seedId: 21251, fruitId: 41251, plantId: 1021251, mutantId: 1041251, name: '紫茉莉' },
  { asset: 'Crop_1380', seedId: 21380, fruitId: 41380, plantId: 1021380, mutantId: 1041380, name: '梧桐' },
  { asset: 'Crop_129', seedId: 20129, fruitId: 40129, plantId: 1020129, mutantId: 1040129, name: '勿忘我' },
  { asset: 'Crop_375', seedId: 20375, fruitId: 40375, plantId: 1020375, mutantId: 1040375, name: '木槿' },
];

function assertImageExists(itemId, label) {
  const imageUrl = getItemImageById(itemId);
  assert.match(imageUrl, /^\/game-config\/seed_images_named\/.+\.png$/, label);
  const relativePath = decodeURIComponent(imageUrl.replace('/game-config/', ''));
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'src', 'gameConfig', relativePath)),
    true,
    `${label} file`,
  );
}

test('supplemental source mappings resolve names and official images', () => {
  const expected = new Map([
    [20207, '绣球花种子'],
    [40207, '绣球花'],
    [20329, '发财红包种子'],
    [40329, '发财红包'],
    [1040265, '黄金·朱雀花'],
    [1041037, '黄金·银星海棠'],
    [1041050, '黄金·卷丹百合'],
    [1046032, '黄金·金盏花'],
    [1041353, '黄金·粉樱花'],
    [1049003, '黄金·星语铃花'],
    [301102, '足球'],
    [204003, '黄金·哈哈南瓜塔'],
    [204006, '星语花铃'],
    [204007, '黄金·星语花铃'],
  ]);

  for (const [itemId, name] of expected) {
    assert.equal(getItemById(itemId)?.name, name);
    assert.match(getItemImageById(itemId), /^\/game-config\/seed_images_named\/.+\.png$/);
  }
});

test('star bell flower is configured as a 2x2 crop', () => {
  assert.equal(getPlantBySeedId(29003)?.size, 2);
});

test('bubble cotton candy resolves its official 2x2 plant configuration', () => {
  const plant = getPlantBySeedId(29004);
  assert.equal(plant?.id, 1029004);
  assert.equal(plant?.size, 2);
  assert.equal(plant?.fruit?.id, 49004);
  assert.equal(plant?.fruit?.count, 192);
  assert.equal(plant?.exp, 7680);
  assert.ok(getPlantGrowPhases(plant.id).length > 0);
});

test('charity red flower uses the official single-grid plant configuration', () => {
  const plant = getPlantBySeedId(20883);
  assert.equal(plant?.id, 1020883);
  assert.equal(plant?.fruit?.id, 40883);
  assert.equal(plant?.size, 1);
  assert.equal(plant?.planting_priority, 1000);
  assert.match(plant?.grow_phases || '', /盛开:0/);
});

test('charity flower activity items use official names and static icons', () => {
  assert.equal(getItemById(1040)?.name, '爱心值');
  assert.equal(getItemById(2158)?.name, '小红花做好事头像框');
  assert.equal(getItemById(101604)?.name, '公益小红花结算礼包');
  assert.equal(getItemImageById(101604), '/activity/charity-flower/settlement-pack.png');
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', '..', 'web', 'public', 'activity', 'charity-flower', 'settlement-pack.png')),
    true,
    'charity flower settlement pack image file',
  );
  assertImageExists(20883, 'red flower seed image');
  assertImageExists(40883, 'red flower fruit image');
});

test('seed levels come from seed item configuration', () => {
  const seedLevels = new Map(getAllSeeds().map(seed => [seed.seedId, seed.requiredLevel]));
  assert.equal(seedLevels.get(20003), 2, 'carrot seed level');
  assert.equal(seedLevels.get(20129), 81, 'forget-me-not seed level');
  assert.equal(seedLevels.get(26032), 1, 'evening primrose seed level');
  assert.equal(seedLevels.get(20416), 1, 'haha pumpkin seed level');
});

test('qixi activity items resolve official static icons', () => {
  const expected = new Map([
    [1024, '/activity/qixi/qixi-feather.png'],
    [301103, '/activity/qixi/qixi-dew.png'],
  ]);

  for (const [itemId, imageUrl] of expected) {
    assert.equal(getItemImageById(itemId), imageUrl);
    assert.equal(
      fs.existsSync(path.join(__dirname, '..', '..', 'web', 'public', imageUrl)),
      true,
      `${getItemById(itemId)?.name} image file`,
    );
  }
});

test('rain poem activity items resolve official names and static icons', () => {
  const expected = new Map([
    [1027, ['雷电徽章', '/activity/rain-poem/lightning-badge.svg']],
    [4002, ['闪电感应', '/activity/rain-poem/lightning-sense.png?v=2']],
    [4003, ['闪电感应', '/activity/rain-poem/lightning-sense.png?v=2']],
    [5001, ['天气采集瓶', '/activity/rain-poem/weather-collection-bottle.png']],
    [5002, ['雷雨召唤瓶', '/activity/rain-poem/rainstorm-summon-bottle.png']],
    [5005, ['青蛙使坏瓶', '/activity/rain-poem/frog-prank-bottle.png']],
    [5006, ['乌云使坏瓶', '/activity/rain-poem/cloud-prank-bottle.png']],
    [2159, ['雨落成诗头像框', '/activity/rain-poem/avatar-frame.png?v=2']],
    [100003, ['化肥礼包', '/game-config/seed_images_named/100003_pack_03.png']],
  ]);

  for (const [itemId, [name, imageUrl]] of expected) {
    assert.equal(getItemById(itemId)?.name, name);
    assert.equal(getItemImageById(itemId), imageUrl);
    const imagePath = imageUrl.split('?', 1)[0];
    const publicPath = imagePath.startsWith('/activity/')
      ? path.join(__dirname, '..', '..', 'web', 'public', imagePath)
      : path.join(__dirname, '..', 'src', 'gameConfig', imageUrl.replace('/game-config/', ''));
    assert.equal(fs.existsSync(publicPath), true, `${name} image file`);
  }
});

test('recent bag items resolve official names and icons', () => {
  const expected = new Map([
    [1026, '鹊羽香囊'],
    [101304, '千星游记礼包'],
  ]);

  for (const [itemId, name] of expected) {
    assert.equal(getItemById(itemId)?.name, name);
    assertImageExists(itemId, `${name} image`);
  }
});

test('activity supplements preserve growth phases from the base plant config', () => {
  const baseBackedActivitySeeds = [
    21353, 20264, 21404, 20108, 21050, 21251, 21380, 20129, 20375, 20329
  ];
  for (const seedId of baseBackedActivitySeeds) {
    const plant = getPlantBySeedId(seedId);
    assert.ok(getPlantGrowPhases(plant.id).length > 0, `${plant.name} growth phases`);
  }
});

test('decoration fruits in the mutant illustrated have complete images', () => {
  assertImageExists(204003, 'golden pumpkin tower image');
  assertImageExists(204004, 'moon lotus tower image');
  assertImageExists(204005, 'golden moon lotus tower image');
  assertImageExists(204006, 'star bell tower image');
  assertImageExists(204007, 'golden star bell tower image');
});

test('current activity plants cover crop and mutant illustrated mappings', () => {
  for (const plant of activityPlants) {
    const seed = getItemById(plant.seedId);
    const fruit = getItemById(plant.fruitId);
    const plantConfig = getPlantBySeedId(plant.seedId);

    assert.equal(seed?.name, `${plant.name}种子`, `${plant.asset} seed name`);
    assert.equal(seed?.asset_name, plant.asset, `${plant.asset} seed asset`);
    assert.equal(fruit?.name, plant.name, `${plant.asset} fruit name`);
    assert.equal(fruit?.asset_name, plant.asset, `${plant.asset} fruit asset`);
    assert.equal(plantConfig?.id, plant.plantId, `${plant.asset} plant mapping`);
    assert.equal(plantConfig?.fruit?.id, plant.fruitId, `${plant.asset} fruit mapping`);
    assertImageExists(plant.seedId, `${plant.asset} seed image`);
    assertImageExists(plant.fruitId, `${plant.asset} fruit image`);
    assertImageExists(plant.mutantId, `${plant.asset} mutant image`);
  }
});
