import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import {
  activityStatus,
  affordability,
  batchTargets,
  buildRanchBody,
  buildRanchDirectBody,
  buildRanchExecuteBody,
  describeOperateResult,
  describeQuote,
  grassRoom,
  isRanchDirectAction,
  isRanchUnlocked,
  mapRanchState,
  RANCH_ACTION_FIELDS,
  RANCH_ACTION_REQUIRED,
  RANCH_ACTIONS,
  RANCH_FIELD_LABELS,
  RANCH_VIEWS,
  taskRatio,
} from '../src/utils/ranch.ts'

// 固定夹具：仿 core/src/services/ranch/state.ts 的 DTO 结构。
// int64（ranch_inst_id、instance_id、数量、桶秒数）是十进制字符串，
// int32（animal_inst_id、slot、stage、level）是数字，serverTime/nextAtMs 是毫秒。
// 不连真实服务端。

const SERVER_TIME = 1_780_000_000_000

const hen = {
  id: 5001,
  animalId: 5001,
  ranchId: '1:101',
  name: '金鸡',
  stage: 2,
  stageName: '成长期',
  nextAtMs: SERVER_TIME + 90_000,
  canProduce: false,
  canHarvest: true,
  canFeed: true,
  canRelease: true,
  limitedCanUsed: false,
  grassBlocked: false,
  produceCount: '3',
  maxProduceCount: 5,
}

const cow = {
  id: 5002,
  animalId: 5002,
  ranchId: '1:101',
  name: '松果牛',
  stage: 1,
  stageName: '幼崽期',
  nextAtMs: SERVER_TIME + 3_600_000,
  canProduce: true,
  canHarvest: false,
  canFeed: true,
  canRelease: false,
  limitedCanUsed: true,
  grassBlocked: true,
  produceCount: '0',
  maxProduceCount: 4,
}

function baseState(overrides = {}) {
  return {
    unlocked: true,
    sceneId: 2,
    serverTime: SERVER_TIME,
    level: 12,
    currentExp: '3500',
    neededExp: '7000',
    reason: '',
    currencies: [
      { id: 1007, count: '12000000000000000000', name: '金券', image: '', locked: '300' },
      { id: 1002, count: '50', name: '点券', image: '' },
    ],
    buckets: [
      { id: 7003, seconds: '3600' },
      { id: 7004, seconds: '0' },
    ],
    grass: '40',
    facilities: [
      {
        id: '1:101',
        facilityId: 101,
        name: '鸡窝',
        moduleType: 1,
        level: 3,
        active: true,
        state: 1,
        upgradeState: 0,
        upgradeEndTime: 0,
        capacity: 4,
        ranch: {
          count: 2,
          capacity: 4,
          animals: [hen, cow],
          shelves: [
            { slot: 0, remaining: '12', canCollect: true, canSteal: true, products: [{ id: 7101, count: '12', name: '金鸡蛋' }] },
            { slot: 1, remaining: '0', canCollect: false },
          ],
          hazards: [{ id: '9001', type: 1 }],
        },
        next: { level: 4, capacity: 5, durationSec: 600, requiredLevel: 15, costs: [{ id: 1007, count: '45000' }], available: true },
      },
      {
        id: '1:201',
        facilityId: 201,
        name: '牧草机',
        moduleType: 3,
        level: 2,
        active: true,
        state: 1,
        capacity: 100,
        feed: { count: '40', consumeRate: 1, remainingSec: '900', status: 1 },
      },
      {
        id: '1:202',
        facilityId: 202,
        name: '升级中的棚',
        moduleType: 2,
        level: 1,
        active: true,
        state: 1,
        capacity: 2,
        upgradeState: 2,
        upgradeEndTime: Math.floor(SERVER_TIME / 1000) + 120,
      },
    ],
    pendingOperations: [
      { id: 'op-1', target: 'ranch:buy:88001', label: '购买幼崽', message: '结果待核对', createdAt: SERVER_TIME, costs: [{ resourceKey: 'item:1007', amount: '45000', name: '牧场金币' }] },
    ],
    ...overrides,
  }
}

