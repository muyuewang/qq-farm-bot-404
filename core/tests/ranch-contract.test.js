const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = rel => readFileSync(resolve(__dirname, '..', 'src', rel), 'utf8');

const contract = read('services/ranch/contract.ts');
const transport = read('services/ranch/transport.ts');
const state = read('services/ranch/state.ts');

/**
 * 这三个动作是 PR#175 新增的：沙漏加速升级、礼包商城购买、道具上锁。
 * 它们分别落在两处契约里——动作白名单（控制器校验入参）和 RPC 路由表（真的发请求），
 * 少写任何一处都会表现为「界面点得动但请求发不出去」，所以用源码级断言钉住。
 */
test('沙漏加速、礼包商城、道具锁定在动作白名单与路由表里都有实现', () => {
    for (const action of ['speedUpUpgrade', 'buyMall', 'setItemLock'])
        assert.match(contract, new RegExp(`'${action}'`), `${action} 不在 ACTIONS 白名单里`);

    // 上锁/解锁是一个动作两个方向，路由表里各自一条。
    for (const [route, method, replyType] of [
        ['speedUpUpgrade', 'SpeedUpBuildingUpgrade', 'RanchSpeedUpBuildingUpgrade'],
        ['lockItems', 'LockItems', 'LockItemsReply'],
        ['unlockItems', 'UnlockItems', 'UnlockItemsReply'],
    ]) {
        const line = transport.split('\n').find(row => row.trimStart().startsWith(`${route}:`));
        assert.ok(line, `transport 缺少 ${route} 路由`);
        assert.match(line, new RegExp(`'${method}'`), `${route} 路由的方法名不是 ${method}`);
        // rpc 用 type 拼 `${type}Request`，回包则用第 4 段；缺这一段会解码到不存在的消息。
        assert.match(line, new RegExp(`'${replyType}'`), `${route} 缺少回包类型 ${replyType}`);
    }
});

test('牧场视图白名单包含概览与礼包商城，且两者各有独立段落', () => {
    const line = state.split('\n').find(row => row.includes("'INVALID_ARGUMENT', '未知牧场页面'"));
    assert.ok(line, '找不到牧场视图白名单');
    for (const view of ['overview', 'mall'])
        assert.ok(line.includes(`'${view}'`), `视图白名单缺少 ${view}`);

    assert.match(state, /if \(view === 'overview'\) state\.career = /, '概览视图没有下发生涯段');
    assert.match(state, /if \(view === 'mall'\) state\.mall = /, '礼包商城视图没有下发 mall 段');
});

/**
 * 礼包商城比罐头商城多放行沙漏（1006），其他商品仍要求能在罐头配置表里识别。
 * 这条判据只有一个开关，改成两套实现就会出现「罐头商城混进沙漏」或「礼包商城缺沙漏」。
 */
test('礼包商城放行沙漏，罐头商城不放行', () => {
    assert.match(state, /async function ranchMallCatalog\(raw: any, slotType = 6, cansOnly = false\)/);
    assert.match(state, /function canCatalog\(raw: any, slotType = 6\): Promise<any> \{\s*return ranchMallCatalog\(raw, slotType, true\);/);
    assert.match(state, /!canMap\.has\(Number\(item\.id\)\) && \(cansOnly \|\| Number\(item\.id\) !== 1006\)/);
});

/**
 * 罐头使用时机（PR#177）：普通与有机各一套配置，喂养时按桶类型读对应字段。
 * 这条链路有三处必须同时成立，缺一处就表现为「设置里改了、喂养行为不变」：
 * 配置项存在 → automation 按桶类型取到 → actions 真的用它筛动物。
 */
test('罐头使用时机按桶类型分别下发给喂养', () => {
    const actions = read('services/ranch/actions.ts');
    const automation = read('services/ranch/automation.ts');
    const config = read('config/ranch-automation.ts');

    for (const stage of ['any', 'longest', 'to_production', 'near_harvest'])
        assert.ok(config.includes(`'${stage}'`), `配置缺少 ${stage} 时机`);

    // 直接喂养按桶类型读不同入参：有机桶读 organicStage，普通桶读 normalStage。
    assert.match(actions, /bucketType === 1 \? input\.organicStage : input\.normalStage/);
    assert.match(actions, /matchesFeedStage\(animal, strategy, nowMs\)/);
    // automation 必须按桶类型选配置键，写死成普通罐头会让有机勾选失效。
    assert.match(automation, /input\.bucketType === 2 \? 'ranch_feed_normal_stage' : 'ranch_feed_organic_stage'/);
    // 快收获时机要参与唤醒，否则巡查按原定收获时间跑，等到点已经错过窗口。
    assert.match(automation, /harvestAt - RANCH_NEAR_HARVEST_MS/);
});
