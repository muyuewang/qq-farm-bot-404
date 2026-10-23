export {};
/**
 * 数据分析模块 - 作物效率分析
 */

const { getAllPlants, getFruitPrice, getSeedPrice, getItemImageById, getItemById } = require('../config/gameConfig');

const EXCLUDED_RADISH_SEED_ID = 29999;

function parseGrowTime(growPhases: string): number {
    if (!growPhases) return 0;
    const phases: string[] = growPhases.split(';').filter((p: string) => p.length > 0);
    let totalTime: number = 0;
    for (const phase of phases) {
        const match: RegExpMatchArray | null = phase.match(/:(\d+)$/);
        if (match) {
            totalTime += Number.parseInt(match[1]);
        }
    }
    return totalTime;
}

function parseNormalFertilizerReduceSec(growPhases: any): number {
    if (!growPhases) return 0;
    const phases: string[] = String(growPhases).split(';').filter((p: string) => p.length > 0);
    if (!phases.length) return 0;
    const first: string = phases[0];
    const match: RegExpMatchArray | null = first.match(/:(\d+)$/);
    return match ? (Number.parseInt(match[1], 10) || 0) : 0;
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    const hours: number = Math.floor(seconds / 3600);
    const mins: number = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
}

interface PlantRankingResult {
    id: any;
    seedId: any;
    name: any;
    seasons: number;
    level: number | null;
    growTime: number;
    growTimeStr: string;
    reduceSec: number;
    reduceSecApplied: number;
    expPerHour: number;
    normalFertilizerExpPerHour: number;
    goldPerHour: number;
    profitPerHour: number;
    normalFertilizerProfitPerHour: number;
    income: number;
    netProfit: number;
    fruitId: number;
    fruitCount: number;
    fruitPrice: number;
    seedPrice: number;
    image: any;
}

function getPlantRankings(sortBy: string = 'exp'): PlantRankingResult[] {
    const plants: any[] = getAllPlants();

    // 筛选普通作物，排除 id 为 29999 的白萝卜种子。
    const normalPlants: any[] = plants.filter((p: any) => {
        return Number(p.seed_id) !== EXCLUDED_RADISH_SEED_ID
            && p.seed_id > 0
            && p.grow_phases;
    });

    const results: PlantRankingResult[] = [];
    for (const plant of normalPlants) {
        const baseGrowTime: number = parseGrowTime(plant.grow_phases);
        if (baseGrowTime <= 0) continue;
        const seasons: number = Number(plant.seasons) || 1;
        const isTwoSeason: boolean = seasons === 2;
        const growTime: number = isTwoSeason ? (baseGrowTime * 1.5) : baseGrowTime;

        const harvestExpBase: number = Number.parseInt(plant.exp) || 0;
        const harvestExp: number = isTwoSeason ? (harvestExpBase * 2) : harvestExpBase;
        const expPerHour: number = (harvestExp / growTime) * 3600;
        // 普通化肥：直接减少第一生长阶段时长（reduceSec）
        const reduceSecBase: number = parseNormalFertilizerReduceSec(plant.grow_phases);
        const reduceSecApplied: number = isTwoSeason ? (reduceSecBase * 2) : reduceSecBase;
        const fertilizedGrowTime: number = growTime - reduceSecApplied;
        const safeFertilizedTime: number = fertilizedGrowTime > 0 ? fertilizedGrowTime : 1;
        const normalFertilizerExpPerHour: number = (harvestExp / safeFertilizedTime) * 3600;

        const fruitId: number = Number(plant.fruit && plant.fruit.id) || 0;
        const fruitCount: number = Number(plant.fruit && plant.fruit.count) || 0;
        const fruitPrice: number = getFruitPrice(fruitId);
        const seedPrice: number = getSeedPrice(Number(plant.seed_id) || 0);

        // 单次收获总金币（毛收益）与净收益
        const income: number = (fruitCount * fruitPrice) * (isTwoSeason ? 2 : 1);
        const netProfit: number = income - seedPrice;
        const goldPerHour: number = (income / growTime) * 3600;
        const profitPerHour: number = (netProfit / growTime) * 3600;
        const normalFertilizerProfitPerHour: number = (netProfit / safeFertilizedTime) * 3600;

        // 优先从 ItemInfo.json 获取种子等级（Plant.json 的 land_level_need 全为 1，不可用）
        const seedItem: any = getItemById(Number(plant.seed_id) || 0);
        const cfgLevel: number = seedItem ? Number(seedItem.level) : Number(plant.land_level_need);
        const requiredLevel: number | null = (Number.isFinite(cfgLevel) && cfgLevel > 0) ? cfgLevel : null;
        results.push({
            id: plant.id,
            seedId: plant.seed_id,
            name: plant.name,
            seasons,
            level: requiredLevel,
            growTime,
            growTimeStr: formatTime(growTime),
            reduceSec: reduceSecBase,
            reduceSecApplied,
            expPerHour: Number.parseFloat(expPerHour.toFixed(2)),
            normalFertilizerExpPerHour: Number.parseFloat(normalFertilizerExpPerHour.toFixed(2)),
            goldPerHour: Number.parseFloat(goldPerHour.toFixed(2)), // 毛收益/时
            profitPerHour: Number.parseFloat(profitPerHour.toFixed(2)), // 净收益/时
            normalFertilizerProfitPerHour: Number.parseFloat(normalFertilizerProfitPerHour.toFixed(2)), // 普通肥净收益/时
            income,
            netProfit,
            fruitId,
            fruitCount,
            fruitPrice,
            seedPrice,
            image: getItemImageById(plant.seed_id),
        });
    }

    if (sortBy === 'exp') {
        results.sort((a: PlantRankingResult, b: PlantRankingResult) => b.expPerHour - a.expPerHour);
    } else if (sortBy === 'fert') {
        results.sort((a: PlantRankingResult, b: PlantRankingResult) => b.normalFertilizerExpPerHour - a.normalFertilizerExpPerHour);
    } else if (sortBy === 'gold') {
        results.sort((a: PlantRankingResult, b: PlantRankingResult) => b.goldPerHour - a.goldPerHour);
    } else if (sortBy === 'profit') {
        results.sort((a: PlantRankingResult, b: PlantRankingResult) => b.profitPerHour - a.profitPerHour);
    } else if (sortBy === 'fert_profit') {
        results.sort((a: PlantRankingResult, b: PlantRankingResult) => b.normalFertilizerProfitPerHour - a.normalFertilizerProfitPerHour);
    } else if (sortBy === 'level') {
        const lv = (v: any): number => (v === null || v === undefined ? -1 : Number(v));
        results.sort((a: PlantRankingResult, b: PlantRankingResult) => lv(b.level) - lv(a.level));
    }

    return results;
}

module.exports = {
    getPlantRankings,
};
