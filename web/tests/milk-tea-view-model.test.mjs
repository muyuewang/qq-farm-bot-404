import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import {
  buildMilkTeaRequest,
  buildMilkTeaView,
  deriveMilkTeaPhase,
  mapMilkTeaBalances,
  mapMilkTeaGoods,
  mapMilkTeaShare,
  MILK_TEA_SHARE_ACTIONS,
} from '../src/stores/milk-tea.ts'

// 固定夹具：模仿 core/src/services/milk-tea.ts 用 { longs: String } 生成的分页快照，
// 数值型字段都是字符串，且取默认值的字段会被 protobufjs 直接省略。
const shopSnapshot = {
  id: '2026110101',
  title: '奶茶热销中',
  page: 'shop',
  serverTime: 1793000000,
  startTime: 1792029600,
  endTime: 1794844799,
  settleStartTime: 1794671999,
  exchangeStartTime: 1792029600,
  exchangeEndTime: 1794844799,
  active: true,
  settling: false,
  summary: { shop_open_at: '1792100000', shop_name: '小铺', can_upgrade: true },
  rules: [],
  recommendedNames: ['奶茶铺'],
  actionAvailability: { craft: true, exchange: true, hire: true },
  levels: [{ level: 1, revenue_required: 0, recipe_ids_string: '1;2;9', recipes: ['普通奶茶', '草莓奶茶'] }],
  balances: { 1001: 12, 1041: 30 },
  shop: {
    level: '3',
    total_revenue: '12345',
    next_level_revenue: '53000',
    effective_cups_per_hour: '50',
    slots: [{ slot_index: 0, end_at: '1793009999', talent_name: '机灵鼠', employee: { gid: '7', name: '阿星' } }],
    pending_rewards: [{ id: '1041', count: '8', name: '奶茶券', image: '' }],
  },
  recipes: [{ recipe_id: '1', recipe_name: '普通奶茶', unlocked: true, stock_cups: '-1', image: '/activity-assets/milk-tea/recipe-1.png', fruitId: 0 }],
}

const workSnapshot = {
  ...shopSnapshot,
  page: 'work',
  work: { my_shift: { shift_id: '99001', shop_name: '朋友的店', end_at: '1793010000', employer: { gid: '5' } }, interact_done: true, talent_id: 9001 },
  interactions: [{ interaction_id: 1, name: '宣传推广', image: '/activity-assets/milk-tea/interact-1.png', ready: true }],
}

test('longs 以字符串下发时保持原值，只把参与算术的字段转成数字', () => {
  const view = buildMilkTeaView([{ page: 'shop', snapshot: shopSnapshot }])
  assert.equal(view.shop.total_revenue, '12345')
  assert.equal(view.shop.pending_rewards[0].count, '8')
  assert.equal(view.shop.level, 3)
  assert.equal(view.shop.slots[0].end_at, '1793009999')
  // protobufjs 省略的默认值补回空集合，模板不会读到 undefined。
  assert.deepEqual(view.shop.drink_cups, {})
  assert.equal(view.shop.next_level_revenue, '53000')
  assert.equal(view.recipes[0].stock_cups, '-1')
  assert.deepEqual(view.recipes[0].fruits, [])
  assert.equal(view.levels[0].recipe_names.join('、'), '普通奶茶、草莓奶茶')
})

test('phase 由 active/settling 与营业结束时间推导，settleTime 沿用旧字段名', () => {
  const view = buildMilkTeaView([{ page: 'shop', snapshot: shopSnapshot }])
  assert.equal(view.phase, 'business')
  assert.equal(view.settleTime, 1794671999)
  assert.equal(deriveMilkTeaPhase({ ...shopSnapshot, settling: true }), 'settling')
  assert.equal(deriveMilkTeaPhase({ ...shopSnapshot, active: false, serverTime: 1791000000 }), 'upcoming')
  assert.equal(deriveMilkTeaPhase({ ...shopSnapshot, active: false, serverTime: 1799000000 }), 'ended')
})

