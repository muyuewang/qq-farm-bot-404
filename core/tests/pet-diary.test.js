const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');
const fixtures = require('./fixtures/pet-diary-capture.json');
const { createPetDiaryService } = require('../dist/services/activity-center/pet-diary');
const root = new protobuf.Root().loadSync(path.resolve(__dirname,'../src/proto/activitypb.proto'), { keepCase: true });
root.loadSync(['solartermspb.proto','mallpb.proto'].map(name=>path.resolve(__dirname,'../src/proto',name)),{keepCase:true});
const types = Object.fromEntries(['PetDiaryOperateRequest','PetDiaryOperateReply','PetDiaryGetGroupReply','GetGroupRequest'].map(name => [name,root.lookupType(`gamepb.activitypb.${name}`)]));
for(const name of ['ClaimSolarTermsRequest','ClaimSolarTermsReply'])types[name]=root.lookupType(`gamepb.solartermspb.${name}`);
const object = (type, input) => type.toObject(type.decode(input), { longs: String, arrays: true, objects: true });
const encode = (type, input) => Buffer.from(type.encode(type.fromObject(input)).finish());
const capture = name => fixtures.find(f => f.file === name);
const decoded = name => types.PetDiaryOperateReply.decode(Buffer.from(capture(name).hex,'hex'));
const charmCaptures = require('./fixtures/pet-charm-refresh-capture.json');

test('pet requests match the official mini-program bytes', () => {
    for (const fixture of fixtures.filter(f => f.direction === 'send')) {
        assert.deepEqual(encode(types.PetDiaryOperateRequest,fixture.expected),Buffer.from(fixture.hex,'hex'),fixture.file);
    }
});

test('all captured pet reply fields match the official decoder, including shops and logs', () => {
    for (const fixture of fixtures.filter(f => f.direction === 'recv' && f.error === '0')) {
        assert.deepEqual(object(types.PetDiaryOperateReply,Buffer.from(fixture.hex,'hex')),fixture.expected,fixture.file);
    }
});

test('late-stage operations match independent official encoder vectors', () => {
    // These are synthetic vectors produced by the extracted official encoder,
    // separate from the real capture fixtures above.
    const vectors=require('./fixtures/pet-diary-official-vectors.json');
    for(const vector of vectors) {
        const {id,cmd,...fields}=vector.input;
        const localInput={activity_id:id,operate_type:cmd,...fields};
        const type=vector.direction==='send'?types.PetDiaryOperateRequest:types.PetDiaryOperateReply;
        const bytes=Buffer.from(vector.hex,'hex');
        assert.deepEqual(encode(type,localInput),bytes,vector.name);
        const actual=type.toObject(type.decode(bytes),{longs:String});
        assert.deepEqual(actual,localInput,vector.name);
    }
});

