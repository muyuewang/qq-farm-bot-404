const assert = require('node:assert/strict');
const test = require('node:test');

const { PlantPhase } = require('../dist/config/config');
const { getPlantById, getPlantGrowPhases } = require('../dist/config/gameConfig');
const {
    analyzeLands,
    classifyHarvestedLandsByMap,
    getCurrentPhase,
    getNormalFertilizerTargetsFromLands,
    getOrganicFertilizerTargetsFromLands,
    filterLandIdsForNormalFertilizer,
    resolveRemovableHarvestedLands,
} = require('../dist/services/farm/land-analysis');

const MUSHROOM_ID = 1020050;
const RADISH_ID = 2020002;
const MORNING_GLORY_ID = 1020147;

function land(id, plant) {
    return { id, unlocked: true, plant };
}

test('getPlantGrowPhases parses multi-season and 盛开-final crops', () => {
    const mushroom = getPlantGrowPhases(MUSHROOM_ID);
    assert.ok(mushroom.length >= 2);
    assert.equal(mushroom[mushroom.length - 1].name, '成熟');
    assert.equal(getPlantById(MUSHROOM_ID).seasons, 2);

    const glory = getPlantGrowPhases(MORNING_GLORY_ID);
    assert.equal(glory[glory.length - 1].name, '盛开');
});

test('getCurrentPhase uses phases[0] even when a later phase is already in the past', () => {
    const now = Math.floor(Date.now() / 1000);
    const current = getCurrentPhase([
        { phase: PlantPhase.GERMINATION, begin_time: now - 100 },
        { phase: PlantPhase.MATURE, begin_time: now - 10 },
    ], false, '', RADISH_ID);
    assert.equal(current.phase, PlantPhase.GERMINATION);
});

test('getCurrentPhase maps phase_id 19 to MATURE', () => {
    const now = Math.floor(Date.now() / 1000);
    const current = getCurrentPhase([
        { phase: PlantPhase.GERMINATION, phase_id: 19, begin_time: now - 10 },
        { phase: PlantPhase.MATURE, begin_time: now + 100 },
        { phase: PlantPhase.MATURE, begin_time: now + 200 },
    ], false, '', MUSHROOM_ID);
    assert.equal(current.phase, PlantPhase.MATURE);
});

test('getCurrentPhase maps a final configured 盛开 remaining phase to MATURE', () => {
    const now = Math.floor(Date.now() / 1000);
    const current = getCurrentPhase([
        { phase: PlantPhase.GERMINATION, begin_time: now - 10 },
    ], false, '', MORNING_GLORY_ID);
    assert.equal(current.phase, PlantPhase.MATURE);
});

test('classifyHarvestedLandsByMap: dead and empty go to removable, missing land stays unknown', () => {
    const now = Math.floor(Date.now() / 1000);
    const map = new Map([
        [1, land(1, { id: RADISH_ID, season: 1, phases: [{ phase: PlantPhase.DEAD, begin_time: now }] })],
        [2, land(2, null)],
        [3, land(3, { id: RADISH_ID, season: 1, phases: [] })],
    ]);
    const result = classifyHarvestedLandsByMap([1, 2, 3, 99], map);
    assert.deepEqual(result.removable.slice().sort((a, b) => a - b), [1, 2, 3]);
    assert.deepEqual(result.growing, []);
    assert.deepEqual(result.unknown, [99]);
});

test('classifyHarvestedLandsByMap: next-season multi-crop is growing, not removable', () => {
    const now = Math.floor(Date.now() / 1000);
    const map = new Map([
        [4, land(4, {
            id: MUSHROOM_ID,
            season: 2,
            phases: [
                { phase: PlantPhase.GERMINATION, begin_time: now - 10 },
                { phase: PlantPhase.MATURE, begin_time: now + 3600 },
            ],
        })],
    ]);
    const result = classifyHarvestedLandsByMap([4], map);
    assert.deepEqual(result.growing, [4]);
    assert.deepEqual(result.removable, []);
    assert.deepEqual(result.unknown, []);
});

test('classifyHarvestedLandsByMap: unusual phase still growing when seasons remain', () => {
    const now = Math.floor(Date.now() / 1000);
    const map = new Map([
        [5, land(5, {
            id: MUSHROOM_ID,
            season: 1,
            phases: [
                { phase: 20, phase_id: 20, begin_time: now - 10 },
                { phase: PlantPhase.MATURE, begin_time: now + 3600 },
            ],
        })],
    ]);
    const result = classifyHarvestedLandsByMap([5], map);
    assert.deepEqual(result.growing, [5]);
    assert.deepEqual(result.removable, []);
});

test('classifyHarvestedLandsByMap: unusual phase on a single-season crop stays unknown', () => {
    const now = Math.floor(Date.now() / 1000);
    const map = new Map([
        [6, land(6, {
            id: RADISH_ID,
            season: 1,
            phases: [
                { phase: 20, phase_id: 20, begin_time: now - 10 },
                { phase: PlantPhase.MATURE, begin_time: now + 60 },
            ],
        })],
    ]);
    const result = classifyHarvestedLandsByMap([6], map);
    assert.deepEqual(result.unknown, [6]);
    assert.deepEqual(result.removable, []);
    assert.deepEqual(result.growing, []);
});