test('balances 由对象转成数组，缺失的货币记为未确认而不是 0', () => {
  const view = buildMilkTeaView([{ page: 'shop', snapshot: shopSnapshot }])
  assert.deepEqual(view.balances, [{ itemId: '1001', count: 12 }, { itemId: '1041', count: 30 }])
  assert.equal(mapMilkTeaBalances(undefined).length, 0)
  // 钻石只有 fund/exchange 页面才会读取；没有下发时不得当成 0。
  assert.equal(view.balances.some(x => x.itemId === '1004'), false)
})

test('remaining 为 null 表示不限购，0 表示售罄', () => {
  const goods = mapMilkTeaGoods([
    { id: 7001, name: '活动种子', description: '', rewards: [{ id: '29005', count: '1' }], costs: [{ id: '1041', count: '20' }], remaining: null, purchaseLimit: null, limitPeriod: 'permanent', conditions: [{ type: 'shop_level', satisfied: true, current: 3, target: 1 }], category: 'seed', available: true },
    { id: 7002, name: '装饰', description: '', rewards: [], costs: [{ id: '1004', count: '10' }], remaining: 0, purchaseLimit: 2, limitPeriod: 'daily', conditions: [{ type: 'shop_level', satisfied: false, current: 3, target: 5 }], category: 'decoration', available: false },
  ])
  assert.equal(goods[0].remaining, null)
  assert.equal(goods[0].purchase_limit, null)
  assert.equal(goods[0].limit_label, '永久')
  assert.equal(goods[0].maxPurchasable, 9999)
  assert.equal(goods[0].unlocked, true)
  assert.equal(goods[0].available, true)
  assert.equal(goods[1].remaining, 0)
  assert.equal(goods[1].maxPurchasable, 0)
  assert.equal(goods[1].unlocked, false)
  assert.equal(goods[1].paid, true)
  assert.equal(goods[1].limit_label, '每日')
})

test('后写入的页面快照覆盖同名段落', () => {
  const view = buildMilkTeaView([
    { page: 'shop', snapshot: shopSnapshot },
    { page: 'work', snapshot: { ...workSnapshot, shop: { ...shopSnapshot.shop, total_revenue: '99' } } },
  ])
  assert.equal(view.shop.total_revenue, '99')
  assert.equal(view.work.my_shift.shift_id, '99001')
  assert.equal(view.work.slips.length, 0)
  assert.equal(view.interactions[0].image, '/activity/milk-tea/icon_S4MyJob_interact_1.png')
})

test('旧动作名映射到新动作，并把展示过的消耗原样回传', () => {
  const view = buildMilkTeaView([
    { page: 'shop', snapshot: shopSnapshot },
    {
      page: 'workshop',
      snapshot: {
        ...shopSnapshot,
        fruits: [{ id: '29005', uid: '5001', count: 3, name: '星语铃花果实', locked: false }],
      },
    },
    { page: 'work', snapshot: workSnapshot },
    { page: 'exchange', snapshot: { ...shopSnapshot, goods: [{ id: 7001, name: '活动种子', costs: [{ id: '1041', count: '20' }], rewards: [], remaining: 2, purchaseLimit: 2, limitPeriod: 'daily', conditions: [], category: 'seed', available: true }] } },
    { page: 'hireList', snapshot: { ...shopSnapshot, hire: { duration_id: 2, wage_total: '130', friends: [], robots: [] }, durations: [] } },
  ])
  assert.deepEqual(buildMilkTeaRequest('cashier', {}, view), { action: 'claim', body: {} })
  assert.deepEqual(buildMilkTeaRequest('wages', {}, view), { action: 'wages', body: {} })
  assert.deepEqual(buildMilkTeaRequest('fundRewards', {}, view), { action: 'fundClaim', body: {} })
  assert.deepEqual(buildMilkTeaRequest('create', { shopName: '奶茶冲鸭' }, view), { action: 'create', body: { name: '奶茶冲鸭' } })
  assert.deepEqual(buildMilkTeaRequest('upgrade', {}, view), { action: 'upgrade', body: { expectedLevel: 3 } })
  assert.deepEqual(buildMilkTeaRequest('buy', { goodsId: '7001', count: 2 }, view), {
    action: 'exchange',
    body: { goodsId: '7001', count: 2, expectedCosts: [{ id: '1041', count: '20' }] },
  })
  assert.deepEqual(buildMilkTeaRequest('craft', { fruitUids: ['5001'] }, view), {
    action: 'craft',
    body: { fruits: [{ uid: '5001', count: 3 }] },
  })
  assert.deepEqual(buildMilkTeaRequest('hire', { targetGid: '88' }, view), {
    action: 'hire',
    body: { targetGid: '88', durationId: 2, expectedCosts: [{ id: 1041, count: '130' }] },
  })
  assert.deepEqual(buildMilkTeaRequest('interact', { interactionType: 4 }, view), {
    action: 'interact',
    body: { interactionType: 4, expectedShiftId: '99001' },
  })
})

