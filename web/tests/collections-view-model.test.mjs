import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDisplayBody,
  buildUpgradeBody,
  COLLECTION_ACTIONS,
  collectionsProgress,
  costLine,
  describeClaimResult,
  describeCollectionResult,
  describeItemAction,
  mapCollectionsSnapshot,
  mapMutationCatalog,
  MUTATION_CATALOG_ENDPOINT,
  starDots,
} from '../src/utils/collections.ts'

/**
 * 夹具按 core/src/services/collections.ts 的 normalizeCollections 输出形状手写，
 * 不连接真实服务端：int64/数量是十进制字符串，星级与分数是数字，
 * 未领取档位的 nextRewardScore 为 null，空展台为 null。
 */
function itemFixture(overrides = {}) {
  return {
    id: 90002,
    name: '星辉残片',
    description: '来自深空的藏品',
    image: '/game-config/item_images/90002.png',
    starLevel: 1,
    maxStarLevel: 5,
    ownCount: '3',
    activated: true,
    isNew: false,
    score: 40,
    displayed: false,
    wished: true,
    requirements: [],
    nextStarCosts: [
      { itemId: 90002, count: '2', name: '星辉残片', image: '/game-config/item_images/90002.png' },
      { itemId: 1007, count: '45000', name: '金券', image: '/game-config/item_images/1007.png' },
    ],
    unlocked: true,
    canUpgrade: true,
    ...overrides,
  }
}

function snapshotFixture(overrides = {}) {
  return {
    category: 1,
    score: 120,
    claimedScore: 60,
    activatedCount: 2,
    totalCount: 6,
    nextRewardScore: 200,
    currentBuffs: [{ id: 3, name: '节省10%肥料', value: 10, description: '10%概率节省10%肥料' }],
    milestones: [
      { level: 1, score: 60, claimed: true, reached: true, rewards: [{ itemId: 1007, count: '1000', name: '金券', image: '' }], buffs: [{ id: 3, name: '节省10%肥料', value: 10, description: '10%概率节省10%肥料' }] },
      { level: 2, score: 120, claimed: false, reached: true, rewards: [], buffs: [] },
      { level: 3, score: 200, claimed: false, reached: false, rewards: [{ itemId: 90009, count: '1', name: '藏品90009', image: '' }], buffs: [] },
    ],
    series: [{
      id: 90001,
      name: '星海遗物',
      rarity: 3,
      rarityName: '珍品',
      description: '需要集齐三件',
      requirements: ['解锁条件待确认'],
      mutationRules: [{ name: '普通', probability: 88.5, guarantee: 20 }, { name: '稀有', probability: 11.5, guarantee: 60 }],
      items: [itemFixture(), itemFixture({ id: 90003, name: '潮汐核心', activated: false, starLevel: 0, canUpgrade: false, ownCount: '1' })],
      activatedCount: 1,
      totalCount: 2,
    }],
    display: { itemId: '90002', pedestalId: '90100' },
    pedestals: [
      { id: 90100, name: '基座展台', image: '', owned: true },
      { id: 90101, name: '悬空展台', image: '', owned: false },
    ],
    updatedAt: 1780000000000,
    ...overrides,
  }
}

test('动作白名单只有后端实现的三个，页面拼不出第四个', () => {
  assert.deepEqual([...COLLECTION_ACTIONS], ['upgrade', 'claim', 'display'])
  assert.equal(MUTATION_CATALOG_ENDPOINT, '/api/illustrated/mutations')
})

test('请求体：未知动作、缺少藏品编号、缺少 displayed 都在本地拦下', async () => {
  const { buildCollectionsBody } = await import('../src/utils/collections.ts')
  assert.equal(buildCollectionsBody('sell', { collectionId: 1 }).ok, false)
  assert.equal(buildCollectionsBody('upgrade', {}).ok, false)
  assert.equal(buildCollectionsBody('upgrade', { collectionId: '0' }).ok, false)
  assert.equal(buildCollectionsBody('display', { collectionId: 90002 }).ok, false)
  assert.equal(buildCollectionsBody('display', { collectionId: 90002, displayed: 'true' }).ok, false)
  assert.deepEqual(buildCollectionsBody('claim').body, {})
  assert.deepEqual(buildCollectionsBody('upgrade', { collectionId: '90002' }), {
    ok: true,
    body: { collectionId: 90002 },
  })
})