test('RANCH_VIEWS、动作表与必填分支表一一对应，页面无法拼出后端不认识的动作', () => {
  assert.equal(RANCH_VIEWS.length, 10)
  const actions = [...RANCH_ACTIONS, 'acknowledge']
  assert.deepEqual([...actions].sort(), Object.keys(RANCH_ACTION_FIELDS).sort())
  assert.deepEqual([...actions].sort(), Object.keys(RANCH_ACTION_REQUIRED).sort())
  for (const action of actions) {
    for (const branch of RANCH_ACTION_REQUIRED[action]) {
      for (const key of branch)
        assert.ok(RANCH_ACTION_FIELDS[action].includes(key), `${action} 的必填字段 ${key} 必须在白名单里`)
    }
    // 缺字段名时错误提示会退化成英文键名，这里保证每个入参都有可读名称。
    for (const field of RANCH_ACTION_FIELDS[action])
      assert.ok(RANCH_FIELD_LABELS[field], `${action} 的字段 ${field} 缺少可读名称`)
  }
})

test('基础快照：int64 原样分组，桶与牧草进入资源条，未下发的段落保持 null', () => {
  const state = mapRanchState(baseState())
  assert.equal(state.unlocked, true)
  assert.equal(state.level, 12)
  assert.equal(state.progressPercent, 50)
  assert.deepEqual(state.resources.map(item => item.key), ['currency:1007', 'currency:1002', 'bucket:7003', 'bucket:7004', 'grass'])
  assert.equal(state.resources[0].value, '12,000,000,000,000,000,000')
  assert.equal(state.resources[0].locked, '300')
  assert.equal(state.resources[1].locked, null)
  assert.equal(state.resources[2].label, '普通罐头桶')
  assert.equal(state.resources[2].value, '1 小时')
  assert.equal(state.resources[3].label, '有机罐头桶')
  assert.equal(state.resources[3].seconds, '0')
  assert.equal(state.resources[4].value, '40')
  // 只请求 animals 时后端不会带其他段落，页面必须显示「未下发」而不是空列表。
  assert.equal(state.bag, null)
  assert.equal(state.shop, null)
  assert.equal(state.market, null)
  assert.equal(state.canShop, null)
  assert.equal(state.tasks, null)
  assert.equal(state.book, null)
  assert.equal(state.activities, null)
  assert.equal(state.friends, null)
  assert.equal(state.friendRanch, null)
  assert.equal(state.dailyShare, null)
  assert.deepEqual(state.pending[0].costs, [{ resourceKey: 'item:1007', amount: '45000', name: '牧场金币' }])
  assert.equal(state.pending[0].target, 'ranch:buy:88001')
})

test('待核对消耗名以后端下发为准，后端没给名字时留空交给页面兜底', () => {
  const state = mapRanchState(baseState({
    pendingOperations: [
      { id: 'op-2', target: 'ranch:clean', label: '清理牧场', message: '结果待核对', costs: [{ resourceKey: 'item:1002', amount: '10' }] },
    ],
  }))
  // 缺 name 不能写成猜测出来的物品名，页面会退回本页资源条或原始 resourceKey。
  assert.deepEqual(state.pending[0].costs, [{ resourceKey: 'item:1002', amount: '10', name: '' }])
})

test('显式空数组与未下发不同：后端确认「没有」时才渲染空态', () => {
  const state = mapRanchState(baseState({ bag: [], tasks: [] }))
  assert.deepEqual(state.bag, [])
  assert.deepEqual(state.tasks, [])
})

test('neededExp 缺失或为 0 时不伪造进度百分比', () => {
  assert.equal(mapRanchState(baseState({ neededExp: null })).progressPercent, 0)
  assert.equal(mapRanchState(baseState({ neededExp: '0' })).progressPercent, 0)
  assert.equal(mapRanchState(baseState({ neededExp: '7000' })).neededExp, '7000')
})

