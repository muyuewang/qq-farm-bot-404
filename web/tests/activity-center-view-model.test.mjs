import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import {
  mapCharityFlowerActivity,
  mapQixiActivity,
  mapRainPoemActivity,
  mapSolarTerms,
  mapStarActivity,
} from '../src/utils/activity-center.ts'

// 固定夹具：仿 core/src/services/activity-center/*.ts 的 itemDto/DTO 结构，
// int64 一律是十进制字符串，protobufjs 省略的默认字段直接不出现。不连真实服务端。

const qixiDto = {
  activityId: '2026081001',
  title: '鹊桥寄情',
  startTime: '1792029600',
  endTime: '1794844799',
  active: true,
  feather: { id: '5101', count: '120', name: '鹊羽', image: '/activity/qixi/feather.png' },
  dew: { id: '5102', count: '0', name: '鹊羽灵露', image: '' },
  sachet: { id: '5103', count: '0', name: '鹊羽香囊', image: '' },
  balances: { feather: '120', dew: '3', sachet: '2', known: true },
  bridge: {
    currentStage: 2,
    stages: [
      { id: '1', stage: 1, statusCode: '2', completed: true, claimed: true, claimable: false, current: false, cost: { id: '5101', count: '50' }, rewards: [{ id: '49001', count: '1', name: '鹊桥残片' }] },
      { id: '2', stage: 2, statusCode: '1', completed: false, claimed: false, claimable: true, current: true, cost: { id: '5101', count: '80' }, rewards: [{ id: '49002', count: '2', name: '星辉' }, { id: '1001', count: '5000', name: '金币' }] },
      { id: '3', stage: 3, statusCode: '0', completed: false, claimed: false, claimable: false, current: false, cost: { id: '5101', count: '120' }, rewards: [] },
    ],
  },
  gift: {
    sentCount: '3',
    sendLimit: '5',
    exchanges: [{ costItems: [{ id: '5103', count: '1', name: '鹊羽香囊' }], receiveItems: [{ id: '5104', count: '1', name: '回礼' }] }],
  },
  actions: { gift: { enabled: true }, dew: { enabled: true }, bridge: { enabled: true } },
}

test('七夕：int64 字符串转数字，当前阶段按 current 标记取', () => {
  const view = mapQixiActivity(qixiDto)
  assert.equal(view.activityId, 2026081001)
  assert.equal(view.startTime, 1792029600)
  assert.equal(view.items.feather.itemCount, 120)
  assert.equal(view.bridge.completedCount, 1)
  assert.equal(view.bridge.nextStage.id, 2)
  assert.equal(view.bridge.nextStage.cost.itemCount, 80)
  assert.equal(view.bridge.nextStage.rewards.length, 2)
  assert.equal(view.bridge.stages[2].rewards.length, 0)
  assert.equal(view.gift.maxCount, 5)
  assert.equal(view.gift.remainingCount, 2)
  assert.equal(view.gift.enabled, true)
})

test('七夕：背包没读到时应记为余额未知，而不是谎报 0', () => {
  const unknown = mapQixiActivity({ ...qixiDto, balances: { feather: null, dew: null, sachet: null, known: false } })
  assert.equal(unknown.items.dew.countKnown, false)
  // 数量字段仍是 itemDto 里的 0，页面靠 countKnown 显示「-」。
  assert.equal(unknown.items.dew.itemCount, 0)
  const known = mapQixiActivity(qixiDto)
  assert.equal(known.items.dew.countKnown, true)
})

test('七夕：空响应和缺段落都不能被映射成成功数据', () => {
  assert.equal(mapQixiActivity(null), null)
  assert.equal(mapQixiActivity('boom'), null)
  const empty = mapQixiActivity({})
  assert.equal(empty.bridge.stages.length, 0)
  assert.equal(empty.bridge.nextStage, null)
  assert.equal(empty.gift.enabled, false)
  assert.equal(empty.active, false)
  // 段落整体缺失时读成空道具，配合 balances.known=false 显示「-」而不是崩在 undefined 上。
  assert.equal(empty.items.feather.itemId, 0)
  assert.equal(empty.items.feather.countKnown, false)
})

