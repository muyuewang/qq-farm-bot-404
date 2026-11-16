import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  isRanchSwitchDefaultOn,
  ranchUsesPreferredAnimal,
  RANCH_AUTOMATION_DEFAULTS,
  RANCH_AUTOMATION_GROUPS,
  RANCH_AUTOMATION_LIMITS,
  RANCH_AUTOMATION_SWITCHES,
  RANCH_BAG_FALLBACK_OPTIONS,
  RANCH_STRATEGY_OPTIONS,
} from '../src/utils/ranch.ts'

// 牧场自动化开关的真值来源是后端 core/src/config/ranch-automation.ts 与
// core/src/services/ranch/automation.ts。这里只做静态解析比对，不启动后端、不连真实服务端。

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const configSource = read('../../core/src/config/ranch-automation.ts')
const serviceSource = read('../../core/src/services/ranch/automation.ts')
const settingsSource = read('../src/components/settings/AccountFeatureSettings.vue')
const automationComposable = read('../src/composables/settings/useAutomationSettings.ts')

function parseScalar(raw) {
  const value = raw.replace(/\s+as\s+[\s\S]+$/, '').replace(/,$/, '').trim()
  if (value === 'true')
    return true
  if (value === 'false')
    return false
  if (/^-?\d+(\.\d+)?$/.test(value))
    return Number(value)
  const quoted = value.match(/^'([^']*)'$/)
  if (quoted)
    return quoted[1]
  throw new Error(`无法解析后端默认值：${raw}`)
}

function parseBackendDefaults() {
  const block = configSource.match(/RANCH_AUTOMATION_DEFAULTS\s*=\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(block, '后端默认值结构变化，请同步 web/src/utils/ranch.ts')
  const result = {}
  for (const line of block.split('\n')) {
    const entry = line.match(/^\s*([A-Za-z0-9_]+):\s*(.+?),?\s*$/)
    if (entry)
      result[entry[1]] = parseScalar(entry[2])
  }
  return result
}

const backendDefaults = parseBackendDefaults()
const backendSwitchKeys = Object.keys(backendDefaults).filter(key => typeof backendDefaults[key] === 'boolean')

test('牧场开关清单与后端默认值逐 key、逐值一致', () => {
  assert.deepEqual(RANCH_AUTOMATION_SWITCHES.map(item => item.key).sort(), [...backendSwitchKeys].sort())
  assert.deepEqual(Object.keys(RANCH_AUTOMATION_DEFAULTS).sort(), Object.keys(backendDefaults).sort())
  for (const [key, value] of Object.entries(backendDefaults))
    assert.deepEqual(RANCH_AUTOMATION_DEFAULTS[key], value, `${key} 的默认值与后端不一致`)
})

test('卡片总开关只恢复后端默认里本就为 true 的动作', () => {
  const defaultOn = Object.keys(backendDefaults).filter(key => backendDefaults[key] === true)
  assert.deepEqual(RANCH_AUTOMATION_SWITCHES.filter(item => isRanchSwitchDefaultOn(item.key)).map(item => item.key).sort(), [...defaultOn].sort())
  for (const key of backendSwitchKeys) {
    if (defaultOn.includes(key))
      continue
    assert.equal(isRanchSwitchDefaultOn(key), false, `${key} 不应被卡片总开关默认打开`)
  }
  // 非开关参数不属于动作，不能误判成默认开启。
  assert.equal(isRanchSwitchDefaultOn('ranch_check_minutes'), false)
  assert.equal(isRanchSwitchDefaultOn('not_a_ranch_key'), false)
})

test('分组覆盖全部开关且不重复，好友组与后端 FRIEND_CONTROLS 同一批开关', () => {
  const grouped = RANCH_AUTOMATION_GROUPS.flatMap(group => RANCH_AUTOMATION_SWITCHES.filter(item => item.group === group.key).map(item => item.key))
  assert.deepEqual(grouped.slice().sort(), RANCH_AUTOMATION_SWITCHES.map(item => item.key).sort())
  assert.equal(new Set(grouped).size, grouped.length)
  for (const group of RANCH_AUTOMATION_GROUPS) {
    assert.ok(RANCH_AUTOMATION_SWITCHES.some(item => item.group === group.key), `${group.key} 分组下没有任何开关`)
    assert.ok(group.title && group.detail, `${group.key} 分组缺少标题或说明`)
  }

  const controls = serviceSource.match(/const FRIEND_CONTROLS[^=]*=\s*\{([^}]*)\}/)?.[1]
  assert.ok(controls, '后端好友互动开关表结构变化，请同步设置页分组')
  const friendKeys = [...controls.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]).sort()
  const friendGroup = RANCH_AUTOMATION_SWITCHES.filter(item => item.group === 'friend').map(item => item.key).sort()
  assert.deepEqual(friendGroup, friendKeys)
})