function harness({ cake = '0', stars = '450', tickets = '0', failBag = false, failSnapshot = false, solarClaimable = false, petCapture = '000157-recv.bin', feedReply = '', storyReply = '', refreshReply = '', equipReply = '' } = {}) {
    const group = { pet: decoded(petCapture).data, seeds: decoded('000276-recv.bin').data, shop: decoded('000318-recv.bin').data };
    const calls = [];
    let mutationCount = 0; let tail = Promise.resolve();
    const service = createPetDiaryService({
        types, getServerTimeSec: () => 1789010000,
        getBag: async () => { if (failBag) throw new Error('bag unavailable'); return [{id:'1028',count:cake},{id:'1029',count:stars},{id:'1002',count:tickets}]; }, getBagItems: x => x,
        int64String: x => String(x ?? '0'), int64Number: x => Number(x || 0),
        itemDto: x => ({id:String(x?.id || x?.item_id || '0'),count:String(x?.count || '0'),name:'item',image:''}),
        textContent: () => ({paragraphs:[]}), getCurrentSolarTerms: async () => ({terms:[{id:'301',startTime:'1789005600',endTime:'1790179199',canClaim:solarClaimable}]}),
        businessError: (code, message) => Object.assign(new Error(message),{code}),
        positiveDecimal: (v,_code,name) => { if (!/^[1-9]\d*$/.test(String(v))) throw new Error(`Invalid ${name}`); return String(v); },
        serializeMutation: fn => { const result=tail.then(fn,fn);tail=result.catch(()=>{});return result; },
        sendMsgAsync: async (_service, method, bytes) => {
            if (method === 'ClaimSolarTerms') {
                assert.equal(_service,'gamepb.solartermspb.SolarTermsService');
                assert.equal(String(types.ClaimSolarTermsRequest.decode(bytes).term_id),'301');
                mutationCount++;solarClaimable=false;
                return {body:Buffer.from(require('./fixtures/pet-solar-claim-capture.json').hex,'hex')};
            }
            if (method === 'GetGroup') {
                if (failSnapshot && mutationCount) throw new Error('offline');
                return {body:encode(types.PetDiaryGetGroupReply,{group:{head:{id:'2026090100'},children:Object.values(group)}})};
            }
            const req = object(types.PetDiaryOperateRequest,bytes);
            calls.push(req);
            if (req.operate_type === '7') return {body:encode(types.PetDiaryOperateReply,{activity_id:'2026090103',operate_type:7,data:group.shop})};
            mutationCount++;
            const selector = Object.keys(req).find(k=>k.startsWith('pet_')||k==='mega_event_claim_all'||k==='shop_buy');
            if (req.operate_type === '29' && feedReply) {
                group.pet = decoded(feedReply).data;
                cake = (BigInt(cake) - 700n).toString();
                stars = (BigInt(stars) + 100n).toString();
                return { body: Buffer.from(capture(feedReply).hex,'hex') };
            }
            if (req.operate_type === '32' && storyReply) {
                group.pet = decoded(storyReply).data;
                return { body: Buffer.from(capture(storyReply).hex,'hex') };
            }
            if (req.operate_type === '41' || req.operate_type === '42') {
                const captured = charmCaptures.find(f => f.file === (req.operate_type === '41' ? refreshReply : equipReply));
                if (captured) {
                    const reply = types.PetDiaryOperateReply.decode(Buffer.from(captured.hex,'hex'));
                    group.pet = reply.data;
                    for (const cost of reply.pet_treasure_hunt_refresh_charm_pool?.costs || []) {
                        assert.equal(String(cost.id),'1002');
                        tickets = (BigInt(tickets) - BigInt(String(cost.count))).toString();
                    }
                    return { body: Buffer.from(captured.hex,'hex') };
                }
                const battle = group.pet.pet_treasure_hunt.battle;
                let result;
                if (req.operate_type === '41') {
                    const free = Number(battle.charm_free_refresh_count) < 1;
                    if (free) battle.charm_free_refresh_count = 1;
                    else { battle.charm_paid_refresh_count = Number(battle.charm_paid_refresh_count) + 1; tickets = (BigInt(tickets) - 30n).toString(); }
                    battle.charm_daily_pool = [101,105];
                    battle.charm_pick_used = false;
                    result = { charm_daily_pool:battle.charm_daily_pool, free_refresh:free, free_refresh_count:battle.charm_free_refresh_count, paid_refresh_count:battle.charm_paid_refresh_count, costs:free ? [] : [{id:1002,count:30}] };
                } else {
                    battle.charm_equipped = req[selector].charm_ids;
                    battle.charm_pick_used = true;
                    result = {charm_equipped:battle.charm_equipped};
                }
                return {body:encode(types.PetDiaryOperateReply,{activity_id:req.activity_id,operate_type:req.operate_type,[selector]:result})};
            }
            if (req.operate_type === '29') { cake='0'; group.pet.pet_treasure_hunt.nurture.growth = 700; }
            return {body:encode(types.PetDiaryOperateReply,{activity_id:req.activity_id,operate_type:req.operate_type,[selector]:{}})};
        },
    });
    return { service, calls, group, mutations: () => mutationCount };
}

