import type { AutomationConfig, FertilizerMode } from '../../types/config';

const { getAllLands, fertilizeBatch, fertilizeOrganicLoop } = require('./api');
const {
    filterLandIdsByTypes,
    getFastMatureLands,
    getLandTypeByLevel,
    getNormalFertilizerTargetsFromLands,
    normalizeFertilizerLandTypes,
} = require('./land-analysis');
const { log, toNum } = require('../../utils/utils');
const { recordOperation } = require('../stats');

/**
 * 临熟催熟。
 *
 * 三种模式共用一套目标筛选：
 * - smart：原有行为，临熟地块循环施有机化肥（1012），施完可能立即成熟；
 * - normal_ripen：临熟且仍可施普通肥的地块，批量施普通化肥（1011）；
 * - organic_ripen：临熟地块批量施有机化肥（1012）。
 *
 * 后两种是「只临熟催熟」模式：播种施肥与多季补肥阶段完全不动化肥，
 * 因此 runFertilizerByConfig / runMultiSeasonFertilizer 遇到它们要直接返回。
 */
export function isRipeningOnlyMode(mode: FertilizerMode): boolean {
    return mode === 'normal_ripen' || mode === 'organic_ripen';
}

/**
 * 执行一次临熟催熟，返回实际施肥次数。
 *
 * lands 传入调用方已读取的地块快照可省一次请求；但快照必须是本轮刚读且期间没有写操作，
 * 否则会对着已收获/已补种的地块施肥，所以 scheduler 会在任何写操作后把它置空。
 */
export async function runRipeningFertilizer(
    automation: Pick<AutomationConfig, 'fertilizer' | 'fertilizer_land_types' | 'fertilizer_smart_seconds'>,
    lands?: any[],
    propagateErrors = false,
): Promise<number> {
    const mode = automation.fertilizer;
    if (mode !== 'smart' && !isRipeningOnlyMode(mode)) return 0;
    const selectedTypes = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    if (selectedTypes.length === 0) return 0;
    const snapshot = lands ?? (await getAllLands())?.lands;
    if (!Array.isArray(snapshot)) return 0;
    // 只按主地块判断土地类型，避免奴隶地块与主地块各算一次。
    const roots = snapshot.filter(land => {
        const masterId = toNum(land?.master_land_id);
        return land && (!masterId || masterId === toNum(land.id));
    });
    const typesById = new Map<number, string>(roots.map(land => [toNum(land.id), getLandTypeByLevel(land.level)]));
    let targets = [...new Set<number>(filterLandIdsByTypes(
        getFastMatureLands(roots, automation.fertilizer_smart_seconds), typesById, selectedTypes,
    ))];
    const normal = mode === 'normal_ripen';
    if (normal) {
        // 普通化肥有剩余次数上限，只保留仍可施的地块。
        const eligible = new Set<number>(getNormalFertilizerTargetsFromLands(roots));
        targets = targets.filter(landId => eligible.has(landId));
    }
    if (targets.length === 0) return 0;

    let count: number;
    if (mode === 'smart') {
        count = await fertilizeOrganicLoop(targets, propagateErrors);
    }
    else {
        // 批量施肥一次发完，用回包 land 里出现的 id 计数，比按目标数猜测更准确。
        const reply = await fertilizeBatch(targets, normal ? 1011 : 1012);
        const updated = new Set<number>((Array.isArray(reply?.land) ? reply.land : []).map(land => toNum(land?.id)));
        count = targets.filter(landId => updated.has(landId)).length;
    }
    if (count > 0) {
        recordOperation('fertilize', count);
        log('施肥', `临熟催熟：${normal ? '普通化肥' : '有机化肥'}已施 ${count} 次`, {
            module: 'farm', event: '临熟催熟', result: 'ok', type: normal ? 'normal' : 'organic', count,
        });
    }
    return count;
}