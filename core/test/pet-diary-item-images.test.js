const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getItemById, getItemImageById } = require('../src/config/gameConfig');
const sources = require('../src/gameConfig/seed_images_named/pet-diary-sources.json');

test('pet diary and seasonal reward items resolve verified official local images', () => {
  assert.deepEqual(sources.entries.map(entry => entry.id).sort((a, b) => a - b),
    [2161, 20516, 20522, 20523, 25995, 29004, 401005]);
  for (const entry of sources.entries) {
    assert.equal(getItemById(entry.id)?.name, entry.name);
    assert.equal(getItemImageById(entry.id), `/game-config/seed_images_named/${encodeURIComponent(entry.file)}`);
    const bytes = fs.readFileSync(path.join(__dirname, '../src/gameConfig/seed_images_named', entry.file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', entry.name);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.name);
    assert.equal(new URL(entry.url).hostname, 'cdn-resource.nqf.qq.com');
  }
});
