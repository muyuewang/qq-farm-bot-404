/**
 * 字段级合并上游 ItemInfo.json
 *
 * 背景：本地 ItemInfo.json 落后上游约 156 项（含 1028 萌宠元气糕、1029 幸运星、1030 宝藏等
 * 活动物品），但本地独有 `price` / `price_id` 两个承重字段（仓库售价、装扮/种子商店依赖），
 * 且本地独有 8 个植物类 ID。因此不能整份替换，必须字段级合并。
 *
 * 合并规则：
 *   1. 上游新增条目 -> 直接加入
 *   2. 本地独有条目 -> 原样保留
 *   3. 两边都有 -> 以上游为基底补充上游新字段，但本地的 price / price_id 优先保留
 *   4. 输出按 id 升序，保持 JSON 两空格缩进
 *
 * 用法：
 *   node core/scripts/merge-upstream-iteminfo.mjs <上游仓库根目录> [--write]
 *   不带 --write 时只做 dry-run 报告，不落盘。
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REL = 'core/src/gameConfig/ItemInfo.json';

const upstreamRoot = process.argv[2];
const write = process.argv.includes('--write');
if (!upstreamRoot) {
    console.error('用法: node core/scripts/merge-upstream-iteminfo.mjs <上游仓库根目录> [--write]');
    process.exit(1);
}

const localPath = resolve(process.cwd(), REL);
const upstreamPath = resolve(upstreamRoot, REL);

const local = JSON.parse(readFileSync(localPath, 'utf8'));
const upstream = JSON.parse(readFileSync(upstreamPath, 'utf8'));
if (!Array.isArray(local) || !Array.isArray(upstream)) {
    console.error('ItemInfo.json 预期为数组');
    process.exit(1);
}

const localById = new Map(local.map(item => [item.id, item]));
const upstreamById = new Map(upstream.map(item => [item.id, item]));

// 白名单：萌宠成长日记（S3）normalize() 直接引用的物品。
// 为什么不是「补齐所有上游缺失项」：
//   1. 以上游为基底会动 621 个既有条目的 21 类字段（65 处 level、16 处 name、47 处 sells），
//      把活动作物等级从 1 改成 200，导致种植自动化拒绝种植活动作物、掐断活动货币来源。
//   2. 即便纯新增也不安全：新增 26032（月见草，在本地 Plant.json 中）会让 getSeedLevel
//      从「返回 0 走 land_level_need 兜底得 1」变成「返回上游 level 21」，改变派生值。
// 因此只新增活动明确需要、且不在本地 Plant.json 中的物品。新增前会校验这一点。
const WHITELIST = [
    1028,  // 萌宠元气糕（投喂/寻宝消耗）
    1029,  // 幸运星（拾物小铺货币）
    1030,  // 待护送宝藏
    80101, // 初级挑战书（夺宝）
    80102, // 中级挑战书
    80103, // 高级挑战书
    20516, 29004, 25995, 21625, 21072, // 活动作物种子，仅用于展示余额
];

const added = [];
const merged = local.map(item => ({ ...item }));

for (const id of WHITELIST) {
    if (localById.has(id)) continue;
    const up = upstreamById.get(id);
    if (!up) {
        console.error(`上游缺少白名单物品 ${id}`);
        process.exit(1);
    }
    added.push(id);
    merged.push({ ...up });
}

merged.sort((a, b) => a.id - b.id);

console.log('=== 合并报告（白名单新增模式）===');
console.log(`本地原有: ${local.length}  上游: ${upstream.length}  合并后: ${merged.length}`);
console.log(`新增条目: ${added.length} -> ${added.join(', ') || '无'}`);
console.log(`既有条目改动: 0（不修改任何既有条目）`);

// 守卫：新增的种子若已在本地 Plant.json 中，会改变 getSeedLevel 的派生结果
const plantPath = resolve(process.cwd(), 'core/src/gameConfig/Plant.json');
try {
    const plantRaw = JSON.parse(readFileSync(plantPath, 'utf8'));
    const plantRows = Array.isArray(plantRaw) ? plantRaw : Object.values(plantRaw).find(Array.isArray) || [];
    const localSeedIds = new Set(plantRows.map(row => Number(row.seed_id)).filter(Boolean));
    const risky = added.filter(id => localSeedIds.has(id));
    if (risky.length) {
        console.error(`\n拒绝写入：新增物品 ${risky.join(', ')} 已存在于本地 Plant.json，`);
        console.error('加入 ItemInfo 会让 getSeedLevel 覆盖 land_level_need 兜底值，改变种子等级派生结果。');
        process.exit(1);
    }
    console.log('派生守卫通过：新增物品均不在本地 Plant.json 中，不影响种子等级');
} catch (error) {
    console.warn(`派生守卫跳过（无法读取 Plant.json）：${error.message}`);
}

// 关键物品自检
const check = [1028, 1029, 1030, 1002];
console.log('=== 关键物品 ===');
for (const id of check) {
    const item = merged.find(entry => entry.id === id);
    console.log(`  ${id}: ${item ? `${item.name} (price=${item.price ?? 'null'})` : '缺失'}`);
}

// 不变量校验：本地每一条必须逐字段完全未变
const mergedById = new Map(merged.map(item => [item.id, item]));
const lost = [];
for (const [id, lo] of localById) {
    const next = mergedById.get(id);
    if (!next) { lost.push(`条目 ${id} 丢失`); continue; }
    for (const field of new Set([...Object.keys(lo), ...Object.keys(next)])) {
        if (JSON.stringify(lo[field]) !== JSON.stringify(next[field])) {
            lost.push(`${id}.${field}: ${JSON.stringify(lo[field])} -> ${JSON.stringify(next[field])}`);
        }
    }
}
if (lost.length) {
    console.error(`\n校验失败：既有条目被改动 ${lost.length} 处`);
    lost.slice(0, 20).forEach(msg => console.error(`  ${msg}`));
    process.exit(1);
}
console.log('\n校验通过：621 个既有条目逐字段未改动');

if (!write) {
    console.log('\n[dry-run] 未写入。确认无误后加 --write 落盘。');
    process.exit(0);
}

copyFileSync(localPath, `${localPath}.bak`);
writeFileSync(localPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log(`\n已写入 ${REL}（原文件备份为 ItemInfo.json.bak）`);
