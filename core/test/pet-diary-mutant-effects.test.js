const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getMutantEffectById, getMutantEffectByIcon, getMutantEffectsByIds } = require('../src/config/gameConfig');
const { getPlantMutantConfigIds } = require('../src/services/farm-land-analyzer');
const { images } = require('../src/gameConfig/seed_images_named/mutant/pet-diary-sources.json');

test('pet diary mutations resolve numeric and protocol string IDs with local icons', () => {
  assert.deepEqual(getMutantEffectsByIds([14, '15', 16, 999999]).map(row => [row.id, row.name, row.icon]), [
    [14, '晶辉', 'crystal'], [15, '比熊', 'bichon'], [16, '乐园', 'leyuan'],
  ]);
  for (const source of images) {
    const effect = getMutantEffectById(source.id);
    assert.equal(getMutantEffectByIcon(effect.icon), effect);
    const { icon, description, ...fields } = effect;
    const { icon: officialIcon, ...officialFields } = source.official;
    assert.deepEqual(fields, officialFields);
    assert.equal(officialIcon, `gui/texture/mutant/icon/${icon}/spriteFrame`);
    assert.ok(description);
    assert.equal(source.file, `${icon}.png`);
    const bytes = fs.readFileSync(path.join(__dirname, '../src/gameConfig/seed_images_named/mutant', source.file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
  }
  assert.equal(getMutantEffectById(16).fruit_name, '比熊棉花糖');
});

test('own land resolves bichon mutation from plant and current phase records', () => {
  assert.deepEqual(getPlantMutantConfigIds({
    mutant_config_ids: ['14', 15],
  }, {
    mutants: [
      { mutant_config_id: '15' },
      { mutant_config_id: 16 },
      { mutant_config_id: 0 },
    ],
  }), [14, 15, 16]);

  const bichon = getMutantEffectsByIds(getPlantMutantConfigIds({}, {
    mutants: [{ mutant_config_id: 15 }],
  }))[0];
  assert.equal(bichon.name, '比熊');
  assert.equal(bichon.description, '比熊·售价*4倍·比熊犬处于看护状态时概率触发');
});

test('official bichon land mask matches its recorded CDN asset', () => {
  const root = path.join(__dirname, '../src/gameConfig/effect_images/mutant/bichon');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sources.json')));
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].assetPath, 'gui/texture/petdog/mutant/dog90031/11/spriteFrame');
  const bytes = fs.readFileSync(path.join(root, manifest.files[0].file));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.files[0].sha256);
});
