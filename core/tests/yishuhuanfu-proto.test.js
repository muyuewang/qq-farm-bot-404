const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

// int64 字段解出来是 Long 对象，直接 Number() 会得到 NaN。
function int64(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Number(value);
}

async function loadRoot() {
    const root = new protobuf.Root();
    await root.load([
        path.join(__dirname, '../src/proto/activitypb.proto'),
        path.join(__dirname, '../src/proto/corepb.proto'),
    ], { keepCase: true });
    return root;
}

// 以下期望值全部来自 2026-11-25 两轮实机抓包（gate-obt HAR），均已做
// decode → encode → 字节比较的往返校验。
test('yishuhuanfu requests reproduce the capture-verified envelopes', async () => {
    const root = await loadRoot();
    const encode = (type, payload) => {
        const T = root.lookupType('gamepb.activitypb.' + type);
        return Buffer.from(T.encode(T.create({ activity_id: '2026111708', ...payload })).finish()).toString('hex');
    };

    // cmd 91 领每日红薯种子
    assert.equal(encode('YshfClaimSeedRequest', { cmd: 91, params: {} }), '08dc8590c607105bfa0b00');
    // cmd 92 查铺子行情（只读，不成交）：查自己的铺子 1000232619
    assert.equal(
        encode('YshfShopQueryRequest', { cmd: 92, params: { shop_gid: '1000232619' } }),
        '08dc8590c607105c820c0608abadf9dc03',
    );
    // cmd 93 卖薯：卖给自己的铺子 480 个
    assert.equal(
        encode('YshfSellRequest', { cmd: 93, params: { shop_gid: '1000232619', count: 480 } }),
        '08dc8590c607105d8a0c0908abadf9dc0310e003',
    );
    // cmd 95 收购记录列表（旧注释误写成“刷新行情”，实际回包是记录）
    assert.equal(encode('YshfRecordRequest', { cmd: 95, params: {} }), '08dc8590c607105f9a0c00');
    // cmd 96 兑换下单：第 10 档 1 件
    assert.equal(
        encode('YshfExchangeRequest', { cmd: 96, params: { index: 10, count: 1 } }),
        '08dc8590c6071060a20c04080a1001',
    );
    // cmd 97 查兑换目录
    assert.equal(encode('YshfCatalogRequest', { cmd: 97, params: {} }), '08dc8590c6071061aa0c00');
    // cmd 98 分享铺子
    assert.equal(encode('YshfShareRequest', { cmd: 98, params: {} }), '08dc8590c6071062b20c00');
});

test('yishuhuanfu state slot 130 decodes the verified snapshots', async () => {
    const root = await loadRoot();
    const State = root.lookupType('gamepb.activitypb.YshfState');

    // 未领种子、未分享：claims 与 share 都是空子消息（0a00 / 1200），
    // 说明 130.1 不是“参与/初始化标记”，而是今日领取标记。
    const early = State.decode(Buffer.from('0a001200220408011801286138904e', 'hex'));
    assert.equal(early.claims.seed_claimed, false);
    assert.equal(early.claims.share_claimed, false);
    assert.equal(int64(early.actions.field_1), 1);
    assert.equal(int64(early.actions.field_3), 1);
    assert.equal(int64(early.base_price), 97);
    assert.equal(int64(early.capacity), 10000);

    // 领过种子并分享过的当天：claims 两个都在，share 里带暴击加成与分享时间。
    const settled = State.decode(Buffer.from('0a0408011001120c0821100118f99099d8062001220210012861302138da68', 'hex'));
    assert.equal(settled.claims.seed_claimed, true);
    assert.equal(settled.claims.share_claimed, true);
    assert.equal(int64(settled.share.bonus), 33);
    assert.equal(int64(settled.share.timestamp), 1795573881);
    assert.equal(int64(settled.base_price), 97);
    assert.equal(int64(settled.bonus_price), 33);
    assert.equal(int64(settled.actions.field_2), 1);
});

