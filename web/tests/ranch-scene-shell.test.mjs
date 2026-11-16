import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { RANCH_VIEWS } from '../src/utils/ranch.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = rel => readFileSync(resolve(here, rel), 'utf8')

const host = read('../src/components/ranch/RanchSceneHost.vue')
const ranchPage = read('../src/views/Ranch.vue')
const personalPage = read('../src/views/Personal.vue')
const shopPage = read('../src/views/Shop.vue')
const illustratedPage = read('../src/views/Illustrated.vue')
const friendsPage = read('../src/views/Friends.vue')
const sceneSwitch = read('../src/components/ui/SceneSwitch.vue')

const SCENE_PAGES = [
  ['Personal.vue', personalPage],
  ['Shop.vue', shopPage],
  ['Illustrated.vue', illustratedPage],
  ['Friends.vue', friendsPage],
]

/** 从页面里把 `const NAME = ([...] as const)` 的分区清单取出来，避免测试和源码靠注释对齐。 */
function viewsIn(name, source) {
  const matched = source.match(new RegExp(`const ${name}[^=]*=\\s*\\(\\[([^\\]]*)\\] as const\\)`))
  assert.ok(matched, `页面里找不到 ${name} 分区清单`)
  return matched[1].split(',').map(item => item.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

/** 单分区页面直接把分区名写在 <RanchSceneHost view="..."> 上，静态可查。 */
function hostView(name, source) {
  const matched = source.match(/<RanchSceneHost[^>]*?\sview="([^"]+)"/s)
  assert.ok(matched, `${name} 没有静态声明牧场分区`)
  return matched[1]
}

const placed = [
  ...viewsIn('TABS', ranchPage),
  ...viewsIn('RANCH_SHOP_VIEWS', shopPage),
  hostView('Personal.vue', personalPage),
  hostView('Illustrated.vue', illustratedPage),
  hostView('Friends.vue', friendsPage),
]

test('牧场每个分区都只有一个页面归属，既不重复也不遗漏', () => {
  assert.deepEqual([...placed].sort(), [...RANCH_VIEWS].sort())
  assert.equal(new Set(placed).size, placed.length)
  // 农场也有的子系统不能同时留在牧场入口和各自的场景页里。
  assert.deepEqual(viewsIn('TABS', ranchPage).filter(v => !['animals', 'facilities', 'tasks', 'activities'].includes(v)), [])
})

test('共用的子系统用场景切换段区分，不新增平行菜单', () => {
  assert.match(sceneSwitch, /modelValue: 'farm' \| 'ranch'/)
  assert.doesNotMatch(sceneSwitch, /api\.|\$fetch|axios/)
  for (const [name, source] of SCENE_PAGES) {
    assert.match(source, /<SceneSwitch[^>]*v-model="\w+Scene"/, `${name} 缺少场景切换段`)
    assert.match(source, /<RanchSceneHost\b/, `${name} 没有牧场场景分支`)
    assert.match(source, /shopScene === 'farm'|illustratedScene === 'farm'|friendsScene === 'farm'|bagScene === 'ranch'/, `${name} 没有按场景分流`)
  }
  assert.equal(shopPage.match(/<SceneSwitch/g).length, 2, '农场卡片和牧场壳都要能切回另一个场景')
})

test('牧场协议只收在场景壳里，页面不各自复制门控与两阶段提交', () => {
  for (const [name, source] of [['Ranch.vue', ranchPage], ...SCENE_PAGES]) {
    assert.doesNotMatch(source, /RanchQuoteDialog/, `${name} 不该自己挂报价弹窗`)
    assert.doesNotMatch(source, /useRanchStore|visibilitychange|acknowledge\(/, `${name} 不该自己管牧场读取与待核对账本`)
  }
  assert.match(host, /import RanchQuoteDialog from/)
  assert.match(host, /document\.addEventListener\('visibilitychange'/)
  assert.match(host, /ranchStore\.acknowledge\(/)
})

test('场景壳按页面要求的分区读取，参数变化才强制重新进场景', () => {
  // 挂载时沿用上一页残留的 activeView 会读到错误分区。
  assert.match(host, /onMounted\(\(\) => \{[\s\S]{0,160}?refresh\(props\.view\)/)
  assert.match(host, /paramsKey = computed\(\(\) => JSON\.stringify\(props\.params \?\? \{\}\)\)/)
  assert.match(host, /if \(previous\[1\] === key\)\s*switchView\(view, params\)/)
  assert.match(host, /else\s*refresh\(view, params\)/)
})

test('停在牧场场景时不重复拉取没有消费方的农场快照', () => {
  assert.match(illustratedPage, /illustratedScene\.value === 'ranch'\)\s*\n\s*return/)
  assert.match(friendsPage, /friendsScene\.value === 'ranch'\)\s*\n\s*return/)
  assert.match(shopPage, /shopScene\.value === 'ranch'\)\s*\n\s*return/)
  for (const [name, source] of [['Illustrated.vue', illustratedPage], ['Friends.vue', friendsPage], ['Shop.vue', shopPage]])
    assert.match(source, /watch\(\w+Scene,/, `${name} 切回农场场景后没有重新读取`)
})
