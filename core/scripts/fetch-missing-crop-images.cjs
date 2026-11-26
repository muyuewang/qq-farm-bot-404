/**
 * 批量补齐缺失作物阶段贴图
 * 链路：bundle config paths -> 压缩UUID解压 -> versions.native hash -> CDN 直链下载
 * 用法：node core/scripts/fetch-missing-crop-images.cjs [--dry]
 * 资源命名：model/v4/Crop_N_Seed(=阶段1) + model/v4/Crop_N_2..6
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GC = 'C:/Users/Administrator/AppData/Roaming/Tencent/xwechat/radium/users/3d8b8c7be28e0b4f5434d6366c03ce94/applet/local/wx5306c5978fdb76e4/usr/gamecaches/';
const OUT = path.join(__dirname, '../src/gameConfig/plant_images');
const CDN = 'https://cdn-resource.nqf.qq.com/release/remote/';

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const V = {}; for (let i = 0; i < 64; i++) V[BASE64_KEYS.charCodeAt(i)] = i;
const H = '0123456789abcdef';
function decompressUuid(c) {
  let s = c.slice(0, 2);
  for (let i = 2; i < c.length; i += 2) {
    const l = V[c.charCodeAt(i)], r = V[c.charCodeAt(i + 1)];
    s += H[l >> 2] + H[((l & 3) << 2) | (r >> 4)] + H[r & 15];
  }
  return s;
}
function dash(f) { return [f.slice(0, 8), f.slice(8, 12), f.slice(12, 16), f.slice(16, 20), f.slice(20)].join('-'); }

// 1) 目标清单：命令行传 N 列表，否则自动算缺失
let targets = process.argv.includes('--list') ? null : null;
const argN = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const gameDir = path.join(__dirname, '../src/gameConfig');
const manifestPath = path.join(OUT, 'manifest.json');

function localPhases(N) {
  const dir = path.join(OUT, 'Crop_' + N);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => parseInt(f)).sort((a, b) => a - b);
}

let wantNs = argN;
if (!wantNs.length) {
  const plant = JSON.parse(fs.readFileSync(path.join(gameDir, 'Plant.json'), 'utf8'));
  const pArr = Array.isArray(plant) ? plant : (plant.data || []);
  const need = new Set();
  for (const p of pArr) {
    const id = Number(p.id);
    if (id >= 1020000 && id < 1030000) need.add(id - 1020000);
    if (id >= 1120000 && id < 1130000) need.add(id - 1120000);
  }
  const ii = JSON.parse(fs.readFileSync(path.join(gameDir, 'ItemInfo.json'), 'utf8'));
  for (const it of (Array.isArray(ii) ? ii : ii.data || [])) {
    const m = (it.asset_name || '').match(/^Crop_(\d+)$/);
    if (m) need.add(Number(m[1]));
  }
  wantNs = [...need].filter(N => localPhases(N).length < 5); // 官方5张(Seed+2-6)
}

// 2) 扫描所有 bundle config
const bundles = {};
for (const b of ['plant', 'mainscene', 'extraRes', 'delayRes', 'mcRes', 'commonRes', 'animal', 'petdog']) {
  const dir = path.join(GC, b);
  if (!fs.existsSync(dir)) continue;
  const cfgFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  // 取 paths 条目最多的 json 作为 bundle config
  let newest = null, best = 0;
  for (const f of cfgFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const n = j && j.paths ? Object.keys(j.paths).length : 0;
      if (n > best) { best = n; newest = f; }
    } catch (e) { /* 非 JSON 跳过 */ }
  }
  if (newest) bundles[b] = JSON.parse(fs.readFileSync(path.join(dir, newest), 'utf8'));
}
console.log('bundles scanned:', Object.keys(bundles).join(','));

