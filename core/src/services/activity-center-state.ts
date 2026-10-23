export {};

const crypto = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

const STATE_FILE_VERSION = 1;
const STATE_FILE_PREFIX = 'activity-center-state';

interface ActivityStateIdentity {
    seasonId: string;
    activityId: string;
    catalogVersion: number;
}

interface NoClaimableDayObservation {
    observedAt: string;
    serverTime: string;
}

interface ConstellationActivityState extends ActivityStateIdentity {
    confirmedOpenedNodeIds: string[];
    confirmedLitNodeIds: string[];
    noClaimableDays: Record<string, NoClaimableDayObservation>;
}

interface CharityRedFlowerState {
    activityId: string;
    initialized: boolean;
    claimedProgressTargets: string[];
    pendingProgressTargets: string[];
}

interface ActivityCenterStateFile {
    version: number;
    records: Record<string, ConstellationActivityState>;
    charityRecords: Record<string, CharityRedFlowerState>;
}

interface StateFileOptions {
    filePath?: string;
}

function normalizeId(value: unknown): string {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? text : '';
}

function normalizeCatalogVersion(value: unknown): number {
    const version = Number(value);
    return Number.isSafeInteger(version) && version > 0 ? version : 0;
}

function normalizeIdentity(identity: Partial<ActivityStateIdentity> | null | undefined): ActivityStateIdentity {
    return {
        seasonId: normalizeId(identity?.seasonId),
        activityId: normalizeId(identity?.activityId),
        catalogVersion: normalizeCatalogVersion(identity?.catalogVersion),
    };
}

function createEmptyConstellationState(identity: ActivityStateIdentity): ConstellationActivityState {
    return {
        ...normalizeIdentity(identity),
        confirmedOpenedNodeIds: [],
        confirmedLitNodeIds: [],
        noClaimableDays: {},
    };
}

function createEmptyCharityRedFlowerState(activityId: unknown): CharityRedFlowerState {
    return {
        activityId: normalizeId(activityId),
        initialized: false,
        claimedProgressTargets: [],
        pendingProgressTargets: [],
    };
}

function normalizeNodeIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(normalizeId).filter(Boolean))).sort((left, right) => {
        const leftValue = BigInt(left);
        const rightValue = BigInt(right);
        return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
}

function normalizeNoClaimableDays(value: unknown): Record<string, NoClaimableDayObservation> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized: Record<string, NoClaimableDayObservation> = {};
    for (const [rawDay, rawObservation] of Object.entries(value as Record<string, unknown>)) {
        const day = Number(rawDay);
        if (!Number.isSafeInteger(day) || day < 1 || day > 28) continue;
        if (!rawObservation || typeof rawObservation !== 'object' || Array.isArray(rawObservation)) continue;
        const observation = rawObservation as Record<string, unknown>;
        const observedAt = String(observation.observedAt ?? '').trim();
        const serverTime = normalizeId(observation.serverTime);
        if (!observedAt || !serverTime) continue;
        normalized[String(day)] = { observedAt, serverTime };
    }
    return normalized;
}

function normalizeConstellationState(
    value: unknown,
    identity: ActivityStateIdentity
): ConstellationActivityState {
    const expected = normalizeIdentity(identity);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createEmptyConstellationState(expected);
    }
    const source = value as Record<string, unknown>;
    const actual = normalizeIdentity(source as Partial<ActivityStateIdentity>);
    if (actual.seasonId !== expected.seasonId
        || actual.activityId !== expected.activityId
        || actual.catalogVersion !== expected.catalogVersion) {
        return createEmptyConstellationState(expected);
    }
    return {
        ...expected,
        confirmedOpenedNodeIds: normalizeNodeIds(source.confirmedOpenedNodeIds),
        confirmedLitNodeIds: normalizeNodeIds(source.confirmedLitNodeIds),
        noClaimableDays: normalizeNoClaimableDays(source.noClaimableDays),
    };
}