const weatherDto = {
  activity: { name: '雨落成诗', startTime: '1792029600', endTime: '1794844799' },
  active: true,
  inventory: [
    { id: '5001', count: '6', name: '天气采集瓶' },
    { id: '5002', count: '2', name: '雷雨召唤瓶' },
    { id: '5005', count: '0', name: '青蛙捣蛋瓶' },
    { id: '5006', count: '1', name: '乌云捣蛋瓶' },
    { id: '1027', count: '18', name: '雷电徽章' },
  ],
  ownWeather: { type: 3, status: 1, beginTime: 1793000000, endTime: 1793003600, isThunderstorm: true, active: true },
  shop: { item: { id: '5001', count: '2', name: '天气采集瓶' }, cost: { id: '1004', count: '10', name: '钻石' }, owned: false, available: true, dailyLimit: 1 },
  collector: {
    rewards: [
      { id: '1', reward: { id: '5002', count: '1', name: '雷雨召唤瓶' }, statusCode: '0' },
      { id: '2', reward: { id: '49005', count: '3', name: '星语铃花果实' }, statusCode: '0' },
    ],
  },
  actions: { collectWeather: { enabled: true, dailyLimit: 10 } },
  tasks: [
    { id: '9001', triggerItemId: '5001', title: '使用采集瓶 3 次', dailyLimit: '3', current: '1', reward: { id: '1027', count: '2', name: '雷电徽章' } },
  ],
  research: {
    currentStage: '1',
    nodes: [
      { id: '1', statusCode: '4', availableByStatus: false, completed: true, cost: { id: '1027', count: '5', name: '雷电徽章' }, reward: { id: '49006', count: '1', name: '雨天装饰' } },
      { id: '2', statusCode: '2', availableByStatus: true, completed: false, cost: { id: '1027', count: '8', name: '雷电徽章' }, reward: { id: '49007', count: '1', name: '彩虹装饰' } },
      { id: '3', statusCode: '1', availableByStatus: false, completed: false, cost: { id: '1027', count: '12', name: '雷电徽章' }, reward: { id: '49008', count: '1', name: '云台装饰' } },
    ],
  },
}

test('雨落成诗：库存按固定道具 ID 归位，商店缺下发时为 null', () => {
  const view = mapRainPoemActivity(weatherDto)
  assert.deepEqual(view.items, { collectionBottles: 6, summonBottles: 2, frogPrankBottles: 0, cloudPrankBottles: 1, badges: 18 })
  assert.equal(view.shop.dailyLimit, 1)
  assert.equal(view.shop.cost.itemId, 1004)
  assert.equal(mapRainPoemActivity({ ...weatherDto, shop: null }).shop, null)
})

test('雨落成诗：新协议没有今日剩余采集次数，只能留空让页面显示未下发', () => {
  const view = mapRainPoemActivity(weatherDto)
  assert.equal(view.collection.dailyUseLimit, 10)
  assert.equal(view.collection.remainingUseCount, null)
  assert.deepEqual(view.collection.rewards.map(r => r.itemName), ['雷雨召唤瓶', '星语铃花果实'])
})

test('雨落成诗：研究节点用 statusCode 2 表示当前可推进，4 或 claimed 表示已完成', () => {
  const view = mapRainPoemActivity(weatherDto)
  assert.equal(view.research.stages[0].completed, true)
  assert.equal(view.research.stages[1].available, true)
  assert.equal(view.research.stages[2].available, false)
  assert.equal(view.research.stages[2].completed, false)
  assert.equal(view.tasks[0].target, 3)
  assert.equal(view.tasks[0].itemId, 5001)
  assert.equal(view.weather.rainstorm, true)
  assert.equal(view.weather.startTime, 1793000000)
})

const charityDto = {
  activityId: '2026040301',
  title: '公益小红花',
  startTime: '1792029600',
  endTime: '1794844799',
  active: true,
  love: { id: '1030', count: '7', name: '爱心' },
  loveBalance: '7',
  donatedLove: '133',
  dailyGift: {
    claimed: true,
    reward: { id: '1030', count: '1', name: '爱心' },
    publicFund: { date: '1793000000', statusCode: '2' },
  },
  progressRewards: [
    { target: '50', reached: true, claimed: true, claimable: false, reward: { id: '49009', count: '1', name: '小红花种子' } },
    { target: '150', reached: true, claimed: false, claimable: true, reward: { id: '49010', count: '2', name: '公益装饰' } },
    { target: '300', reached: false, claimed: false, claimable: false, reward: { id: '49011', count: '1', name: '爱心框' } },
  ],
  globalProgress: { donated: '1024000', target: '2000000', reached: false },
  settlement: { requiredLove: '200', eligible: false, reward: { id: '49012', count: '1', name: '公益勋章' } },
  actions: { donateLove: { enabled: true }, claimDailyGift: { enabled: false } },
}

