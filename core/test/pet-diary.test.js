/**
 * 萌宠成长日记（S3）后端测试
 *
 * 覆盖：协议编码契约、钻石防护、限额与前置校验、素材路径、节令适配。
 * 全部使用夹具，不连真实服务端。
 */
const assert = require('node:assert');
const test = require('node:test');

const { loadProto, types } = require('../src/utils/proto');
const helpers = require('../src/services/activity-center-helpers');
const { createPetDiaryService, OPERATIONS, GROUP_ID, PET_ID } = require('../src/services/activity-pet-diary');

const catalog = require('../src/activity-data/pet-diary-2026090101.json');
const base = catalog.ActivityPetTreasureHuntBase[0];

test.before(async () => { await loadProto(); });

// ---- 协议契约 ----

test('GetGroup 请求必须编码出非空 group id', async () => {
    // 本地 GetGroupRequest 字段名为 id，上游为 group_id。若误用上游字段名，
    // protobufjs 会静默丢弃未知字段并产出空请求体，服务端将拒绝或返回错活动。
    const request = types.ActivityGetGroupRequest.fromObject({ id: GROUP_ID });
    const encoded = Buffer.from(types.ActivityGetGroupRequest.encode(request).finish());
    assert.ok(encoded.length > 0, 'GetGroup 请求体不得为空');
    assert.strictEqual(encoded[0], 0x08, '字段 1 应为 varint');

    const wrong = types.ActivityGetGroupRequest.fromObject({ group_id: GROUP_ID });
    const wrongEncoded = Buffer.from(types.ActivityGetGroupRequest.encode(wrong).finish());
    assert.strictEqual(wrongEncoded.length, 0, '上游字段名在本地应编码为空（回归哨兵）');
});

test('Operate 请求按命令字编码，且响应选择器可解析', () => {
    for (const [action, [command, selector]] of Object.entries(OPERATIONS)) {
        const request = types.PetDiaryOperateRequest.fromObject({
            activity_id: PET_ID,
            operate_type: command,
        });
        const encoded = Buffer.from(types.PetDiaryOperateRequest.encode(request).finish());
        assert.ok(encoded.length > 0, `${action} 请求体不得为空`);

        const decoded = types.PetDiaryOperateRequest.decode(encoded);
        assert.strictEqual(String(decoded.activity_id), PET_ID, `${action} 活动 ID 往返不一致`);
        assert.strictEqual(Number(decoded.operate_type), command, `${action} 命令字往返不一致`);

        assert.ok(
            types.PetDiaryOperateReply.fields[selector],
            `${action} 的响应选择器 ${selector} 不存在于 PetDiaryOperateReply`,
        );
    }
});

test('命令字与响应字段号保持 +100 关系（官方编码器规律）', () => {
    const exempt = new Set(['seeds']); // mega_event_claim_all 为 21 → 120，不遵循该规律
    for (const [action, [command, selector]] of Object.entries(OPERATIONS)) {
        if (exempt.has(action)) continue;
        const field = types.PetDiaryOperateReply.fields[selector];
        assert.strictEqual(field.id, command + 100, `${action} 字段号应为命令字 +100`);
    }
});

// ---- 依赖注入与夹具 ----

function buildService(overrides = {}) {
    const bag = overrides.bag ?? new Map([['1028', '99999'], ['1002', '9999']]);
    const sent = [];
    const service = createPetDiaryService({
        types,
        sendMsgAsync: async (svc, method, body) => {
            sent.push({ svc, method, body });
            return overrides.reply ? overrides.reply(svc, method, body) : { body: Buffer.alloc(0) };
        },
        getBag: async () => ({}),
        getBagItems: () => [...bag].map(([id, count]) => ({ id, count })),
        getServerTimeSec: () => overrides.now ?? 1757500000,
        itemDto: helpers.itemDto,
        int64String: helpers.int64String,
        int64Number: helpers.int64Number,
        textContent: helpers.textContent,
        businessError: helpers.businessError,
        positiveDecimal: helpers.positiveDecimal,
        serializeMutation: helpers.serializeMutation,
        getCurrentSolarTerms: async () => overrides.solar ?? { terms: [] },
        claimSolarTerm: async () => ({ rewards: [] }),
    });
    return { service, sent, bag };
}