test('yishuhuanfu state carries the luck coin balance after selling', async () => {
    const root = await loadRoot();
    const State = root.lookupType('gamepb.activitypb.YshfState');

    // 卖出 480 个蜜薯后状态槽新增 field 3 = 69120，随后两次兑换依次扣减。
    const cases = [
        ['0a0408011001120c0821100118b19699d806200118809c0422021001286f302138ac65', 69120],
        ['0a0408011001120c0821100118b19699d806200118a8e50322021001286f302138ac65', 62120],
        ['0a0408011001120c0821100118b19699d806200118f0d30122021001286f302138ac65', 27120],
    ];
    for (const [hex, expected] of cases) {
        const state = State.decode(Buffer.from(hex, 'hex'));
        assert.equal(int64(state.luck_coin), expected);
        // 三段状态的构成稳定不变：基础价 111 + 暴击 33 = 144，只有余额在动。
        assert.equal(int64(state.base_price), 111);
        assert.equal(int64(state.bonus_price), 33);
        assert.equal(int64(state.share.bonus), 33);
    }
});

test('yishuhuanfu operate replies decode the verified result slots', async () => {
    const root = await loadRoot();
    const Reply = root.lookupType('gamepb.activitypb.ActivityOperateReply');

    // cmd 91：领到 28 个红薯种子（item 20307）
    const claim = Reply.decode(Buffer.from('08dc8590c607105bfa0b080a0608d39e01101c', 'hex'));
    assert.equal(int64(claim.operate_type), 91);
    assert.equal(int64(claim.yshf_claim_seed.grant.item_id), 20307);
    assert.equal(int64(claim.yshf_claim_seed.grant.count), 28);

    // cmd 92：查自己铺子，基础价 111 + 暴击加成 33 = 144，每日接收额度 8000、铺主 1000232619
    const shop = Reply.decode(Buffer.from(
        '08dc8590c607105c820ca9010aa401086f102118c03e229a0108abadf9dc031206e6b290e69c881a860168747470733a2f2f746869726477782e716c6f676f2e636e2f6d6d6f70656e2f76695f33322f51306a345477475466544c6963567557324d546c31415837687335323870774b735649636962556963745957696373384a335374486a5135707531626b585a5138755869634c58596671586a7056314d584f76526961714b4a4c58672f313332208f011001',
        'hex',
    ));
    assert.equal(int64(shop.operate_type), 92);
    assert.equal(int64(shop.yshf_shop.quote.base_price), 111);
    assert.equal(int64(shop.yshf_shop.quote.bonus_price), 33);
    assert.equal(int64(shop.yshf_shop.quote.quota), 8000);
    // 与状态槽 130.5 / 130.6 同源：111 + 33 = 144，正是 cmd 93 的成交单价。
    assert.equal(
        int64(shop.yshf_shop.quote.base_price) + int64(shop.yshf_shop.quote.bonus_price),
        144,
    );
    assert.equal(int64(shop.yshf_shop.quote.shop.gid), 1000232619);
    assert.equal(shop.yshf_shop.quote.shop.name, '沐月');
    assert.equal(int64(shop.yshf_shop.quote.shop.level), 143);
    // 回包字段 2 = can_sell：这次是卖自己的铺子且成交成功，该字段为 1（true）。
    assert.equal(shop.yshf_shop.can_sell, true);

    // cmd 93：卖给自己 480 个，单价 144，共得 69120，额度 8000，余额 69120
    const sell = Reply.decode(Buffer.from('08dc8590c607105d8a0c1108e00310900118809c0420c03e28809c04', 'hex'));
    assert.equal(int64(sell.operate_type), 93);
    assert.equal(int64(sell.yshf_sell.count), 480);
    assert.equal(int64(sell.yshf_sell.price), 144);
    assert.equal(int64(sell.yshf_sell.total), 69120);
    assert.equal(int64(sell.yshf_sell.quota), 8000);
    assert.equal(int64(sell.yshf_sell.balance), 69120);
    // 成交总额必须等于单价 × 数量，否则说明字段位挪过。
    assert.equal(int64(sell.yshf_sell.total), int64(sell.yshf_sell.price) * int64(sell.yshf_sell.count));

    // cmd 96：第 10 档 7000 福气币换 1 个化肥（item 80001），余 62120
    const exchange = Reply.decode(Buffer.from(
        '08dc8590c6071060a20c2408d83612170881f1041001188092b8c398feffffff013085bc01380118a8e50320012801',
        'hex',
    ));
    assert.equal(int64(exchange.operate_type), 96);
    assert.equal(int64(exchange.yshf_exchange.price), 7000);
    assert.equal(int64(exchange.yshf_exchange.grant.item_id), 80001);
    assert.equal(int64(exchange.yshf_exchange.grant.count), 1);
    assert.equal(int64(exchange.yshf_exchange.balance), 62120);

    // cmd 96：第 9 档 35000 福气币换 1 个萌宠种子礼包（item 101623），余 27120
    const exchange9 = Reply.decode(Buffer.from(
        '08dc8590c6071060a20c2508b89102121708f799061001188092b8c398feffffff01308cbc01380118f0d30120012801',
        'hex',
    ));
    assert.equal(int64(exchange9.yshf_exchange.price), 35000);
    assert.equal(int64(exchange9.yshf_exchange.grant.item_id), 101623);
    assert.equal(int64(exchange9.yshf_exchange.balance), 27120);

    // cmd 98：分享给 4 个种子。2 号位是 32 位邀请码（与 GetShareKey 同源），
    // 不是分享卡片里的 UUID 标识——这一点在 2026-11-28 的抓包里被纠正。
    const share = Reply.decode(Buffer.from(
        '08dc8590c6071062b20c6e0a0608d39e0110041021188201225a08f9d6ffc504122034323136393435366334623934386539613532613338336537303865636433311a20333335413841313034343335313044323139444538383436364135453833463220022a0c08dc8590c60710f9d6ffc50428da683001',
        'hex',
    ));
    assert.equal(int64(share.operate_type), 98);
    assert.equal(int64(share.yshf_share.grant.item_id), 20307);
    assert.equal(int64(share.yshf_share.grant.count), 4);
    assert.equal(int64(share.yshf_share.price), 33);
    assert.equal(share.yshf_share.shop.invite_key, '42169456c4b948e9a52a383e708ecd31');
});

