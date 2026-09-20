const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findLatestSource } = require('./activity-update-scanner');
const {
  bundleConfigUrl,
  cacheKey,
  findSettingsFile,
  remoteBundleNames,
  resolveAssetPath,
} = require('./cdn-resource-finder');

let cachedResolver = null;
let cachedResolverKey = '';
const SOURCE_ASSET_ROUTE = '/api/activity/source-asset';

const ACTIVITY_CARD_ASSET_RULES = [
  // 以下路径均按活动 ID 在最新版官方 bundle 配置中逐项核对。没有登记的活动
  // 不允许通过“看起来像背景”的启发式规则随意选图。
  { ids: [2026030200], title: '南瓜乐翻天', paths: ['gui/texture/activity/nanguabg/img_nangua_bg'] },
  { ids: [2026031201], title: '洛克联动', paths: ['gui/texture/activity/rocobg/img_roco_bg'] },
  { ids: [2026040200], title: '清明春耕纪', paths: ['gui/texture/activity/qingbg/img_qing_bg_top'] },
  { ids: [2026060100], title: '荷风十里蝉初鸣', paths: ['gui/texture/saiji/saijiOpenBigImg/img_saijiOpen_bg'] },
  { ids: [2026061900], title: '粽香大比拼', paths: ['gui/texture/icon/icon_duanwu_banner'] },
  { ids: [2026070100], title: '故友重逢', paths: ['gui/texture/icon/icon_banner_friendrecall'] },
  { ids: [2026070300], title: '雨落成诗', paths: ['gui/texture/icon/icon_banner_weatherBottle'] },
  { ids: [2026072700], title: '心许千灯星垂野', paths: ['gui/texture/Season/S2/S2Open/BigImg/img_S2Open_share'] },
  { ids: [2026080100, 2026081200], title: '青酿换万金', paths: ['gui/texture/activity/liqueur/bigImg/img_liqueur_share_bg'] },
  { ids: [2026081800], title: '鹊桥寄情', paths: ['gui/texture/activity/qixi/img_qixi_bg'] },
  { ids: [2026090900], title: '公益小红花', paths: ['gui/texture/icon/icon_banner_redFlower'] },
  { ids: [2026090100], title: '萌宠日记', paths: ['gui/texture/Season/S3/S3BigImg/img_S3_rule1'] },
];

function getDefaultMiniappRoot() {
  return path.join(os.homedir(), 'Library', 'Containers', 'com.tencent.qqexminiprogram', 'Data',
    'Library', 'Application Support', 'QQEX', 'miniapp', 'temps', 'miniapp_src');
}