test('classifyHarvestedLandsByMap: dead last season of a multi-crop is removable', () => {
    const now = Math.floor(Date.now() / 1000);
    const map = new Map([
        [7, land(7, {
            id: MUSHROOM_ID,
            season: 2,
            phases: [{ phase: PlantPhase.DEAD, begin_time: now }],
        })],
    ]);
    const result = classifyHarvestedLandsByMap([7], map);
    assert.deepEqual(result.removable, [7]);
    assert.deepEqual(result.growing, []);
});

test('resolveRemovableHarvestedLands skips unknown instead of treating it as removable', async () => {
    const result = await resolveRemovableHarvestedLands([99], { land: [] });
    assert.deepEqual(result.removable, []);
    assert.deepEqual(result.growing, []);
    assert.equal(result.fallbackRemoved, 1);
});

test('resolveRemovableHarvestedLands classifies a mixed harvest reply without shovel next-season crops', async () => {
    const now = Math.floor(Date.now() / 1000);
    const result = await resolveRemovableHarvestedLands([1, 2], {
        land: [
            land(1, { id: RADISH_ID, season: 1, phases: [{ phase: PlantPhase.DEAD, begin_time: now }] }),
            land(2, {
                id: MUSHROOM_ID,
                season: 2,
                phases: [
                    { phase: PlantPhase.GERMINATION, begin_time: now - 10 },
                    { phase: PlantPhase.MATURE, begin_time: now + 3600 },
                ],
            }),
        ],
    });
    assert.deepEqual(result.removable, [1]);
    assert.deepEqual(result.growing, [2]);
    assert.equal(result.fallbackRemoved, 0);
});

test('analyzeLands still harvests a radish at phase 6', () => {
    const now = Math.floor(Date.now() / 1000);
    const status = analyzeLands([
        land(1, { id: RADISH_ID, season: 1, phases: [{ phase: PlantPhase.MATURE, begin_time: now - 10 }] }),
    ]);
    assert.deepEqual(status.harvestable, [1]);
    assert.deepEqual(status.dead, []);
});

test('analyzeLands treats morning glory final remaining phase as harvestable', () => {
    const now = Math.floor(Date.now() / 1000);
    const status = analyzeLands([
        land(8, { id: MORNING_GLORY_ID, season: 1, phases: [{ phase: PlantPhase.GERMINATION, begin_time: now - 10 }] }),
    ]);
    assert.deepEqual(status.harvestable, [8]);
});

function growingPhases(now = Math.floor(Date.now() / 1000)) {
    return [
        { phase: PlantPhase.GERMINATION, begin_time: now - 10 },
        { phase: PlantPhase.MATURE, begin_time: now + 3600 },
    ];
}

test('getNormalFertilizerTargetsFromLands includes only growing lands with remaining normal fertilizer', () => {
    const now = Math.floor(Date.now() / 1000);
    const lands = [
        land(1, { id: MUSHROOM_ID, season: 2, left_inorc_fert_times: 1, phases: growingPhases(now) }),
        land(2, { id: MUSHROOM_ID, season: 2, phases: growingPhases(now) }),
        land(3, { id: MUSHROOM_ID, season: 2, left_inorc_fert_times: 0, phases: growingPhases(now) }),
        land(4, { id: MUSHROOM_ID, season: 2, left_inorc_fert_times: 1, phases: [{ phase: PlantPhase.DEAD, begin_time: now }] }),
        land(5, { id: RADISH_ID, season: 1, left_inorc_fert_times: 1, phases: [{ phase: PlantPhase.MATURE, begin_time: now - 10 }] }),
    ];
    assert.deepEqual(getNormalFertilizerTargetsFromLands(lands), [1]);
});

test('getOrganicFertilizerTargetsFromLands still includes lands with left_inorc_fert_times 0', () => {
    const now = Math.floor(Date.now() / 1000);
    const lands = [
        land(2, { id: MUSHROOM_ID, season: 2, left_inorc_fert_times: 0, phases: growingPhases(now) }),
        land(4, { id: MUSHROOM_ID, season: 2, left_inorc_fert_times: 1, phases: [{ phase: PlantPhase.DEAD, begin_time: now }] }),
    ];
    assert.deepEqual(getOrganicFertilizerTargetsFromLands(lands), [2]);
});

test('filterLandIdsForNormalFertilizer keeps unknown empties and drops exhausted growing lands', () => {
    const now = Math.floor(Date.now() / 1000);
    const lands = [
        land(1, { id: MUSHROOM_ID, season: 2, left_inorc_fert_times: 1, phases: growingPhases(now) }),
        land(2, { id: MUSHROOM_ID, season: 2, phases: growingPhases(now) }),
        land(3, null),
    ];
    assert.deepEqual(filterLandIdsForNormalFertilizer([1, 2, 3, 99], lands), [1, 3, 99]);
});
