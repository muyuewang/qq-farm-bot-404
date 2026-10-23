import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const ts = require('typescript')
const { reactive, ref } = require('vue')

// Run the real stores with Vue/Pinia; only external I/O and browser storage are replaced.
function harness(t, name, api) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const account = reactive({ currentAccountId: 'a' })
  const imports = {
    '@/api': { __esModule: true, default: api, getApiErrorMessage: value => value?.error || value?.message || '请求失败' },
    '@/stores/account': { useAccountStore: () => account },
    '@vueuse/core': { useStorage: (_key, initial) => ref(initial) },
  }
  const source = readFileSync(new URL(`../src/stores/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  // Execute the real transpiled store with test I/O, without adding a browser or bundler dependency.
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  const useStore = module.exports[`use${name[0].toUpperCase()}${name.slice(1)}Store`]
  return { store: useStore(pinia), account }
}

test('bulk fertilizer applies authoritative partial results and blocks duplicate requests', async (t) => {
  const requests = []
  const { store } = harness(t, 'farm', {
    post: (url, body, options) => new Promise(resolve => requests.push({ url, body, options, resolve })),
  })
  store.lands = [{ id: 1, status: 'growing', matureInSec: 100 }]
  const pending = store.fertilizeAll('a', 'organic')
  assert.equal(await store.fertilizeAll('a', 'organic'), false)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/farm/fertilize-all')
  assert.equal(requests[0].options.headers['x-account-id'], 'a')
  requests[0].resolve({ data: { ok: true, data: { successCount: 1, skippedCount: 2, updatedLands: [{ id: 1, status: 'harvestable', matureInSec: 0 }] } } })
  assert.equal((await pending).skippedCount, 2)
  assert.equal(store.lands[0].status, 'harvestable')
  assert.equal(store.fertilizePending, false)
})

test('fertilizer replies cannot overwrite another account or clear its pending request', async (t) => {
  const requests = []
  const { store } = harness(t, 'farm', {
    post: () => new Promise(resolve => requests.push(resolve)),
  })
  const old = store.fertilizeAll('a', 'normal')
  store.resetLandState()
  store.lands = [{ id: 1, status: 'growing', matureInSec: 800 }]
  const current = store.fertilizeAll('b', 'organic')
  requests[0]({ data: { ok: true, data: { updatedLands: [{ id: 1, status: 'harvestable', matureInSec: 0 }] } } })
  assert.equal(await old, false)
  assert.equal(store.lands[0].matureInSec, 800)
  assert.equal(store.fertilizePending, true)
  requests[1]({ data: { ok: false, error: '化肥不足' } })
  assert.equal(await current, false)
  assert.equal(store.fertilizePending, false)
  assert.equal(store.fertilizeError, '化肥不足')
})

test('selected-land fertilizer requests preserve the explicit target set', async (t) => {
  const requests = []
  const { store } = harness(t, 'farm', {
    post: async (url, body, options) => {
      requests.push({ url, body, options })
      return { data: { ok: true, data: { successCount: 1, skippedCount: 0, updatedLands: [] } } }
    },
  })
  await store.fertilizeAll('a', 'normal', [2, 4])
  assert.deepEqual(requests[0].body, { fertilizerType: 'normal', landIds: [2, 4] })
  assert.equal(requests[0].options.headers['x-account-id'], 'a')
  await store.fertilizeAll('a', 'organic', [])
  assert.deepEqual(requests[1].body, { fertilizerType: 'organic', landIds: [] })
  await store.fertilizeAll('a', 'normal')
  assert.deepEqual(requests[2].body, { fertilizerType: 'normal' })
})