test('每个开关都对应后端一个真实自动动作', () => {
  for (const item of RANCH_AUTOMATION_SWITCHES)
    assert.ok(serviceSource.includes(`'${item.key}'`), `${item.key} 在后端巡查流程里没有被使用`)
})

test('策略选项与巡查区间边界取自后端校验规则', () => {
  const allowed = configSource.match(/key === 'ranch_strategy'\s*\?\s*\[([^\]]*)\]\s*:\s*\[([^\]]*)\]/)
  assert.ok(allowed, '后端策略白名单结构变化，请同步设置页选项')
  assert.deepEqual(RANCH_STRATEGY_OPTIONS.map(item => item.value), [...allowed[1].matchAll(/'([^']+)'/g)].map(match => match[1]))
  assert.deepEqual(RANCH_BAG_FALLBACK_OPTIONS.map(item => item.value), [...allowed[2].matchAll(/'([^']+)'/g)].map(match => match[1]))

  const range = configSource.match(/number\s*<\s*(\d+)\s*\|\|\s*number\s*>\s*(\d+)/)
  assert.ok(range, '后端巡查间隔校验结构变化，请同步设置页边界')
  assert.deepEqual(RANCH_AUTOMATION_LIMITS.checkMinutes, { min: Number(range[1]), max: Number(range[2]) })
})

test('窝与棚的指定动物按后端 kind 判定，仅 preferred 路径真正生效', () => {
  const kinds = configSource.match(/key === 'ranch_coop_animal'\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/)
  assert.ok(kinds, '后端窝/棚类型判定结构变化，请同步设置页选项过滤')
  const animals = JSON.parse(read('../../core/src/gameConfig/ranch/MCAnimalConfig.json'))
  const animalKinds = [...new Set(animals.map(animal => animal.husbandry_type))].sort()
  assert.deepEqual(animalKinds, [kinds[2], kinds[1]].sort())

  assert.equal(ranchUsesPreferredAnimal('preferred', 'level'), true)
  assert.equal(ranchUsesPreferredAnimal('bag_priority', 'preferred'), true)
  assert.equal(ranchUsesPreferredAnimal('bag_priority', 'level'), false)
  assert.equal(ranchUsesPreferredAnimal('level', 'preferred'), false)
  assert.equal(ranchUsesPreferredAnimal(undefined, undefined), false)
})

test('设置页与默认值来自同一份清单，避免新增开关漏挂卡片', () => {
  assert.match(automationComposable, /\.\.\.RANCH_AUTOMATION_DEFAULTS/)
  assert.match(settingsSource, /RANCH_AUTOMATION_SWITCHES/)
  assert.match(settingsSource, /RANCH_AUTOMATION_GROUPS/)
  // 卡片关闭时必须清掉全部牧场动作，否则后端巡查仍会继续跑旧开关。
  assert.match(settingsSource, /ranchKeys\.forEach/)
  assert.match(settingsSource, /isRanchSwitchDefaultOn/)
})
