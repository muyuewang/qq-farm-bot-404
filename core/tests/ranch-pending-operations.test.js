const test = require('node:test');
const assert = require('node:assert/strict');

// itemDto 先查牧场自带道具表（MCItemInfo），查不到才回落到全局 gameConfig。
// 这里用两个表外 id，确保断言的是桩件返回值，不与仓库配置版本的真实名字耦合。
const OUTSIDE_RANCH_ITEMS = 910001;
const OUTSIDE_RANCH_COST = 910002;

function loadModel(goods = {}) {
    const mock = (name, exports) => {
        const id = require.resolve(`../dist/${name}`);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    mock('config/gameConfig', {
        getItemById: id => ({ name: `桩物品${id}`, image: '' }),
        getItemImageById: () => '',
        getShopGoodsById: id => goods[id],
    });
    const id = require.resolve('../dist/services/ranch/model');
    delete require.cache[id];
    return require(id);
}

test('待核对账本把购买记录补成具体商品名，消耗也带上物品名', () => {
    const { pendingOperationView } = loadModel({ 88001: { item_id: OUTSIDE_RANCH_ITEMS } });
    const view = pendingOperationView({
        id: 'op-1',
        target: 'ranch:buy:88001',
        label: '购买牧场商品',
        message: '结果待核对',
        costs: [{ resourceKey: `item:${OUTSIDE_RANCH_COST}`, amount: '45000' }],
    });
    assert.equal(view.label, `购买桩物品${OUTSIDE_RANCH_ITEMS}`, '通用占位名必须换成商品对应道具名');
    assert.deepEqual(view.costs, [{ resourceKey: `item:${OUTSIDE_RANCH_COST}`, amount: '45000', name: `桩物品${OUTSIDE_RANCH_COST}` }]);
});

test('商品查不到或本就有具体标签时保持原样，不编造名称', () => {
    const { pendingOperationView } = loadModel({});
    const unknown = pendingOperationView({ id: 'a', target: 'ranch:buy:999', label: '购买牧场商品', costs: [] });
    assert.equal(unknown.label, '购买牧场商品', 'goods 表里没有该商品时不改写标签');
    const other = pendingOperationView({ id: 'b', target: 'ranch:clean', label: '清理牧场', costs: [] });
    assert.equal(other.label, '清理牧场');
});