function normalizeCharityRedFlowerState(
    value: unknown,
    activityId: unknown
): CharityRedFlowerState {
    const expectedActivityId = normalizeId(activityId);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createEmptyCharityRedFlowerState(expectedActivityId);
    }
    const source = value as Record<string, unknown>;
    if (normalizeId(source.activityId) !== expectedActivityId) {
        return createEmptyCharityRedFlowerState(expectedActivityId);
    }
    const claimedProgressTargets = normalizeNodeIds(source.claimedProgressTargets);
    const claimedSet = new Set(claimedProgressTargets);
    return {
        activityId: expectedActivityId,
        initialized: source.initialized === true,
        claimedProgressTargets,
        pendingProgressTargets: normalizeNodeIds(source.pendingProgressTargets)
            .filter(target => !claimedSet.has(target)),
    };
}

function mergeConstellationStates(
    identity: ActivityStateIdentity,
    ...states: unknown[]
): ConstellationActivityState {
    const expected = normalizeIdentity(identity);
    const opened = new Set<string>();
    const lit = new Set<string>();
    const noClaimableDays: Record<string, NoClaimableDayObservation> = {};

    for (const stateValue of states) {
        const state = normalizeConstellationState(stateValue, expected);
        state.confirmedOpenedNodeIds.forEach(id => opened.add(id));
        state.confirmedLitNodeIds.forEach((id) => {
            lit.add(id);
            opened.add(id);
        });
        for (const [day, observation] of Object.entries(state.noClaimableDays)) {
            const existing = noClaimableDays[day];
            if (!existing || BigInt(observation.serverTime) >= BigInt(existing.serverTime)) {
                noClaimableDays[day] = observation;
            }
        }
    }

    return {
        ...expected,
        confirmedOpenedNodeIds: normalizeNodeIds(Array.from(opened)),
        confirmedLitNodeIds: normalizeNodeIds(Array.from(lit)),
        noClaimableDays,
    };
}

function mergeCharityRedFlowerStates(
    activityId: unknown,
    ...states: unknown[]
): CharityRedFlowerState {
    const expectedActivityId = normalizeId(activityId);
    const claimed = new Set<string>();
    const pending = new Set<string>();
    let initialized = false;

    for (const stateValue of states) {
        const state = normalizeCharityRedFlowerState(stateValue, expectedActivityId);
        initialized ||= state.initialized;
        state.claimedProgressTargets.forEach(target => claimed.add(target));
        state.pendingProgressTargets.forEach(target => pending.add(target));
    }
    claimed.forEach(target => pending.delete(target));

    return {
        activityId: expectedActivityId,
        initialized,
        claimedProgressTargets: normalizeNodeIds(Array.from(claimed)),
        pendingProgressTargets: normalizeNodeIds(Array.from(pending)),
    };
}

function stateRecordKey(identity: ActivityStateIdentity): string {
    const normalized = normalizeIdentity(identity);
    return `${normalized.seasonId}:${normalized.activityId}:v${normalized.catalogVersion}`;
}

function resolveAccountId(accountId?: string): string {
    return String(accountId ?? process.env.FARM_ACCOUNT_ID ?? '').trim() || 'default';
}

function safeAccountFileToken(accountId?: string): string {
    return crypto.createHash('sha256').update(resolveAccountId(accountId), 'utf8').digest('hex');
}

function getActivityCenterStateFile(accountId?: string, options: StateFileOptions = {}): string {
    if (options.filePath) return options.filePath;
    return getDataFile(`${STATE_FILE_PREFIX}-${safeAccountFileToken(accountId)}.json`);
}

function emptyStateFile(): ActivityCenterStateFile {
    return { version: STATE_FILE_VERSION, records: {}, charityRecords: {} };
}

function normalizeStateFile(value: unknown): ActivityCenterStateFile {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyStateFile();
    const source = value as Record<string, unknown>;
    if (Number(source.version) !== STATE_FILE_VERSION
        || !source.records
        || typeof source.records !== 'object'
        || Array.isArray(source.records)) {
        return emptyStateFile();
    }
    return {
        version: STATE_FILE_VERSION,
        records: source.records as Record<string, ConstellationActivityState>,
        charityRecords: source.charityRecords && typeof source.charityRecords === 'object' && !Array.isArray(source.charityRecords)
            ? source.charityRecords as Record<string, CharityRedFlowerState>
            : {},
    };
}

