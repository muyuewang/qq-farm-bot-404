const catalog = require('../gameConfig/GrowthPlantingTasks.json');
const definitions = new Map(catalog.tasks.map(task => [task.taskId, task]));

// Only explicitly verified planting tasks are eligible; never infer actions from live text.
function getGrowthPlantingNeeds(tasks) {
  const needs = new Map();
  for (const task of tasks || []) {
    const definition = definitions.get(Number(task.id));
    if (!definition || !task.is_unlocked || task.is_claimed) continue;
    const total = Number(task.total_progress);
    const progress = Number(task.progress);
    if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(progress) || progress < 0) continue;
    const remaining = Math.max(0, total - progress);
    if (!remaining) continue;
    // One planting can advance several already unlocked tasks for the same seed.
    needs.set(definition.seedId, Math.max(needs.get(definition.seedId) || 0, remaining));
  }
  return [...needs].map(([seedId, count]) => ({ seedId, count }));
}

async function plantGrowthTasks(landIds, deps) {
  const plantedLandIds = [];
  let remainingLandIds = [...landIds];
  const tasks = await deps.getTasks();
  const needs = getGrowthPlantingNeeds(tasks);
  if (!needs.length) return { plantedLandIds, remainingLandIds };
  const seeds = await deps.getBagSeeds();
  for (const need of needs) {
    if (!remainingLandIds.length) break;
    const plant = deps.getPlant(need.seedId);
    if (!plant || Number(plant.size || 1) !== 1 || deps.isLocked(plant)) continue;
    const count = Math.min(need.count, remainingLandIds.length);
    const owned = Math.max(0, Number(seeds.find(seed => Number(seed.seedId) === need.seedId)?.count) || 0);
    let available = Math.min(count, owned);
    if (available < count) {
      available += await deps.buySeed(need.seedId, count - available, owned);
    }
    if (!available) continue;
    const targets = remainingLandIds.slice(0, Math.min(count, available));
    const result = await deps.plantSeeds(need.seedId, targets, { maxPlantCount: targets.length });
    plantedLandIds.push(...result.plantedLandIds);
    const used = new Set(result.occupiedLandIds);
    remainingLandIds = remainingLandIds.filter(id => !used.has(id));
    // A partial/uncertain planting must not trigger another purchase or normal planting this round.
    if (result.planted < targets.length) return { plantedLandIds, remainingLandIds: [], interrupted: true };
  }
  return { plantedLandIds, remainingLandIds };
}

module.exports = { getGrowthPlantingNeeds, plantGrowthTasks };
