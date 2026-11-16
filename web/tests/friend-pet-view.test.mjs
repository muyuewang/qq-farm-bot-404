import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = rel => readFileSync(resolve(here, rel), 'utf8')

const friendsPage = read('../src/views/Friends.vue')
const friendList = read('../src/components/friends/FriendsFriendList.vue')

// 后端 /api/friends 给每位好友附加的是 petState + pet，历史上前端按 dogId/dogName 取值，
// 一直是空值，才导致「好友狗信息未提供」的误判。这里锁死字段名，避免再次退回去。
test('好友狗状态只按后端下发的 petState/pet 取值，不再读不存在的 dogId/dogName', () => {
  for (const [name, source] of [['Friends.vue', friendsPage], ['FriendsFriendList.vue', friendList]]) {
    assert.doesNotMatch(source, /dogId/, `${name} 仍在读后端不下发的 dogId`)
    assert.doesNotMatch(source, /dogName/, `${name} 仍在读后端不下发的 dogName`)
  }
  assert.match(friendList, /friend\.petState === 'protect'/)
  assert.match(friendList, /friend\.pet\?\.name/)
})

test('狗状态筛选不把当天没确认过的好友当成无护主犬', () => {
  // unknown 表示当天还没确认过，既不能进「护主犬」也不能进「无护主犬」计数。
  assert.match(friendsPage, /petState === 'protect'\)\.length/)
  assert.match(friendsPage, /petState === 'none'\)\.length/)
  assert.match(friendsPage, /petState !== 'unknown'/)
  assert.match(friendsPage, /const petFilter = ref<'all' \| 'protect' \| 'none'>/)
  assert.match(friendsPage, /petState === petFilter\.value/)
})
