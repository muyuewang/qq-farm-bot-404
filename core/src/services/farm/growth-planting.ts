const { toNum } = require('../../utils/utils');
const catalog = require('../../gameConfig/GrowthPlantingTasks.json');

// Only explicitly verified planting tasks are eligible; never infer actions from live text.
const definitions = new Map<number, { seedId: number; total: number }>(
    (Array.isArray(catalog && catalog.tasks) ? catalog.tasks : [])
        .map((task: any) => [toNum(task && task.taskId), { seedId: toNum(task && task.seedId), total: toNum(task && task.total) }])
        .filter(([id, def]: [number, any]) => id > 0 && def.seedId > 0),
);

/**
 * 从成长任务列表中提取"需要种植的种子 → 剩余数量"。
 * 只认 GrowthPlantingTasks.json 里明确登记过的 taskId，绝不从任务文案里猜。
 * 一次种植可同时推进多个已解锁的同种子任务，取最大剩余数。
 */
function getGrowthPlantingNeeds(tasks: any[]): Array<{ seedId: number; count: number }> {
    const needs = new Map<number, number>();
    for (const task of Array.isArray(tasks) ? tasks : []) {
        const definition = definitions.get(toNum(task && task.id));
        if (!definition || definition.seedId <= 0) continue;
        if (!task.is_unlocked || task.is_claimed) continue;
        const total = toNum(task.total_progress);
        const progress = toNum(task.progress);
        if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(progress) || progress < 0) continue;
        const remaining = Math.max(0, total - progress);
        if (!remaining) continue;
        needs.set(definition.seedId, Math.max(needs.get(definition.seedId) || 0, remaining));
    }
    return [...needs].map(([seedId, count]) => ({ seedId, count }));
}

interface PlantGrowthTasksDeps {
    getTasks: () => Promise<any[]>;
    getBagSeeds: () => Promise<any[]>;
    getPlant: (seedId: number) => any;
    isLocked: (seedId: number, plant: any) => boolean;
    plantSeeds: (seedId: number, landIds: number[], options?: any) => Promise<{ plantedLandIds?: number[]; occupiedLandIds?: number[]; planted?: number }>;
    buySeed: (seedId: number, count: number, previousOwned: number) => Promise<number>;
    warn?: (message: string) => void;
}

/**
 * 任务作物优先种植：把任务需要的种子优先种进给定空地。
 * 只消耗背包里已有的种子，不足时不自动购买（种植策略由外部决定是否补货）。
 * 返回剩余可用空地；种植出现部分成功/不确定时中断本轮，避免误购或重复种植。
 */
async function plantGrowthTasks(landIds: number[], deps: PlantGrowthTasksDeps): Promise<{
    plantedLandIds: number[];
    remainingLandIds: number[];
    interrupted?: boolean;
}> {
    const plantedLandIds: number[] = [];
    let remainingLandIds = [...(Array.isArray(landIds) ? landIds : [])];
    const tasks = await deps.getTasks();
    const needs = getGrowthPlantingNeeds(tasks);
    if (!needs.length) return { plantedLandIds, remainingLandIds };
    const seeds = await deps.getBagSeeds();
    for (const need of needs) {
        if (!remainingLandIds.length) break;
        const plant = deps.getPlant(need.seedId);
        if (!plant || toNum(plant.size || 1) !== 1 || deps.isLocked(need.seedId, plant)) continue;
        const count = Math.min(need.count, remainingLandIds.length);
        const owned = Math.max(0, toNum((seeds || []).find((seed: any) => toNum(seed && seed.seedId) === need.seedId)?.count));
        let available = Math.min(count, owned);
        if (available < count && typeof deps.buySeed === 'function') {
            // 背包存量不足时按缺口从商店补购，返回值是确认实际入库的数量。
            available += await deps.buySeed(need.seedId, count - available, owned);
        }
        if (!available) continue;
        const targets = remainingLandIds.slice(0, Math.min(count, available));
        const result = await deps.plantSeeds(need.seedId, targets, { maxPlantCount: targets.length });
        plantedLandIds.push(...((result && result.plantedLandIds) || []));
        const used = new Set((result && result.occupiedLandIds) || []);
        remainingLandIds = remainingLandIds.filter((id: number) => !used.has(id));
        // 部分成功/结果不确定时必须中断本轮，不能触发后续购买或常规补种。
        if (toNum(result && result.planted) < targets.length) {
            return { plantedLandIds, remainingLandIds: [], interrupted: true };
        }
    }
    return { plantedLandIds, remainingLandIds };
}

module.exports = {
    getGrowthPlantingNeeds,
    plantGrowthTasks,
};
