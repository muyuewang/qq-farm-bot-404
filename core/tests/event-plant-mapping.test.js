const assert = require('node:assert/strict');
const test = require('node:test');

const {
    getPlantBySeedId,
    getPlantById,
    getPlantByFruitId,
    getAllPlants,
    getAllSeeds,
} = require('../dist/config/gameConfig');

// 红薯只登记在 EventPlants.json（seed 20307），不在 Plant.json。
// getBagSeeds() 依赖 getPlantBySeedId 识别背包种子，缺这条映射会回退到第二策略。
const SWEET_POTATO_SEED_ID = 20307;
const SWEET_POTATO_PLANT_ID = 1020307;
const SWEET_POTATO_FRUIT_ID = 40307;

test('活动作物红薯进入植物/种子/果实映射', () => {
    const plant = getPlantBySeedId(SWEET_POTATO_SEED_ID);
    assert.ok(plant, '红薯种子应能查到植物配置');
    assert.equal(plant.id, SWEET_POTATO_PLANT_ID);
    assert.equal(plant.name, '红薯');
    assert.equal(getPlantById(SWEET_POTATO_PLANT_ID), plant);
    assert.equal(getPlantByFruitId(SWEET_POTATO_FRUIT_ID), plant);
});

test('活动作物红薯按单格作物识别，可进入背包种子优先', () => {
    const plant = getPlantBySeedId(SWEET_POTATO_SEED_ID);
    assert.ok(plant);
    assert.equal(Number(plant.size) || 1, 1);
    const seed = getAllSeeds().find((item) => item.seedId === SWEET_POTATO_SEED_ID);
    assert.ok(seed, '红薯种子应出现在全部种子列表');
    assert.equal(seed.size, 1);
});

test('合并活动作物不覆盖正式作物配置', () => {
    // 星语铃花同时在 Plant.json 和 EventPlants.json，正式配置应保留
    const plant = getPlantBySeedId(29003);
    assert.ok(plant);
    assert.equal(plant.name, '星语铃花');
    assert.equal(Number(plant.size), 2, '2x2 作物的 size 不能被活动表覆盖');
    assert.equal(getAllPlants().filter((item) => item.seed_id === 29003).length, 1);
});
