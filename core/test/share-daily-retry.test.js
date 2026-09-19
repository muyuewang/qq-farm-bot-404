const assert = require('node:assert/strict');
const test = require('node:test');

test('daily share retries after a temporarily unavailable check without reconnecting', async () => {
  const sharePath = require.resolve('../src/services/share');
  const networkPath = require.resolve('../src/utils/network');
  const protoPath = require.resolve('../src/utils/proto');
  const utilsPath = require.resolve('../src/utils/utils');
  const gameConfigPath = require.resolve('../src/config/gameConfig');
  const NativeDate = globalThis.Date;
  const originalCache = new Map();
  let now = new NativeDate(2026, 8, 16, 0, 0, 0).getTime();
  let checkCount = 0;

  class FakeDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  const stubModule = (path, exports) => {
    originalCache.set(path, require.cache[path]);
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  };

  try {
    delete require.cache[sharePath];
    globalThis.Date = FakeDate;
    stubModule(networkPath, {
      sendMsgAsync: async (_service, method) => {
        if (method === 'CheckCanShare') {
          checkCount += 1;
          return { body: { can_share: checkCount > 1 } };
        }
        if (method === 'ReportShare') return { body: { success: true } };
        if (method === 'ClaimShareReward') return { body: { success: true, items: [] } };
        throw new Error(`unexpected method: ${method}`);
      },
    });
    const passthroughType = {
      create: value => value,
      encode: value => ({ finish: () => value }),
      decode: value => value,
    };
    stubModule(protoPath, {
      types: {
        CheckCanShareRequest: passthroughType,
        CheckCanShareReply: passthroughType,
        ReportShareRequest: passthroughType,
        ReportShareReply: passthroughType,
        ClaimShareRewardRequest: passthroughType,
        ClaimShareRewardReply: passthroughType,
      },
    });
    stubModule(utilsPath, { log: () => {}, toNum: Number });
    stubModule(gameConfigPath, { getItemById: () => null });

    const { performDailyShare, getShareDailyState } = require(sharePath);
    assert.equal(await performDailyShare(), false);
    assert.equal(getShareDailyState().doneToday, false);

    now += 10 * 60 * 1000;
    assert.equal(await performDailyShare(), true);
    assert.equal(checkCount, 2);
    assert.equal(getShareDailyState().doneToday, true);
  } finally {
    globalThis.Date = NativeDate;
    delete require.cache[sharePath];
    for (const [path, cached] of originalCache) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  }
});