test('动物动作只看后端布尔位：限制罐头的动物走有机桶，桶为空时加速不可用', () => {
  const state = mapRanchState(baseState())
  const [henView, cowView] = state.facilities[0].ranch.animals
  assert.equal(henView.actions.find(item => item.action === 'feed').label, '普通罐头加速')
  assert.equal(henView.actions.find(item => item.action === 'feed').enabled, true)
  assert.equal(henView.actions.find(item => item.action === 'produce').reason, '当前阶段还不能生产')
  assert.equal(henView.actions.find(item => item.action === 'harvest').enabled, true)
  assert.equal(henView.actions.find(item => item.action === 'release').danger, true)
  assert.equal(henView.countdown, 90)

  assert.equal(cowView.bucketType, 1)
  const cowFeed = cowView.actions.find(item => item.action === 'feed')
  assert.equal(cowFeed.label, '有机罐头加速')
  assert.equal(cowFeed.enabled, false)
  assert.match(cowFeed.reason, /有机罐头桶为空/)
  assert.equal(cowView.actions.find(item => item.action === 'produce').reason, '缺少牧草，动物已停止产出')
  assert.equal(cowView.actions.find(item => item.action === 'release').enabled, false)
})

/** 只替换第一座栏舍里的动物列表，其余设施保持原样。 */
function withAnimals(animals) {
  const base = baseState()
  return baseState({
    facilities: [
      { ...base.facilities[0], ranch: { ...base.facilities[0].ranch, animals } },
      ...base.facilities.slice(1),
    ],
  })
}

test('生产到货时间单独透传：deliveringUntilMs 与 nextAtMs 不是同一个时点', () => {
  // 未下发 delivering_until_ms 时为 null，页面就不会安排到货刷新。
  assert.equal(mapRanchState(baseState()).facilities[0].ranch.animals[0].deliveringUntilMs, null)
  // 0 与负数都不是有效时间点，按未下发处理。
  assert.equal(mapRanchState(withAnimals([{ ...hen, deliveringUntilMs: 0 }])).facilities[0].ranch.animals[0].deliveringUntilMs, null)
  assert.equal(mapRanchState(withAnimals([{ ...hen, deliveringUntilMs: -1 }])).facilities[0].ranch.animals[0].deliveringUntilMs, null)

  const deliveringAt = SERVER_TIME + 600_000
  const animal = mapRanchState(withAnimals([{ ...hen, deliveringUntilMs: deliveringAt }])).facilities[0].ranch.animals[0]
  assert.equal(animal.deliveringUntilMs, deliveringAt)
  // 两个时点各自独立：催产确认后 nextAtMs 可能已经推进，到货仍要等到 deliveringUntilMs。
  assert.equal(animal.nextAtMs, hen.nextAtMs)
})

test('设施视图区分栏舍、牧草机与升级中设施', () => {
  const [coop, grassMachine, upgrading] = mapRanchState(baseState()).facilities
  assert.equal(coop.isRanch, true)
  assert.equal(coop.isGrassMachine, false)
  assert.equal(coop.summary.animalText, '2 / 4')
  assert.equal(coop.summary.hazardCount, 1)
  assert.equal(coop.summary.shelfText, '1 个货架有产物')
  assert.equal(coop.next.available, true)
  assert.equal(coop.upgradeCountdown, null)
  assert.equal(grassMachine.isGrassMachine, true)
  assert.equal(grassMachine.feed.count, '40')
  assert.equal(grassRoom(grassMachine), 60n)
  assert.equal(grassRoom({ ...grassMachine, capacity: 100, feed: { ...grassMachine.feed, count: '100' } }), 0n)
  assert.equal(upgrading.upgradeState, 2)
  assert.equal(upgrading.ranch, null)
  assert.ok(upgrading.upgradeCountdown > 0)
})

test('一级棚可激活只看后端下发的 canActivate，页面不自行按等级或 state 推断', () => {
  // 后端 canActivateShed = level >= 21 && module_type === 7 && facility_id === 6002001 && state === 3，
  // 前端只透传这个布尔位，等级不足或 state 不是 3 时后端不会给 true。
  const pending = {
    id: '1:900',
    facilityId: 6002001,
    name: '一级棚',
    moduleType: 7,
    level: 1,
    active: false,
    state: 3,
    canActivate: true,
    capacity: 4,
  }
  const state = mapRanchState(baseState({ facilities: [pending] }))
  assert.equal(state.facilities[0].canActivate, true)
  assert.equal(state.facilities[0].active, false)
  // 未下发 canActivate 时一律按不可激活处理，避免老快照凭空长出解锁按钮。
  const legacy = mapRanchState(baseState({ facilities: [{ ...pending, canActivate: undefined }] }))
  assert.equal(legacy.facilities[0].canActivate, false)
  // 非布尔值同样不算已下发，挡住后端序列化成字符串的情况。
  const stringy = mapRanchState(baseState({ facilities: [{ ...pending, canActivate: 'true' }] }))
  assert.equal(stringy.facilities[0].canActivate, false)
  // 普通栏舍（module_type 1）不会是待激活棚。
  const coop = mapRanchState(baseState()).facilities[0]
  assert.equal(coop.canActivate, false)
})

