function getOldestPendingAgeMs(startedAtValues, now = Date.now()) {
  const values = Array.from(startedAtValues || []).filter(Number.isFinite);
  if (values.length === 0) return 0;
  return Math.max(0, now - Math.min(...values));
}

function evaluateGatewayHealth(input = {}) {
  const connected = input.connected !== false;
  const heartbeatAgeMs = Math.max(0, Number(input.heartbeatAgeMs) || 0);
  const oldestPendingAgeMs = Math.max(0, Number(input.oldestPendingAgeMs) || 0);
  const heartbeatLimitMs = Math.max(1000, Number(input.heartbeatLimitMs) || 30000);
  const pendingLimitMs = Math.max(1000, Number(input.pendingLimitMs) || 5000);

  if (!connected) return { healthy: false, reason: 'disconnected' };
  if (heartbeatAgeMs > heartbeatLimitMs) return { healthy: false, reason: 'heartbeat_stale' };
  if (oldestPendingAgeMs > pendingLimitMs) return { healthy: false, reason: 'request_stuck' };
  return { healthy: true, reason: 'ok' };
}

function nextBusinessBackoffMs(previousMs = 0, minimumMs = 30000, maximumMs = 60000) {
  const min = Math.max(1000, Number(minimumMs) || 30000);
  const max = Math.max(min, Number(maximumMs) || 60000);
  const previous = Math.max(0, Number(previousMs) || 0);
  return previous > 0 ? Math.min(max, previous * 2) : min;
}

const HEARTBEAT_STALE_AFTER_MS = 30000;
const MAX_HEARTBEAT_MISSES = 3;

// 终止判定只看"入站静默 + 连续心跳失败"两个条件，绝不因心跳应答单独超时触发，
// 否则会误杀业务流量正常、只是 Heartbeat 回得慢的健康连接（频繁掉线根因）。
function shouldTerminateForHeartbeat(missCount, inboundSilenceMs) {
  return Number(missCount) >= MAX_HEARTBEAT_MISSES
    && Number(inboundSilenceMs) > HEARTBEAT_STALE_AFTER_MS;
}

module.exports = {
  getOldestPendingAgeMs,
  evaluateGatewayHealth,
  nextBusinessBackoffMs,
  HEARTBEAT_STALE_AFTER_MS,
  MAX_HEARTBEAT_MISSES,
  shouldTerminateForHeartbeat,
};