// ---- 钻石防护 ----

test('normalize 拒绝将含钻石成本的商品标记为可兑换', () => {
    const { service } = buildService();
    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: { nurture: { stage: 2 }, hunt: {}, battle: {} },
            },
            shop: {
                head: { id: '2026090103', start_time: 1757000000, end_time: 1760000000 },
                shop: {
                    goods: [
                        { id: '1', name: '钻石商品', cost: [{ id: '1004', count: '1' }], item: [], purchase_limit: '0', purchased_count: '0' },
                        { id: '2', name: '钻石计数商品', cost: [{ id: '1029', count: '1' }], diamond_cost_count: 5, item: [], purchase_limit: '0', purchased_count: '0' },
                        { id: '3', name: '幸运星商品', cost: [{ id: '1029', count: '1' }], item: [], purchase_limit: '0', purchased_count: '0' },
                    ],
                },
            },
        },
        new Map([['1029', '10000']]),
    );

    const byId = Object.fromEntries(snapshot.shop.map(g => [g.id, g]));
    assert.strictEqual(byId['1'].safeCosts, false, '钻石成本商品不应视为安全');
    assert.strictEqual(byId['1'].exchangeable, false, '钻石成本商品不可兑换');
    assert.strictEqual(byId['2'].safeCosts, false, 'diamond_cost_count > 0 不应视为安全');
    assert.strictEqual(byId['2'].exchangeable, false, 'diamond_cost_count > 0 不可兑换');
    assert.strictEqual(byId['3'].exchangeable, true, '幸运星商品余额充足应可兑换');
});

test('锦囊付费刷新在点券不足时不回退钻石', () => {
    const { service } = buildService({ bag: new Map([['1002', '0']]) });
    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: {
                    nurture: { stage: 2 },
                    hunt: {},
                    battle: { charm_free_refresh_count: 1, charm_paid_refresh_count: 0 },
                },
            },
        },
        new Map([['1002', '0']]),
    );
    assert.strictEqual(snapshot.charms.freeRefreshRemaining, 0, '免费次数应已用完');
    assert.strictEqual(snapshot.charms.canRefresh, false, '点券不足时不得标记为可刷新');
});

// ---- 限额与阶段 ----

test('限额取自官方配置而非硬编码', () => {
    assert.strictEqual(base.daily_feed_limit, 16);
    assert.strictEqual(base.daily_treasure_limit, 10);
    assert.strictEqual(base.growth_adult_threshold, 7000);
    assert.strictEqual(base.growth_per_feed, 700);
    // 成年需要的投喂次数必须不超过每日上限，否则首日无法成年
    assert.ok(
        base.growth_adult_threshold / base.growth_per_feed <= base.daily_feed_limit,
        '成年所需投喂次数不应超过每日上限',
    );
});

test('幼犬阶段不可寻宝、成年阶段不可投喂', () => {
    const { service } = buildService();
    const build = stage => service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: {
                    nurture: { stage, cg_played: true },
                    hunt: { treasure_cost: [{ id: '1028', count: '700' }], can_play_plunder: true },
                    battle: {},
                    feed: { feed_count: 0 },
                },
            },
        },
        new Map([['1028', '99999']]),
    );

    const puppy = build(1);
    assert.strictEqual(puppy.nurture.canFeed, true, '幼犬阶段应可投喂');
    assert.strictEqual(puppy.hunt.canDraw, false, '幼犬阶段不应可寻宝');

    const adult = build(2);
    assert.strictEqual(adult.nurture.canFeed, false, '成年阶段不应可投喂');
    assert.strictEqual(adult.hunt.canDraw, true, '成年阶段应可寻宝');
});

test('达到每日限额后关闭对应动作', () => {
    const { service } = buildService();
    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: {
                    nurture: { stage: 1, cg_played: true },
                    feed: { feed_count: base.daily_feed_limit },
                    hunt: {},
                    battle: {},
                },
            },
        },
        new Map([['1028', '99999']]),
    );
    assert.strictEqual(snapshot.nurture.canFeed, false, '投喂次数用尽后不得可投喂');
    assert.strictEqual(snapshot.nurture.feedCount, base.daily_feed_limit);
});