test('yishuhuanfu catalog decodes all ten price tiers', async () => {
    const root = await loadRoot();
    const Reply = root.lookupType('gamepb.activitypb.ActivityOperateReply');
    const reply = Reply.decode(Buffer.from(
        '08dc8590c6071061aa0c760a0a080110c0843d180220010a0a080210e0d4031802201c0a0a080310c0b802180220280a0a080410c0b802180220280a09080510b442180220320a0a080610e0da011802200a0a0a080710e0da011802200a0a0a080810e0da011802200a0a0a080910b891021802200a0a09080a10d83618022032',
        'hex',
    ));
    const goods = reply.yshf_catalog.goods;
    assert.equal(goods.length, 10);
    assert.deepEqual(goods.map(entry => int64(entry.price)), [
        1000000, 60000, 40000, 40000, 8500, 28000, 28000, 28000, 35000, 7000,
    ]);
    assert.deepEqual(goods.map(entry => int64(entry.limit)), [1, 28, 40, 40, 50, 10, 10, 10, 10, 50]);
    assert.ok(goods.every(entry => int64(entry.status) === 2));
});

test('yishuhuanfu catalog marks exchanged tiers after a purchase', async () => {
    const root = await loadRoot();
    const Reply = root.lookupType('gamepb.activitypb.ActivityOperateReply');
    // 兑换第 9、10 档之后重新拉目录：这两档带上了累计已兑次数 exchanged，且目录尾部带上了余额。
    const reply = Reply.decode(Buffer.from(
        '08dc8590c6071061aa0c86010a0a080110c0843d180220010a0a080210e0d4031802201c0a0a080310c0b802180220280a0a080410c0b802180220280a0b080510b4421802203238010a0a080610e0da011802200a0a0a080710e0da011802200a0a0a080810e0da011802200a0a0e080910b891021802200a280130010a0f080a10d8361802203228013001380110f0d301',
        'hex',
    ));
    const goods = reply.yshf_catalog.goods;
    assert.equal(goods.length, 10);
    const tier1 = goods.find(entry => int64(entry.index) === 1);
    const tier9 = goods.find(entry => int64(entry.index) === 9);
    const tier10 = goods.find(entry => int64(entry.index) === 10);
    // 刚兑过的两档带 exchanged（实机均为 1），没兑过的档位没有。
    assert.equal(int64(tier9.field_5), 1);
    assert.equal(int64(tier9.exchanged), 1);
    assert.equal(int64(tier10.field_5), 1);
    assert.equal(int64(tier10.exchanged), 1);
    assert.equal(int64(tier1.field_5), 0);
    assert.equal(int64(tier1.exchanged), 0);
    // 目录尾部的余额与 cmd 96 回包、状态槽 field 3 三处一致。
    assert.equal(int64(reply.yshf_catalog.field_2), 27120);
    // 限购数量不因兑换而变化，仍是配置值。
    assert.equal(int64(tier10.limit), 50);
});

