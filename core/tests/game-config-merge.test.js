'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    loadConfigs,
    getPlantById,
    getPlantBySeedId,
    getPlantByFruitId,
    getAllPlants,
    getAllSeeds,
    getItemById,
    isInvalidPlant,
    isInvalidSeedId,
    filterInvalidPlants,
} = require('../dist/config/gameConfig');

/**
 * b23ae38（TS 重构）丢了两段旧逻辑：EventPlants.json 合并、InvalidPlants.json 过滤。
 * 这里锁定两类回归：活动种子能被背包识别，无效种子不再进入任何候选池。
 */
test('EventPlants 合并：红薯/绣球花种子能被背包识别', () => {
    const sweetPotato = getPlantBySeedId(20307);
    assert.ok(sweetPotato, '红薯种子 20307 必须能查到植物，否则 getBagSeeds 会跳过');
    assert.equal(sweetPotato.name, '红薯');
    assert.equal(sweetPotato.id, 1020307);
    assert.equal(sweetPotato.fruit.id, 40307);
    assert.equal(sweetPotato.size, 1);

    const hydrangea = getPlantBySeedId(20207);
    assert.ok(hydrangea, '绣球花种子 20207 必须能查到植物');
    assert.equal(hydrangea.id, 1020207);

    const seeds = getAllSeeds();
    assert.ok(seeds.some(seed => seed.seedId === 20307), 'getAllSeeds 必须包含红薯种子');
    assert.ok(getPlantByFruitId(40307), '红薯果实 40307 必须能反查到植物');
});

test('EventPlants 合并不覆盖全量表已有条目', () => {
    // 1021404 在 Plant.json 叫「月光花」，EventPlants.json 叫「白牵牛花」，应以全量表为准。
    const plant = getPlantById(1021404);
    assert.ok(plant);
    assert.equal(plant.name, '月光花');
});

test('InvalidPlants 过滤：白萝卜不再进入植物/物品/背包', () => {
    assert.equal(isInvalidSeedId(29999), true);
    assert.equal(isInvalidPlant({ id: 2020002, seed_id: 29999 }), true);
    assert.equal(isInvalidPlant({ id: 20307, seed_id: 20307 }), false);
    assert.deepEqual(filterInvalidPlants([
        { id: 2020002, seed_id: 29999 },
        { id: 20307, seed_id: 20307 },
    ]).map(p => p.id), [20307]);

    // 地里已种下的白萝卜仍要能解析生长阶段，否则会被误判成空地铲掉。
    assert.ok(getPlantById(2020002), '无效植物资料仍保留在 plantMap 供生命周期解析');
    assert.equal(getPlantBySeedId(29999), undefined, '无效种子不能进入背包/种植候选');
    assert.equal(getItemById(29999), undefined);
    assert.equal(getAllPlants().some(p => p.id === 2020002), false);
    assert.equal(getAllSeeds().some(s => s.seedId === 29999), false);
});

test('EventPlants 补物品不覆盖官方 ItemInfo', () => {
    // 红薯种子/果实在官方 ItemInfo.json 里已有完整条目，合并时不得改写类型与价格。
    const seed = getItemById(20307);
    assert.ok(seed);
    assert.equal(seed.type, 5);
    assert.equal(seed.name, '红薯种子');

    const fruit = getItemById(40307);
    assert.ok(fruit);
    assert.equal(fruit.type, 6);
    assert.equal(fruit.sells, '1001:240');
});

test('loadConfigs 可重复调用且不重复追加活动植物', () => {
    const before = getAllPlants().length;
    loadConfigs();
    const after = getAllPlants().length;
    assert.equal(after, before, '重复加载不应让 plantMap 越变越大');
    assert.ok(getPlantBySeedId(20307), '重新加载后活动植物仍在');
});