// ---- 活动有效期 ----

test('活动未开始或已结束时全部动作关闭', () => {
    const group = now => ({
        pet: {
            head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
            pet_treasure_hunt: {
                nurture: { stage: 2, cg_played: true },
                hunt: { treasure_cost: [{ id: '1028', count: '700' }], can_play_plunder: true },
                battle: { charm_daily_pool: [1] },
                feed: { feed_count: 0 },
            },
        },
    });
    const bag = new Map([['1028', '99999'], ['1002', '9999']]);

    for (const [label, now] of [['未开始', 1756000000], ['已结束', 1761000000]]) {
        const { service } = buildService({ now });
        const snapshot = service.normalize(group(now), bag);
        assert.strictEqual(snapshot.active, false, `${label} 时 active 应为 false`);
        assert.strictEqual(snapshot.hunt.canDraw, false, `${label} 时不得可寻宝`);
        assert.strictEqual(snapshot.nurture.canFeed, false, `${label} 时不得可投喂`);
        assert.strictEqual(snapshot.hunt.canPlunder, false, `${label} 时不得可夺宝`);
        assert.strictEqual(snapshot.charms.canRefresh, false, `${label} 时不得可刷新锦囊`);
        assert.strictEqual(snapshot.charms.canChoose, false, `${label} 时不得可选锦囊`);
    }
});

test('活动边界时刻按服务端时间判定为有效', () => {
    const group = {
        pet: {
            head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
            pet_treasure_hunt: { nurture: { stage: 2 }, hunt: {}, battle: {} },
        },
    };
    for (const now of [1757000000, 1760000000]) {
        const { service } = buildService({ now });
        assert.strictEqual(service.normalize(group, new Map()).active, true, `边界 ${now} 应视为有效`);
    }
});

// ---- 素材与物品 ----

test('素材路径使用本地 /activity/pet-diary/ 前缀', () => {
    const assets = require('../src/activity-data/pet-diary-assets.json');
    const { service } = buildService();
    const withIcon = catalog.ActivityPetTreasureHuntCharm.find(c => c.icon_path);
    if (!withIcon) return;

    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: { nurture: { stage: 2 }, hunt: {}, battle: {} },
            },
        },
        new Map(),
    );
    const charm = snapshot.charms.all.find(c => c.id === withIcon.charm_id);
    if (charm?.image) {
        assert.ok(
            charm.image.startsWith('/activity/pet-diary/'),
            `锦囊图标应使用本地前缀，实际为 ${charm.image}`,
        );
        assert.ok(!charm.image.includes('activity-assets'), '不应残留上游 activity-assets 前缀');
    }
    assert.strictEqual(assets.length, 129, '精简后的素材映射表条目数应为 129');
});

test('活动物品名称已进入统一配置，不出现未知物品', () => {
    const { getItemById } = require('../src/config/gameConfig');
    const expected = { 1028: '萌宠元气糕', 1029: '幸运星', 1030: '待护送宝藏' };
    for (const [id, name] of Object.entries(expected)) {
        const item = getItemById(Number(id));
        assert.ok(item, `物品 ${id} 应存在于 ItemInfo`);
        assert.strictEqual(item.name, name, `物品 ${id} 名称应为 ${name}`);
        assert.ok(helpers.itemDto({ item_id: Number(id), count: 1 }).image, `物品 ${id} 应有图标`);
    }
});

// ---- 入参校验 ----

test('非法操作与非法入参被拒绝', async () => {
    const { service } = buildService();
    await assert.rejects(() => service.operatePetDiary('unknownAction'), /未知萌宠操作/);
    await assert.rejects(() => service.operatePetDiary(123), /未知萌宠操作/);
    await assert.rejects(() => service.getPetDiaryRecords('other'), /未知记录类型/);
    await assert.rejects(() => service.getPetDiaryFriend('0'), /正十进制整数/);
    await assert.rejects(() => service.getPetDiaryFriend(-1), /正十进制整数/);
    await assert.rejects(() => service.getPetDiaryFriend('abc'), /正十进制整数/);
});

// ---- 节令适配 ----

