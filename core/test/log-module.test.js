const assert = require('node:assert/strict');
const test = require('node:test');

const { log, setLogHook } = require('../src/utils/utils');

test('宠物模块日志使用宠物标签', () => {
  let received;
  setLogHook((tag, message, isWarn, meta) => {
    received = { tag, message, isWarn, meta };
  });

  try {
    log('系统', '已派出比熊犬', { module: 'pet', event: '派出宠物' });
    assert.deepEqual(received, {
      tag: '宠物',
      message: '已派出比熊犬',
      isWarn: false,
      meta: { module: 'pet', event: '派出宠物' },
    });
  }
  finally {
    setLogHook(null);
  }
});

test('旧式宠物标签可推断为宠物模块', () => {
  let received;
  setLogHook((tag, message, isWarn, meta) => {
    received = { tag, message, isWarn, meta };
  });

  try {
    log('宠物', '已召回宠物');
    assert.equal(received.tag, '宠物');
    assert.equal(received.meta.module, 'pet');
  }
  finally {
    setLogHook(null);
  }
});