test('snapshot reads never claim seeds, and expose real limits and balances', async () => {
    const h=harness(); const dto=await h.service.getPetDiary();
    assert.deepEqual(h.calls.map(c=>c.operate_type),['7']);
    assert.equal(dto.nurture.canFeed,false);
    assert.equal(dto.seeds.canClaim,false);
    assert.equal(dto.stories.length,9);
    assert.equal(dto.shop.length,13);
    assert.equal(dto.shop.find(g=>g.id==='61').remaining,'100');
    assert.equal(dto.shop.find(g=>g.id==='61').exchangeable,true);
    assert.equal(dto.shop.find(g=>g.id==='50').exchangeable,false);
});

test('insufficient cake, duplicate seeds and unknown actions never issue a mutation', async () => {
    const h=harness();
    await assert.rejects(h.service.operatePetDiary('feed'),/不足/);
    await assert.rejects(h.service.operatePetDiary('seeds'),/礼包/);
    await assert.rejects(h.service.operatePetDiary('constructor'),/未知/);
    assert.equal(h.mutations(),0);
});

test('serialized mutations reread resources to prevent double spending', async () => {
    const h=harness({cake:'700'});
    const results=await Promise.allSettled([h.service.operatePetDiary('feed'),h.service.operatePetDiary('feed')]);
    assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
    assert.equal(h.mutations(),1);
    assert.equal(results[0].value.snapshot.nurture.growth,700);
});

test('successful live feeding capture updates balances, growth and the unlocked story', async () => {
    const h = harness({ cake:'1409', feedReply:'001874-recv.bin' });
    const result = await h.service.operatePetDiary('feed');
    assert.deepEqual(result.costs.map(i=>[i.id,i.count]), [['1028','700']]);
    assert.deepEqual(result.rewards.map(i=>[i.id,i.count]), [['1029','100']]);
    assert.equal(result.snapshot.balances.find(i=>i.id==='1028').count,'709');
    assert.equal(result.snapshot.balances.find(i=>i.id==='1029').count,'550');
    assert.equal(result.snapshot.nurture.growth,700);
    assert.equal(result.snapshot.nurture.feedCount,1);
    assert.equal(result.snapshot.stories[0].unlocked,true);
    assert.equal(result.snapshot.stories[0].claimed,false);
    assert.ok(result.snapshot.stories[0].photo.endsWith('/img_s3PhotoWall_photo0.webp'));
});

test('user-triggered live story claim capture provides the gift and prevents duplicate claims', async () => {
    const h = harness({ cake:'709', petCapture:'001874-recv.bin', storyReply:'001926-recv.bin' });
    const result = await h.service.operatePetDiary('story',{order:1});
    assert.deepEqual(result.rewards.map(i=>[i.id,i.count]), [['29004','1'],['20516','8'],['80014','1']]);
    assert.equal(result.snapshot.stories[0].claimed,true);
    assert.equal(result.snapshot.nurture.growth,700);
    await assert.rejects(h.service.operatePetDiary('story',{order:1}),/已领取/);
    assert.equal(h.mutations(),1);
});

function refreshHarness(options = {}) {
    const h = harness(options);
    h.group.pet.pet_treasure_hunt.nurture.stage = 2;
    Object.assign(h.group.pet.pet_treasure_hunt.battle, {charm_equipped:[102],charm_daily_pool:[101,105],charm_pick_used:true,charm_free_refresh_count:1,charm_paid_refresh_count:0});
    return h;
}
const ticketRefresh = {payment:'tickets',expectedPaidRefreshCount:0};