test('公益小红花：进度只按爱心计数，不再编造金额和结算时间', () => {
  const view = mapCharityFlowerActivity(charityDto)
  assert.equal(view.love.count, 7)
  assert.equal(view.love.personalScore, 133)
  assert.equal(view.global.score, 1024000)
  assert.equal(view.global.target, 2000000)
  assert.equal(view.finalReward.threshold, 200)
  assert.equal(view.finalReward.eligible, false)
  assert.equal('amountYuan' in view.global, false)
})

test('公益小红花：达成与可领取分开，公益金只留日期和状态码', () => {
  const view = mapCharityFlowerActivity(charityDto)
  assert.deepEqual(view.personalRewards.map(tier => [tier.reached, tier.claimable]), [[true, false], [true, true], [false, false]])
  assert.deepEqual(view.publicFund, { date: 1793000000, statusCode: '2' })
  assert.equal(mapCharityFlowerActivity({ ...charityDto, dailyGift: { claimed: false } }).publicFund, null)
  assert.equal(view.share.claimed, true)
  assert.equal(view.share.claimable, false)
})

const stellarDto = {
  serverTime: 1793000000,
  season: {
    id: '20261101',
    title: '星垂野',
    statusCode: '1',
    startTime: '1792029600',
    endTime: '1794844799',
    pass: {
      activityId: '2026110102',
      title: '千星游记',
      level: '7',
      progress: '320',
      progressMax: '500',
      claimedThroughLevel: '5',
      nodeCount: '10',
      nodes: [
        { id: '6', level: '6', locked: false, claimed: false, claimable: true, rewards: [{ id: '49020', count: '1', name: '星砂礼包' }] },
        { id: '7', level: '7', locked: false, claimed: false, claimable: true, rewards: [{ id: '1023', count: '60', name: '星砂' }] },
        { id: '8', level: '8', locked: true, claimed: false, claimable: false, rewards: [] },
      ],
    },
  },
  constellation: {
    currentDay: 12,
    groups: [
      { id: '1', nodeId: '101', name: '角', category: '东方苍龙', explain: '春见', opened: true, lit: true, visualState: 'lit', rewards: [{ id: '49021', count: '1', name: '角宿奖励' }] },
      { id: '2', nodeId: '102', name: '亢', category: '东方苍龙', explain: '夏见', opened: true, lit: false, visualState: 'lightable', rewards: [] },
      { id: '3', nodeId: '103', name: '氐', category: '东方苍龙', explain: '秋见', opened: null, lit: null, visualState: 'claimableUnknown', rewards: [] },
      { id: '4', nodeId: '104', name: '房', category: '东方苍龙', explain: '冬见', opened: false, lit: false, visualState: 'locked', rewards: [] },
    ],
  },
  shop: {
    currencies: [{ id: '1023', count: '260', name: '星砂', balance: '260', balanceKnown: true }],
    goods: [
      { id: '9001', name: '星语装饰', category: '装饰', item: { id: '49030', count: '1', name: '星语装饰', image: '/x.png' }, cost: { id: '1023', count: '120', name: '星砂' }, sortOrder: '1', statusCode: '1', owned: false, exchangeable: true, balanceKnown: true, maxExchangeCount: '2', maxExchangeCountKnown: true },
      { id: '9002', name: '已拥有装扮', category: '装扮', item: { id: '49031', count: '1', name: '已拥有装扮' }, cost: { id: '1023', count: '80', name: '星砂' }, sortOrder: '2', statusCode: '1', owned: true, exchangeable: true, balanceKnown: false, maxExchangeCount: '0', maxExchangeCountKnown: false },
    ],
  },
  solarTerms: {
    serverTime: '1793000000',
    currentTermId: '24',
    terms: [
      { id: '23', name: '霜降', statusCode: '3', canClaim: false, startTime: '1792000000', endTime: '1792900000', rewards: [{ id: '1023', count: '30', name: '星砂' }] },
      { id: '24', name: '立冬', statusCode: '2', canClaim: true, startTime: '1792900000', endTime: '1793500000', rewards: [{ id: '49040', count: '1', name: '节令装饰' }] },
    ],
  },
  actions: { exchange: { enabled: true }, claimPass: { enabled: true, count: 2 } },
  errors: { solarTerms: null, shop: '星砂商店部分档位读取失败' },
}