test('一键操作只统计后端允许的目标，危险物按数量汇总', () => {
  const state = mapRanchState(baseState())
  assert.deepEqual(batchTargets(state, 'harvest'), { animals: 1, shelves: 1, hazards: 0, total: 2 })
  assert.deepEqual(batchTargets(state, 'produce'), { animals: 1, shelves: 0, hazards: 0, total: 1 })
  assert.deepEqual(batchTargets(state, 'clean'), { animals: 0, shelves: 0, hazards: 1, total: 1 })
  assert.deepEqual(batchTargets(null, 'harvest'), { animals: 0, shelves: 0, hazards: 0, total: 0 })
})

test('请求体只带白名单字段，必填分支不满足时不发起请求', () => {
  assert.deepEqual(
    buildRanchBody('buy', { goodsId: 7101, count: 2, shopId: 5, autoPlace: true, uid: 'should-drop' }),
    { ok: true, body: { goodsId: 7101, count: 2, shopId: 5, autoPlace: true } },
  )
  const missingShop = buildRanchBody('buy', { goodsId: 7101, count: 2 })
  assert.equal(missingShop.ok, false)
  assert.match(missingShop.error, /商店/)

  // feed 的两个分支：全部或指定目标。
  assert.deepEqual(buildRanchBody('feed', { all: true }), { ok: true, body: { all: true } })
  assert.equal(buildRanchBody('feed', { ranchId: '1:101', animalId: 5001, bucketType: 2 }).ok, true)
  assert.equal(buildRanchBody('feed', { animalId: 5001 }).ok, false)
  assert.equal(buildRanchBody('clean', {}).ok, true)

  // 空串与 null 不算已填，避免拿 undefined 去撞后端。
  assert.equal(buildRanchBody('steal', { hostGid: '' }).ok, false)
  assert.equal(buildRanchBody('stroke', { hostGid: '88', ranchId: null, animalId: 3 }).ok, false)

  // 放生必须逐只，后端没有 all 分支。
  const releaseAll = buildRanchBody('release', { all: true, ranchId: '1:101', animalId: 5001 })
  assert.equal(releaseAll.ok, false)
  assert.match(releaseAll.error, /一键放生/)
  assert.equal(buildRanchBody('unknownAction', {}).ok, false)
})

test('普通罐头阶段与喂养后催产随喂养请求下发，不再被白名单丢掉', () => {
  // 这两个字段曾是新增协议里的字段，白名单没跟上就会被静默过滤，用户选了也不生效。
  assert.deepEqual(
    buildRanchBody('feed', { all: true, bucketType: 2, normalStage: 'longest', produceAfterFeed: true }),
    { ok: true, body: { all: true, bucketType: 2, normalStage: 'longest', produceAfterFeed: true } },
  )
  // 有机罐头不筛阶段，只带桶类型也能正常通过。
  assert.deepEqual(
    buildRanchBody('feed', { all: true, bucketType: 1 }),
    { ok: true, body: { all: true, bucketType: 1 } },
  )
  // 直投路径同样保留这两个字段，且仍然不带 expected。
  assert.deepEqual(
    buildRanchDirectBody('feed', { all: true, bucketType: 2, normalStage: 'any', produceAfterFeed: true }),
    { ok: true, body: { all: true, bucketType: 2, normalStage: 'any', produceAfterFeed: true, direct: true } },
  )
  // 其它动作不认这两个字段，即便传了也不会被带出去。
  assert.deepEqual(buildRanchBody('produce', { all: true, normalStage: 'longest' }), { ok: true, body: { all: true } })
  // 每个入参都要有可读名称，否则错误提示会退化成英文键名。
  assert.ok(RANCH_FIELD_LABELS.normalStage)
  assert.ok(RANCH_FIELD_LABELS.produceAfterFeed)
})

