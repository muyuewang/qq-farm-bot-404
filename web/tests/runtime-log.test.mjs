import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import {
  matchesRuntimeLog,
  matchesRuntimeSubmodule,
  normalizeRuntimeLog,
  runtimeLogModule,
} from '../src/utils/runtime-log.ts'

function log(overrides = {}) {
  return normalizeRuntimeLog({ ts: 1, msg: '某条日志', ...overrides })
}

test('日志模块按 tag 归一化：meta.module 为空时也能按农场/牧场/系统筛选', () => {
  // 上游 #184 修复的核心：真实日志的模块信息多在 tag 上，meta.module 常为空。
  const farm = log({ tag: '农场' })
  const ranch = log({ tag: '牧场' })
  const error = log({ tag: '错误' })
  assert.equal(runtimeLogModule(farm), 'farm')
  assert.equal(runtimeLogModule(ranch), 'ranch')
  assert.equal(runtimeLogModule(error), 'system')

  assert.equal(matchesRuntimeLog(farm, { module: 'farm' }), true)
  assert.equal(matchesRuntimeLog(ranch, { module: 'ranch' }), true)
  assert.equal(matchesRuntimeLog(farm, { module: 'ranch' }), false)
  // 系统筛选包含错误/警告来源，错误 tag 归到 system。
  assert.equal(matchesRuntimeLog(error, { module: 'system' }), true)
  // 多选模块：农场需含降级为子模块的好友/仓库。
  assert.equal(matchesRuntimeLog(log({ tag: '好友' }), { module: 'farm,friend,warehouse' }), true)
})

test('子模块筛选：农场下的好友/仓库/土地与牧场下的好友/仓库', () => {
  const friendLog = log({ tag: '好友' })
  const warehouseLog = log({ tag: '仓库' })
  const landLog = log({ tag: '农场', action: 'farm_cycle' })
  assert.equal(matchesRuntimeSubmodule(friendLog, 'farm', 'friend'), true)
  assert.equal(matchesRuntimeSubmodule(warehouseLog, 'farm', 'warehouse'), true)
  assert.equal(matchesRuntimeSubmodule(friendLog, 'farm', 'warehouse'), false)
  // 土地按 event 白名单匹配，事件既有英文 code 也有中文。
  assert.equal(matchesRuntimeSubmodule(landLog, 'farm', 'land'), true, 'normalize 的 event 取自 meta.event/action')
  const chineseLand = normalizeRuntimeLog({ ts: 1, meta: { event: '土地推送通知' }, tag: '农场', msg: '' })
  assert.equal(matchesRuntimeSubmodule(chineseLand, 'farm', 'land'), true)
  // 未选子模块时全部通过。
  assert.equal(matchesRuntimeSubmodule(friendLog, 'farm', ''), true)

  const ranchSteal = normalizeRuntimeLog({ ts: 1, meta: { event: 'ranch_steal' }, tag: '牧场', msg: '' })
  assert.equal(matchesRuntimeSubmodule(ranchSteal, 'ranch', 'friend'), true)
})