test('星垂野：星宿状态只认协议证实过的 lit/lightable', () => {
  const view = mapStarActivity(stellarDto)
  assert.equal(view.starRecord.totalCount, 4)
  assert.equal(view.starRecord.claimedCount, 1)
  assert.equal(view.starRecord.claimableCount, 1)
  assert.equal(view.starRecord.unlockedCount, 2)
  assert.equal(view.starRecord.records[2].claimable, false)
  assert.equal(view.starRecord.records[2].unlocked, false)
  assert.equal(view.starRecord.openedDays, 12)
})

test('星垂野：限购次数未知按不限次处理，兑换按钮靠服务端兜底', () => {
  const view = mapStarActivity(stellarDto)
  assert.equal(view.exchangeShop[0].exchangeLimit, 2)
  assert.equal(view.exchangeShop[0].isRepeatable, true)
  assert.equal(view.exchangeShop[0].price, 120)
  assert.equal(view.exchangeShop[0].currencyId, 1023)
  // 已拥有且次数未知：仍可重复兑换，但被 ownedBlocksExchange 拦住。
  assert.equal(view.exchangeShop[1].exchangeLimit, 0)
  assert.equal(view.exchangeShop[1].isRepeatable, true)
  assert.equal(view.exchangeShop[1].ownedBlocksExchange, true)
  assert.equal(view.exchangeShop[1].statusLabel, '可兑换')
  assert.equal(view.starSandBalance, 260)
  assert.equal(view.shopWarning, '星砂商店部分档位读取失败')
})

test('星垂野：通行证每层只有一份奖励，不再有免费/珍藏双轨', () => {
  const view = mapStarActivity(stellarDto)
  assert.equal(view.passport.currentLevel, 7)
  assert.equal(view.passport.freeClaimedLevel, 5)
  assert.equal(view.passport.claimableLevels, 2)
  assert.equal(view.passport.rewardTierCount, 3)
  assert.deepEqual(view.passport.levelRewardTiers[0], { level: 6, rewards: [{ itemId: 49020, itemName: '星砂礼包', itemCount: 1, image: '' }] })
  assert.equal('freeRewards' in view.passport.levelRewardTiers[0], false)
})

test('星垂野：赛季缺失时不返回半截视图，节令沿用共享映射', () => {
  assert.equal(mapStarActivity({}), null)
  assert.equal(mapStarActivity(null), null)
  const view = mapStarActivity(stellarDto)
  assert.equal(view.solarTerms.currentTerm.title, '立冬')
  assert.equal(view.solarTerms.terms[0].statusLabel, '已结束')
  assert.equal(view.solarTerms.claimableCount, 1)
  assert.deepEqual(mapSolarTerms({ terms: null }), null)
})

test('只有赛季壳子时各段落读成空集合，不把缺失当 0 之外的结论', () => {
  const shell = mapStarActivity({ season: { id: '1', title: '星垂野' } })
  assert.equal(shell.passport, null)
  assert.equal(shell.exchangeShop.length, 0)
  assert.equal(shell.starRecord.totalCount, 0)
  // actions.exchange 没下发即视为只读，页面不给兑换入口。
  assert.equal(shell.shopReadOnly, true)
  assert.equal(shell.starSandBalance, 0)
  assert.equal(shell.solarTerms, null)

  const bare = mapRainPoemActivity({})
  assert.equal(bare.shop, null)
  assert.equal(bare.weather, undefined)
  assert.equal(bare.collection.rewards.length, 0)
  assert.equal(bare.research.stages.length, 0)

  const charity = mapCharityFlowerActivity({})
  assert.equal(charity.publicFund, null)
  assert.equal(charity.share.rewards.length, 0)
  assert.equal(charity.personalRewards.length, 0)
  assert.equal(charity.love.canDonate, false)
})