async function fetchBundleConfig(settings, bundle) {
  const response = await fetch(bundleConfigUrl(settings, bundle), {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`读取 ${bundle} CDN 配置失败: ${response.status}`);
  return response.json();
}

async function loadResolver() {
  const { latest } = findLatestSource(process.env.QQ_MINIAPP_SRC || getDefaultMiniappRoot());
  if (!latest) throw new Error('未找到最新完整 QQ 农场源码');
  const settings = JSON.parse(fs.readFileSync(findSettingsFile(latest.directory), 'utf8'));
  const resolverKey = `${cacheKey(settings)}:${latest.name}`;
  if (cachedResolver && cachedResolverKey === resolverKey) return cachedResolver;

  const entries = await Promise.all(remoteBundleNames(settings).map(async (bundle) => {
    try {
      return [bundle, await fetchBundleConfig(settings, bundle)];
    } catch {
      return null;
    }
  }));
  const configs = new Map(entries.filter(Boolean));
  const assetsRoot = path.join(latest.directory, 'assets');
  try {
    for (const entry of fs.readdirSync(assetsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configName = fs.readdirSync(path.join(assetsRoot, entry.name))
        .find(name => /^config\.[^.]+\.json$/.test(name));
      if (!configName) continue;
      configs.set(entry.name, JSON.parse(fs.readFileSync(path.join(assetsRoot, entry.name, configName), 'utf8')));
    }
  } catch {
    // 展开源码可能不包含本地 bundle，继续使用 CDN 配置。
  }
  if (!configs.size) throw new Error('未读取到可用的官方 CDN bundle 配置');
  cachedResolverKey = resolverKey;
  cachedResolver = (requestedPath) => {
    const resolved = resolveAssetPath(settings, configs, requestedPath);
    if (!resolved) return '';
    const nativeDirectory = path.join(assetsRoot, resolved.bundle, 'native', resolved.uuid.slice(0, 2));
    try {
      const filename = fs.readdirSync(nativeDirectory)
        .find(name => name.startsWith(`${resolved.uuid}.`) && /\.(?:png|jpe?g|webp)$/i.test(name));
      if (filename) {
        return `${SOURCE_ASSET_ROUTE}/${encodeURIComponent(resolved.bundle)}/${encodeURIComponent(filename)}`;
      }
    } catch {
      // 本地源码没有该原生图片时再使用官方 CDN。
    }
    return resolved.imageUrl || '';
  };
  return cachedResolver;
}

function findSourceAsset(bundle, filename) {
  if (!/^[\w-]+$/.test(String(bundle || ''))
    || !/^[0-9a-f-]{36}\.[0-9a-f]+\.(?:png|jpe?g|webp)$/i.test(String(filename || ''))) return '';
  const { latest } = findLatestSource(process.env.QQ_MINIAPP_SRC || getDefaultMiniappRoot());
  if (!latest) return '';
  const candidate = path.join(latest.directory, 'assets', bundle, 'native', filename.slice(0, 2), filename);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : '';
}

function collectImageObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectImageObjects(item, output);
  } else if (value && typeof value === 'object') {
    if (typeof value.img === 'string' && value.img.trim()) output.push(value);
    for (const child of Object.values(value)) collectImageObjects(child, output);
  }
  return output;
}

function collectResolvedImages(value, output = [], key = '') {
  if (Array.isArray(value)) {
    for (const item of value) collectResolvedImages(item, output, key);
  } else if (value && typeof value === 'object') {
    if (typeof value.imageUrl === 'string' && value.imageUrl.trim()) {
      output.push({
        imageUrl: value.imageUrl,
        img: String(value.img || ''),
        key,
        width: Number(value.width || value.w || 0),
        height: Number(value.height || value.h || 0),
      });
    }
    for (const [childKey, child] of Object.entries(value)) collectResolvedImages(child, output, childKey);
  }
  return output;
}

function pickActivityCardImage(value) {
  const candidates = collectResolvedImages(value);
  const scored = candidates.map(candidate => {
    const hint = `${candidate.key} ${candidate.img}`.toLowerCase();
    let score = 0;
    if (/background|\bbg\b|banner|main|poster|cover/.test(hint)) score += 100;
    if (/icon|item|reward|button|btn|currency|rule|tutorial|guide|tips|share/.test(hint)) score -= 160;
    if (candidate.width && candidate.height) {
      const ratio = candidate.width / candidate.height;
      if (ratio >= 1.3) score += 40;
      score += Math.min(30, Math.round((candidate.width * candidate.height) / 100000));
    }
    return { ...candidate, score };
  }).sort((left, right) => right.score - left.score);
  return scored[0]?.score > 0 ? scored[0].imageUrl : '';
}

async function resolveActivityCardImages(activityWindows) {
  const resolveImage = await loadResolver();
  const result = new Map();
  for (const item of activityWindows || []) {
    const id = Number(item?.id);
    const rule = ACTIVITY_CARD_ASSET_RULES.find(entry => entry.ids.includes(id));
    if (!rule) continue;
    for (const assetPath of rule.paths) {
      const imageUrl = resolveImage(assetPath);
      if (imageUrl) {
        result.set(id, imageUrl);
        break;
      }
    }
  }
  return result;
}

async function resolveActivityCdnImages(value) {
  const targets = collectImageObjects(value);
  if (!targets.length) return value;
  const resolveImage = await loadResolver();
  for (const target of targets) {
    const imageUrl = resolveImage(target.img);
    if (imageUrl) target.imageUrl = imageUrl;
  }
  return value;
}

module.exports = {
  ACTIVITY_CARD_ASSET_RULES,
  collectImageObjects,
  collectResolvedImages,
  findSourceAsset,
  pickActivityCardImage,
  resolveActivityCardImages,
  resolveActivityCdnImages,
};