// 3) 建资源索引：Crop_N -> {bundle, phase -> {uuid, hash}}
const index = new Map(); // key: N -> {bundle, phases: Map(phase->{uuid,hash}), seed:{...}}
for (const [bundle, cfg] of Object.entries(bundles)) {
  const flatN = (cfg.versions && cfg.versions.native) || [];
  const nat = new Map(); for (let k = 0; k < flatN.length; k += 2) nat.set(flatN[k], flatN[k + 1]);
  for (const [idx, [p]] of Object.entries(cfg.paths)) {
    const m = p.match(/^model\/v4\/(?:gold\/)?Crop_(\d+)(?:_(\d)|_Seed)?$/);
    if (!m) continue;
    const N = Number(m[1]);
    if (!wantNs.includes(N)) continue;
    const uuid = cfg.uuids[idx];
    if (/@/.test(uuid)) continue; // 只要 base（texture 本体）
    const rec = index.get(N) || { bundle, phases: new Map() };
    rec.bundle = bundle;
    const i = Number(idx);
    const hash = nat.get(i);
    if (m[2]) rec.phases.set(Number(m[2]), { uuid, hash });
    else if (p.endsWith('_Seed')) rec.phases.set(1, { uuid, hash }); // Seed=阶段1
    index.set(N, rec);
  }
}

// 4) 生成下载任务
const dry = process.argv.includes('--dry');
const tasks = [];
const report = [];
for (const N of wantNs.sort((a, b) => a - b)) {
  const rec = index.get(N);
  const have = localPhases(N);
  if (!rec) { report.push({ N, status: 'NOT_IN_BUNDLES', have }); continue; }
  for (const [phase, { uuid, hash }] of [...rec.phases].sort((a, b) => a[0] - b[0])) {
    if (have.includes(phase)) continue;
    if (!hash) { report.push({ N, status: 'NO_HASH phase' + phase, have }); continue; }
    const full = decompressUuid(uuid);
    const url = `${CDN}${rec.bundle}/native/${full.slice(0, 2)}/${dash(full)}.${hash}.png`;
    tasks.push({ N, phase, url, out: path.join(OUT, 'Crop_' + N, phase + '.png') });
  }
}
console.log('download tasks:', tasks.length);
tasks.slice(0, 3).forEach(t => console.log(' sample:', t.N, 'phase' + t.phase, t.url));
const notFound = report.filter(r => r.status === 'NOT_IN_BUNDLES');
console.log('not in bundles:', notFound.length, notFound.map(r => r.N).join(','));
if (dry) process.exit(0);

// 5) 下载（顺序，避免限流；Node 22 内置 fetch 自带重定向）
let ok = 0, fail = [];
(async () => {
  for (const t of tasks) {
    fs.mkdirSync(path.dirname(t.out), { recursive: true });
    try {
      const res = await fetch(t.url);
      if (!res.ok) { fail.push(t.N + ':' + t.phase + ' HTTP' + res.status); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(1, 4).toString() !== 'PNG') { fail.push(t.N + ':' + t.phase + ' NOT_PNG'); continue; }
      fs.writeFileSync(t.out, buf);
      ok++;
    } catch (e) { fail.push(t.N + ':' + t.phase + ' ' + e.message); }
  }
  console.log('downloaded:', ok, 'failed:', fail.length);
  fail.slice(0, 30).forEach(f => console.log(' FAIL', f));

  // 6) 更新 manifest
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let added = 0;
  for (const N of wantNs) {
    const dir = path.join(OUT, 'Crop_' + N);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
    if (!files.length) continue;
    const key = 'Crop_' + N;
    const existed = !!manifest[key];
    // manifest 条目必须是 { 阶段: 贴图URL } 的对象形态；写成数组会被
    // gameConfig 的 Object.entries 展开成 phase→phase+1 的裸数字，导致破图。
    manifest[key] = files
      .map(f => parseInt(f))
      .sort((a, b) => a - b)
      .reduce((acc, p) => {
        acc[String(p)] = `/game-config/plant_images/${key}/${p}.png`;
        return acc;
      }, {});
    if (!existed) added++;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('manifest updated, new keys:', added);
})();
