const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseOfficialGatewayUrl,
  syncGatewayClientVersion,
} = require('../src/controllers/admin-account-routes');

test('extracts code and client version from the official gateway URL', () => {
  assert.deepEqual(parseOfficialGatewayUrl(
    'wss://gate-obt.nqf.qq.com/prod/ws?platform=qq&os=iOS&ver=1.13.2.9_20260723&code=ac0af478f19a045c6b03809dd0f6f0c7',
  ), {
    code: 'ac0af478f19a045c6b03809dd0f6f0c7',
    clientVersion: '1.13.2.9_20260723',
    wechat: false,
  });
});

test('marks WeChat captures so they never overwrite the QQ version', () => {
  assert.equal(parseOfficialGatewayUrl(
    'wss://gate-obt.nqf.qq.com/prod/ws?platform=wx&os=iOS&ver=1.15.0.2_20261001&code=ac0af478f19a045c6b03809dd0f6f0c7',
  ).wechat, true);
  assert.equal(parseOfficialGatewayUrl(
    'wss://gate-obt.nqf.qq.com/prod/ws?os=iOS&ver=1.15.0.2_20261001&code=ac0af478f19a045c6b03809dd0f6f0c7',
  ).wechat, false);
});

test('rejects non-official gateway URLs and malformed versions', () => {
  assert.equal(parseOfficialGatewayUrl(
    'wss://example.com/prod/ws?ver=1.13.2.9_20260723&code=abc',
  ), null);
  assert.equal(parseOfficialGatewayUrl(
    'wss://gate-obt.nqf.qq.com/prod/ws?ver=latest&code=abc',
  ), null);
});

test('updates persisted and runtime client versions only when they differ', () => {
  let saved = { serverUrl: 'wss://gate-obt.nqf.qq.com', clientVersion: '1.0.0_20260101' };
  let runtime = null;
  const store = {
    getSystemConfig: () => saved,
    setSystemConfig: (next) => {
      saved = next;
      return next;
    },
  };
  const gateway = { code: 'abc', clientVersion: '1.13.2.9_20260723' };
  assert.equal(syncGatewayClientVersion(gateway, store, next => runtime = next), true);
  assert.equal(saved.clientVersion, gateway.clientVersion);
  assert.equal(runtime.clientVersion, gateway.clientVersion);
  assert.equal(syncGatewayClientVersion(gateway, store, () => assert.fail()), false);
});

test('a WeChat capture writes only the WeChat version field', () => {
  let saved = { clientVersion: '1.13.2.9_20260723', wxClientVersion: '1.0.0_20260101' };
  const store = {
    getSystemConfig: () => saved,
    setSystemConfig: (next) => {
      saved = next;
      return next;
    },
  };
  let runtime = null;
  const gateway = { code: 'abc', clientVersion: '1.15.0.2_20261001', wechat: true };
  assert.equal(syncGatewayClientVersion(gateway, store, next => runtime = next), true);
  assert.equal(saved.wxClientVersion, gateway.clientVersion);
  assert.equal(saved.clientVersion, '1.13.2.9_20260723');
  assert.equal(runtime.wxClientVersion, gateway.clientVersion);
});
