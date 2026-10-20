const { getPlantById } = require('../config/gameConfig');
const { getServerTimeSec, toNum } = require('../utils/utils');

// 土地快照只在很短时间内可信；过期后宁可没有预测，也不用旧地块推算。
const SNAPSHOT_MAX_AGE_SEC = 180;
// 会话太短时的经验均值几乎没有意义，直接不参与外推。
const HISTORY_MIN_SECONDS = 60;

const seconds = value => (toNum(value) > 1e12 ? Math.floor(toNum(value) / 1000) : toNum(value));

/**
 * 每块地只统计一次。2x2 作物的从属地块和主地块会同时出现在 AllLands 里，
 * 成熟时间只有当季作物才有服务端下发。
 */
function buildHarvestEvents(lands, nowSec, getPlant = getPlantById) {
    const events = [];
    const seen = new Set();
    const slaves = new Set();
    for (const land of lands) {
        for (const id of land.slave_land_ids || []) slaves.add(toNum(id));
    }
    for (const land of lands) {
        const id = toNum(land.id);
        const master = toNum(land.master_land_id);
        if (!id || seen.has(id) || !land.unlocked || slaves.has(id) || (master && master !== id)) continue;
        seen.add(id);

        const plant = land.plant;
        if (!plant || !Array.isArray(plant.phases)) continue;
        const phases = plant.phases.filter(phase => seconds(phase.begin_time) > 0);
        // 协议下发的是从当前阶段开始的尾部列表，时钟不会推进这个状态。
        const current = plant.phases[0];
        if (current && (toNum(current.phase) === 7 || toNum(current.phase) === 0)) continue;

        const config = getPlant(toNum(plant.id));
        const configuredPhases = String(config?.grow_phases || '').split(';').filter(Boolean);
        const finalName = configuredPhases.at(-1)?.split(':')[0];
        const explicitMature = phases.find(
            phase => [6, 19].includes(toNum(phase.phase)) || toNum(phase.phase_id) === 19,
        );
        const finalPhase = phases[phases.length - 1];
        const mature = explicitMature || (['成熟', '盛开'].includes(finalName)
            && plant.phases.length <= configuredPhases.length && toNum(finalPhase?.phase) === 2 ? finalPhase : null);
        if (!mature) continue;
        // 缺少服务端加成数据是“未知”，不能按土壤颜色之类猜成零加成。
        if (!config || !land.buff || !Number.isFinite(Number(land.buff.plant_exp_bonus))) continue;
        const exp = Math.floor(toNum(config.exp) * (1 + Math.max(0, toNum(land.buff.plant_exp_bonus)) / 10000));
        if (exp <= 0) continue;
        events.push({ landId: id, at: Math.max(nowSec, seconds(mature.begin_time)), exp });
    }
    return events.sort((a, b) => a.at - b.at || a.landId - b.landId);
}

function calculateLevelForecast(options) {
    const { nowSec } = options;
    const remainingExp = Math.max(0, toNum(options.remainingExp));
    const base = {
        generatedAt: nowSec * 1000,
        remainingExp,
        scheduledExp: 0,
        plotCount: 0,
        readyExp: 0,
        estimatedAt: null,
        source: 'unavailable',
        automatic: options.autoHarvest === true && options.quiet !== true,
    };
    if (!options.connected || remainingExp <= 0) return base;

    const events = buildHarvestEvents(options.lands || [], nowSec, options.getPlant);
    base.scheduledExp = events.reduce((sum, event) => sum + event.exp, 0);
    base.plotCount = events.length;
    base.readyExp = events
        .filter(event => event.at <= nowSec)
        .reduce((sum, event) => sum + event.exp, 0);

    let total = 0;
    for (const event of events) {
        total += event.exp;
        if (total >= remainingExp) {
            return { ...base, source: event.at <= nowSec ? 'ready' : 'planted', estimatedAt: event.at * 1000 };
        }
    }

    // 已排期的收获不再叠加历史均值；只有最后一次已知收获之后的缺口才用历史速率外推。
    const rate = Math.max(0, toNum(options.historyRate));
    if (rate <= 0 || !base.automatic) return base;
    const startAt = events.length ? events[events.length - 1].at : nowSec;
    const estimatedAt = (startAt + Math.ceil(((remainingExp - total) / rate) * 3600)) * 1000;
    return { ...base, source: events.length ? 'mixed' : 'history', estimatedAt };
}

let revision = 0;
let snapshot = null;

function invalidateLandForecast() {
    snapshot = null;
    revision++;
}

function getLandForecastRevision() {
    return revision;
}

function rememberLandForecast(lands, user, expectedRevision) {
    if (revision !== expectedRevision || !Array.isArray(lands)) return;
    snapshot = { lands, gid: toNum(user.gid), exp: toNum(user.exp), at: getServerTimeSec() };
}

function getLevelForecast(user, progress, stats, automation, quiet) {
    const nowSec = getServerTimeSec();
    const valid = snapshot && snapshot.gid === toNum(user.gid) && snapshot.exp === toNum(user.exp)
        && nowSec >= snapshot.at && nowSec - snapshot.at <= SNAPSHOT_MAX_AGE_SEC;
    const sessionSeconds = Math.max(0, toNum(stats.sessionElapsedSeconds));
    return calculateLevelForecast({
        lands: valid ? snapshot.lands : [],
        nowSec,
        remainingExp: progress ? toNum(progress.needed) - toNum(progress.current) : 0,
        historyRate: sessionSeconds >= HISTORY_MIN_SECONDS
            ? Math.max(0, toNum(stats.sessionExpGained)) / sessionSeconds * 3600
            : 0,
        connected: !!stats.connection?.connected,
        autoHarvest: !!automation?.farm,
        quiet,
        getPlant: getPlantById,
    });
}

module.exports = {
    buildHarvestEvents,
    calculateLevelForecast,
    invalidateLandForecast,
    getLandForecastRevision,
    rememberLandForecast,
    getLevelForecast,
};