test('快照缺失系列列表时返回 null，不用全零快照冒充没有藏品', () => {
  assert.equal(mapCollectionsSnapshot(undefined), null)
  assert.equal(mapCollectionsSnapshot({ score: 10 }), null)
  assert.equal(mapCollectionsSnapshot({ series: [] }).totalCount, 0)
})

test('int64 数量原样保留，缺失字段回落成空数组而不是 undefined', () => {
  const mapped = mapCollectionsSnapshot(snapshotFixture({
    score: '12345',
    series: [{ id: 1, items: [] }],
    milestones: undefined,
    pedestals: undefined,
    currentBuffs: undefined,
    display: undefined,
  }))
  assert.equal(mapped.score, 12345)
  assert.deepEqual(mapped.milestones, [])
  assert.deepEqual(mapped.pedestals, [])
  assert.deepEqual(mapped.currentBuffs, [])
  assert.equal(mapped.series[0].rarityName, '等级未知')
  assert.deepEqual(mapped.series[0].items, [])
  assert.equal(mapped.display, null)
})

test('大数 ownCount 不被 Number 截断', () => {
  const mapped = mapCollectionsSnapshot(snapshotFixture({
    series: [{ id: 1, items: [itemFixture({ ownCount: '12000000000000000000' })] }],
  }))
  assert.equal(mapped.series[0].items[0].ownCount, '12000000000000000000')
})

test('展台 itemId 为 0 视为未设置，nextRewardScore 为 0 视为已达最高档', () => {
  const zero = mapCollectionsSnapshot(snapshotFixture({
    display: { itemId: '0', pedestalId: '0' },
    nextRewardScore: 0,
  }))
  assert.equal(zero.display, null)
  assert.equal(zero.nextRewardScore, null)
  assert.deepEqual(collectionsProgress(zero), { percent: 100, text: `当前分数 ${zero.score}　·　全部档位已达成` })
})

test('分数进度按下一档计算并夹在 0–100，快照缺失时不编造进度', () => {
  const mapped = mapCollectionsSnapshot(snapshotFixture({ score: 150 }))
  assert.equal(collectionsProgress(mapped).percent, 75)
  assert.equal(collectionsProgress(mapped).text, '当前分数 150 / 200')
  assert.equal(collectionsProgress(mapCollectionsSnapshot(snapshotFixture({ score: 900 }))).percent, 100)
  assert.equal(collectionsProgress(null), null)
})

test('星级点不超过后端下发的上限，满星也不会画空位', () => {
  assert.deepEqual(starDots({ starLevel: 3, maxStarLevel: 5 }), { filled: 3, total: 5 })
  assert.deepEqual(starDots({ starLevel: 9, maxStarLevel: 5 }), { filled: 5, total: 5 })
  assert.deepEqual(starDots({ starLevel: -1, maxStarLevel: 0 }), { filled: 0, total: 5 })
})

/** 面板拿到的都是映射后的视图模型，操作前置校验的测试也必须喂映射后的对象。 */
function mappedItem(overrides = {}) {
  const mapped = mapCollectionsSnapshot(snapshotFixture({
    series: [{ id: 90001, name: '星海遗物', rarity: 3, items: [itemFixture(overrides)] }],
  }))
  return mapped.series[0].items[0]
}

test('操作状态逐项对应后端的拒绝条件', () => {
  const displayId = '90002'
  assert.equal(describeItemAction(mappedItem({ unlocked: false }), displayId).reason, '尚未满足解锁条件')
  assert.equal(describeItemAction(mappedItem({ activated: false }), displayId).canActivate, true)
  assert.equal(describeItemAction(mappedItem({ starLevel: 5 }), displayId).reason, '已达最高星级')
  assert.equal(describeItemAction(mappedItem({ nextStarCosts: [] }), displayId).reason, '升星材料未下发')
  assert.match(describeItemAction(mappedItem({ canUpgrade: false }), displayId).reason, /升星还需 2 件本体/)
  const shown = describeItemAction(mappedItem({ displayed: true }), displayId)
  assert.equal(shown.canHide, true)
  assert.equal(shown.canDisplay, false)
  // 展台上是别的藏品时，本件既可以升星也可以换上台
  const hidden = describeItemAction(mappedItem(), '90003')
  assert.equal(hidden.canDisplay, true)
  assert.equal(hidden.canHide, false)
})