test('奶茶接口没有对应动作的旧控件返回可解释的错误而不是请求体', () => {
  const view = buildMilkTeaView([{ page: 'shop', snapshot: shopSnapshot }])
  // 快乐不独享走独立实例，奶茶请求构造器不该为它编造分页动作。
  assert.equal(buildMilkTeaRequest('shareDaily', {}, view).action, null)
  assert.equal(buildMilkTeaRequest('shareRewards', {}, view).action, null)
  assert.match(buildMilkTeaRequest('shareDaily', {}, view).error, /未提供/)
  // 摘要里 shop_open_at 缺省即未开业，expectedLevel 读不到时不猜。
  const closed = buildMilkTeaView([{ page: 'shop', snapshot: { ...shopSnapshot, summary: {}, shop: undefined } }])
  assert.equal(closed.shop, null)
  assert.equal(closed.summary.level, -1)
  assert.equal(buildMilkTeaRequest('upgrade', {}, closed).action, null)
  // 已不在背包里的果实不发送，交给本地提示而不是让服务端猜。
  assert.equal(buildMilkTeaRequest('craft', { fruitUids: ['9999'] }, view).action, null)
})

// 固定夹具：GET /api/activities/share-reward/:activityId 的 DTO
// （commerce 约定：整数是 number、时间是毫秒、里程碑 id 是 tier_id 字符串）。
const shareDto = {
  id: '2026110104',
  title: '快乐不独享',
  icon: '/activity-assets/autumn/happy.png',
  serverTime: 1793000000000,
  startTime: 1792029600000,
  endTime: 1794844799000,
  active: true,
  rules: [],
  score: 120,
  scoreItemId: 1030,
  dailyReward: 5,
  firstShareReward: 10,
  claimedCount: 1,
  claimLimit: 1,
  poolClaimedCount: 3,
  poolClaimLimit: 10,
  canClaimDaily: false,
  canShare: false,
  firstShareAwarded: true,
  canClaimMilestones: true,
  milestones: [
    { id: '1', threshold: 60, state: 3, rewards: [{ id: 90001, count: 1, name: '人气装饰', image: '', description: '' }] },
    { id: '2', threshold: 150, state: 2, rewards: [] },
  ],
}

test('快乐不独享 DTO 折叠成旧 share 段落', () => {
  const share = mapMilkTeaShare(shareDto)
  assert.equal(share.current_score, 120)
  assert.equal(share.milestones[0].tier_id, '1')
  assert.equal(share.milestones[1].state, 2)
  assert.deepEqual(share.my_pool, { claimed_count: 3, claim_limit: 10 })
  // canClaimDaily 里混了活动有效期，只有确实领过才标成今日已领。
  assert.equal(share.daily.daily_reward_claimed, true)
  assert.equal(mapMilkTeaShare({ ...shareDto, claimedCount: 0 }).daily.daily_reward_claimed, false)
  assert.equal(mapMilkTeaShare(null), null)
  assert.equal(mapMilkTeaShare({}).milestones.length, 0)
})

test('旧弹窗动作映射到快乐不独享的后端动作名', () => {
  assert.deepEqual(MILK_TEA_SHARE_ACTIONS, { shareDaily: 'daily', shareRewards: 'milestones' })
})
