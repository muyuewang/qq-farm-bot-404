const assert = require('node:assert/strict');
const test = require('node:test');

const { decodeIllustratedReplyRaw } = require('../src/services/illustrated');

function encodeVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7Fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function varintField(field, value) {
  return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]);
}

function messageField(field, value) {
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(value.length), value]);
}

test('raw illustrated decoder preserves mutant wish current and total fields', () => {
  const guaranteeInfo = Buffer.concat([
    varintField(1, 4),
    varintField(2, 14),
    varintField(3, 60),
  ]);
  const item = Buffer.concat([
    varintField(1, 204009),
    varintField(2, 4),
    messageField(8, guaranteeInfo),
  ]);
  const decoded = decodeIllustratedReplyRaw(messageField(1, item));

  assert.deepEqual(decoded.normalizedItems[0].guaranteeInfo, {
    progress_type: 4,
    current: 14,
    total: 60,
  });
});