test('节令按活动时间窗过滤，并使用适配后的 canClaim', () => {
    const { service } = buildService();
    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: { nurture: { stage: 2 }, hunt: {}, battle: {} },
            },
        },
        new Map(),
        {
            terms: [
                { id: '1', startTime: 1750000000, endTime: 1752000000, canClaim: true },  // 活动前，应过滤
                { id: '2', startTime: 1757500000, endTime: 1758000000, canClaim: true },  // 窗口内，保留
                { id: '3', startTime: 1770000000, endTime: 1772000000, canClaim: false }, // 活动后，应过滤
            ],
        },
    );
    assert.deepStrictEqual(snapshot.solarTerms.terms.map(t => t.id), ['2'], '仅保留与活动时间窗重叠的节令');
});

test('节令读取失败时降级为 warning 而非整体失败', () => {
    const { service } = buildService();
    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: { nurture: { stage: 2 }, hunt: {}, battle: {} },
            },
        },
        new Map(),
        null,
        ['节令小礼读取失败，请稍后刷新'],
    );
    assert.strictEqual(snapshot.solarTerms, null);
    assert.ok(snapshot.warnings.includes('节令小礼读取失败，请稍后刷新'));
    assert.strictEqual(snapshot.active, true, '子模块失败不应影响主状态');
});

// ---- 背包未知时的降级 ----

test('背包读取失败时余额标记为未知且消耗类动作关闭', () => {
    const { service } = buildService();
    const snapshot = service.normalize(
        {
            pet: {
                head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
                pet_treasure_hunt: {
                    nurture: { stage: 1, cg_played: true },
                    feed: { feed_count: 0 },
                    hunt: { treasure_cost: [{ id: '1028', count: '700' }] },
                    battle: {},
                },
            },
        },
        null,
        null,
        ['背包读取失败，消耗资源的操作已暂停'],
    );
    assert.ok(snapshot.balances.every(b => b.known === false), '余额应全部标记未知');
    assert.strictEqual(snapshot.nurture.canFeed, false, '背包未知时不得可投喂');
    assert.strictEqual(snapshot.hunt.canDraw, false, '背包未知时不得可寻宝');
});

function battleService({ canStart = true, count = 0, books = '2', shouldContinue } = {}) {
    let writes = 0;
    const group = { group: { head: { id: GROUP_ID }, children: [{
        head: { id: PET_ID, start_time: 1757000000, end_time: 1760000000 },
        pet_treasure_hunt: { nurture: { stage: 2 }, hunt: { can_play_plunder: true }, battle: { battle_count: count } },
    }] } };
    const { service } = buildService({ bag: new Map([['80103', books]]), reply: async (svc, method, body) => {
        if (method === 'GetGroup') return { body: types.PetDiaryGetGroupReply.encode(types.PetDiaryGetGroupReply.fromObject(group)).finish() };
        const req = types.PetDiaryOperateRequest.decode(body);
        let payload;
        if (Number(req.operate_type) === 47) payload = { pet_treasure_hunt_get_friend_activity_info: { gid: '123', info: {
            treasures: [{ id: 'treasure', status: 2, end_at: 1760000000,
                battle_previews: [{ challenge_item_id: '80103', can_start: canStart }] }],
        } } };
        else {
            assert.equal(Number(req.operate_type), 43);
            assert.equal(String(req.pet_treasure_hunt_start_battle.challenge_item_id), '80103');
            writes++; payload = { pet_treasure_hunt_start_battle: { won: true } };
        }
        return { body: types.PetDiaryOperateReply.encode(types.PetDiaryOperateReply.fromObject({ activity_id: PET_ID, operate_type: req.operate_type, ...payload })).finish() };
    } });
    return { run: () => service.operatePetDiary('battle', { gid: '123', treasureId: 'treasure', challengeId: '80103' },
        shouldContinue ? { shouldContinue } : {}), writes: () => writes };
}

test('shared battle action revalidates preview, daily limit, inventory and cancellation', async () => {
    for (const options of [{ canStart: false }, { count: 20 }, { books: '0' }, { shouldContinue: () => false }]) {
        const f = battleService(options);
        await assert.rejects(f.run()); assert.equal(f.writes(), 0);
    }
    const f = battleService();
    const result = await f.run(); assert.equal(f.writes(), 1); assert.ok(result.snapshot);
});