test('live paid refresh and keep-current messages match every field of the independent official decoder', () => {
    for (const fixture of charmCaptures) {
        const type = fixture.direction === 'send' ? types.PetDiaryOperateRequest : types.PetDiaryOperateReply;
        const bytes = Buffer.from(fixture.hex,'hex');
        assert.deepEqual(object(type,bytes),fixture.expected,fixture.file);
        assert.deepEqual(encode(type,fixture.expected),bytes,fixture.file);
    }
});

test('live paid refresh deducts 30 tickets, offers two new charms and keeps the current charm until chosen', async () => {
    const h = refreshHarness({tickets:'11915',refreshReply:'000469-recv.bin',equipReply:'000474-recv.bin'});
    const result = await h.service.operatePetDiary('refreshCharm',ticketRefresh);
    assert.deepEqual(result.costs.map(i => [i.id,i.count]),[['1002','30']]);
    assert.equal(result.snapshot.charms.refreshBalance,'11885');
    assert.equal(result.snapshot.charms.paidRefreshCount,1);
    assert.equal(result.snapshot.charms.paidRefreshRemaining,2);
    assert.equal(result.snapshot.charms.refreshCost.count,'30');
    assert.deepEqual(result.snapshot.charms.pool.map(c=>c.id),[101,105]);
    assert.deepEqual(result.snapshot.charms.equipped.map(c=>c.id),[102]);
    assert.equal(result.snapshot.charms.canChoose,true);
    assert.equal(result.snapshot.charms.canRefresh,false);
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{payment:'tickets',expectedPaidRefreshCount:1}),/先替换或保留/);
    const kept = await h.service.operatePetDiary('equipCharm',{charmId:102});
    assert.deepEqual(kept.snapshot.charms.equipped.map(c=>c.id),[102]);
    assert.equal(kept.snapshot.charms.canRefresh,true);
    assert.equal(kept.snapshot.charms.canChoose,false);
    assert.equal(kept.snapshot.charms.refreshBalance,'11885');
    await assert.rejects(h.service.operatePetDiary('equipCharm',{charmId:101}),/本轮已经选择/);
    assert.equal(h.mutations(),2);
});

test('free clicks, insufficient or unavailable tickets and diamond overrides never trigger a paid operation', async () => {
    for (const options of [{tickets:'29'},{tickets:'0'},{tickets:'100',failBag:true}]) {
        const h = refreshHarness(options);
        const dto = await h.service.getPetDiary();
        assert.equal(dto.charms.canRefresh,false);
        if (options.failBag) assert.equal(dto.charms.refreshBalance,null);
        await assert.rejects(h.service.operatePetDiary('refreshCharm',ticketRefresh));
        assert.equal(h.mutations(),0);
    }
    const h = refreshHarness({tickets:'100'});
    await assert.rejects(h.service.operatePetDiary('refreshCharm'),/免费刷新已用完/);
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{payment:'free'}),/免费刷新已用完/);
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{...ticketRefresh,allowDiamonds:true}),/不支持使用钻石/);
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{payment:'diamonds'}),/不支持使用钻石/);
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{payment:'tickets'}),/次数已变化/);
    assert.equal(h.mutations(),0);
});

test('serialized refresh clicks cannot spend twice and a stale paid counter cannot be reused after choosing', async () => {
    const h = refreshHarness({tickets:'30'});
    const results = await Promise.allSettled([h.service.operatePetDiary('refreshCharm',ticketRefresh),h.service.operatePetDiary('refreshCharm',ticketRefresh)]);
    assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
    assert.equal(results[0].value.snapshot.charms.refreshBalance,'0');
    await h.service.operatePetDiary('equipCharm',{charmId:101});
    await assert.rejects(h.service.operatePetDiary('refreshCharm',ticketRefresh),/次数已变化/);
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{payment:'tickets',expectedPaidRefreshCount:1}),/点券不足/);
    assert.equal(h.mutations(),2);
});

