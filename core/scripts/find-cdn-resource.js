#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findLatestSource } = require('../src/services/activity-update-scanner');
const {
  assetCandidates,
  assetUrl,
  buildTableIndex,
  bundleConfigUrl,
  cacheKey,
  findRows,
  findSettingsFile,
  parseConfigRows,
  remoteBundleNames,
  resolveAssetPath,
  tableNameFromAssetPath,
} = require('../src/services/cdn-resource-finder');

function usage() {
  return `QQ 农场 CDN 配置与图片查找工具

用法：
  npm run inspect:cdn -- --list-tables
  npm run inspect:cdn -- --table Plant --id 1029003
  npm run inspect:cdn -- --name 星语铃花
  npm run inspect:cdn -- --path gui/texture/icon/example/spriteFrame
  npm run inspect:cdn -- --table MutantEffect --all

选项：
  --source <目录>       已解包且包含 src/settings*.json 的源码目录；默认选择最新完整 QQ 农场源码
  --cache-root <目录>   下载缓存目录；默认位于系统临时目录
  --list-tables         列出发现的官方配置表
  --table <名称>        限定配置表，忽略大小写、空格、下划线和连字符
  --id <ID>             按配置行 ID 查询
  --name <名称>         按 name/effect_name/title 查询，优先精确匹配
  --path <资源路径>     直接解析 Cocos 资源路径
  --all                 输出指定表的全部配置行及可解析图片
  --download <文件>     下载命中的第一张图片；未指定时只输出 URL
  --refresh             忽略已有缓存，重新获取远程配置
`;
}

function parseArgs(argv) {
  const result = {};
  const valueOptions = new Set(['source', 'cache-root', 'table', 'id', 'name', 'path', 'download']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') result.help = true;
    else if (token === '--list-tables') result.listTables = true;
    else if (token === '--all') result.all = true;
    else if (token === '--refresh') result.refresh = true;
    else if (token.startsWith('--') && valueOptions.has(token.slice(2))) {
      const value = argv[++index];
      if (value == null) throw new Error(`${token} 缺少参数`);
      result[token.slice(2)] = value;
    } else throw new Error(`未知参数：${token}`);
  }
  return result;
}

function resolveDownloadTarget(target) {
  const baseDir = process.cwd();
  const resolved = path.resolve(baseDir, target);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new Error(`--download 目标必须位于当前工作目录内：${resolved}`);
  }
  return resolved;
}

async function download(url, target, refresh = false) {
  if (!refresh && fs.existsSync(target)) return;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`下载失败 ${response.status}：${url}`);
  const temporary = `${target}.building-${process.pid}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temporary, target);
}

async function readRemoteJson(url, target, refresh) {
  await download(url, target, refresh);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function defaultSource() {
  const root = path.join(os.homedir(), 'Library/Containers/com.tencent.qqexminiprogram/Data/Library',
    'Application Support/QQEX/miniapp/temps/miniapp_src');
  const { latest } = findLatestSource(root);
  if (!latest) throw new Error('未找到最新完整 QQ 农场源码，请用 --source 指定已解包目录');
  return latest.directory;
}

async function loadRemoteData(settings, cacheRoot, refresh) {
  const versionRoot = path.join(cacheRoot, cacheKey(settings));
  const configs = new Map();
  const tables = [];
  for (const bundle of remoteBundleNames(settings)) {
    const configFile = path.join(versionRoot, 'bundles', `${bundle}.json`);
    const config = await readRemoteJson(bundleConfigUrl(settings, bundle), configFile, refresh);
    configs.set(bundle, config);
    for (const [indexText, value] of Object.entries(config.paths || {})) {
      const assetPath = value?.[0];
      if (!String(assetPath || '').startsWith('config/')) continue;
      const url = assetUrl(settings, bundle, config, Number(indexText), 'import');
      if (!url) continue;
      const safeName = String(assetPath).replace(/[^\w.-]/g, '_');
      const tableFile = path.join(versionRoot, 'tables', `${bundle}_${safeName}.json`);
      try {
        const serialized = await readRemoteJson(url, tableFile, refresh);
        const rows = parseConfigRows(serialized);
        if (rows) tables.push({ bundle, assetPath, name: tableNameFromAssetPath(assetPath), rows });
      } catch (error) {
        process.stderr.write(`[跳过] ${bundle}/${assetPath}: ${error.message}\n`);
      }
    }
  }
  return { configs, tables };
}

function firstResolvable(settings, configs, rows) {
  for (const entry of rows) {
    for (const candidate of assetCandidates(entry.row)) {
      const image = resolveAssetPath(settings, configs, candidate);
      if (image) return { entry, image, candidates: assetCandidates(entry.row) };
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.listTables && !args.path && !args.id && !args.name && !args.all) throw new Error('请指定查询条件；使用 --help 查看用法');
  if (args.all && !args.table) throw new Error('--all 必须配合 --table');

  const source = path.resolve(args.source || defaultSource());
  const settingsFile = findSettingsFile(source);
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const cacheRoot = path.resolve(args['cache-root'] || path.join(os.tmpdir(), 'qq-farm-bot-cdn-resource-cache'));
  const { configs, tables } = await loadRemoteData(settings, cacheRoot, args.refresh);

  if (args.listTables) {
    const list = [...new Set(tables.map(table => table.name))].sort();
    console.log(JSON.stringify({ source, settingsFile, count: list.length, tables: list }, null, 2));
    return;
  }
  if (args.path) {
    const image = resolveAssetPath(settings, configs, args.path);
    if (!image) throw new Error(`无法解析资源路径：${args.path}`);
    if (args.download) await download(image.imageUrl, resolveDownloadTarget(args.download), true);
    console.log(JSON.stringify({ source, ...image, downloadedTo: args.download ? resolveDownloadTarget(args.download) : null }, null, 2));
    return;
  }

  const index = buildTableIndex(tables);
  const rows = findRows(index, { table: args.table, id: args.id, name: args.name });
  if (!rows.length) throw new Error('没有找到匹配的配置行');
  const outputRows = rows.map(entry => {
    const candidates = assetCandidates(entry.row);
    const image = candidates.map(candidate => resolveAssetPath(settings, configs, candidate)).find(Boolean) || null;
    return { table: entry.table, bundle: entry.bundle, row: entry.row, candidates, image };
  });
  const resolved = firstResolvable(settings, configs, rows);
  if (args.download) {
    if (!resolved) throw new Error('匹配的配置行没有可下载图片');
    await download(resolved.image.imageUrl, resolveDownloadTarget(args.download), true);
  }
  console.log(JSON.stringify({
    source,
    count: outputRows.length,
    results: outputRows,
    downloadedTo: args.download ? resolveDownloadTarget(args.download) : null,
  }, null, 2));
}

main().catch(error => {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
});
