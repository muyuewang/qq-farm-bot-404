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
      const gid = config?.params?.friendGid
      if (gid) {
        return { data: { ok: true, data: {
          targetGid: gid, own: false, price: '120', bonus: '30', totalPrice: '150',
          quota: '100', quotaCap: '8000', quotaUsed: '7900', canSell: true,
          shop: { gid, name: '手填铺主', level: '88' },
        } } }
      }
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
  exchanged: '0',
  remaining: '50',
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
    daily: { dateKey: '', seedClaimed: false, shared: false, sharedToday: false, shareKeySaved: false },
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

test('queryShopQuote uses friendGid and keeps the quote shape for rendering', async () => {
  const store = freshStore()
  // 面板一定先加载快照再查行情；queryShopQuote 与 operate 一样做账号/代际校验。
  assert.equal(await store.load('1001'), true)
  const quote = await store.queryShopQuote('1001', '987654')

  assert.ok(quote)
  assert.equal(quote.gid, '987654')
  assert.equal(quote.name, '手填铺主')
  assert.equal(quote.totalPrice, '150')
  assert.equal(quote.quota, '100')
  assert.equal(quote.canSell, true)
  assert.equal(quote.via, 'manual')
  assert.ok(calls.some(c => c.url.endsWith('/shop')))
  // 非法 GID 直接返回 null，不打网关。
  assert.equal(await store.queryShopQuote('1001', 'abc'), null)
})

test('friend scan keeps panel-source tags and shows backend message', async () => {
  const store = freshStore()
  shopsPayload = [
    { gid: '1', name: '我的铺子', own: true, via: 'own', price: '100', bonus: '20', totalPrice: '120', quota: '8000', unlimited: true },
    { gid: '2', name: '', via: 'panel', panelAccount: '另一个号', price: '90', bonus: '66', totalPrice: '156', quota: '8000', quotaCap: '8000' },
  ]
  // 桩件里注入 message 验证提示文案来自后端。
  const originalGet = api.get
  api.get = async (url, config) => {
    const res = await originalGet(url, config)
    if (url.endsWith('/friends') && res.data?.ok)
      res.data.data.message = '已扫描 2 个铺子（含其它账号好友 1 个）'
    return res
  }
  try {
    assert.equal(await store.scanFriendShops('1001'), true)
    assert.equal(store.friendShops[1].via, 'panel')
    assert.equal(store.friendShops[1].panelAccount, '另一个号')
    assert.match(store.notes.friends, /其它账号好友/)
  } finally { api.get = originalGet }
})

test('snapshot refresh keeps the loaded catalog instead of flashing the skeleton', async () => {
  const store = freshStore()
  catalogPayload = [catalogEntry({ exchangeable: true, price: '8500' })]
  snapshotPayload = { active: true, catalog: [{ index: 5, price: '0', status: 0 }], catalogLoaded: false, actions: { exchange: { enabled: false, available: false, availabilityKnown: true } } }
  assert.equal(await store.loadCatalog('1001'), true)
  assert.equal(store.catalog[0].price, '8500')

  // 快照里的目录骨架价格是 0，不能把真实档位覆盖回去。
  assert.equal(await store.load('1001', true), true)
  assert.equal(store.state.catalog[0].price, '8500')
  assert.equal(store.state.catalogLoaded, true)
  assert.equal(store.state.actions.exchange.enabled, false)
})

test('catalog uses limit minus exchanged as remaining, and falls back to limit on old backends', async () => {
  const store = freshStore()
  // 2026-11-28 起 cmd 97 的 6 号位是「累计已兑」：limit 28、已兑 13 → 界面「限购 15/28」。
  catalogPayload = [
    catalogEntry({ index: 2, price: '60000', limit: '28', exchanged: '13', remaining: '15' }),
    // 兑满的档位 remaining=0，后端会同时把 exchangeable 置 false。
    catalogEntry({ index: 3, price: '40000', limit: '40', exchanged: '40', remaining: '0', exchangeable: false }),
  ]
  snapshotPayload = { active: true, catalog: catalogPayload }
  assert.equal(await store.loadCatalog('1001'), true)
  assert.equal(store.catalog[0].limit, '28')
  assert.equal(store.catalog[0].exchanged, '13')
  assert.equal(store.catalog[0].remaining, '15')
  assert.equal(store.catalog[1].remaining, '0')
  assert.equal(store.catalog[1].exchangeable, false)

  // 旧后端只下发 limit、没有 remaining/exchanged：remaining 退化成本档上限，不能显示 0。
  catalogPayload = [{ index: 4, price: '40000', limit: '40' }]
  await store.loadCatalog('1001')
  assert.equal(store.catalog[0].exchanged, '0')
  assert.equal(store.catalog[0].remaining, '40')
})

