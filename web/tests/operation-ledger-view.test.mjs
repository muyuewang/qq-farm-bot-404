// 本测试文件覆盖以下源文件（供契约测试追踪）：
// web/src/utils/operation-ledger-view.ts
// web/src/components/ledger/OperationLedgerPanel.vue

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import {
  dayLabel,
  describeEntry,
  describeRow,
  groupLedgerEntries,
  itemsText,
  toneOf,
  topSources,
} from '../src/utils/operation-ledger-view.ts'

// 固定夹具：仿 /api/operation-ledger 返回的明细（已按时间倒序，带 actionLabel / day / metrics），不连真实服务端。

const STANDARD = new Set([1102, 1007])
const ranch = (id, ts, action, actionLabel, extra = {}) => ({ id, ts, day: '2026-11-28', action, actionLabel, label: actionLabel, completed: 1, costs: [], rewards: [], metrics: { exp: 0, income: 0, expense: 0 }, ...extra })

test('同一天内连续同类记录合并，指标求和并记录起止时间', () => {
  const entries = [
    ranch('a', 500, 'clean', '清理', { label: '清理牧场', rewards: [{ id: 7002, name: '便便', count: 2 }, { id: 1102, name: '牧场经验', count: 5 }], metrics: { exp: 5 } }),
    ranch('b', 400, 'clean', '清理', { label: '清理牧场', rewards: [{ id: 7002, name: '便便', count: 1 }, { id: 1102, name: '牧场经验', count: 5 }], metrics: { exp: 5 } }),
    ranch('c', 300, 'sell', '出售', { metrics: { income: 900 } }),
    ranch('d', 200, 'clean', '清理', { label: '清理牧场' }),
  ]
  const [day] = groupLedgerEntries(entries, true)
  assert.equal(day.rows.length, 3, '不相邻的同类记录不合并')
  const [cleanRun, sell, lone] = day.rows
  assert.deepEqual(cleanRun.entries.map(e => e.id), ['a', 'b'])
  assert.equal(cleanRun.id, 'a', '合并行以最新一条的 id 作键')
  assert.deepEqual(cleanRun.metrics, { exp: 10, income: 0, expense: 0 })
  assert.equal(cleanRun.earliestTs, 400)
  assert.equal(cleanRun.latestTs, 500)
  assert.equal(sell.entries.length, 1)
  assert.equal(lone.entries.length, 1)

  assert.deepEqual(describeRow(cleanRun, STANDARD), { title: '清理牧场', detail: '获得 便便×3' }, '牧场经验已有独立指标，不重复出现在明细')
})

test('关闭合并时每条记录单独成行；跨天的记录不合并', () => {
  const entries = [
    ranch('a', 500, 'clean', '清理'),
    ranch('b', 400, 'clean', '清理'),
    ranch('c', 300, 'clean', '清理', { day: '2026-11-27' }),
  ]
  assert.equal(groupLedgerEntries(entries, false)[0].rows.length, 2)
  const days = groupLedgerEntries(entries, true)
  assert.deepEqual(days.map(d => d.day), ['2026-11-28', '2026-11-27'])
  assert.equal(days[0].rows[0].entries.length, 2)
  assert.equal(days[1].rows[0].entries.length, 1)
})

test('牧场合并行的具体名称不一致时退回通用动作名', () => {
  const entries = [
    ranch('a', 2, 'buy', '购买', { label: '购买火鸡 ×1' }),
    ranch('b', 1, 'buy', '购买', { label: '购买鸡 ×1' }),
  ]
  const [row] = groupLedgerEntries(entries, true)[0].rows
  assert.equal(describeRow(row, STANDARD).title, '购买')
})

test('农场单条与合并行的描述', () => {
  const farm = (id, ts, op, extra) => ({ id, ts, day: '2026-11-28', op, actionLabel: { plant: '种植', sell: '出售', fertilize: '施肥' }[op], ...extra })
  const plants = [
    farm('p1', 3, 'plant', { seedName: '红薯', landCount: 3, landIds: [1, 2, 3] }),
    farm('p2', 2, 'plant', { seedName: '金银花', landCount: 2, landIds: [4, 5] }),
    farm('p3', 1, 'plant', { seedName: '红薯', landCount: 1, landIds: [6] }),
  ]
  const [row] = groupLedgerEntries(plants, true)[0].rows
  assert.deepEqual(describeRow(row, STANDARD), { title: '种植', detail: '红薯、金银花 共 6 块' })
  assert.deepEqual(describeEntry(plants[0], STANDARD), { title: '红薯 种下 3 块', detail: '地块 1, 2, 3' })

  const sell = farm('s', 1, 'sell', { items: [{ id: 1, name: '金银花', count: 273 }, { id: 2, name: '红薯', count: 27 }] })
  assert.deepEqual(describeEntry(sell, STANDARD), { title: '金银花×273、红薯×27', detail: '共 300 个' })

  const organic = farm('f', 1, 'fertilize', { fertilizerName: '有机化肥', times: 12, landCount: 4, landIds: [1, 2] })
  assert.equal(describeEntry(organic, STANDARD).title, '有机化肥 施 12 次 · 4 块')
})

test('指标来源按数值取前两名，跳过 0', () => {
  const actions = [
    { label: '收获', exp: 7140, income: 0, expense: 0 },
    { label: '任务', exp: 2700, income: 23000, expense: 0 },
    { label: '清理', exp: 135, income: 0, expense: 0 },
    { label: '出售', exp: 0, income: 101672, expense: 0 },
  ]
  assert.deepEqual(topSources(actions, 'exp'), [{ label: '收获', value: 7140 }, { label: '任务', value: 2700 }])
  assert.deepEqual(topSources(actions, 'income').map(s => s.label), ['出售', '任务'])
  assert.deepEqual(topSources(actions, 'expense'), [])
})

test('日期标题只按服务器给出的日期字符串换算，跨年也正确', () => {
  assert.equal(dayLabel('2026-11-28', '2026-11-28'), '今天 · 11-28')
  assert.equal(dayLabel('2026-11-27', '2026-11-28'), '昨天 · 11-27')
  assert.equal(dayLabel('2026-11-20', '2026-11-28'), '11-20')
  assert.equal(dayLabel('2025-12-31', '2026-01-01'), '昨天 · 12-31')
  assert.equal(dayLabel('2025-12-30', '2026-01-01'), '2025-12-30')
  assert.equal(dayLabel('', '2026-11-28'), '日期未知')
})

test('着色与物品文案', () => {
  assert.equal(toneOf({ exp: 5, income: 0, expense: 300 }), 'expense')
  assert.equal(toneOf({ exp: 5, income: 900, expense: 0 }), 'income')
  assert.equal(toneOf({ exp: 5, income: 0, expense: 0 }), 'exp')
  assert.equal(toneOf({ exp: 0, income: 0, expense: 0 }), 'none')
  const items = [{ id: 1, name: 'A', count: 1 }, { id: 2, name: 'B', count: 2 }, { id: 3, name: 'C', count: 3 }]
  assert.equal(itemsText(items, String, 2), 'A×1、B×2 等')
  assert.equal(itemsText(items, String, Infinity), 'A×1、B×2、C×3')
})