test('yishuhuanfu state carries the pending commission in slot 130.11', async () => {
    const root = await loadRoot();
    const State = root.lookupType('gamepb.activitypb.YshfState');
    // 15:09 抓包 #167（卖完 30 个之后）：130 里出现 5856 = {11:86}、6801 = {13:1}。
    const withCommission = State.decode(Buffer.from(
        '0a0408011001120c0821100118b19699d806200118c6fa0122041001286f302138ac6558566801',
        'hex',
    ));
    assert.equal(int64(withCommission.pending_commission), 86);
    assert.equal(int64(withCommission.commission_flag), 1);
    assert.equal(int64(withCommission.luck_coin), 32070);

    // 15:11 抓包 #116（领完提成之后）：11/13 消失，福气币 32070 + 86 = 32156。
    const claimed = State.decode(Buffer.from(
        '0a0408011001120e0821100118b19699d8062001281e189cfb0122021001286f302138ac65',
        'hex',
    ));
    assert.equal(int64(claimed.pending_commission), 0);
    assert.equal(int64(claimed.commission_flag), 0);
    assert.equal(int64(claimed.luck_coin), 32156);
});

test('yishuhuanfu cmd 95 and 99 replies round-trip their capture layout', async () => {
    const root = await loadRoot();
    const OpReply = root.lookupType('gamepb.activitypb.ActivityOperateReply');
    const RecordType = root.lookupType('gamepb.activitypb.YshfPurchaseRecord');
    const CommissionReply = root.lookupType('gamepb.activitypb.YshfCommissionReply');

    // cmd 95 回包：slot195 = {1: repeated record}，抓包单条记录字段原样搬过来。
    const record = RecordType.create({
        timestamp: '1795590561',
        gid: '1006806548',
        count: '30',
        total: '4320',
        name: '风筝有风',
        level: '114',
        commission: '86',
    });
    const recordsReply = OpReply.create({
        activity_id: '2026111708',
        operate_type: '95',
        yshf_records: { records: [record] },
    });
    const decodedRecords = OpReply.decode(Buffer.from(OpReply.encode(recordsReply).finish()));
    const first = decodedRecords.yshf_records.records[0];
    assert.equal(int64(first.timestamp), 1795590561);
    assert.equal(int64(first.gid), 1006806548);
    assert.equal(int64(first.count), 30);
    // 4320 = 30 × 144，是付给卖家的总额；86 是本人提成，两者不是同一个量。
    assert.equal(int64(first.total), 4320);
    assert.equal(first.name, '风筝有风');
    assert.equal(int64(first.commission), 86);

    // cmd 99 回包：抓包原样 08561801209cfb01 = {1:86, 3:1, 4:32156}。
    const commission = CommissionReply.decode(Buffer.from('08561801209cfb01', 'hex'));
    assert.equal(int64(commission.amount), 86);
    assert.equal(int64(commission.field_3), 1);
    assert.equal(int64(commission.balance), 32156);
});

/**
 * 2026-11-28 15:29 抓包（QQ 经典农场 1.17.1.13，gate-obt.nqf.qq.com）。
 * 这一版服务端给「卖薯给好友」加了分享标识校验，并开始下发兑换档位的已兑次数。
 * 下面三段都是抓包里对应槽位的原始字节，直接解，不经过本地再编码。
 */
