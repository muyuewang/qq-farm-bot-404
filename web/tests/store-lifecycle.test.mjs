import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createPinia, disposePinia, setActivePinia } = require('pinia')
const ts = require('typescript')

// Run the real stores with Vue/Pinia; only external I/O and browser storage are replaced.
function harness(t, api) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const imports = {
    '@/api': { __esModule: true, default: api, getApiErrorMessage: value => value?.error || value?.message || '请求失败' },
  }
  const source = readFileSync(new URL('../src/stores/pet-diary.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  // Execute the real transpiled store with test I/O, without adding a browser or bundler dependency.
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(id => imports[id] || require(id), module, module.exports)
  return { store: module.exports.usePetDiaryStore(pinia) }
}

test('pet success feedback expires, newer feedback gets its full duration, and switching accounts clears it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let message = '第一次成功'
  const { store } = harness(t, {
    post: async () => ({ data: { ok: true, data: { message, snapshot: { active: true } } } }),
  })
  store.selectAccount('a')
  store.activity = { active: true }
  await store.operate('refreshCharm')
  t.mock.timers.tick(3000)
  message = '第二次成功'
  await store.operate('equipCharm', { charmId: 101 })
  t.mock.timers.tick(1000)
  assert.equal(store.notice, '第二次成功')
  t.mock.timers.tick(3000)
  assert.equal(store.notice, '')
  await store.operate('refreshCharm')
  store.selectAccount('b')
  assert.equal(store.notice, '')
})

test('pet failure warnings stay visible after the success-feedback timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store } = harness(t, {
    post: async () => {
      throw new Error('余额不足')
    },
  })
  store.selectAccount('a')
  store.activity = { active: true }
  await store.operate('draw')
  t.mock.timers.tick(8000)
  assert.match(store.error, /余额不足/)
  assert.equal(store.stale, true)
})
