import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

/**
 * 以薯换福面板（前端）在 2026-11-28 热更后的三条硬性契约。
 *
 * 覆盖文件（写成仓库相对路径，供 core 的 current-change-coverage 静态校验）：
 *   web/src/components/activity/YishuHuanfuActivityPanel.vue
 *   web/src/stores/yishuhuanfu.ts
 *
 * 这些是协议行为变化在前端的落点，改坏了不会报错，只会让用户「查得到价却卖不进去」。
 */
function readPanel() {
  return readFileSync(new URL('../src/components/activity/YishuHuanfuActivityPanel.vue', import.meta.url), 'utf8')
}

function readStore() {
  return readFileSync(new URL('../src/stores/yishuhuanfu.ts', import.meta.url), 'utf8')
}

test('兑换档位显示剩余/上限，而不是只显示上限', () => {
  const panel = readPanel()
  // cmd 97 的 limit 是「限购总数」、exchanged 是累计已兑，剩余 = limit - exchanged。
  assert.match(panel, /限购 \{\{ fmt\(entry\.remaining\) \}\}\/\{\{ fmt\(entry\.limit\) \}\}/, '兑换档位必须显示剩余/上限')
  // 兑换成功后要重拉目录，否则界面停在兑换前的次数。
  assert.match(panel, /store\.loadCatalog\(accountId\.value\)/, '兑换成功后必须重拉目录')
})

test('比价行标明「缺当日标识只能看价」，并允许导入与移出', () => {
  const panel = readPanel()
  assert.match(panel, /缺今日标识，只能看价/, '缺标识的铺子必须显式提示不可卖')
  // 不可卖的铺子不能让人点「选它出售」白跑一次写请求。
  assert.match(panel, /:disabled="shop\.canSell === false \|\| !shop\.shareKeyKnown/, '缺标识时出售按钮必须禁用')
  assert.match(panel, /导入标识/, '面板外的真人好友只能靠手动导入标识变得可售')
  assert.match(panel, /移出比价/, '误加的铺子要能移出比价')
  assert.match(panel, /确认移出/, '移出是删除本地标识，必须二次确认')
})

test('出售数量输入不会因为值是 number 而抛 trim is not a function', () => {
  const panel = readPanel()
  // type=number 的输入在部分环境会把值转成 number，直接 .trim() 会抛异常。
  assert.match(panel, /String\(sellCount\.value \?\? ''\)\.trim\(\)/, '出售数量必须先转字符串再 trim')
})

test('store 提供导入/移出标识的动作，并解析新字段', () => {
  const store = readStore()
  assert.match(store, /async function importShareKey/, 'store 缺少导入标识')
  assert.match(store, /async function forgetShareKey/, 'store 缺少移出标识')
  assert.match(store, /\/share-key`/, '导入走 POST /yishuhuanfu/share-key')
  assert.match(store, /\/share-key\/remove`/, '移出走 POST /yishuhuanfu/share-key/remove')
  assert.match(store, /shareKeyKnown: boolean/, '比价行必须带 shareKeyKnown')
  assert.match(store, /remaining: string/, '目录档位必须带 remaining')
  assert.match(store, /shareKeySaved: boolean/, 'daily 必须带 shareKeySaved，决定能否补分享标识')
})
