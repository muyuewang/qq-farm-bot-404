/**
 * 以薯换福（红薯系）+ 活动物品补充进 ItemInfo.json
 *
 * 证据来源（均为协议/官方 UI 直接证据，非臆造）：
 *   - 20307 红薯种子：cmd 91 领取回包 item_id=20307（yishuhuanfu.ts 协议确认）
 *   - 40307  红薯：官方仓库 UI 显示名称"红薯"、单价 240 金、描述
 *            "卖给商人后，可以获得金币。"；协议下发售价与 240 金一致
 *   - 1040307 黄金·红薯：变异果实编号规律（1049004 黄金·泡泡棉花糖 ↔ 10+果实ID），
 *            背包协议显示按金豆豆计价 3/个；名称按官方"黄金·"前缀规律推断，待官方表核对
 *   - 1032   蜜薯：YSHF_SWEET_POTATO_ITEM_ID 协议常量
 *   - 1033   幸运硬币：YSHF_LUCK_COIN_ITEM_ID 协议常量
 *
 * 未知字段一律置 null，不虚构。插入后按 id 升序，保持两空格缩进。
 * 原文件备份为 ItemInfo.json.bak-pre-yshf。
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'src', 'gameConfig', 'ItemInfo.json');
const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const byId = new Map(items.map(it => [Number(it.id), it]));
const template = items.find(x => Number(x.id) === 40084);
if (!template) throw new Error('找不到模板条目 40084');

function makeEntry(overrides) {
    const entry = {};
    for (const key of Object.keys(template)) {
        entry[key] = overrides[key] !== undefined ? overrides[key] : template[key];
    }
    return entry;
}

const additions = [
    {
        id: 1032,
        type: 0,
        name: '蜜薯',
        interaction_type: null,
        sells: null,
        sell_cond: null,
        cond_sells: null,
        level: null,
        asset_name: null,
        desc: '以薯换福活动蜜薯，通过活动铺子出售。',
        effectDesc: '以薯换福活动蜜薯',
        rarity: null,
        rarity_color: null,
        jumps: null,
        show_tab_ids: null,
    },
    {
        id: 1033,
        type: 0,
        name: '幸运硬币',
        interaction_type: null,
        sells: null,
        sell_cond: null,
        cond_sells: null,
        level: null,
        asset_name: null,
        desc: '以薯换福活动货币。',
        effectDesc: '以薯换福活动货币',
        rarity: null,
        rarity_color: null,
        jumps: null,
        show_tab_ids: null,
    },
    {
        id: 20307,
        type: 5,
        name: '红薯种子',
        interaction_type: 'plant',
        sells: null,
        sell_cond: null,
        cond_sells: null,
        level: null,
        asset_name: 'Crop_307',
        desc: '种植后，可以收获一定数量的红薯。',
        effectDesc: '红薯',
        rarity: null,
        rarity_color: null,
        jumps: null,
        show_tab_ids: 3,
    },
    {
        id: 40307,
        type: 6,
        name: '红薯',
        interaction_type: null,
        sells: '1001:240',
        sell_cond: null,
        cond_sells: null,
        level: null,
        asset_name: 'Crop_307',
        desc: '卖给商人后，可以获得金币。',
        effectDesc: '卖给商人后，可以获得金币。',
        rarity: null,
        rarity_color: null,
        jumps: null,
        show_tab_ids: 1,
    },
    {
        id: 1040307,
        type: 17,
        name: '黄金·红薯',
        interaction_type: null,
        sells: '1005:3',
        sell_cond: null,
        cond_sells: null,
        level: null,
        asset_name: 'gold/Crop_307',
        desc: '卖给商人后，可以获得金豆豆。',
        effectDesc: '卖给商人后，可以获得金豆豆。',
        rarity: null,
        rarity_color: null,
        jumps: null,
        show_tab_ids: 2,
    },
];

fs.copyFileSync(FILE, FILE + '.bak-pre-yshf');

let added = 0;
let updated = 0;
for (const overrides of additions) {
    const existing = byId.get(Number(overrides.id));
    if (existing) {
        // 已存在则只补名称/类型/售价这些缺口，不覆盖本地已有值
        for (const [key, value] of Object.entries(overrides)) {
            if (existing[key] === undefined || existing[key] === null || existing[key] === '') {
                existing[key] = value;
            }
        }
        updated++;
    } else {
        items.push(makeEntry(overrides));
        added++;
    }
}

items.sort((a, b) => Number(a.id) - Number(b.id));
fs.writeFileSync(FILE, JSON.stringify(items, null, 2) + '\n', 'utf8');
console.log(`新增 ${added} 条，补充 ${updated} 条，总数 ${items.length}`);
for (const id of [1032, 1033, 20307, 40307, 1040307]) {
    const it = items.find(x => Number(x.id) === id);
    console.log(id, '->', it.name, 'type=' + it.type, 'sells=' + (it.sells || 'null'));
}
