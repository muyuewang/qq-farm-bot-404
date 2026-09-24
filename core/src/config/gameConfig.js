const fs = require('node:fs');
const path = require('node:path');
const { filterInvalidPlants, isInvalidPlant, isInvalidSeedId } = require('./invalidPlants');
const { getResourcePath } = require('./runtime-paths');

// 等级经验配置
let roleLevelConfig = null;
let levelExpTable = null;

// 植物配置
let plantConfig = null;
const plantMap = new Map();          // plantId → plant
const seedToPlant = new Map();       // seedId → plant
const fruitToPlant = new Map();      // fruitId → plant

// 物品配置
let itemInfoConfig = null;
const itemInfoMap = new Map();       // itemId → itemInfo
const seedItemMap = new Map();       // seedItemId → itemInfo
const seedImageMap = new Map();      // seedId/itemId → imageUrl
const seedAssetImageMap = new Map(); // assetName → imageUrl
const plantPhaseImageMap = new Map();// assetName → { phase: imageUrl }
let plantPhaseManifestPath = '';
let plantPhaseManifestMtimeMs = -1;
const skinDetailImageMap = new Map();// itemId → skinDetailImageUrl
const staticItemInfoMap = new Map([
    [6001, { id: 6001, name: '烟花·玉兔望月', type: 23, can_use: 1 }],
    [204010, { id: 204010, name: '玉兔邀月' }],
    [90042, { id: 90042, name: '稚萌熊熊' }],
    [1040, { id: 1040, name: '爱心值' }],
    [2158, { id: 2158, name: '小红花做好事头像框' }],
    [101604, { id: 101604, name: '公益小红花结算礼包' }],
    [1027, { id: 1027, name: '雷电徽章' }],
    [4002, { id: 4002, name: '闪电感应' }],
    [4003, { id: 4003, name: '闪电感应' }],
    [5001, { id: 5001, name: '天气采集瓶' }],
    [5002, { id: 5002, name: '雷雨召唤瓶' }],
    [5005, { id: 5005, name: '青蛙使坏瓶' }],
    [5006, { id: 5006, name: '乌云使坏瓶' }],
    [2159, { id: 2159, name: '雨落成诗头像框' }],
    [100003, { id: 100003, name: '化肥礼包' }],
]);
const staticItemImageMap = new Map([
    [6001, '/activity/wish-sign/firework.png'],
    [26030, '/activity/wish-sign/moon-beauty-seed.png'],
    [80002, '/activity/wish-sign/fertilizer-4h.png'],
    [80003, '/activity/wish-sign/fertilizer-8h.png'],
    [80004, '/activity/wish-sign/fertilizer-12h.png'],
    [80013, '/activity/wish-sign/organic-fertilizer-8h.png'],
    [80014, '/activity/wish-sign/organic-fertilizer-12h.png'],
    [1002, '/activity/wish-sign/coupon.png'],
    [20435, '/activity/wish-sign/lily-seed.png'],
    [204010, '/activity/wish-sign/moon-rabbit-skin.png'],
    [90042, '/activity/wish-sign/cute-bear-skin.png'],
    [101604, '/activity/charity-flower/settlement-pack.png'],
    [1023, '/activity/star-festival/star-token.png'],
    [1024, '/activity/qixi/qixi-feather.png'],
    [301103, '/activity/qixi/qixi-dew.png'],
    [5001, '/activity/rain-poem/weather-collection-bottle.png'],
    [5002, '/activity/rain-poem/rainstorm-summon-bottle.png'],
    [5005, '/activity/rain-poem/frog-prank-bottle.png'],
    [5006, '/activity/rain-poem/cloud-prank-bottle.png'],
    [1027, '/activity/rain-poem/lightning-badge.svg'],
    [4002, '/activity/rain-poem/lightning-sense.png?v=2'],
    [4003, '/activity/rain-poem/lightning-sense.png?v=2'],
    [2159, '/activity/rain-poem/avatar-frame.png?v=2'],
]);

// 变异效果配置
let mutantEffectConfig = null;
const mutantEffectMap = new Map();       // mutantId → mutantEffect
const mutantEffectByIconMap = new Map(); // icon → mutantEffect

