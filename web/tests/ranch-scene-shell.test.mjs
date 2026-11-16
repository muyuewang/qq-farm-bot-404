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
const sceneStore = read('../src/stores/scene.ts')
const sceneSwitch = read('../src/components/ui/SceneSwitch.vue')
const menu = read('../src/router/menu.ts')
const layout = read('../src/layouts/DefaultLayout.vue')
const sidebar = read('../src/components/Sidebar.vue')
const personalPage = read('../src/views/Personal.vue')
const shopPage = read('../src/views/Shop.vue')
const illustratedPage = read('../src/views/Illustrated.vue')
const friendsPage = read('../src/views/Friends.vue')
const activityPage = read('../src/views/Activity.vue')

const SCENE_PAGES = [
  ['Personal.vue', personalPage],
  ['Shop.vue', shopPage],
  ['Illustrated.vue', illustratedPage],
  ['Friends.vue', friendsPage],
  ['Activity.vue', activityPage],
]

/** Activity.vue 自己有一份农场活动轮询的可见性监听，不在这份清单里。 */
const NO_VISIBILITY_PAGES = SCENE_PAGES.slice(0, 4)

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
  ...viewsIn('RANCH_TABS', personalPage),
  ...viewsIn('RANCH_SHOP_VIEWS', shopPage),
  hostView('Illustrated.vue', illustratedPage),
  hostView('Friends.vue', friendsPage),
  hostView('Activity.vue', activityPage),
]

test('牧场每个分区都只有一个页面归属，既不重复也不遗漏', () => {
  assert.deepEqual([...placed].sort(), [...RANCH_VIEWS].sort())
  assert.equal(new Set(placed).size, placed.length)
})

test('场景是全局状态，菜单和页面一起切', () => {
  assert.match(sceneStore, /defineStore\('scene'/)
  assert.match(sceneStore, /ref<GameScene>\(localStorage\.getItem\(SCENE_KEY\) === 'ranch' \? 'ranch' : 'farm'\)/)
  assert.match(sceneStore, /function setScene\(value: GameScene\)/)
  assert.doesNotMatch(sceneStore, /api\.|\$fetch|axios/, '场景只是浏览偏好，不该发请求')

  // 顶栏那一个开关读全局 store，页面不再各带一份 v-model 段控件。
  assert.match(sceneSwitch, /useSceneStore\(\)/)
  assert.match(sceneSwitch, /sceneStore\.setScene\(target\.value\)/)
  assert.doesNotMatch(sceneSwitch, /modelValue/)
  assert.doesNotMatch(sceneSwitch, /api\.|\$fetch|axios/)
  assert.match(layout, /<SceneSwitch \/>/)

  // 换场景时整站换皮，避免用户以为还停在原来那个助手里。
  assert.match(layout, /SCENE_BRAND\.ranch\.title/)
  assert.match(sidebar, /SCENE_BRAND/)

  for (const [name, source] of SCENE_PAGES) {
    assert.doesNotMatch(source, /SceneSwitch/, `${name} 不该再自带一个场景切换段`)
    assert.doesNotMatch(source, /ref<'farm' \| 'ranch'>/, `${name} 不该自己存场景`)
    assert.match(source, /useSceneStore\(\)/, `${name} 没有读全局场景`)
  }
})

test('牧场不再单列菜单入口，只有农场有的页面在牧场场景里隐藏', () => {
  assert.doesNotMatch(menu, /views\/Ranch\.vue/, '牧场内容应分散到各场景页，不该再有独立入口')
  assert.doesNotMatch(menu, /name: 'ranch'/)
  // 宠物和分析只有农场一套，切到牧场后菜单里留着它们只会显示对不上的农场数据。
  assert.match(menu, /label: '宠物',[\s\S]{0,120}scenes: \['farm'\]/)
  assert.match(menu, /label: '分析',[\s\S]{0,120}scenes: \['farm'\]/)
  assert.match(sidebar, /!item\.scenes \|\| item\.scenes\.includes\(scene\.value\)/)
  // 停在农场专属页时切场景要跟着菜单走，否则用户看到的是与场景对不上的页面。
  assert.match(layout, /availablePaths[\s\S]{0,220}router\.replace\('\/personal'\)/)
})

test('牧场协议只收在场景壳里，页面不各自复制门控与两阶段提交', () => {
  for (const [name, source] of SCENE_PAGES) {
    assert.match(source, /<RanchSceneHost\b/, `${name} 没有牧场场景分支`)
    assert.doesNotMatch(source, /RanchQuoteDialog/, `${name} 不该自己挂报价弹窗`)
    assert.doesNotMatch(source, /useRanchStore|acknowledge\(/, `${name} 不该自己管牧场读取与待核对账本`)
  }
  // 活动页的可见性监听只服务于农场活动轮询，牧场侧的可见性刷新必须留在场景壳里。
  for (const [name, source] of NO_VISIBILITY_PAGES)
    assert.doesNotMatch(source, /visibilitychange/, `${name} 不该自己管牧场读取`)
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
  for (const [name, source] of [
    ['Illustrated.vue', illustratedPage],
    ['Friends.vue', friendsPage],
    ['Shop.vue', shopPage],
    ['Activity.vue', activityPage],
  ]) {
    assert.match(source, /scene\.value === 'ranch'\)\n\s*return/, `${name} 没有按全局场景跳过农场读取`)
    assert.match(source, /watch\(scene,/, `${name} 切回农场场景后没有重新读取`)
  }
})
