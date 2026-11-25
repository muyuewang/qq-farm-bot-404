import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const { createPinia, setActivePinia } = require('pinia')

// 加载真实的以薯换福 store，只替换 HTTP 层与账号 store。
// int64 一律是十进制字符串，protobufjs 省略的默认字段直接不出现。不连真实服务端。
const calls = []
const api = {
  get: async (url, config) => {
    calls.push({ method: 'GET', url, account: config?.headers?.['x-account-id'] })
    if (url.endsWith('/yishuhuanfu/catalog')) {
      return { data: { ok: true, data: { catalog: catalogPayload } } }
    }
    if (url.endsWith('/yishuhuanfu/records')) {
      return { data: { ok: true, data: { records: recordsPayload } } }
    }
    if (url.endsWith('/yishuhuanfu/friends')) {
      return { data: { ok: true, data: { shops: shopsPayload, scanned: 3 } } }
    }
    if (url.endsWith('/yishuhuanfu/shop')) {
      return { data: { ok: true, data: { quota: '5000', quotaCap: '8000', quotaUsed: '3000' } } }
    }
    return { data: { ok: true, data: snapshotPayload } }
  },
  post: async (url, body, config) => {
    calls.push({ method: 'POST', url, body, account: config?.headers?.['x-account-id'] })
    return { data: { ok: true } }
  },
}

let catalogPayload = []
let recordsPayload = []
let shopsPayload = []
let currentAccountId = '1001'
let snapshotPayload = {}

function loadStoreModule() {
  const imports = {
    '@/api': { __esModule: true, default: api },
    '@/stores/account': { useAccountStore: () => ({ currentAccount: { id: currentAccountId } }) },
  }
  const source = readFileSync(new URL('../src/stores/yishuhuanfu.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  return module.exports
}

const { useYishuHuanfuStore } = loadStoreModule()

function freshStore(accountId = '1001') {
  setActivePinia(createPinia())
  currentAccountId = accountId
  calls.length = 0
  catalogPayload = []
  recordsPayload = []
  shopsPayload = []
  snapshotPayload = {}
  return useYishuHuanfuStore()
}

const catalogEntry = overrides => ({
  index: 5,
  itemId: '35002',
  name: '有机化肥',
  nameKnown: true,
  price: '8500',
  status: 2,
  limit: '50',
  exchangedToday: '0',
  image: '',
  ...overrides,
})

test('catalog keeps the server exchangeable flag and defaults missing flag to clickable', () => {
  const store = freshStore()
  catalogPayload = [catalogEntry({ exchangeable: true }), catalogEntry({ index: 6, price: '28000', exchangeable: false })]
  snapshotPayload = { activityId: '2026111708', active: true, catalog: catalogPayload }
  store.state = {
    groupId: '', activityId: '', name: '', startTime: null, endTime: null, rules: [], active: true, serverTime: '',
    shop: { gid: '', price: '', priceKnown: false, quoteTime: '', selfPrice: '', bonus: '', estimatedPrice: null, quota: null, quotaCap: '', quotaUsed: null },
    seed: { id: '', name: '', image: '', balance: null, balanceKnown: false },
    sweetPotato: { id: '', name: '', image: '', balance: null, balanceKnown: false },
    luckCoin: { id: '', name: '', image: '', balance: null, balanceKnown: false },
    catalog: [], catalogLoaded: false, commission: { pending: '', claimable: false, flag: '' },
    balanceError: '', balanceStale: false,
    daily: { dateKey: '', seedClaimed: false, shared: false, sharedToday: false },
    actions: { claimSeed: { enabled: true, available: true, availabilityKnown: true }, sell: { enabled: true, available: true, availabilityKnown: true }, share: { enabled: true, available: true, availabilityKnown: true }, exchange: { enabled: false, available: false, availabilityKnown: false } },
  }
  return store.loadCatalog('1001').then((ok) => {
    assert.equal(ok, true)
    assert.equal(store.catalog[0].exchangeable, true)
    assert.equal(store.catalog[1].exchangeable, false)
    // 缺 exchangeable 的档位按可兑处理，不能被合成 false。
    catalogPayload = [catalogEntry({})]
    return store.loadCatalog('1001').then(() => {
      assert.equal(store.catalog[0].exchangeable, true)
    })
  })
})

test('records are isolated by account: switching account discards the old list', async () => {
  const store = freshStore('1001')
  recordsPayload = [{ timestamp: '1795500000', gid: '2001', count: '30', total: '4320', name: 'A', avatar: '', level: '143', commission: '86' }]
  assert.equal(await store.loadRecords('1001'), true)
  assert.equal(store.recordsList.length, 1)
  assert.equal(store.recordsList[0].name, 'A')

  // 切到另一个账号：旧列表必须先清掉，守卫不能因为「非空」而跳过请求。
  recordsPayload = [{ timestamp: '1795500001', gid: '3001', count: '10', total: '1200', name: 'B', avatar: '', level: '50', commission: '20' }]
  await store.loadRecords('2002')
  assert.equal(store.recordsList.length, 1)
  assert.equal(store.recordsList[0].name, 'B')
  assert.ok(calls.some(c => c.account === '2002' && c.url.endsWith('/records')))
})

test('friend shop can_sell is tri-state: missing field stays sellable, explicit false blocks', async () => {
  const store = freshStore()
  shopsPayload = [
    { gid: '1', name: '自家', own: true, price: '111', bonus: '33', totalPrice: '144', quota: '8000', quotaCap: '8000', unlimited: true },
    { gid: '2', name: '好友A', price: '99', bonus: '66', totalPrice: '165', quota: '8000', quotaCap: '8000' },
    { gid: '3', name: '好友B', price: '50', bonus: '0', totalPrice: '50', quota: '8000', quotaCap: '8000', canSell: false },
  ]
  assert.equal(await store.scanFriendShops('1001'), true)
  assert.equal(store.friendShops.length, 3)
  assert.equal(store.friendShops[0].canSell, null)
  assert.equal(store.friendShops[0].unlimited, true)
  assert.equal(store.friendShops[1].canSell, null)
  assert.equal(store.friendShops[2].canSell, false)
})

test('sell payload omits friendGid and count when not provided, and no retry on write', async () => {
  const store = freshStore()
  assert.equal(await store.load('1001'), true)
  assert.equal(await store.operate('sell', { count: 480 }, '1001'), true)
  const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/sell'))
  assert.ok(post)
  assert.equal(post.body.count, 480)
  assert.equal('friendGid' in post.body, false)
  assert.equal(calls.filter(c => c.method === 'POST' && c.url.endsWith('/sell')).length, 1)
})