test('refresh limits, adulthood and retaining remaining charm effects are validated on the latest state', async () => {
    const h = refreshHarness({tickets:'100'});
    const state = h.group.pet.pet_treasure_hunt;
    state.nurture.stage = 1;
    await assert.rejects(h.service.operatePetDiary('refreshCharm',ticketRefresh),/成年/);
    state.nurture.stage = 2;
    state.battle.charm_free_refresh_count = 0;
    await assert.rejects(h.service.operatePetDiary('refreshCharm',ticketRefresh),/次数已变化/);
    const free = await h.service.operatePetDiary('refreshCharm',{payment:'free'});
    assert.deepEqual(free.costs,[]);
    assert.equal(free.snapshot.charms.refreshBalance,'100');
    state.battle.charm_equipped = [105];
    state.battle.charm_daily_pool = [101,104];
    state.battle.charm_effect_remaining_count = [{charm_id:105,effect_order:1,remaining_count:1}];
    await assert.rejects(h.service.operatePetDiary('equipCharm',{charmId:103}),/不可选择/);
    const keep = await h.service.operatePetDiary('equipCharm',{charmId:105});
    assert.deepEqual(keep.snapshot.charms.equipped[0].remaining,[1]);
    state.battle.charm_paid_refresh_count = 2;
    const last = await h.service.operatePetDiary('refreshCharm',{payment:'tickets',expectedPaidRefreshCount:2});
    assert.equal(last.snapshot.charms.paidRefreshRemaining,0);
    assert.equal(last.snapshot.charms.refreshCost.count,'30');
    await h.service.operatePetDiary('equipCharm',{charmId:105});
    await assert.rejects(h.service.operatePetDiary('refreshCharm',{payment:'tickets',expectedPaidRefreshCount:3}),/次数已用完/);
    assert.equal((await h.service.getPetDiary()).charms.canRefresh,false);
});

test('a successful action remains successful when its follow-up snapshot fails', async () => {
    const h=harness({cake:'700',failSnapshot:true});
    const result=await h.service.operatePetDiary('feed');
    assert.equal(h.mutations(),1);
    assert.equal(result.snapshot,null);
    assert.match(result.refreshError,/操作已成功/);
});

test('expired activity and locked stories cannot be mutated', async () => {
    const h=harness({cake:'700'});
    await assert.rejects(h.service.operatePetDiary('story',{order:1}),/尚未解锁/);
    h.group.pet.head.end_time=1789009999;
    await assert.rejects(h.service.operatePetDiary('feed'),/活动时间/);
    assert.equal(h.mutations(),0);
});

test('shop checks numeric purchase counts, combined costs, and diamond fallback before sending', async () => {
    const h=harness({stars:'20000'});
    const goods=h.group.shop.shop.goods.find(g=>String(g.id)==='61');
    goods.purchased_count=99;
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'2'}),/限购/);
    goods.purchased_count=0;
    goods.diamond_cost_count=30;
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'1'}),/钻石/);
    goods.diamond_cost_count=0;
    goods.cost=[{id:'1004',count:'1'}];
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'1'}),/钻石/);
    goods.cost=[{id:'1029',count:'15000'},{id:'1029',count:'15000'}];
    await assert.rejects(h.service.operatePetDiary('exchange',{goodsId:'61',count:'1'}),/余额不足/);
    assert.equal(h.mutations(),0);
});

test('pet activity is discoverable without loading any season details', () => {
    const {buildActivityGameplayBindings,resolveActivityGameplays}=require('../dist/services/activity-gameplay-registry');
    const result=resolveActivityGameplays(['2026090100','2026090102'],buildActivityGameplayBindings({}));
    assert.equal(result.gameplayKey,'pet');
    assert.equal(result.detailTarget,'pet');
});

