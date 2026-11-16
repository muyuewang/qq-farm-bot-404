import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { COLLECTION_ACTIONS, COLLECTIONS_ENDPOINT, MUTATION_CATALOG_ENDPOINT } from '../src/utils/collections.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const service = read('../../core/src/services/collections.ts')
const routes = read('../../core/src/controllers/admin/farm-routes.ts')
const ranchConfig = read('../../core/src/config/ranch-automation.ts')
const panel = read('../src/components/illustrated/CollectionsPanel.vue')
const card = read('../src/components/illustrated/CollectionItemCard.vue')
const store = read('../src/stores/collections.ts')
const view = read('../src/views/Illustrated.vue')

test('动作清单与后端 operateCollections 的分支逐一对应', () => {
  const branches = [...service.matchAll(/if \(action === '([A-Za-z]+)'\)/g)].map(match => match[1])
  assert.deepEqual(branches, [...COLLECTION_ACTIONS])
  assert.match(service, /throw collectionError\('INVALID_ARGUMENT', '未知的藏品操作'\)/)
})

test('三个写动作都注册在 /api/collections/:action 下，快照与静态目录各有只读路由', () => {
  assert.equal(COLLECTIONS_ENDPOINT, '/api/collections')
  assert.equal(MUTATION_CATALOG_ENDPOINT, '/api/illustrated/mutations')
  assert.match(routes, /app\.get\('\/api\/collections'/)
  assert.match(routes, /app\.post\('\/api\/collections\/:action'/)
  assert.match(routes, /app\.get\('\/api\/illustrated\/mutations'/)
  // 藏品册是手工入口，页面上不能出现绕过 operate 直接发协议的调用
  assert.doesNotMatch(`${panel}${card}`, /api\.(get|post)\(/)
  assert.match(store, /api\.post\(`\$\{COLLECTIONS_ENDPOINT\}\/\$\{action\}`/)
})

test('后端读取失败时不返回快照，前端必须保持错误态而不是渲染零值', () => {
  assert.match(service, /throw new Error\('当前账号未返回蓝晶藏品信息'\)/)
  assert.match(store, /mapCollectionsSnapshot\(data\.data\)/)
  assert.match(store, /藏品数据不完整，后端未返回系列列表/)
})

test('升星与展示的乐观并发字段与后端读取的入参一致', () => {
  assert.match(service, /const level = input\.expectedStarLevel/)
  assert.match(service, /input\.expectedCosts !== undefined/)
  assert.match(service, /costSignature\(input\.expectedCosts\) !== costSignature\(item\.nextStarCosts\)/)
  assert.match(service, /collectionError\('PRICE_CHANGED'/)
  assert.match(service, /typeof input\.displayed !== 'boolean'/)
  assert.match(service, /input\.expectedDisplayItemId !== undefined/)
  assert.match(store, /api\.post\(`\$\{COLLECTIONS_ENDPOINT\}\/\$\{action\}`, built\.body/)
})

test('前端置灰原因覆盖后端每一条拒绝分支的语义', () => {
  for (const code of [
    'COLLECTION_LOCKED',
    'COLLECTION_COST_UNKNOWN',
    'COLLECTION_NOT_ACTIVE',
    'COLLECTION_STATE_CHANGED',
    'INSUFFICIENT_BALANCE',
    'COLLECTION_RESULT_UNKNOWN',
  ])
    assert.ok(service.includes(code), `后端拒绝码 ${code} 已不存在，前端文案需要同步`)
  assert.match(service, /if \(!item\.unlocked\) throw collectionError\('COLLECTION_LOCKED'/)
  assert.match(service, /if \(!item\.activated\) throw collectionError\('COLLECTION_NOT_ACTIVE'/)
})

test('视图模型只读后端 normalizeCollections 真下发的字段', () => {
  const returned = service.slice(service.indexOf('return {'), service.indexOf('let pendingSnapshot'))
  for (const field of ['score', 'claimedScore', 'activatedCount', 'totalCount', 'nextRewardScore', 'currentBuffs', 'milestones', 'series', 'display', 'pedestals', 'updatedAt'])
    assert.ok(new RegExp(`\\b${field}[,:}]`).test(returned), `基础快照字段 ${field} 与后端不再对应`)
  for (const field of ['starLevel', 'maxStarLevel', 'ownCount', 'activated', 'isNew', 'displayed', 'wished', 'requirements', 'nextStarCosts', 'unlocked', 'canUpgrade'])
    assert.ok(service.includes(field), `藏品字段 ${field} 与后端不再对应`)
})

test('藏品册没有后台自动动作，因此不得凭空加自动化开关', () => {
  // core/src/config/ranch-automation.ts 是自动化开关登记表；藏品册不在任何调度里
  assert.doesNotMatch(ranchConfig, /collection/i)
  assert.doesNotMatch(service, /getAutomation\(\)/)
})

test('藏品册挂在图鉴页的独立页签下，两套快照互不冒充', () => {
  assert.match(view, /import CollectionsPanel from '@\/components\/illustrated\/CollectionsPanel\.vue'/)
  assert.match(view, /const COLLECTIONS_TAB = 'collections'/)
  assert.match(view, /<CollectionsPanel v-if="isCollections" \/>/)
  // 图鉴的等级奖励按钮在藏品页签下必须隐藏，否则会对着另一本图鉴发请求
  assert.match(view, /v-if="!isCollections"[\s\S]{0,320}领取等级奖励/)
})

test('写操作前有确认弹窗，结果未知时提示刷新而不是重复提交', () => {
  assert.match(panel, /import ConfirmModal from '@\/components\/ConfirmModal\.vue'/)
  assert.match(panel, /const pending = ref<\{ kind: 'upgrade' \| 'display'/)
  assert.match(panel, /await collectionsStore\.operate\(currentAccountId\.value, request\.kind, request\.body\)/)
  assert.match(store, /上一条藏品操作仍在执行，请稍候/)
  assert.match(panel, /不要重复提交同一条操作/)
})
