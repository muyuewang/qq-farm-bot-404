const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const protobuf=require('protobufjs');
const root=new protobuf.Root().loadSync(['mallpb.proto','qqvippb.proto'].map(f=>path.resolve(__dirname,'../src/proto',f)),{keepCase:true});
const fixtures=require('./fixtures/autumn-live-capture.json');
const decode=(file,name)=>root.lookupType(name).decode(Buffer.from(fixtures.find(v=>v.file===file).hex,'hex'));
test('member and nonmember full replies decode actual entitlement and mall flags',()=>{
 const member=decode('000325-recv.bin','gamepb.qqvippb.GetQQVipRewardsStatusReply');
 const nonmember=decode('000016-recv.bin','gamepb.qqvippb.GetQQVipRewardsStatusReply');
 assert.equal(member.is_qq_vip,true);assert.equal(member.can_claim,false);
 assert.equal(member.claimed_today,true);assert.equal(member.mall_free_can_claim,true);
 assert.equal(Number(member.remaining_days),1562);
 assert.equal(nonmember.is_qq_vip,false);
 assert.ok(nonmember.reward_statuses.length>0);
 const mall=decode('000327-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 assert.deepEqual(mall.goods_list.map(g=>Number(g.goods_id)),[1053,1054,1055,1056]);
 assert.equal(mall.goods_list[0].is_available,true);
 assert.equal(Number(mall.goods_list[2].price.id),1901);
 assert.equal(Number(mall.goods_list[2].price.count),30);
 assert.equal(Number(mall.goods_list[2].reward_items[0].id),2121);
});

function harness({member=true,bag=[{id:1901,count:20},{id:1901,count:10}],bagFailure=false,refreshFailure=false,vipRefreshFailure=false,vipStatusFailure=false,now=1790215551,slotType=4,mallFile='000327-recv.bin',diamond=7,transformGoods=goods=>goods}={}){
 const bought=[];
 const mock=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
 mock('../dist/config/gameConfig',{getItemById:()=>({name:'item'}),getItemImageById:()=>''});
 mock('../dist/utils/utils',{toNum:v=>Number(v)||0,getServerTimeSec:()=>now});
 mock('../dist/services/qqvip',{
  refreshVipInfo:async()=>{if(vipRefreshFailure)throw Object.assign(new Error('网络繁忙，请稍候再试。'),{code:1000032});},
  getQQVipRewardsStatus:async()=>{if(vipStatusFailure)throw Object.assign(new Error('网络繁忙，请稍候再试。'),{code:1000032});return {is_qq_vip:member,remaining_days:1562};},
 });
 mock('../dist/services/warehouse',{getBag:async()=>{if(bagFailure)throw new Error('bag unavailable');return bag;},getBagItems:v=>v});
 mock('../dist/services/pay',{getDiamondBalance:async()=>diamond});
 mock('../dist/services/mystery-shop',{});
 mock('../dist/services/mall',{getMallListBySlotType:async slot=>{
  if(refreshFailure&&bought.length)throw new Error('offline');
  assert.equal(slot,slotType);const reply=decode(mallFile,'gamepb.mallpb.GetMallListBySlotTypeResponse');reply.goods_list=transformGoods(reply.goods_list);return reply;
 },purchaseMallGoods:async (id,count)=>{bought.push({id,count});return {goods_id:id,success:true,reward_items:[]};}});
 const id=require.resolve('../dist/services/commerce');delete require.cache[id];
 return {service:require(id),bought};
}

test('SVIP free gifts remain available when the optional membership refresh service is busy',async()=>{
 const h=harness({vipRefreshFailure:true});
 const catalog=await h.service.getMallCatalog(4);
 assert.equal(catalog.membership.isSvip,true);
 assert.equal(catalog.goods.find(g=>g.id===1053).purchasable,true);
 await h.service.purchaseMallProduct(1053,1,4);
 assert.deepEqual(h.bought,[{id:1053,count:1}]);
});

test('SVIP purchases still require a successful membership status read',async()=>{
 const h=harness({vipStatusFailure:true});
 await assert.rejects(h.service.purchaseMallProduct(1053,1,4),e=>e.code===1000032);
 assert.equal(h.bought.length,0);
});
test('nonmember may browse but backend rejects every SVIP purchase',async()=>{
 const h=harness({member:false});const list=await h.service.getMallCatalog(4);
 assert.equal(list.goods.length,4);assert.ok(list.goods.every(g=>!g.purchasable));
 for(const id of [1053,1054,1055,1056])await assert.rejects(h.service.purchaseMallProduct(id,1,4),e=>e.code==='GOODS_UNAVAILABLE');
 assert.equal(h.bought.length,0);
});
test('SVIP fragments aggregate, missing currencies are zero, unknown balances cannot spend',async()=>{
 const h=harness();const list=await h.service.getMallCatalog(4);
 assert.equal(list.goods.find(g=>g.id===1055).price.balance,30);
 assert.equal(list.goods.find(g=>g.id===1056).price.balance,0);
 const result=await h.service.purchaseMallProduct(1055,1,4);assert.equal(result.purchase.count,1);
 assert.deepEqual(h.bought,[{id:1055,count:1}]);
 const unknown=harness({bagFailure:true});await assert.rejects(unknown.service.purchaseMallProduct(1055,1,4),e=>e.code==='MALL_BALANCE_UNAVAILABLE');
 assert.equal(unknown.bought.length,0);
});
test('confirmed purchase survives a failed catalog refresh',async()=>{
 const h=harness({refreshFailure:true});const result=await h.service.purchaseMallProduct(1053,1,4);
 assert.equal(result.refreshRequired,true);assert.equal(h.bought.length,1);
});
test('purchase wire field 2 is success, never the quantity bought',()=>{
 const type=root.lookupType('gamepb.mallpb.PurchaseResponse');
 const reply=type.decode(Buffer.from('089d081001','hex'));
 assert.equal(Number(reply.goods_id),1053);assert.equal(reply.success,true);
 assert.equal(reply.count,undefined);
});

test('switched nonmember catalog contains the same goods with every availability flag false',()=>{
 const status=decode('001366-recv.bin','gamepb.qqvippb.GetQQVipRewardsStatusReply');
 const member=decode('000327-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 const nonmember=decode('001376-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 assert.equal(status.is_qq_vip,false);
 assert.deepEqual(nonmember.goods_list.map(g=>Number(g.goods_id)),[1053,1054,1055,1056]);
 for(let i=0;i<member.goods_list.length;i++){
  assert.equal(nonmember.goods_list[i].is_available,false);
  assert.deepEqual(nonmember.goods_list[i].price,member.goods_list[i].price);
  assert.deepEqual(nonmember.goods_list[i].reward_items,member.goods_list[i].reward_items);
 }
});

test('new activity promotion uses captured 780 price only inside its server time window',async()=>{
 const options={slotType:1,mallFile:'001343-recv.bin',diamond:780};
 for(const [now,price,original]of [[1790179199,880,null],[1790179200,780,880],[1790783998,780,880],[1790783999,880,null]]){
  const h=harness({...options,now});const catalog=await h.service.getMallCatalog(1);
  const product=catalog.goods.find(g=>g.id===1060);
  assert.equal(product.price.count,price);assert.equal(product.originalPrice,original);
  assert.equal(product.discountEndTime,1790783999000);
  assert.equal(product.isDiscounted,original!==null);
  assert.equal(catalog.goods.find(g=>g.id===1043).price.count,488);
 }
 const h=harness({...options,now:1790215551});
 await h.service.purchaseMallProduct(1060,1,1,{id:1004,count:780});
 assert.deepEqual(h.bought,[{id:1060,count:1}]);
 const expired=harness({...options,now:1790783999,diamond:1000});
 await assert.rejects(expired.service.purchaseMallProduct(1060,1,1,{id:1004,count:780}),e=>e.code==='MALL_PRICE_CHANGED');
 assert.equal(expired.bought.length,0);
});

test('captured unrestricted point and diamond products remain purchasable without field 8',async()=>{
 const raw=decode('001343-recv.bin','gamepb.mallpb.GetMallListBySlotTypeResponse');
 const ids=[1002,1003,1006,1007,1008,1009,1010,1011,1012,1013,1014,1015,1016,1017];
 const h=harness({slotType:1,mallFile:'001343-recv.bin',diamond:87,bag:[{id:1002,count:13756}]});
 const catalog=await h.service.getMallCatalog(1);
 for(const id of ids){
  const wire=raw.goods_list.find(g=>Number(g.goods_id)===id);
  assert.equal(Object.hasOwn(wire,'is_available'),false);
  assert.equal(wire.purchase_limit,null);
  const product=catalog.goods.find(g=>g.id===id);
  assert.equal(product.purchasable,true);
  assert.equal(product.purchaseStatus,'available');
  assert.equal(product.limit,null);
 }
 await h.service.purchaseMallProduct(1002,1,1,{id:1002,count:42});
 await h.service.purchaseMallProduct(1007,1,1,{id:1004,count:5});
 assert.deepEqual(h.bought,[{id:1002,count:1},{id:1007,count:1}]);
});

test('captured sold-out and claimed products have distinct states and cannot be purchased',async()=>{
 const h=harness({slotType:1,mallFile:'001343-recv.bin',diamond:10000});
 const catalog=await h.service.getMallCatalog(1);
 for(const id of [1001,1044]){
  const product=catalog.goods.find(g=>g.id===id);
  assert.equal(product.limit.remaining,0);
  assert.equal(product.purchaseStatus,'sold_out');
  assert.equal(product.purchasable,false);
  assert.match(product.unavailableReason,id===1001?/已领取/:/售罄/);
  await assert.rejects(h.service.purchaseMallProduct(id,1,1),e=>e.code==='GOODS_SOLD_OUT');
 }
 assert.equal(catalog.goods.find(g=>g.id===1057).purchaseStatus,'share_required');
 assert.equal(h.bought.length,0);
});

test('unlimited flag fallback never skips balance or special purchase restrictions',async()=>{
 const options={slotType:1,mallFile:'001343-recv.bin',diamond:4,bag:[{id:1002,count:41}]};
 const h=harness(options);
 for(const id of [1002,1007])await assert.rejects(h.service.purchaseMallProduct(id,1,1),e=>e.code==='INSUFFICIENT_BALANCE');
 assert.equal(h.bought.length,0);
 const unknown=harness({...options,bagFailure:true});
 await assert.rejects(unknown.service.purchaseMallProduct(1002,1,1),e=>e.code==='MALL_BALANCE_UNAVAILABLE');
 assert.equal(unknown.bought.length,0);
 for(const [flags,status]of [[{ad_only:true},'ad_required'],[{is_owned:true},'owned'],[{share:{share_only:true,share_status:1}},'share_required']]){
  const limited=harness({...options,transformGoods:goods=>goods.map(g=>Number(g.goods_id)===1007?Object.assign(g,flags):g)});
  const product=(await limited.service.getMallCatalog(1)).goods.find(g=>g.id===1007);
  assert.equal(product.purchaseStatus,status);assert.equal(product.purchasable,false);
  await assert.rejects(limited.service.purchaseMallProduct(1007,1,1),e=>e.code==='GOODS_UNAVAILABLE');
  assert.equal(limited.bought.length,0);
 }
});

test('zero restriction type is unlimited while a real zero limit is sold out',async()=>{
 const options={slotType:1,mallFile:'001343-recv.bin'};
 for(const [type,status,remaining]of [[0,'available',null],[1,'sold_out',0]]){
  const h=harness({...options,transformGoods:goods=>goods.map(g=>Number(g.goods_id)===1007?Object.assign(g,{purchase_limit:{limit_type:type,limit_count:0,bought_count:0}}):g)});
  const product=(await h.service.getMallCatalog(1)).goods.find(g=>g.id===1007);
  assert.equal(product.purchaseStatus,status);
  assert.equal(product.limit?.remaining??null,remaining);
 }
 const svip=harness({transformGoods:goods=>goods.map(g=>Object.assign(g,{purchase_limit:null,is_available:false}))});
 assert.ok((await svip.service.getMallCatalog(4)).goods.every(g=>!g.purchasable));
});

test('limited mall uses its own slot, current price and finite availability without SVIP gating', async () => {
 const options={slotType:5,member:false,bag:[{id:1002,count:100}],transformGoods:()=>[{
  goods_id:1061,name:'奶茶点券礼包',goods_type:5,is_available:true,price:{id:1002,count:25},
  reward_items:[{id:29005,count:1}],purchase_limit:{limit_type:3,limit_count:3,bought_count:2},
 }]};
 const h=harness(options);
 const product=(await h.service.getMallCatalog(5)).goods[0];
 assert.equal(product.purchasable,true); assert.equal(product.limit.remaining,1);
 await assert.rejects(h.service.purchaseMallProduct(1061,2,5,{id:1002,count:25}));
 await assert.rejects(h.service.purchaseMallProduct(1061,1,5,{id:1002,count:24}));
 await h.service.purchaseMallProduct(1061,1,5,{id:1002,count:25});
 assert.deepEqual(h.bought,[{id:1061,count:1}]);
 const unavailable=harness({...options,transformGoods:()=>options.transformGoods().map(v=>({...v,is_available:false}))});
 assert.equal((await unavailable.service.getMallCatalog(5)).goods[0].purchasable,false);
 await assert.rejects(unavailable.service.purchaseMallProduct(1061,1,5,{id:1002,count:25}));
 assert.equal(unavailable.bought.length,0);
});