test('一级棚解锁走报价确认而不是直投，缺少设施时直接拒绝', () => {
  // 解锁免费但会改动账号状态，不能借 direct 绕开确认。
  assert.equal(isRanchDirectAction('activateShed'), false)
  assert.equal(buildRanchDirectBody('activateShed', { facilityId: '1:900' }).ok, false)
  assert.deepEqual(buildRanchBody('activateShed', { facilityId: '1:900' }), { ok: true, body: { facilityId: '1:900' } })
  const missing = buildRanchBody('activateShed', {})
  assert.equal(missing.ok, false)
  assert.match(missing.error, /设施/)
})

test('两阶段协议：execute 必须回传报价签名，skipped 报价不发起写请求', () => {
  assert.equal(buildRanchExecuteBody('harvest', { all: true }).ok, false)
  assert.match(buildRanchExecuteBody('harvest', { all: true }).error, /报价/)

  const skipped = buildRanchExecuteBody('harvest', { all: true }, { skipped: true, message: '当前没有可收获的产物' })
  assert.equal(skipped.ok, false)
  assert.equal(skipped.skipped, true)
  assert.equal(skipped.error, '当前没有可收获的产物')

  assert.equal(buildRanchExecuteBody('harvest', { all: true }, { skipped: false, expected: {} }).ok, false)

  const body = buildRanchExecuteBody('sell', { uid: '9527', count: 3 }, { skipped: false, expected: { signature: 'sig-1' } })
  assert.deepEqual(body, { ok: true, body: { uid: '9527', count: 3, expected: { signature: 'sig-1' } } })
  // 入参与报价不一致时（缺必填），仍然拒绝，不会带着签名硬打。
  assert.equal(buildRanchExecuteBody('sell', { uid: '9527' }, { expected: { signature: 'sig-1' } }).ok, false)
})

test('直投协议：只有喂养 / 催产 / 收获 / 清理免报价，其余动作仍强制走报价', () => {
  // 四个免报价动作：带上 direct 标记，且不带 expected。
  for (const action of ['feed', 'produce', 'harvest', 'clean']) {
    assert.equal(isRanchDirectAction(action), true, `${action} 应走直投`)
  }
  assert.deepEqual(buildRanchDirectBody('harvest', { all: true }), { ok: true, body: { all: true, direct: true } })
  assert.deepEqual(buildRanchDirectBody('clean', {}), { ok: true, body: { direct: true } })
  assert.deepEqual(buildRanchDirectBody('feed', { all: true, bucketType: 2 }), { ok: true, body: { all: true, bucketType: 2, direct: true } })

  // 直投同样受白名单与必填约束，未知字段不会漏发。
  assert.equal(buildRanchDirectBody('produce', { ranchId: '1:101', animalId: 5001 }).ok, true)
  assert.equal(buildRanchDirectBody('feed', { animalId: 5001 }).ok, false)

  // 交易类动作不能借 direct 绕开成本确认。
  for (const action of ['sell', 'buy', 'release', 'upgrade', 'useCan']) {
    assert.equal(isRanchDirectAction(action), false, `${action} 不应走直投`)
    assert.equal(buildRanchDirectBody(action, { uid: '9527', count: 1, all: true }).ok, false)
  }
})

test('写操作结果：未知状态不当成成功', () => {
  assert.deepEqual(
    describeOperateResult({ status: 'confirmed', notice: '收获完成', refreshRequired: true }),
    { status: 'confirmed', message: '收获完成', refreshRequired: true },
  )
  const skipped = describeOperateResult({ status: 'skipped' })
  assert.equal(skipped.status, 'skipped')
  assert.match(skipped.message, /已跳过/)
  assert.deepEqual(describeOperateResult({ status: 'weird' }), { status: 'unknown', message: '牧场返回了未知状态：weird', refreshRequired: true })
  const unknown = describeOperateResult({})
  assert.equal(unknown.status, 'unknown')
  assert.match(unknown.message, /勿重复提交/)
})

