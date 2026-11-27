import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

test('离线设置最终文案、顺序与错误状态接线', () => {
  const settings = read('web/src/views/Settings.vue')
  assert.match(settings, /label:\s*'离线设置'/)
  assert.match(settings, /保存离线设置/)
  assert.match(settings, /wxKickoutReloginError/)
  const offline = settings.indexOf('<OfflineReminderCard')
  const relogin = settings.indexOf('<WxKickoutReloginCard')
  assert.ok(offline >= 0 && relogin > offline, 'WxKickoutReloginCard must be below OfflineReminderCard')
})

test('自动连回卡片优先展示服务端状态，并明确 UTC 日切含义', () => {
  const card = read('web/src/components/settings/WxKickoutReloginCard.vue')
  assert.match(card, /props\.status\?\.enabled/)
  assert.match(card, /props\.status\?\.blocked/)
  assert.match(card, /北京时间 08:00/)
  assert.match(card, /error/)
})

test('组合式函数不暴露未消费的 loading 状态', () => {
  const source = read('web/src/composables/settings/useWxKickoutRelogin.ts')
  assert.doesNotMatch(source, /wxKickoutReloginLoading/)
  assert.doesNotMatch(source, /const loading = ref/)
})

test('扫码成功文案不再冒充凭据已落盘，并提示 5 分钟窗口', () => {
  const store = read('web/src/stores/wx-login.ts')
  assert.match(store, /5 分钟/)
  assert.doesNotMatch(store, /自动连回凭据已保存/)
  assert.match(store, /autoReloginReady/)
})

test('账号保存链路消费 wxAutoReconnectReady=false', () => {
  assert.match(read('web/src/stores/account.ts'), /return .*\.data/)
  const modal = read('web/src/components/WxLoginModal.vue')
  assert.match(modal, /wxAutoReconnectReady\s*===\s*false/)
})

test('无关的背包种子优先级改动保持数组安全守卫', () => {
  const source = read('web/src/components/settings/BagSeedPriority.vue')
  assert.match(source, /seedList/)
  assert.match(source, /priorityIds/)
})

test('前端类型契约覆盖 autoStart 与自动连回配置', () => {
  assert.match(read('core/src/types/account.ts'), /autoStart\?:\s*boolean/)
  assert.match(read('core/src/types/config.ts'), /interface WxKickoutReloginConfig/)
})
