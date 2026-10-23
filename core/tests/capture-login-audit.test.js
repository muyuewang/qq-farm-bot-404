const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');
const { decodeLoginProfile, compareConnectionVersions } = require('../../tools/analyze-keepalive-capture');

const root = new protobuf.Root();
root.loadSync(path.join(__dirname, '../src/proto/player-login.proto'), { keepCase: true });

test('capture audit decodes the distinct QQ and WeChat login layouts without account data', () => {
    for (const [method, typeName, version, channel, scene] of [
        ['PlayerLogin', 'PlayerLoginRequest', '1.15.0.2_20261001', 'other-qq', '1234567'],
        ['PlayerLogin', 'PlayerLoginRequest', '1.15.0.2_20261001', 'other', '1005'],
        ['Login', 'LoginRequest', '1.14.2.13_20260922', 'other', undefined],
    ]) {
        const body = root.lookupType(`gamepb.userpb.${typeName}`).encode({
            sharer_id: 123, sharer_open_id: 'private-open-id',
            device_info: { client_version: version, sys_software: 'Windows', device_id: 'private-device-id' },
            report_data: { minigame_channel: channel, minigame_platid: 2, click_id: 'private-click-id' },
            scene_id: scene,
        }).finish();
        const profile = decodeLoginProfile(root, method, body);
        assert.equal(profile.version, version);
        assert.equal(profile.channel, channel);
        assert.equal(profile.sceneId, scene ?? null);
        assert.equal(profile.hasDeviceId, true);
        assert.equal(JSON.stringify(profile).includes('private-'), false);
    }
});

test('version audit requires all three stages and flags drift within a connection', () => {
    assert.equal(compareConnectionVersions('v1', [], ['v1']).consistent, null);
    assert.equal(compareConnectionVersions('', ['v1'], ['v1']).complete, false);
    assert.equal(compareConnectionVersions('v1', ['v1'], ['v1', 'v1']).consistent, true);
    assert.equal(compareConnectionVersions('v1', ['v1'], ['v1', 'v2']).consistent, false);
    assert.equal(compareConnectionVersions('v1', ['v2'], ['v1']).consistent, false);
});