test('材料未知时给出「未知数量」而不是 0 件', () => {
  const action = describeItemAction(mappedItem({ canUpgrade: false, nextStarCosts: [{ itemId: 1007, count: '9', name: '金券', image: '' }] }), null)
  assert.equal(action.reason, '升星还需 未知数量 件本体')
})

test('upgrade 请求体把当前星级与材料签名原样带上，后端据此拒绝过期确认', () => {
  const body = buildUpgradeBody(mappedItem())
  assert.deepEqual(body, {
    collectionId: 90002,
    expectedStarLevel: 1,
    // count 必须与后端报价的同名字面量一致，costSignature 是字符串拼接比对
    expectedCosts: [{ itemId: 90002, count: '2' }, { itemId: 1007, count: '45000' }],
  })
  assert.equal(buildUpgradeBody(mappedItem({ canUpgrade: false })), null)
  assert.equal(buildUpgradeBody(mappedItem({ unlocked: false })), null)
  assert.equal(buildUpgradeBody(mappedItem({ starLevel: 5 })), null)
  assert.equal(buildUpgradeBody(mappedItem({ nextStarCosts: [] })), null)
})

test('display 请求体要求已激活，展台空位按后端的 0 上报', () => {
  const empty = mapCollectionsSnapshot(snapshotFixture({ display: null }))
  assert.deepEqual(buildDisplayBody(mappedItem(), true, empty), {
    collectionId: 90002,
    displayed: true,
    expectedDisplayItemId: '0',
  })
  const filled = mapCollectionsSnapshot(snapshotFixture())
  assert.equal(buildDisplayBody(mappedItem(), false, filled).expectedDisplayItemId, '90002')
  assert.equal(buildDisplayBody(mappedItem({ activated: false }), true, filled), null)
  assert.equal(buildDisplayBody(mappedItem({ unlocked: false }), true, filled), null)
  assert.equal(buildDisplayBody(mappedItem(), true, null).expectedDisplayItemId, '0')
})

test('结果三态：skipped 是正常分支，缺 snapshot 不能当成就功', () => {
  assert.deepEqual(describeCollectionResult({ skipped: true }, '藏品已更新'), { status: 'skipped', message: '当前没有需要变更的藏品状态' })
  assert.equal(describeCollectionResult({ snapshot: {} }, '藏品已更新').status, 'confirmed')
  const unknown = describeCollectionResult({}, '升星完成')
  assert.equal(unknown.status, 'unknown')
  assert.match(unknown.message, /不要重复提交/)
})

test('领取汇总：没有 claimedScores 时不编档位数量', () => {
  assert.equal(describeClaimResult({ skipped: true }), '当前没有可达成的收藏分数档位')
  assert.equal(
    describeClaimResult({ snapshot: {}, claimedScores: [60, 120], rewards: [{ id: 1007, count: '1000', name: '金券' }] }),
    '已领取 2 个分数档位：金券 ×1000',
  )
  assert.equal(describeClaimResult({ snapshot: {}, rewards: [] }), '奖励已领取')
})

test('材料行与档位奖励共用同一份文案格式', () => {
  assert.equal(costLine({ itemId: 1007, count: '45000', name: '金券', image: '' }), '金券 ×45000')
  assert.equal(costLine({ itemId: 1007, count: '1', name: '', image: '' }), '物品1007 ×1')
})

test('静态目录缺失段落回落空数组，隐藏系列不混进藏品册本体', () => {
  const catalog = mapMutationCatalog({
    collections: [{ id: 90500, name: '未开放系列', rarityName: '天工', mutationRules: [{ name: '普通', probability: 100 }], items: [{ id: 1 }] }],
  })
  assert.deepEqual(catalog.normal, [])
  assert.deepEqual(catalog.decoration, [])
  assert.equal(catalog.collections[0].items[0].id, 1)
  assert.equal(catalog.collections[0].items[0].name, '')
  assert.equal(catalog.collections[0].mutationRules[0].guarantee, 0)
  assert.equal(mapMutationCatalog(undefined).collections.length, 0)
})