test('yishuhuanfu 2026-11-28 slots: catalog used count, exchange write-back, share ref', async () => {
    const root = await loadRoot();
    const Catalog = root.lookupType('gamepb.activitypb.YshfCatalog');
    const Exchange = root.lookupType('gamepb.activitypb.YshfExchangeReply');
    const Share = root.lookupType('gamepb.activitypb.YshfShareReply');

    // cmd 97 回包 slot 197：第 2 档 limit=28、exchanged=13 → 界面「限购 15/28」。
    const catalog = Catalog.decode(Buffer.from(
        '0a0a080110c0843d180220010a0e080210e0d4031802201c300d38010a0c080310c0b8021802202838010a0e080410c0b80218022028300138010a0b080510b4421802203238010a0c080610e0da011802200a38010a0c080710e0da011802200a38010a0e080810e0da011802200a300138010a0c080910b891021802200a38010a0b080a10d83618022032380110eccc0d',
        'hex',
    ));
    assert.equal(catalog.goods.length, 10);
    const tier2 = catalog.goods.find(entry => int64(entry.index) === 2);
    assert.equal(int64(tier2.limit), 28);
    assert.equal(int64(tier2.exchanged), 13);
    // 目录尾部的福气币余额，与状态槽 130.3、卖薯回包 field 5 三处一致。
    assert.equal(int64(catalog.field_2), 222828);
    // 只兑过 1 次的第 4 档也带 exchanged，说明它不是「今日已兑」的布尔标记。
    assert.equal(int64(catalog.goods.find(entry => int64(entry.index) === 4).exchanged), 1);

    // cmd 96 回包 slot 196：兑 3 次后 exchanged=16（13+3），余额 42828 → 界面「限购 12/28」。
    const exchange = Exchange.decode(Buffer.from(
        '08a0fe0a121708fb99061003188092b8c398feffffff013088ff01380118ccce0220032810',
        'hex',
    ));
    assert.equal(int64(exchange.price), 180000);
    assert.equal(int64(exchange.grant.item_id), 101627);
    assert.equal(int64(exchange.grant.count), 3);
    assert.equal(int64(exchange.balance), 42828);
    assert.equal(int64(exchange.count), 3);
    assert.equal(int64(exchange.exchanged), 16);

    // cmd 98 回包 slot 198：5 号位才是分享卡片里的铺子标识（UUID）。
    const share = Share.decode(Buffer.from(
        '189f0122800108f5effbc704122035326162356531363939346234313130623463376666373933363766636530331a20384130393431343434303830424134334139364144343334364534364131424520022a3208dc8590c60710f5effbc7041a2430643065353235632d316633652d343133332d383964362d64613333366438343565323928c88501',
        'hex',
    ));
    assert.equal(int64(share.shop.gid), 1224669173);
    assert.equal(share.shop.invite_key, '52ab5e16994b4110b4c7ff79367fce03');
    assert.equal(share.shop.shop_ref.share_key, '0d0e525c-1f3e-4133-89d6-da336d845e29');
    assert.equal(String(share.shop.shop_ref.activity_id), '2026111708');
    assert.equal(String(share.shop.shop_ref.gid), '1224669173');
});

/**
 * 静态契约：分享标识只有「导入」和「移出」两个写入口，两者都必须落到 provider 的同名方法上。
 * 服务端没有按 gid 反查好友标识的接口，删掉任一入口都会让面板外的真人好友永远不可售
 * （或者让误加的铺子只能等下一天分享才能消失）。
 *
 * 覆盖文件：core/src/controllers/admin/activity-center/yishuhuanfu-routes.ts
 */
test('yishuhuanfu routes expose share-key import and removal endpoints', () => {
    const file = path.join(__dirname, '../src/controllers/admin/activity-center/yishuhuanfu-routes.ts');
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /\/api\/activity-center\/yishuhuanfu\/share-key'/, '缺少导入标识路由');
    assert.match(source, /\/api\/activity-center\/yishuhuanfu\/share-key\/remove'/, '缺少移出比价路由');
    assert.match(source, /importYishuHuanfuShareKey/, '导入路由没有接到 provider');
    assert.match(source, /forgetYishuHuanfuShareKey/, '移出路由没有接到 provider');
});
