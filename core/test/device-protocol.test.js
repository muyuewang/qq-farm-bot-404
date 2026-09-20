const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-device-protocol-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');
const {
    buildLoginDeviceInfo,
    buildTsdkDeviceInfo,
    buildWebSocketHeaders,
    resolveDeviceFingerprint,
} = require('../src/utils/network');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('an account resolves the device protocol saved by its owner', () => {
    const account = store.addOrUpdateAccount({ username: 'alice', name: 'Alice farm' }).accounts.at(-1);
    store.setUserDeviceProtocol({
        enabled: true,
        userAgent: 'Mozilla/5.0 (iPhone)',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 17 Pro',
        deviceMac: '02:11:22:33:44:55',
        deviceId: '0123456789ABCDEF',
        imei: '123456789012345',
    }, 'alice');

    const protocol = store.getDeviceProtocolForAccount(account.id);
    assert.equal(protocol.enabled, true);
    assert.equal(protocol.deviceModel, 'iPhone 17 Pro');
});

test('custom device values are included in the protobuf login device info', () => {
    const info = buildLoginDeviceInfo({
        enabled: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        deviceBrand: 'Xiaomi',
        deviceModel: 'Xiaomi 14 Ultra',
        deviceMac: '02:11:22:33:44:55',
        deviceId: '0123456789ABCDEF',
        imei: '123456789012345',
    });

    assert.equal(info.sys_software, 'Android');
    assert.equal(info.sys_hardware, 'Xiaomi Xiaomi 14 Ultra');
    assert.equal(info.device_id, '0123456789ABCDEF');
    assert.equal(info.telecom_oper, undefined);
});

test('a disabled custom protocol does not alter the default login fingerprint', () => {
  const info = buildLoginDeviceInfo({ enabled: false, deviceModel: 'iPhone 17 Pro' });
  assert.deepEqual(info, {
    client_version: '1.14.0.4_20260911',
    sys_software: 'Windows',
  });
  assert.equal(info.sys_hardware, undefined);
});

test('the default login fingerprint is not injected into the TSDK identity', () => {
    assert.deepEqual(buildTsdkDeviceInfo(null), { platform: 'iOS' });
    assert.deepEqual(buildTsdkDeviceInfo({ enabled: false, deviceModel: 'iPhone 17 Pro' }), {
        platform: 'iOS',
    });
});

test('an enabled custom protocol is passed through to the TSDK identity', () => {
    const info = buildTsdkDeviceInfo({
        enabled: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        deviceBrand: 'Xiaomi',
        deviceModel: 'Xiaomi 14 Ultra',
        deviceMac: '02:11:22:33:44:55',
        deviceId: '0123456789ABCDEF',
        imei: '123456789012345',
    });

    assert.deepEqual(info, {
        deviceModel: 'Xiaomi 14 Ultra',
        deviceBrand: 'Xiaomi',
        deviceId: '0123456789ABCDEF',
        deviceMac: '02:11:22:33:44:55',
        imei: '123456789012345',
        platform: 'Android',
        system: 'Android',
    });
});

test('the default login fingerprint is not injected into the TSDK identity', () => {
    assert.deepEqual(buildTsdkDeviceInfo(null), { platform: 'iOS' });
    assert.deepEqual(buildTsdkDeviceInfo({ enabled: false, deviceModel: 'iPhone 17 Pro' }), {
        platform: 'iOS',
    });
});

test('an enabled custom protocol is passed through to the TSDK identity', () => {
    const info = buildTsdkDeviceInfo({
        enabled: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        deviceBrand: 'Xiaomi',
        deviceModel: 'Xiaomi 14 Ultra',
        deviceMac: '02:11:22:33:44:55',
        deviceId: '0123456789ABCDEF',
        imei: '123456789012345',
    });

    assert.deepEqual(info, {
        deviceModel: 'Xiaomi 14 Ultra',
        deviceBrand: 'Xiaomi',
        deviceId: '0123456789ABCDEF',
        deviceMac: '02:11:22:33:44:55',
        imei: '123456789012345',
        platform: 'Android',
        system: 'Android',
    });
});

test('an empty custom user agent is preserved and omitted from the QQ handshake', () => {
    store.setUserDeviceProtocol({
        enabled: true,
        userAgent: '',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 17',
        deviceId: 'stable-alice-device',
    }, 'alice');

    const protocol = store.getUserDeviceProtocol('alice');
    const headers = buildWebSocketHeaders(protocol);
    assert.equal(protocol.userAgent, '');
    assert.equal(headers['User-Agent'], undefined);
    assert.equal(headers.Origin, 'https://gate-obt.nqf.qq.com');
    assert.equal(headers.Referer, 'https://appservice.qq.com/1112386029/1.14.0.4/page-frame.html');
});

test('custom device protocol rejects incomplete or contradictory fingerprints', () => {
    assert.throws(() => resolveDeviceFingerprint({
        enabled: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 17',
        deviceId: 'device-1',
    }), /矛盾/);
    assert.throws(() => resolveDeviceFingerprint({
        enabled: true,
        userAgent: 'Mozilla/5.0 (iPhone)',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 17',
    }), /不完整/);
});

test('custom device protocol rejects incomplete or contradictory fingerprints', () => {
    assert.throws(() => resolveDeviceFingerprint({
        enabled: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 17',
        deviceId: 'device-1',
    }), /矛盾/);
    assert.throws(() => resolveDeviceFingerprint({
        enabled: true,
        userAgent: 'Mozilla/5.0 (iPhone)',
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 17',
    }), /不完整/);
});