/** 加载所有游戏配置文件 */
function loadConfigs() {
    const basePath = getResourcePath('gameConfig');

    // 1. 加载等级经验表
    try {
        const roleLevelPath = path.join(basePath, 'RoleLevel.json');
        if (fs.existsSync(roleLevelPath)) {
            roleLevelConfig = JSON.parse(fs.readFileSync(roleLevelPath, 'utf8'));
            levelExpTable = [];
            for (const entry of roleLevelConfig) {
                levelExpTable[entry.level] = entry.exp;
            }
            console.warn(`[配置] 已加载等级经验表 (${  roleLevelConfig.length  } 级)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 RoleLevel.json 失败:', err.message);
    }

    // 2. 加载植物配置
    try {
        const plantPath = path.join(basePath, 'Plant.json');
        if (fs.existsSync(plantPath)) {
            plantConfig = filterInvalidPlants(JSON.parse(fs.readFileSync(plantPath, 'utf8')));
            plantMap.clear();
            seedToPlant.clear();
            fruitToPlant.clear();
            for (const plant of plantConfig) {
                plantMap.set(plant.id, plant);
                if (plant.seed_id) seedToPlant.set(plant.seed_id, plant);
                if (plant.fruit && plant.fruit.id) fruitToPlant.set(plant.fruit.id, plant);
            }
            console.warn(`[配置] 已加载植物配置 (${  plantConfig.length  } 种)`);
        }

        // 活动植物通常早于全量静态配置发布，使用轻量增量表补齐植物、
        // 种子和果实三者的关系，避免土地与图鉴显示裸 ID。
        const eventPlantPath = path.join(basePath, 'EventPlants.json');
        if (fs.existsSync(eventPlantPath)) {
            const eventPlants = JSON.parse(fs.readFileSync(eventPlantPath, 'utf8'));
            for (const entry of eventPlants) {
                if (isInvalidPlant(entry)) continue;
                const plantId = Number(entry.id);
                const seedId = Number(entry.seed_id) || 0;
                if (plantMap.has(plantId) || (seedId > 0 && seedToPlant.has(seedId))) continue;
                const plant = {
                    ...entry,
                    id: plantId,
                    name: entry.name,
                    asset_name: entry.asset_name,
                    seed_id: seedId || null,
                    fruit: {
                        id: Number(entry.fruit_id),
                        count: Number(entry.fruit_count) || 0,
                    },
                    size: Math.max(1, Number(entry.size) || 1),
                    seasons: Number(entry.seasons) || 1,
                    grow_phases: entry.grow_phases || '',
                    exp: Number(entry.exp) || 0,
                    planting_priority: Math.max(0, Number(entry.planting_priority) || 0),
                };
                plantMap.set(plant.id, plant);
                if (plant.seed_id) seedToPlant.set(plant.seed_id, plant);
                if (plant.fruit.id) fruitToPlant.set(plant.fruit.id, plant);
            }
            plantConfig = [...plantMap.values()];
            console.warn(`[配置] 已合并活动植物配置 (${  eventPlants.length  } 种)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 Plant.json 失败:', err.message);
    }

    // 3. 加载物品配置
    try {
        const itemInfoPath = path.join(basePath, 'ItemInfo.json');
        if (fs.existsSync(itemInfoPath)) {
            itemInfoConfig = JSON.parse(fs.readFileSync(itemInfoPath, 'utf8'));
            itemInfoMap.clear();
            seedItemMap.clear();
            for (const item of itemInfoConfig) {
                const itemId = Number(item && item.id) || 0;
                if (itemId <= 0 || isInvalidSeedId(itemId)) continue;
                itemInfoMap.set(itemId, item);
                // type === 5 表示种子物品
                if (Number(item.type) === 5) {
                    seedItemMap.set(itemId, item);
                }
            }
            console.warn(`[配置] 已加载物品配置 (${  itemInfoConfig.length  } 项)`);
        }

        const eventPlantPath = path.join(basePath, 'EventPlants.json');
        if (fs.existsSync(eventPlantPath)) {
            const eventPlants = JSON.parse(fs.readFileSync(eventPlantPath, 'utf8'));
            for (const entry of eventPlants) {
                if (isInvalidPlant(entry)) continue;
                const seedId = Number(entry.seed_id);
                const plant = seedToPlant.get(seedId);
                const fruitId = Number(plant && plant.fruit && plant.fruit.id) || Number(entry.fruit_id);
                const name = plant && plant.name || entry.name;
                const assetName = plant && plant.asset_name || entry.asset_name;
                const baseItem = {
                    asset_name: assetName,
                    level: Number(entry.level) || Number(plant && plant.land_level_need) || 1,
                    rarity: Math.max(3, Number(entry.rarity) || 0),
                    rarity_color: entry.rarity_color || 'EEC55A',
                };
                const existingSeedItem = itemInfoMap.get(seedId);
                if (seedId > 0 && (!existingSeedItem || plant)) {
                    const seedItem = {
                        ...baseItem,
                        ...(existingSeedItem || {}),
                        id: seedId,
                        type: 5,
                        name: `${name}种子`,
                        asset_name: assetName,
                        rarity: Math.max(1, Number(existingSeedItem && existingSeedItem.rarity) || 3),
                        interaction_type: 'plant',
                        max_count: 9999,
                        max_own: 9999,
                        desc: `种植后，可以收获一定数量的${name}。`,
                        effectDesc: name,
                    };
                    itemInfoMap.set(seedId, seedItem);
                    seedItemMap.set(seedId, seedItem);
                }
                const existingFruitItem = itemInfoMap.get(fruitId);
                if (!existingFruitItem || plant) {
                    itemInfoMap.set(fruitId, {
                        ...baseItem,
                        ...(existingFruitItem || {}),
                        id: fruitId,
                        type: 4,
                        name,
                        asset_name: assetName,
                        rarity: Math.max(1, Number(existingFruitItem && existingFruitItem.rarity) || 3),
                        max_count: 99999,
                        max_own: 999990,
                        layer: Number(entry.layer) || 0,
                    });
                }
            }
            itemInfoConfig = Array.from(itemInfoMap.values());
        }
    } catch (err) {
        console.warn('[配置] 加载 ItemInfo.json 失败:', err.message);
    }

    // 4. 加载种子图片映射
    try {
        const seedImagesPath = path.join(basePath, 'seed_images_named');
        seedImageMap.clear();
        seedAssetImageMap.clear();
        if (fs.existsSync(seedImagesPath)) {
            const files = fs.readdirSync(seedImagesPath);
            for (const filename of files) {
                const name = String(filename || '');
                const imageUrl = `/game-config/seed_images_named/${  encodeURIComponent(filename)}`;

                // 匹配 {id}_xxx.png 格式
                const namedMatch = name.match(/^(\d+)_.*\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (namedMatch) {
                    const seedId = Number(namedMatch[1]) || 0;
                    if (seedId > 0 && !seedImageMap.has(seedId)) {
                        seedImageMap.set(seedId, imageUrl);
                    }
                }

                // 匹配纯 {id}.png 格式
                const numericMatch = name.match(/^(\d+)\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (numericMatch) {
                    const itemId2 = Number(numericMatch[1]) || 0;
                    if (itemId2 > 0 && !seedImageMap.has(itemId2)) {
                        seedImageMap.set(itemId2, imageUrl);
                    }
                }

                // 匹配 Crop_X_Seed.png 格式（资产名映射）
                const assetMatch = name.match(/(Crop_\d+)_Seed\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (assetMatch) {
                    const assetName = assetMatch[1];
                    if (assetName && !seedAssetImageMap.has(assetName)) {
                        seedAssetImageMap.set(assetName, imageUrl);
                    }
                }
            }
            console.warn(`[配置] 已加载种子图片映射 (${  seedImageMap.size  } 项)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 seed_images_named 失败:', err.message);
    }

    // 5. 加载从官方 plant Bundle 导出的阶段图片
    plantPhaseManifestPath = path.join(basePath, 'plant_images', 'manifest.json');
    plantPhaseManifestMtimeMs = -1;
    loadPlantPhaseManifest(true);

    // 6. 加载装扮道具图片映射
    try {
        const skinDetailPath = path.join(basePath, 'seed_images_named', 'skinDetail');
        skinDetailImageMap.clear();
        if (fs.existsSync(skinDetailPath)) {
            const skinFiles = fs.readdirSync(skinDetailPath);
            for (const skinFile of skinFiles) {
                const skinName = String(skinFile || '');
                const skinUrl = `/game-config/seed_images_named/skinDetail/${  encodeURIComponent(skinFile)}`;
                const skinMatch = skinName.match(/^(\d+)_img_(?:skin|nangua)_.*\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (skinMatch) {
                    const skinId = Number(skinMatch[1]) || 0;
                    if (skinId > 0 && !skinDetailImageMap.has(skinId)) {
                        skinDetailImageMap.set(skinId, skinUrl);
                    }
                }
            }
            console.warn(`[配置] 已加载装扮道具图片映射 (${  skinDetailImageMap.size  } 项)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 skinDetail 失败:', err.message);
    }

    // 6. 加载变异效果配置
    try {
        const mutantPath = path.join(basePath, 'MutantEffect.json');
        if (fs.existsSync(mutantPath)) {
            mutantEffectConfig = JSON.parse(fs.readFileSync(mutantPath, 'utf8'));
            mutantEffectMap.clear();
            mutantEffectByIconMap.clear();
            for (const mutant of mutantEffectConfig) {
                const mutantId = Number(mutant && mutant.id) || 0;
                if (mutantId <= 0) continue;
                mutantEffectMap.set(mutantId, mutant);
                if (mutant.icon) mutantEffectByIconMap.set(mutant.icon, mutant);
            }
            console.warn(`[配置] 已加载变异效果配置 (${  mutantEffectConfig.length  } 种)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 MutantEffect.json 失败:', err.message);
    }
}

/** 获取等级经验表 */
function getLevelExpTable() {
    return levelExpTable;
}

/**
 * 获取升级所需经验进度
 * @returns {{current: number, needed: number}}
 */
function getLevelExpProgress(level, exp) {
    const result = { current: 0, needed: 0 };
    if (!levelExpTable || level <= 0) return result;

    const currentLevelExp = levelExpTable[level] || 0;
    const nextLevelExp = levelExpTable[level + 1] || currentLevelExp + 1;
    const progress = Math.max(0, exp - currentLevelExp);
    const totalNeeded = nextLevelExp - currentLevelExp;

    return { current: progress, needed: totalNeeded };
}

/** 根据植物ID获取植物 */
function getPlantById(plantId) {
    return plantMap.get(plantId);
}

/** 根据种子ID获取植物 */
function getPlantBySeedId(seedId) {
    return seedToPlant.get(seedId);
}

/** 根据植物ID获取植物名 */
function getPlantName(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.name : `植物${  plantId}`;
}

/** 根据种子ID获取植物名 */
function getPlantNameBySeedId(seedId) {
    const plant = seedToPlant.get(seedId);
    return plant ? plant.name : `种子${  seedId}`;
}

/**
 * 获取植物生长总时间（秒）
 * @param {number} plantId - 植物ID
 * @returns {number} 总生长秒数
 */
function getPlantGrowTime(plantId) {
    const plant = plantMap.get(plantId);
    if (!plant || !plant.grow_phases) return 0;

    const phases = plant.grow_phases.split(';').filter(Boolean);
    let totalSeconds = 0;
    for (const phase of phases) {
        const match = phase.match(/:(\d+)/);
        if (match) {
            totalSeconds += Number.parseInt(match[1]);
        }
    }
    return totalSeconds;
}

/**
 * 解析官方 Plant.grow_phases。官方客户端把每项转换成内部 phase_id；
 * 服务端响应的 phase 与该内部 ID 匹配，常规阶段按一基顺序排列。
 */
function getPlantGrowPhases(plantId) {
    const plant = plantMap.get(Number(plantId) || 0);
    if (!plant || !plant.grow_phases) return [];

    return String(plant.grow_phases)
        .split(';')
        .filter(Boolean)
        .map((value, index) => {
            const separator = value.lastIndexOf(':');
            const name = separator >= 0 ? value.slice(0, separator) : value;
            const duration = separator >= 0 ? Number(value.slice(separator + 1)) || 0 : 0;
            return { index, name, duration };
        });
}

/**
 * 格式化生长时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatGrowTime(seconds) {
    if (seconds < 60) return `${seconds  }秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)  }分钟`;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours  }小时${  minutes  }分` : `${hours  }小时`;
}

/** 获取植物种植经验 */
function getPlantExp(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.exp : 0;
}

/**
 * 获取种子收获信息
 * @param {number} seedId - 种子ID
 * @returns {{expPerSeason: number, seasons: number, incomePerSeason: number}}
 */
function getSeedHarvestInfo(seedId) {
    const plant = seedToPlant.get(seedId);
    if (!plant) {
        return { expPerSeason: 0, seasons: 1, incomePerSeason: 0 };
    }

    const expPerSeason = plant.exp || 0;
    const seasons = plant.seasons || 1;
    const fruitCount = (plant.fruit && plant.fruit.count) || 0;

    // 通过种子ID的末位匹配果实价格
    const seedIdStr = String(seedId);
    const suffix = seedIdStr.slice(-4);
    let fruitUnitPrice = 0;

    for (const [itemId, itemInfo] of itemInfoMap) {
        // type === 4 表示果实类型物品
        if (Number(itemInfo.type) === 4) {
            const itemIdStr = String(itemId);
            if (itemIdStr.endsWith(suffix)) {
                fruitUnitPrice = Number(itemInfo.price) || 0;
                break;
            }
        }
    }

    const incomePerSeason = fruitUnitPrice * fruitCount;
    return { expPerSeason, seasons, incomePerSeason };
}

/** 根据果实ID获取果实名 */
function getFruitName(fruitId) {
    const plant = fruitToPlant.get(fruitId);
    return plant ? plant.name : `果实${  fruitId}`;
}

/** 根据果实ID获取植物 */
function getPlantByFruitId(fruitId) {
    return fruitToPlant.get(fruitId);
}

/** 获取所有种子列表 */
function getAllSeeds() {
    return Array.from(seedToPlant.values()).map(plant => ({
        seedId: plant.seed_id,
        name: plant.name,
        requiredLevel: getSeedLevel(plant.seed_id) || Number(plant.land_level_need) || 0,
        price: getSeedPrice(plant.seed_id),
        image: getSeedImageBySeedId(plant.seed_id)
    }));
}

/** 内部函数：根据ID映射种子图片 */
function getMappedSeedImage(id) {
    const numericId = Number(id) || 0;
    if (numericId <= 0) return '';

    // 先查种子图片映射
    const directImage = seedImageMap.get(numericId);
    if (directImage) return directImage;

    // 再通过物品的 asset_name 查找
    const itemInfo = itemInfoMap.get(numericId);
    const assetName = itemInfo && itemInfo.asset_name ? String(itemInfo.asset_name).trim() : '';
    if (!assetName) return '';

    return seedAssetImageMap.get(assetName) || '';
}

/** 根据种子ID获取图片 */
function getSeedImageBySeedId(seedId) {
    return getMappedSeedImage(seedId);
}

/**
 * 重新加载官方植物阶段图片清单。导出工具更新 manifest 后无需重启服务。
 */
function loadPlantPhaseManifest(force = false) {
    if (!plantPhaseManifestPath) return;
    try {
        const stat = fs.statSync(plantPhaseManifestPath);
        if (!force && stat.mtimeMs === plantPhaseManifestMtimeMs) return;
        const manifest = JSON.parse(fs.readFileSync(plantPhaseManifestPath, 'utf8'));
        const nextMap = new Map();
        for (const [assetName, phases] of Object.entries(manifest)) {
            nextMap.set(assetName, phases || {});
        }
        plantPhaseImageMap.clear();
        for (const [assetName, phases] of nextMap) plantPhaseImageMap.set(assetName, phases);
        plantPhaseManifestMtimeMs = stat.mtimeMs;
        console.warn(`[配置] 已加载植物阶段图片映射 (${  plantPhaseImageMap.size  } 种)`);
    } catch (err) {
        if (force || err.code !== 'ENOENT') {
            console.warn('[配置] 加载 plant_images 失败:', err.message);
        }
    }
}

/**
 * 根据植物ID和当前阶段获取官方植物图片
 * @returns {string} 可公开访问的阶段图片URL，未导出时为空字符串
 */
function getPlantImageByPhase(plantId, phase) {
    loadPlantPhaseManifest();
    // 客户端的种子阶段共用 plant Bundle 中 model/v4/zhongzi，不使用各作物的发芽图。
    if (Number(phase) === 1) {
        const commonImages = plantPhaseImageMap.get('__common');
        return commonImages && commonImages.seed || '';
    }
    const plant = plantMap.get(Number(plantId) || 0);
    if (!plant) return '';
    const seedId = Number(plant.seed_id) || 0;
    const itemInfo = itemInfoMap.get(seedId);
    const assetName = String(
        plant.asset_name
        || (itemInfo && itemInfo.asset_name)
        || (seedId > 20000 ? `Crop_${seedId - 20000}` : `Plant_${plant.id}`)
    ).trim();
    if (!assetName) return '';
    const phases = plantPhaseImageMap.get(assetName);
    if (!phases) return '';
    const numericPhase = Number(phase) || 1;
    return phases[String(numericPhase)] || '';
}

/**
 * 根据当前变异组合解析客户端应展示的植物 ID。
 * mutant_effect_plant 格式示例：5:1120112:1;5_6:1129001:1。
 * 多效果组合优先于单效果，避免黄金+活动变异退化成普通黄金作物。
 */
function getMutantDisplayPlantId(plantId, mutantIds) {
    const numericPlantId = Number(plantId) || 0;
    if (!Array.isArray(mutantIds) || mutantIds.length === 0) return numericPlantId;
    const activeIds = new Set(mutantIds.map(id => Number(id) || 0).filter(id => id > 0));
    let currentPlantId = numericPlantId;
    const visited = new Set([currentPlantId]);

    // 部分组合通过两段映射完成，例如普通作物 -> 黄金作物 -> 黄金活动变异作物。
    for (let depth = 0; depth < 4; depth += 1) {
        const plant = plantMap.get(currentPlantId);
        const mapping = String(plant && plant.mutant_effect_plant || '').trim();
        if (!mapping) break;
        let bestMatch = null;
        for (const entry of mapping.split(';')) {
            const [effectKey, targetIdText] = entry.split(':');
            const effectIds = String(effectKey || '')
                .split('_')
                .map(id => Number(id) || 0)
                .filter(id => id > 0);
            const targetId = Number(targetIdText) || 0;
            if (!targetId || effectIds.length === 0 || !effectIds.every(id => activeIds.has(id))) continue;
            if (!bestMatch || effectIds.length > bestMatch.effectCount) {
                bestMatch = { effectCount: effectIds.length, targetId };
            }
        }
        if (!bestMatch || visited.has(bestMatch.targetId)) break;
        currentPlantId = bestMatch.targetId;
        visited.add(currentPlantId);
    }
    return currentPlantId;
}

/** 获取变异作物阶段图，缺少专属导出图时回退到原作物。 */
function getMutantPlantImageByPhase(plantId, mutantIds, phase) {
    const displayPlantId = getMutantDisplayPlantId(plantId, mutantIds);
    return getPlantImageByPhase(displayPlantId, phase) || getPlantImageByPhase(plantId, phase);
}

/** 根据物品ID获取图片 */
function getItemImageById(itemId) {
    const numericId = Number(itemId) || 0;
    if (numericId <= 0) return '';

    const staticImage = staticItemImageMap.get(numericId);
    if (staticImage) return staticImage;

    const tryGetImage = (targetId) => {
        const img = seedImageMap.get(targetId);
        if (img) return img;
        const info = itemInfoMap.get(targetId);
        const assetName = info && info.asset_name ? String(info.asset_name) : '';
        if (assetName) {
            const assetImg = seedAssetImageMap.get(assetName);
            if (assetImg) return assetImg;
        }
        return '';
    };

    // 1. 先直接查找
    let image = tryGetImage(numericId);
    if (image) return image;

    // 2. 尝试通过果实ID找到植物，再用种子ID查找
    const plant = getPlantByFruitId(numericId);
    if (plant && plant.seed_id) {
        image = tryGetImage(plant.seed_id);
        if (image) return image;
    }

    // 3. 查找装扮道具图片映射
    const skinImg = skinDetailImageMap.get(numericId);
    if (skinImg) return skinImg;

    return '';
}

/** 根据物品ID获取物品信息 */
function getItemById(itemId) {
    const numericId = Number(itemId) || 0;
    const staticInfo = staticItemInfoMap.get(numericId);
    const itemInfo = itemInfoMap.get(numericId);
    if (!staticInfo) return itemInfo;
    return {
        ...(itemInfo || {}),
        ...staticInfo,
    };
}

/** 判断是否是种子物品 */
function isSeedItem(itemId) {
    return seedItemMap.has(Number(itemId) || 0);
}

/** 获取种子价格 */
function getSeedPrice(seedId) {
    const item = seedItemMap.get(Number(seedId) || 0);
    return item ? Number(item.price) || 0 : 0;
}

/** 获取种子所需等级 */
function getSeedLevel(seedId) {
    const item = seedItemMap.get(Number(seedId) || 0);
    return item ? Number(item.level) || 0 : 0;
}

/** 获取果实单价 */
function getFruitPrice(fruitId) {
    const item = itemInfoMap.get(Number(fruitId) || 0);
    return item ? Number(item.price) || 0 : 0;
}

/** 根据种子ID获取果实层级 */
function getFruitLayerBySeedId(seedId) {
    const numericSeedId = Number(seedId) || 0;
    const plant = seedToPlant.get(numericSeedId);
    if (!plant) {
        console.warn(`[getFruitLayerBySeedId] 未找到种子ID ${  numericSeedId  } 对应的植物`);
        return 0;
    }
    if (!plant.fruit || !plant.fruit.id) {
        console.warn(`[getFruitLayerBySeedId] 种子ID ${  numericSeedId  } 的植物没有果实信息`);
        return 0;
    }

    const fruitId = Number(plant.fruit.id) || 0;
    const fruitItem = itemInfoMap.get(fruitId);
    if (!fruitItem) {
        console.warn(`[getFruitLayerBySeedId] 未找到果实ID ${  fruitId  } 的物品信息`);
        return 0;
    }

    return Number(fruitItem.layer) || 0;
}

/** 根据果实ID获取果实层级 */
function getFruitLayerByFruitId(fruitId) {
    const numericFruitId = Number(fruitId) || 0;
    const fruitItem = itemInfoMap.get(numericFruitId);
    if (!fruitItem) return 0;
    return Number(fruitItem.layer) || 0;
}

/** 获取所有植物列表 */
function getAllPlants() {
    return Array.from(plantMap.values());
}

/** 根据变异效果ID获取变异效果 */
function getMutantEffectById(mutantId) {
    return mutantEffectMap.get(Number(mutantId) || 0);
}

/** 根据图标获取变异效果 */
function getMutantEffectByIcon(icon) {
    return mutantEffectByIconMap.get(String(icon || ''));
}

/** 获取所有变异效果 */
function getAllMutantEffects() {
    return mutantEffectConfig || [];
}

/** 根据多个变异效果ID批量获取 */
function getMutantEffectsByIds(ids) {
    if (!Array.isArray(ids)) return [];
    return ids
        .map(id => mutantEffectMap.get(Number(id) || 0))
        .filter(effect => effect !== undefined);
}

// 启动时加载配置
loadConfigs();

module.exports = {
    loadConfigs,
    getAllPlants,
    getAllSeeds,
    getLevelExpTable,
    getLevelExpProgress,
    getPlantById,
    getPlantBySeedId,
    getPlantName,
    getPlantNameBySeedId,
    getPlantGrowTime,
    getPlantGrowPhases,
    getPlantExp,
    formatGrowTime,
    getSeedHarvestInfo,
    getFruitName,
    getPlantByFruitId,
    getItemById,
    getItemImageById,
    isSeedItem,
    getSeedPrice,
    getFruitPrice,
    getFruitLayerBySeedId,
    getFruitLayerByFruitId,
    getSeedImageBySeedId,
    getPlantImageByPhase,
    getMutantDisplayPlantId,
    getMutantPlantImageByPhase,
    getSeedLevel,
    getMutantEffectById,
    getMutantEffectByIcon,
    getAllMutantEffects,
    getMutantEffectsByIds
};
