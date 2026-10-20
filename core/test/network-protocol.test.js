const assert = require('node:assert/strict');
const test = require('node:test');

const { CONFIG, DEFAULT_CLIENT_VERSION, resolveClientVersion } = require('../src/config/config');
const { loadProto } = require('../src/utils/proto');
const { buildHeartbeatBody, buildLoginBody } = require('../src/utils/network');

// 抓包会话的版本号：固定为抓包当时的值，避免默认版本升级后无法复现官方字节。
const OFFICIAL_SESSION_VERSION = '1.14.0.4_20260911';
const OFFICIAL_LOGIN_BODY =
  '180022002a1c0a11312e31342e302e345f3230323630393131120757696e646f777330003a0731323334353637'
  + '42180a0012001a0022002a086f746865722d717130023a0042004a00';
const OFFICIAL_HEARTBEAT_BODY = '08f9d6ffc5041211312e31342e302e345f32303236303931311800';
const OFFICIAL_HEARTBEAT_GID = 1220537209;

function withSessionVersion(version, run) {
  const previous = CONFIG.clientVersion;
  CONFIG.clientVersion = version;
  try {
    return run();
  } finally {
    CONFIG.clientVersion = previous;
  }
}

test.before(async () => loadProto());

test('default client protocol is upgraded without replacing custom versions', () => {
  assert.equal(DEFAULT_CLIENT_VERSION, '1.15.0.2_20261001');
  assert.equal(resolveClientVersion('1.13.0.5_20260723'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.15.0.1_20261001'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.15.0.3_20261001'), '1.15.0.3_20261001');
  assert.equal(resolveClientVersion('1.16.0.0_20261101'), '1.16.0.0_20261101');
  assert.equal(resolveClientVersion('custom-build'), 'custom-build');
});

test('default login request reproduces the official capture byte for byte', () => {
  withSessionVersion(OFFICIAL_SESSION_VERSION, () => {
    assert.equal(buildLoginBody().toString('hex'), OFFICIAL_LOGIN_BODY);
  });
});

test('custom device protocol keeps its explicit fingerprint fields', () => {
  withSessionVersion(OFFICIAL_SESSION_VERSION, () => {
    const body = buildLoginBody({
      enabled: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      deviceBrand: 'Xiaomi',
      deviceModel: 'Xiaomi 14 Ultra',
      deviceId: 'device-14-ultra',
    });
    assert.notEqual(body.toString('hex'), OFFICIAL_LOGIN_BODY);
  });
});

test('heartbeat request reproduces the official capture byte for byte', () => {
  withSessionVersion(OFFICIAL_SESSION_VERSION, () => {
    assert.equal(buildHeartbeatBody(OFFICIAL_HEARTBEAT_GID).toString('hex'), OFFICIAL_HEARTBEAT_BODY);
  });
});
