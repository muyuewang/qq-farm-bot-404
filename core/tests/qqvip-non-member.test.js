const assert = require('node:assert/strict');
const test = require('node:test');
function harness(status, claimError) {
 const calls=[];
 const mock=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
 const codec=(decoded={})=>({create:v=>v,encode:v=>({finish:()=>v}),decode:()=>decoded});
 mock('../dist/utils/network',{sendMsgAsync:async (_s,method,body,options)=>{
  calls.push({method,body,options});
  if(method==='ClaimQQVipRewards'&&claimError)throw Object.assign(new Error('membership expired'),{code:claimError});
  return {body:Buffer.alloc(0)};
 }});
 mock('../dist/utils/proto',{types:{RefreshVipInfoRequest:codec(),RefreshVipInfoReply:codec(),GetQQVipRewardsStatusRequest:codec(),GetQQVipRewardsStatusReply:codec(status),ClaimQQVipRewardsRequest:codec(),ClaimQQVipRewardsReply:codec({items:[]})}});
 mock('../dist/utils/utils',{log:()=>{},toNum:v=>Number(v)||0,getSystemDateKey:()=> '2026-09-24'});
 const id=require.resolve('../dist/services/qqvip');delete require.cache[id];
 return {service:require(id),calls,mock};
}
test('nonmember receives configs but must never claim them',async()=>{
 const h=harness({is_qq_vip:false,can_claim:true,reward_statuses:[{type:1,is_enable:true,reward_type:5}]});
 assert.equal(await h.service.performDailyVipGift(),false);
 assert.deepEqual(h.calls.map(c=>c.method),['GetQQVipRewardsStatus']);
 assert.equal(h.service.getVipDailyState().doneToday,true);
 assert.equal(h.service.getVipDailyState().hasGift,false);
 await h.service.performDailyVipGift();assert.equal(h.calls.length,1);
});
test('membership expiring between check and claim skips rest of day',async()=>{
 const h=harness({is_qq_vip:true,can_claim:true,reward_statuses:[{type:1,is_enable:true,reward_type:5}]},1021001);
 assert.equal(await h.service.performDailyVipGift(),false);
 const claim=h.calls.find(c=>c.method==='ClaimQQVipRewards');
 assert.deepEqual(claim.body.reward_types,[5]);
 assert.deepEqual(claim.options.expectedErrorCodes,[1021001,1021002]);
 assert.equal(h.service.getVipDailyState().doneToday,true);
 assert.equal(h.service.getVipDailyState().hasGift,false);
});
test('claim uses config IDs and distinct daily/season flags',async()=>{
 const h=harness({is_qq_vip:true,can_claim:false,rewards_can_claim:true,reward_statuses:[{type:1,is_enable:true,reward_type:5},{type:2,is_enable:true,reward_type:6},{type:2,is_enable:false,reward_type:7}]});
 assert.equal(await h.service.performDailyVipGift(),true);
 assert.deepEqual(h.calls.find(c=>c.method==='ClaimQQVipRewards').body.reward_types,[6]);
});
test('free SVIP gift never spends diamonds and checks eligibility and limits',async()=>{
 const h=harness({});
 const bought=[];
 const base={is_free:true,is_available:true,price:{count:0},goods_id:1053};
 h.mock('../dist/services/mall',{getMallListBySlotType:async slot=>{assert.equal(slot,4);return {goods_list:[base,{...base,goods_id:1054,price:{id:1004,count:110}},{...base,goods_id:1055,is_available:false},{...base,goods_id:1056,purchase_limit:{bought_count:1,limit_count:1}}]};},purchaseMallGoods:async id=>bought.push(id)});
 assert.equal(await h.service.claimSvipMallFreeGift({is_qq_vip:false,mall_free_can_claim:true}),false);
 assert.equal(await h.service.claimSvipMallFreeGift({is_qq_vip:true,mall_free_can_claim:true}),true);
 assert.deepEqual(bought,[1053]);
});
