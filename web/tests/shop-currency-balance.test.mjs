import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'
import { pickCurrencyBalance } from '../src/utils/shop-currency.ts'

// 道具商城 /api/props-shop 只为商品定价用到的币种返回余额：
// core/src/services/commerce.ts currencyBalances() 只查询 goods 里出现的 price.id。
// 点券(1002)、钻石(1004) 没有对应商品时不会出现在 currencies 中，前端必须另找来源，
// 否则 ShopAccountHeader 会把 null 渲染成「未确认」。

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('道具商城已返回余额时优先使用商城值', () => {
  assert.equal(pickCurrencyBalance(1055, 0), 1055)
  assert.equal(pickCurrencyBalance(12, 999), 12)
})

test('商城未返回该币种时回退到备用来源', () => {
  // 点券：/api/status 的 status.coupon
  assert.equal(pickCurrencyBalance(null, 860), 860)
  assert.equal(pickCurrencyBalance(undefined, 860), 860)
  // 钻石：单独查询 /api/diamond
  assert.equal(pickCurrencyBalance(null, 120), 120)
})

test('余额为 0 是有效值，不能被当成缺失而回退', () => {
  assert.equal(pickCurrencyBalance(0, 500), 0)
})

test('两个来源都不可用时保持 null，由 header 显示未确认', () => {
  assert.equal(pickCurrencyBalance(null, null), null)
  assert.equal(pickCurrencyBalance(undefined, undefined), null)
  assert.equal(pickCurrencyBalance(Number.NaN, Number.NaN), null)
  assert.equal(pickCurrencyBalance(Number.POSITIVE_INFINITY, null), null)
})

test('Shop.vue 顶部资源条为点券与钻石接线了回退来源', () => {
  const shop = read('../src/views/Shop.vue')
  // 点券回退到 status.coupon，钻石回退到 /api/diamond 的返回值
  assert.match(shop, /status\.value\?\.status\?\.coupon/)
  assert.match(shop, /\/api\/diamond/)
  assert.match(shop, /pickCurrencyBalance/)
  // 两个币种都必须经过回退，而不是直接读商城 currencies
  assert.match(shop, /const headerCoupon = computed\(\(\) => pickCurrencyBalance\(/)
  assert.match(shop, /const headerDiamond = computed\(\(\) => pickCurrencyBalance\(/)
})
