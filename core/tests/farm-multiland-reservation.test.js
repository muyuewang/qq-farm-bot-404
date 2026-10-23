const assert = require('node:assert/strict');
const test = require('node:test');

const {
    clearRegisteredLayout,
    getRegisteredLayout,
    registerLayout,
    resetRegisteredLayouts,
    selectFutureLayoutReservation,
} = require('../dist/services/farm/layout-reservation');
const {
    DEFAULT_ACCOUNT_CONFIG,
    globalConfig,
    normalizeAccountConfig,
} = require('../dist/models/store/shared-state');
const {
    applyConfigSnapshot,
} = require('../dist/models/store/account-config');

test('keeps multi-land reservation opt-in by default', () => {
    assert.equal(DEFAULT_ACCOUNT_CONFIG.bagSeedMultiLandReservationEnabled, false);
    assert.equal(normalizeAccountConfig({}).bagSeedMultiLandReservationEnabled, false);
    assert.equal(normalizeAccountConfig({ bagSeedMultiLandReservationEnabled: true }).bagSeedMultiLandReservationEnabled, true);
});

test('round-trips the multi-land reservation account setting', () => {
    const accountId = '__multiland_reservation_test__';
    try {
        const enabled = applyConfigSnapshot(
            { bagSeedMultiLandReservationEnabled: true },
            { accountId, persist: false },
        );
        assert.equal(enabled.bagSeedMultiLandReservationEnabled, true);

        const disabled = applyConfigSnapshot(
            { bagSeedMultiLandReservationEnabled: false },
            { accountId, persist: false },
        );
        assert.equal(disabled.bagSeedMultiLandReservationEnabled, false);
    } finally {
        delete globalConfig.accountConfigs[accountId];
    }
});

test('reserves the earliest stable 2x2 layout for a priority seed', () => {
    const reservation = selectFutureLayoutReservation(
        [1, 2, 3],
        Array.from({ length: 15 }, (_, index) => index + 1),
        2,
    );

    assert.deepEqual(reservation, {
        layout: { anchorLandId: 5, landIds: [5, 6, 1, 2] },
        reservedLandIds: [1, 2],
    });
});

test('keeps accumulating empty lands in the selected future layout', () => {
    const reservation = selectFutureLayoutReservation(
        [1, 2, 5],
        Array.from({ length: 15 }, (_, index) => index + 1),
        2,
    );

    assert.deepEqual(reservation, {
        layout: { anchorLandId: 5, landIds: [5, 6, 1, 2] },
        reservedLandIds: [5, 1, 2],
    });
});

const ALL_24 = Array.from({ length: 24 }, (_, index) => index + 1);
const sorted = (ids) => [...ids].sort((a, b) => a - b);

test('prefers the fuller layout when nothing is registered yet', () => {
    const reservation = selectFutureLayoutReservation(
        [1, 3, 4, 7],
        Array.from({ length: 15 }, (_, index) => index + 1),
        2,
    );

    assert.equal(reservation.layout.anchorLandId, 7);
    assert.deepEqual(sorted(reservation.layout.landIds), [3, 4, 7, 8]);
    assert.deepEqual(sorted(reservation.reservedLandIds), [3, 4, 7]);
});

test('issue #89: a later-emptied land joins the reservation instead of being dropped', () => {
    const first = selectFutureLayoutReservation([3], ALL_24, 2);
    assert.deepEqual(first.reservedLandIds, [3]);

    // 上一轮选了锚点更小但同样只有 [3] 的布局；下一轮 4 号地也空了。
    const second = selectFutureLayoutReservation([3, 4], ALL_24, 2, { registered: first.layout });
    assert.equal(second.layout.anchorLandId, 7);
    assert.deepEqual(sorted(second.layout.landIds), [3, 4, 7, 8]);
    assert.deepEqual(sorted(second.reservedLandIds), [3, 4]);
});

test('keeps the registered layout when an alternative is not any fuller', () => {
    // 空地只有 [3] 时，锚点 6 与锚点 7 两组布局都只能预留 [3]，无登记时取锚点更小的 6。
    const unregistered = selectFutureLayoutReservation([3], ALL_24, 2);
    assert.equal(unregistered.layout.anchorLandId, 6);

    // 已登记的是锚点更大的那一组：格数相同时必须沿用，不能回切到小锚点。
    const registered = { anchorLandId: 7, landIds: [7, 8, 3, 4] };
    const sticky = selectFutureLayoutReservation([3], ALL_24, 2, { registered });
    assert.equal(sticky.layout.anchorLandId, 7);
    assert.deepEqual(sticky.reservedLandIds, [3]);
});

test('never switches to a less full layout than the registered one', () => {
    const registered = selectFutureLayoutReservation([3, 4], ALL_24, 2);
    const next = selectFutureLayoutReservation([3, 4, 9], ALL_24, 2, { registered: registered.layout });
    assert.ok(next.reservedLandIds.length >= registered.reservedLandIds.length);
});

test('skips candidate layouts that overlap lands claimed by another seed', () => {
    const base = selectFutureLayoutReservation([3, 4], ALL_24, 2);
    const claimed = base.layout.landIds;
    const other = selectFutureLayoutReservation([3, 4], ALL_24, 2, { excludeLandIds: claimed });
    if (other) {
        assert.equal(other.layout.landIds.some((id) => claimed.includes(id)), false);
    }
    assert.equal(
        selectFutureLayoutReservation([3, 4], ALL_24, 2, { excludeLandIds: ALL_24 }),
        null,
    );
});

test('registers, returns copies of and clears layouts per seed', () => {
    resetRegisteredLayouts();
    assert.equal(getRegisteredLayout(20001), null);
    const layout = { anchorLandId: 7, landIds: [7, 8, 3, 4] };
    registerLayout(20001, layout);
    const stored = getRegisteredLayout(20001);
    assert.deepEqual(stored, layout);
    stored.landIds.push(99);
    assert.deepEqual(getRegisteredLayout(20001), layout);
    assert.equal(getRegisteredLayout(20002), null);
    clearRegisteredLayout(20001);
    assert.equal(getRegisteredLayout(20001), null);
});

test('does not reserve when the multi-land layout is already plantable', () => {
    const reservation = selectFutureLayoutReservation(
        [1, 2, 5, 6],
        Array.from({ length: 15 }, (_, index) => index + 1),
        2,
    );

    assert.equal(reservation, null);
});

test('does not reserve single-land crops or impossible future layouts', () => {
    assert.equal(selectFutureLayoutReservation([1], [1, 2, 5, 6], 1), null);
    assert.equal(selectFutureLayoutReservation([1, 2, 3], [1, 2, 3, 4], 2), null);
});