test('报价文案：skipped 用后端说明，正常报价汇总数量、消耗与预计获得', () => {
  assert.deepEqual(describeQuote(null), { summary: '', detail: [], skipped: true, count: 0 })
  assert.equal(describeQuote({ skipped: true, message: '背包没有可出售产物' }).summary, '背包没有可出售产物')
  const quote = describeQuote({ count: 2, costItems: [{ id: 1007, count: '45000', name: '金券' }], rewards: [{ id: 7101, count: '12', name: '金鸡蛋' }] })
  assert.equal(quote.skipped, false)
  assert.equal(quote.count, 2)
  assert.equal(quote.summary, '数量：2　·　消耗：金券 ×45,000　·　预计获得：金鸡蛋 ×12')
  assert.deepEqual(quote.detail.map(item => item.id), ['1007', '7101'])
})

test('余额未确认时不把「买不起」当成结论', () => {
  assert.equal(affordability('120', '100'), true)
  assert.equal(affordability('99', '100'), false)
  assert.equal(affordability(null, '100'), null)
  assert.equal(affordability('', '100'), null)
})

test('活动三态只用服务端毫秒时钟，起止时间都没下发时不猜', () => {
  const active = { startTime: SERVER_TIME - 1000, endTime: SERVER_TIME + 1000 }
  assert.equal(activityStatus(active, SERVER_TIME).state, 'active')
  assert.equal(activityStatus({ startTime: SERVER_TIME + 1000, endTime: SERVER_TIME + 9000 }, SERVER_TIME).state, 'upcoming')
  assert.equal(activityStatus({ startTime: SERVER_TIME - 9000, endTime: SERVER_TIME - 1000 }, SERVER_TIME).state, 'ended')
  assert.deepEqual(activityStatus({}, SERVER_TIME), { label: '时间未下发', state: 'unknown' })
  // 只下发开始时间且已过：没有结束时间证据时仍按进行中展示，但不显示结束时刻由页面负责。
  assert.equal(activityStatus({ startTime: SERVER_TIME - 1000, endTime: 0 }, SERVER_TIME).state, 'active')
  assert.equal(activityStatus(active, 0).state, 'unknown')
  assert.equal(activityStatus(active, null).state, 'unknown')
})

test('任务进度不伪造分母', () => {
  assert.deepEqual(taskRatio({ progress: '3', total: '0' }), { percent: 0, known: false, progress: '3', total: '0' })
  assert.deepEqual(taskRatio({ progress: '3', total: '10' }), { percent: 30, known: true, progress: '3', total: '10' })
  assert.equal(taskRatio({ progress: '20', total: '10' }).percent, 100)
})

test('好友栏舍的动物没有自家动作位', () => {
  const state = mapRanchState(baseState({
    friendRanch: {
      gid: '88001',
      name: '小明',
      level: 20,
      canSteal: true,
      stealableShelves: 2,
      cleanableHazards: 1,
      strokeRemaining: 3,
      mosquitoRemaining: 0,
      ranches: [{ id: '1:101', name: '鸡窝', mosquitoes: 1, mosquitoLimit: 3, mosquitoRoom: 2, animals: [hen], shelves: [{ slot: 0, remaining: '5', canSteal: true }] }],
    },
  }))
  assert.equal(state.friendRanch.gid, '88001')
  assert.equal(state.friendRanch.strokeRemaining, 3)
  assert.equal(state.friendRanch.mosquitoRemaining, 0)
  const animals = state.friendRanch.ranches[0].animals
  assert.equal(animals[0].isFriend, true)
  assert.deepEqual(animals[0].actions, [])
  assert.equal(state.friendRanch.ranches[0].shelves[0].canSteal, true)
})

test('未解锁的牧场只给出后端原因，不渲染零值快照', () => {
  assert.equal(isRanchUnlocked(baseState({ unlocked: false })), false)
  assert.equal(isRanchUnlocked(null), false)
  const state = mapRanchState(baseState({ unlocked: false, reason: '农场等级不足' }))
  assert.equal(state.unlocked, false)
  assert.equal(state.reason, '农场等级不足')
  assert.equal(mapRanchState(null), null)
})