test('activity directory uses the official pet title without renaming other activities', () => {
    const { buildActivityDirectory } = require('../dist/services/activity-center');
    const windows = ['2026090100', '2026090101', '2026090102', '2026090103'].map(id => ({ id, name: 'S3 萌宠', beginTime: 1, endTime: 2 }));
    windows.push({ id: '2026070304', name: '天气活动', beginTime: 1, endTime: 2 });
    const directory = buildActivityDirectory(windows, null, null, null, null);
    assert.equal(directory[0].name, '萌宠成长日记');
    assert.equal(directory[0].detailTarget, 'pet');
    assert.equal(directory[0].activityIds.length, 4);
    assert.equal(directory[1].name, '天气活动');
    assert.equal(directory[1].detailTarget, 'weather');
});

test('permanent bichon appears in the pet catalog with the official skill', () => {
    const {PET_IDS,getPetSkillCatalog}=require('../dist/services/pets');
    assert.ok(PET_IDS.includes(90031));
    const skills=getPetSkillCatalog().skillsByPetId[90031];
    assert.equal(skills.find(s=>s.skillId===3001).name,'比熊润田');
});

test('pet mutations expose official names, icons and the paradise/golden crop combinations', () => {
    const fs = require('node:fs');
    const { getMutantEffectsByIds, getMutantDisplayPlantId, getPlantById } = require('../dist/config/gameConfig');
    const { buildLandDetail } = require('../dist/services/farm/land-analysis');
    const effects = getMutantEffectsByIds([15, 16]);
    assert.deepEqual(effects.map(e => [e.id, e.name, e.icon]), [[15, '比熊', 'bichon'], [16, '乐园', 'leyuan']]);
    assert.equal(effects[0].description, '比熊犬处于看护状态时概率触发');
    assert.equal(effects[1].description, '种植泡泡棉花糖有概率出现');
    for (const id of [15, 16]) assert.ok(fs.existsSync(path.join(__dirname, `../src/gameConfig/seed_images_named/mutant/${id}.png`)));
    assert.equal(getMutantDisplayPlantId(1029004, [16]), 1028004);
    assert.equal(getMutantDisplayPlantId(1029004, [5, 16]), 1128004);
    assert.equal(getMutantDisplayPlantId(1029004, [16, 5]), 1128004);
    assert.equal(getPlantById(1028004).fruit.id, 204008);
    const now = Math.floor(Date.now() / 1000);
    const detail = buildLandDetail({ id: 1, unlocked: true, plant: { id: 1029004, mutant_config_ids: [15, 16], phases: [{ phase: 2, begin_time: now - 60 }, { phase: 6, begin_time: now + 3600 }] } });
    assert.equal(detail.plantName, '比熊棉花糖');
    assert.deepEqual(detail.mutantEffects.map(effect => effect.name), ['比熊', '乐园']);
});

test('solar gift uses the captured claim result and a second claim is blocked', async () => {
    const h=harness({solarClaimable:true});
    const result=await h.service.operatePetDiary('solar',{termId:'301'});
    assert.deepEqual(result.rewards.map(i=>({id:i.id,count:i.count})),[{id:'25995',count:'30'},{id:'1002',count:'200'}]);
    assert.equal(result.snapshot.solarTerms.terms[0].canClaim,false);
    await assert.rejects(h.service.operatePetDiary('solar',{termId:'301'}),/不可领取/);
    assert.equal(h.mutations(),1);
});

test('actual mall response distinguishes tickets, gold beans and diamonds', () => {
    const type=root.lookupType('gamepb.mallpb.GetMallListBySlotTypeResponse');
    const reply=object(type,Buffer.from(require('./fixtures/pet-mall-capture.json').hex,'hex'));
    const goods=id=>reply.goods_list.find(g=>Number(g.goods_id)===id);
    assert.deepEqual(goods(1044).price,{id:'1002',count:'25',mutant_types:[]});
    assert.deepEqual(goods(1050).price,{id:'1005',count:'150',mutant_types:[]});
    assert.deepEqual(goods(1045).price,{id:'1004',count:'25',mutant_types:[]});
    assert.deepEqual(goods(1044).reward_items.map(i=>[i.id,i.count]),[['29004','1'],['80001','2'],['80011','2']]);
});
