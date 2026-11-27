import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, setActivePinia } = require('pinia')
const ts = require('typescript')

// /api/bag 的形状取自 core/src/services/warehouse.ts getBagDetail()：
// 无 UID 的容器/余额条目（1011/1012 化肥容器、3001/3002 收藏点）只出现在 systemItems。不连真实服务端。
let currentAccountId = '1001'
let bagPayload = {}
const api = {
  get: async () => ({ data: { ok: true, data: bagPayload } }),
  post: async () => ({ data: { ok: true } }),
}

function loadStoreModule() {
  const imports = {
    '@/api': { __esModule: true, default: api },
    '@/stores/account': { useAccountStore: () => ({ currentAccountId }) },
  }
  const source = readFileSync(new URL('../src/stores/bag.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  return module.exports
}

const { useBagStore } = loadStoreModule()

function freshStore(accountId = '1001') {
  setActivePinia(createPinia())
  currentAccountId = accountId
  bagPayload = {}
  return useBagStore()
}

const systemItems = [
  { id: 1011, count: 36000, name: '普通化肥容器', interactionType: 'fertilizerbucket', hoursText: '10.0小时' },
  { id: 1012, count: 5400, name: '有机化肥容器', interactionType: 'fertilizerbucket', hoursText: '1.5小时' },
  { id: 3001, count: 12, name: '普通收藏点', interactionType: '', hoursText: '' },
  { id: 3002, count: 3, name: '典藏收藏点', interactionType: '', hoursText: '' },
  { id: 1001, count: 99999, name: '金币', interactionType: '', hoursText: '' },
]
const stackItem = { key: 'uid:7', id: 20001, uid: 7, count: 5, name: '白萝卜果实', hoursText: '' }

test('dashboard items come from systemItems, where the backend puts UID-less containers', async () => {
  const store = freshStore()
  bagPayload = { items: [stackItem], originalItems: [], systemItems }
  await store.fetchBag('1001')

  const byId = Object.fromEntries(store.dashboardItems.map(item => [Number(item.id), item]))
  assert.deepEqual(Object.keys(byId).map(Number).sort(), [1011, 1012, 3001, 3002])
  assert.equal(byId[1011].hoursText, '10.0小时')
  assert.equal(byId[1012].hoursText, '1.5小时')
  assert.equal(byId[3001].count, 12)
})

test('dashboard ids still found in items for backends that predate systemItems, without duplicates', async () => {
  const store = freshStore()
  bagPayload = {
    items: [{ id: 1011, count: 3600, hoursText: '1.0小时' }, stackItem],
    originalItems: [],
    systemItems: [{ id: 1011, count: 7200, hoursText: '2.0小时' }],
  }
  await store.fetchBag('1001')
  const normal = store.dashboardItems.filter(item => Number(item.id) === 1011)
  assert.equal(normal.length, 1)
  assert.equal(normal[0].hoursText, '2.0小时')

  bagPayload = { items: [{ id: 1012, count: 3600, hoursText: '1.0小时' }], originalItems: [] }
  await store.fetchBag('1001')
  assert.deepEqual(store.dashboardItems.map(item => Number(item.id)), [1012])
})

test('system items are dropped on clearBag and on a failed bag reply', async () => {
  const store = freshStore()
  bagPayload = { items: [], originalItems: [], systemItems }
  await store.fetchBag('1001')
  assert.equal(store.dashboardItems.length, 4)

  store.clearBag()
  assert.equal(store.dashboardItems.length, 0)

  await store.fetchBag('1001')
  assert.equal(store.dashboardItems.length, 4)
  const originalGet = api.get
  api.get = async () => ({ data: { ok: false, error: 'boom' } })
  try {
    await store.fetchBag('1001')
  }
  finally {
    api.get = originalGet
  }
  assert.equal(store.dashboardItems.length, 0)
})

test('a reply for a previously selected account does not overwrite dashboard items', async () => {
  const store = freshStore('1001')
  bagPayload = { items: [], originalItems: [], systemItems }
  currentAccountId = '2002'
  await store.fetchBag('1001')
  assert.equal(store.dashboardItems.length, 0)
})
