const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateGatewayHealth,
  getOldestPendingAgeMs,
  nextBusinessBackoffMs,
  shouldTerminateForHeartbeat,
} = require('../src/utils/gateway-health');

test('gateway health distinguishes stale heartbeat and stuck requests', () => {
  assert.deepEqual(evaluateGatewayHealth({ heartbeatAgeMs: 31000 }), { healthy: false, reason: 'heartbeat_stale' });
  assert.deepEqual(evaluateGatewayHealth({ heartbeatAgeMs: 1000, oldestPendingAgeMs: 6000 }), { healthy: false, reason: 'request_stuck' });
  assert.deepEqual(evaluateGatewayHealth({ heartbeatAgeMs: 1000, oldestPendingAgeMs: 1000 }), { healthy: true, reason: 'ok' });
});

test('gateway backoff starts at 30 seconds and caps at 60 seconds', () => {
  assert.equal(nextBusinessBackoffMs(0), 30000);
  assert.equal(nextBusinessBackoffMs(30000), 60000);
  assert.equal(nextBusinessBackoffMs(60000), 60000);
  assert.equal(getOldestPendingAgeMs([9000, 7000], 10000), 3000);
});

test('heartbeat termination requires both missed heartbeats and inbound silence', () => {
  // 真正死连接：连续 3 次心跳失败且 30s 无任何入站数据。
  assert.equal(shouldTerminateForHeartbeat(3, 30001), true);
  assert.equal(shouldTerminateForHeartbeat(8, 120000), true);
  // 边界：入站静默恰好 30s 不触发。
  assert.equal(shouldTerminateForHeartbeat(3, 30000), false);
  // 失败次数不足不触发。
  assert.equal(shouldTerminateForHeartbeat(2, 120000), false);
  // 关键回归：业务流量仍在（入站很新鲜）时，绝不能因心跳应答慢而误杀健康连接。
  assert.equal(shouldTerminateForHeartbeat(8, 1000), false);
  assert.equal(shouldTerminateForHeartbeat(99, 0), false);
});
