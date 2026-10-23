export {};

const { toNum } = require('../../utils/utils');
const { buildPlantingLayouts } = require('./land-analysis');

interface PlantingLayout {
    anchorLandId: number;
    landIds: number[];
}

interface FutureLayoutReservation {
    layout: PlantingLayout;
    reservedLandIds: number[];
}

interface SelectFutureLayoutOptions {
    /** 上一轮为该种子登记的目标布局；在“预留格数不吃亏”的前提下优先沿用。 */
    registered?: PlantingLayout | null;
    /** 本轮已被其他种子占用的整组目标布局土地；与之重叠的候选布局不可选。 */
    excludeLandIds?: Iterable<number>;
}

// seedId -> 已登记的目标布局。每个账号运行在独立 worker 进程内，模块级状态天然按账号隔离。
const registeredLayouts = new Map<number, PlantingLayout>();

function layoutKey(layout: PlantingLayout | null | undefined): string {
    if (!layout || !Array.isArray(layout.landIds)) return '';
    return layout.landIds.map((id: any) => toNum(id)).sort((a: number, b: number) => a - b).join(',');
}

/**
 * 为暂时凑不齐的多格作物选择一组未来布局，并只预留其中当前已经空出的土地。
 *
 * 选择规则（#89）：
 * 1. 已预留格数最多的候选布局优先，避免“后空出的地被别的作物种掉”；
 * 2. 格数相同时优先沿用已登记的目标布局，使轮次之间不来回切换（只会向更满的布局收敛）；
 * 3. 仍相同时取锚点最小者，保证结果稳定。
 */
function selectFutureLayoutReservation(
    currentEmptyLandIds: any[],
    allEligibleLandIds: any[],
    plantSize: number,
    options: SelectFutureLayoutOptions = {},
): FutureLayoutReservation | null {
    const size = Math.max(1, toNum(plantSize) || 1);
    if (size <= 1) return null;

    const emptyIds = new Set<number>((Array.isArray(currentEmptyLandIds) ? currentEmptyLandIds : [])
        .map((id: any) => toNum(id))
        .filter((id: number) => id > 0));
    if (emptyIds.size === 0) return null;
    if (buildPlantingLayouts([...emptyIds], size).length > 0) return null;

    const excluded = new Set<number>([...(options.excludeLandIds || [])]
        .map((id: any) => toNum(id))
        .filter((id: number) => id > 0));
    const registeredKey = layoutKey(options.registered);

    const candidates = buildPlantingLayouts(allEligibleLandIds, size)
        .map((layout: PlantingLayout) => ({
            layout,
            reservedLandIds: layout.landIds.filter((id: number) => emptyIds.has(id)),
        }))
        .filter((candidate: FutureLayoutReservation) => (
            candidate.reservedLandIds.length > 0
            && candidate.reservedLandIds.length < candidate.layout.landIds.length
            && !candidate.layout.landIds.some((id: number) => excluded.has(id))
        ))
        .sort((a: FutureLayoutReservation, b: FutureLayoutReservation) => {
            const byReserved = b.reservedLandIds.length - a.reservedLandIds.length;
            if (byReserved !== 0) return byReserved;
            if (registeredKey) {
                const aReg = layoutKey(a.layout) === registeredKey ? 0 : 1;
                const bReg = layoutKey(b.layout) === registeredKey ? 0 : 1;
                if (aReg !== bReg) return aReg - bReg;
            }
            return a.layout.anchorLandId - b.layout.anchorLandId;
        });

    return candidates[0] || null;
}

function getRegisteredLayout(seedId: any): PlantingLayout | null {
    const layout = registeredLayouts.get(toNum(seedId));
    return layout ? { anchorLandId: layout.anchorLandId, landIds: [...layout.landIds] } : null;
}

function registerLayout(seedId: any, layout: PlantingLayout): void {
    const id = toNum(seedId);
    if (!id || !layout || !Array.isArray(layout.landIds) || layout.landIds.length === 0) return;
    registeredLayouts.set(id, { anchorLandId: layout.anchorLandId, landIds: [...layout.landIds] });
}

function clearRegisteredLayout(seedId: any): void {
    registeredLayouts.delete(toNum(seedId));
}

function resetRegisteredLayouts(): void {
    registeredLayouts.clear();
}

module.exports = {
    selectFutureLayoutReservation,
    getRegisteredLayout,
    registerLayout,
    clearRegisteredLayout,
    resetRegisteredLayouts,
};
