const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const UUID_VALUES = Object.fromEntries([...UUID_CHARS].map((char, index) => [char, index]));
const HEX = '0123456789abcdef';

function decodeUuid(value) {
  const bare = String(value || '').split('@')[0];
  if (/^[0-9a-f-]{36}$/i.test(bare) || /^[0-9a-f]{9}$/i.test(bare)) return bare;
  if (bare.length !== 22) return bare;
  const template = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.split('');
  const slots = template.map((char, index) => char === 'x' ? index : -1).filter(index => index >= 0);
  template[0] = bare[0];
  template[1] = bare[1];
  let slot = 2;
  for (let index = 2; index < bare.length; index += 2) {
    const left = UUID_VALUES[bare[index]];
    const right = UUID_VALUES[bare[index + 1]];
    if (left == null || right == null) return bare;
    template[slots[slot++]] = HEX[left >> 2];
    template[slots[slot++]] = HEX[((left & 3) << 2) | (right >> 4)];
    template[slots[slot++]] = HEX[right & 15];
  }
  return template.join('');
}

function versionHash(config, kind, index) {
  const versions = config?.versions?.[kind] || [];
  for (let offset = 0; offset < versions.length; offset += 2) {
    if (Number(versions[offset]) === Number(index)) return versions[offset + 1];
  }
  return null;
}

function bundleConfigUrl(settings, bundle) {
  const server = settings?.assets?.server;
  const version = settings?.assets?.bundleVers?.[bundle];
  if (!server || !version) throw new Error(`bundle ${bundle} 缺少 CDN server 或版本`);
  return `${server.replace(/\/$/, '')}/remote/${bundle}/config.${version}.json`;
}

function assetUrl(settings, bundle, config, index, kind = 'native', extension = 'png') {
  const uuid = decodeUuid(config?.uuids?.[index]);
  const hash = versionHash(config, kind, index);
  if (!uuid || !hash) return '';
  const suffix = kind === 'import' ? 'json' : extension;
  return `${settings.assets.server.replace(/\/$/, '')}/remote/${bundle}/${kind}/${uuid.slice(0, 2)}/${uuid}.${hash}.${suffix}`;
}

function listFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else result.push(target);
    }
  }
  return result;
}

function findSettingsFile(root) {
  const candidates = listFiles(root)
    .filter(file => /(?:^|[\\/])src[\\/]settings(?:\.[^.]+)?\.json$/i.test(file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (!candidates.length) throw new Error(`在 ${root} 中未找到 src/settings*.json`);
  return candidates[0];
}

function remoteBundleNames(settings) {
  return [...new Set([
    ...(settings?.assets?.remoteBundles || []),
    ...(settings?.assets?.projectBundles || []),
  ])].filter(bundle => !['resources', 'internal', 'main'].includes(bundle)
    && settings?.assets?.bundleVers?.[bundle]);
}

function parseConfigRows(serialized) {
  const rows = serialized?.[5]?.[0]?.[2];
  return Array.isArray(rows) ? rows : null;
}

function tableNameFromAssetPath(assetPath) {
  const match = /(?:^|\/)config\/([^/]+)$/i.exec(String(assetPath || ''));
  return match?.[1] || path.basename(String(assetPath || ''));
}

function buildTableIndex(tables) {
  const byId = {};
  const byName = {};
  const byTable = {};
  for (const table of tables) {
    const tableName = table.name || tableNameFromAssetPath(table.assetPath);
    byTable[tableName] ||= [];
    for (const row of table.rows || []) {
      const entry = { table: tableName, bundle: table.bundle || '', row };
      byTable[tableName].push(entry);
      if (row?.id != null) (byId[String(row.id)] ||= []).push(entry);
      for (const name of [row?.name, row?.effect_name, row?.title].filter(Boolean)) {
        (byName[String(name)] ||= []).push(entry);
      }
    }
  }
  return { byId, byName, byTable };
}

function normalizeTableName(value) {
  return String(value || '').toLowerCase().replace(/[_\s-]/g, '');
}

function entriesForTable(index, tableName) {
  if (!tableName) return Object.values(index.byTable || {}).flat();
  const normalized = normalizeTableName(tableName);
  return Object.entries(index.byTable || {})
    .filter(([name]) => normalizeTableName(name) === normalized)
    .flatMap(([, entries]) => entries);
}

function findRows(index, options = {}) {
  const entries = entriesForTable(index, options.table);
  if (options.id != null) return entries.filter(entry => String(entry.row?.id) === String(options.id));
  if (options.name != null) {
    const query = String(options.name);
    const names = row => [row?.name, row?.effect_name, row?.title].filter(Boolean).map(String);
    const exact = entries.filter(entry => names(entry.row).includes(query));
    return exact.length ? exact : entries.filter(entry => names(entry.row).some(name => name.includes(query)));
  }
  return entries;
}

function assetCandidates(row) {
  const result = [row?.icon_res, row?.icon].filter(Boolean).map(String);
  if (row?.asset_name) {
    const assetName = String(row.asset_name).replace(/^\/+/, '');
    if (/(?:^|\/)Crop_/.test(assetName)) {
      result.push(`model/v4/${assetName}_Seed/spriteFrame`);
      for (const phase of [6, 5, 4, 3, 2, 1]) result.push(`model/v4/${assetName}_${phase}/spriteFrame`);
      result.push(`model/v4/${assetName}/spriteFrame`);
    }
    result.push(`${assetName}/spriteFrame`, assetName);
  }
  return [...new Set(result)];
}

function resolveAssetPath(settings, configs, requestedPath) {
  const clean = String(requestedPath || '').replace(/^db:\/\/assets\//, '').replace(/^db:\/\//, '');
  const candidates = /\/(?:spriteFrame|texture)$/.test(clean)
    ? [clean]
    : [`${clean}/spriteFrame`, `${clean}/texture`, clean];
  for (const candidate of candidates) {
    for (const [bundle, config] of configs) {
      const paths = Object.entries(config.paths || {});
      for (const [indexText, value] of paths) {
        if (value?.[0] !== candidate) continue;
        const basePath = value[0].replace(/\/(?:spriteFrame|texture)$/, '');
        const baseEntry = paths.find(([, item]) => item?.[0] === basePath);
        const nativeIndex = Number(baseEntry?.[0] ?? indexText);
        const imageUrl = assetUrl(settings, bundle, config, nativeIndex);
        if (imageUrl) return {
          bundle,
          requestedPath,
          assetPath: value[0],
          uuid: decodeUuid(config.uuids[nativeIndex]),
          imageUrl,
        };
      }
    }
  }
  return null;
}

function cacheKey(settings) {
  return crypto.createHash('sha256').update(JSON.stringify({
    server: settings?.assets?.server,
    bundleVers: settings?.assets?.bundleVers,
    remoteBundles: settings?.assets?.remoteBundles,
    projectBundles: settings?.assets?.projectBundles,
  })).digest('hex').slice(0, 24);
}

module.exports = {
  assetCandidates,
  assetUrl,
  buildTableIndex,
  bundleConfigUrl,
  cacheKey,
  decodeUuid,
  findRows,
  findSettingsFile,
  parseConfigRows,
  remoteBundleNames,
  resolveAssetPath,
  tableNameFromAssetPath,
  versionHash,
};