test('friend shop reports whether today share key is known, and defaults to sellable when absent', async () => {
  const store = freshStore()
  shopsPayload = [
    { gid: '1', own: true, price: '111', bonus: '33', totalPrice: '144', quota: '8000', quotaCap: '8000', unlimited: true, shareKey: 'a0000001-0000-4000-8000-000000000001' },
    { gid: '2', name: '有标识', price: '99', bonus: '66', totalPrice: '165', quota: '8000', quotaCap: '8000', shareKeyKnown: true, shareKey: 'b0000001-0000-4000-8000-000000000002' },
    // 只能看价：没有对方当天标识，服务端会拒绝成交。
    { gid: '3', name: '缺标识', price: '50', bonus: '0', totalPrice: '50', quota: '8000', quotaCap: '8000', shareKeyKnown: false },
    // 旧后端不带这个字段：按「有标识」处理，不能把整排铺子标成不可卖。
    { gid: '4', name: '旧后端', price: '40', bonus: '0', totalPrice: '40', quota: '8000', quotaCap: '8000' },
  ]
  assert.equal(await store.scanFriendShops('1001'), true)
  assert.equal(store.friendShops[0].shareKeyKnown, true)
  assert.equal(store.friendShops[0].shareKey, 'a0000001-0000-4000-8000-000000000001')
  assert.equal(store.friendShops[1].shareKeyKnown, true)
  assert.equal(store.friendShops[2].shareKeyKnown, false)
  assert.equal(store.friendShops[2].shareKey, '')
  assert.equal(store.friendShops[3].shareKeyKnown, true)
})

test('import and forget share key hit the right endpoints and rescan the pool', async () => {
  const store = freshStore()
  // 导入：整条分享链接也行，后端负责从文本里认标识。
  assert.equal(await store.importShareKey('2001', 'https://example.com/shop?share_key=0d0e525c-1f3e-4133-89d6-da336d845e29', '1001'), true)
  const importCall = calls.find(c => c.method === 'POST' && c.url.endsWith('/yishuhuanfu/share-key'))
  assert.ok(importCall, '必须调用 share-key 导入接口')
  assert.equal(importCall.body.gid, '2001')
  assert.match(importCall.body.text, /0d0e525c/)
  // 导入后要强扫一次比价，否则新铺子不会出现在列表里。
  assert.ok(calls.some(c => c.method === 'GET' && c.url.endsWith('/friends')), '导入后必须重扫比价')

  // 缺 GID 或缺文本时不发请求。
  calls.length = 0
  assert.equal(await store.importShareKey('', 'abc', '1001'), false)
  assert.equal(await store.importShareKey('2001', '  ', '1001'), false)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)

  // 移出比价：删除的是本地标识存档，不是永久屏蔽。
  shopsPayload = [{ gid: '2001', name: '被移出', price: '99', bonus: '0', totalPrice: '99', quota: '8000', quotaCap: '8000', shareKeyKnown: true }]
  await store.scanFriendShops('1001')
  assert.equal(store.friendShops.length, 1)
  shopsPayload = []
  assert.equal(await store.forgetShareKey('2001', '1001'), true)
  const forgetCall = calls.find(c => c.method === 'POST' && c.url.endsWith('/yishuhuanfu/share-key/remove'))
  assert.ok(forgetCall, '必须调用 share-key/remove 接口')
  assert.equal(forgetCall.body.gid, '2001')
  assert.equal(store.friendShops.length, 0, '移出后本地列表要立刻去掉这一家')
})