function loadConstellationState(
    identity: ActivityStateIdentity,
    accountId?: string,
    options: StateFileOptions = {}
): ConstellationActivityState {
    const file = normalizeStateFile(readJsonFile(
        getActivityCenterStateFile(accountId, options),
        emptyStateFile
    ));
    return normalizeConstellationState(file.records[stateRecordKey(identity)], identity);
}

function persistConstellationState(
    stateValue: unknown,
    identity: ActivityStateIdentity,
    accountId?: string,
    options: StateFileOptions = {}
): ConstellationActivityState {
    const filePath = getActivityCenterStateFile(accountId, options);
    const file = normalizeStateFile(readJsonFile(filePath, emptyStateFile));
    const key = stateRecordKey(identity);
    const merged = mergeConstellationStates(identity, file.records[key], stateValue);
    // 读-并-写在同一 worker 的串行 mutation 队列内调用；writeJsonFileAtomic 保证文件替换原子性。
    file.records[key] = merged;
    writeJsonFileAtomic(filePath, file);
    return merged;
}

function loadCharityRedFlowerState(
    activityId: unknown,
    accountId?: string,
    options: StateFileOptions = {}
): CharityRedFlowerState {
    const normalizedActivityId = normalizeId(activityId);
    const file = normalizeStateFile(readJsonFile(
        getActivityCenterStateFile(accountId, options),
        emptyStateFile
    ));
    return normalizeCharityRedFlowerState(file.charityRecords[normalizedActivityId], normalizedActivityId);
}

function persistCharityRedFlowerState(
    stateValue: unknown,
    activityId: unknown,
    accountId?: string,
    options: StateFileOptions = {}
): CharityRedFlowerState {
    const normalizedActivityId = normalizeId(activityId);
    const filePath = getActivityCenterStateFile(accountId, options);
    const file = normalizeStateFile(readJsonFile(filePath, emptyStateFile));
    const merged = mergeCharityRedFlowerStates(
        normalizedActivityId,
        file.charityRecords[normalizedActivityId],
        stateValue
    );
    file.charityRecords[normalizedActivityId] = merged;
    writeJsonFileAtomic(filePath, file);
    return merged;
}

function stateFromDynamicNodes(identity: ActivityStateIdentity, nodes: unknown): ConstellationActivityState {
    const opened: string[] = [];
    const lit: string[] = [];
    if (Array.isArray(nodes)) {
        for (const node of nodes) {
            const id = normalizeId(node?.node_id ?? node?.nodeId ?? node?.id);
            if (!id) continue;
            if (node?.field_2 === true || node?.field2 === true) opened.push(id);
            if (node?.field_3 === true || node?.field3 === true) {
                opened.push(id);
                lit.push(id);
            }
        }
    }
    return mergeConstellationStates(identity, {
        ...normalizeIdentity(identity),
        confirmedOpenedNodeIds: opened,
        confirmedLitNodeIds: lit,
        noClaimableDays: {},
    });
}

function stateWithNoClaimableDay(
    identity: ActivityStateIdentity,
    day: number,
    serverTime: string,
    observedAt = new Date().toISOString()
): ConstellationActivityState {
    const normalizedDay = Number(day);
    const dayState = createEmptyConstellationState(identity);
    if (Number.isSafeInteger(normalizedDay) && normalizedDay >= 1 && normalizedDay <= 28) {
        dayState.noClaimableDays[String(normalizedDay)] = {
            observedAt: String(observedAt),
            serverTime: normalizeId(serverTime),
        };
    }
    return normalizeConstellationState(dayState, identity);
}

module.exports = {
    STATE_FILE_VERSION,
    createEmptyConstellationState,
    createEmptyCharityRedFlowerState,
    normalizeConstellationState,
    normalizeCharityRedFlowerState,
    mergeConstellationStates,
    mergeCharityRedFlowerStates,
    stateRecordKey,
    safeAccountFileToken,
    getActivityCenterStateFile,
    loadConstellationState,
    persistConstellationState,
    loadCharityRedFlowerState,
    persistCharityRedFlowerState,
    stateFromDynamicNodes,
    stateWithNoClaimableDay,
};
