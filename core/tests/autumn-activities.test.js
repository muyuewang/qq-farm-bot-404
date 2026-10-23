const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const protobuf=require('protobufjs');
const root=new protobuf.Root().loadSync(path.resolve(__dirname,'../src/proto/activitypb.proto'),{keepCase:true});
const types=Object.fromEntries(['GetGroupRequest','GetGroupReply','AutumnOperateRequest','ActivityOperateReply'].map(n=>[n,root.lookupType('gamepb.activitypb.'+n)]));
const encode=(t,v)=>Buffer.from(t.encode(t.fromObject(v)).finish());
const object=(t,v)=>t.toObject(t.decode(v),{longs:String,bytes:String});

test('all supported autumn operations match independent official encoder vectors',()=>{
    for(const vector of require('./fixtures/autumn-official-vectors.json')){
        const type=vector.direction==='send'?types.AutumnOperateRequest:types.ActivityOperateReply;
        assert.deepEqual(object(type,Buffer.from(vector.hex,'hex')),vector.expected);
        assert.equal(encode(type,vector.expected).toString('hex'),vector.hex);
    }
});

test('real wish replies expose pending rewards then clear the claimed state',()=>{
    const fixtures=require('./fixtures/autumn-live-capture.json');
    const frame=file=>object(types.ActivityOperateReply,Buffer.from(fixtures.find(v=>v.file===file).hex,'hex'));
    const draw=frame('000562-recv.bin');
    assert.equal(draw.data.wish_sign.pending.choose_id,'5');
    assert.deepEqual(draw.wish_sign_draw,{text_id:'1',day_id:'1',rewards:[{id:'6001',count:'20'}]});
    const claim=frame('000570-recv.bin');
    assert.equal(claim.data.wish_sign.pending,undefined);
    assert.equal(claim.wish_sign_claim.awards[0].id,'6001');
    assert.equal(claim.wish_sign_claim.awards[0].count,'20');
});

function harness({happy=false,offlineAfterWrite=false}={}) {
    const calls=[];
    const head={activity_id:happy?2026092501:2026092401,begin_time:1790179200,end_time:1791388799};
    const state={activity:head,...(happy?{share_reward:{summary:{daily:{claim_limit:3},daily_reward:5,first_share_reward:5,milestones:[{tier_id:1,threshold:10,state:1}]}}}:{wish_sign:{remaining_count:1,activity_day:1}})};
    let writes=0;
    const mock=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
    mock('../dist/utils/proto',{types});
    mock('../dist/utils/utils',{toNum:v=>Number(v)||0,getServerTimeSec:()=>1790215551});
    mock('../dist/config/gameConfig',{getItemById:()=>({name:'reward'}),getItemImageById:()=>''});
    mock('../dist/utils/network',{sendMsgAsync:async (_s,method,bytes)=>{
        if(method==='GetGroup'){
            if(offlineAfterWrite&&writes)throw new Error('offline');
            return {body:encode(types.GetGroupReply,{group:{activity:{activity_id:2026092400},children:[state]}})};
        }
        const req=object(types.AutumnOperateRequest,bytes);calls.push(req);writes++;
        const field=Object.keys(req).find(k=>k!=='activity_id'&&k!=='operate_type');
        let result={};
        if(field==='wish_sign_draw'){
            state.wish_sign.remaining_count=0;
            state.wish_sign.pending={choose_id:req[field].choose_id,text_id:1,day_id:1,rewards:[{id:6001,count:20}]};
            result={text_id:1,day_id:1,rewards:[{id:6001,count:20}]};
        } else if(field==='wish_sign_claim') {state.wish_sign.pending=null;result={awards:[{id:6001,count:20}]};}
        else if(field==='share_reward_claim_daily'){state.share_reward.summary.daily.daily_reward_claimed=true;state.share_reward.summary.current_score=5;result={granted_score:5};}
        else if(field==='share_reward_share'){state.share_reward.summary.daily.first_share_awarded=true;state.share_reward.summary.current_score=5;result={granted_score:5};}
        return {body:encode(types.ActivityOperateReply,{activity_id:head.activity_id,operate_type:req.operate_type,[field]:result})};
    }});
    delete require.cache[require.resolve('../dist/services/share-reward-activity')];
    const id=require.resolve('../dist/services/autumn-activities');delete require.cache[id];
    return {service:require(id),state,calls};
}

test('wish commands match complete live request bodies from frames 561 and 569',()=>{
    for(const [cmd,field,hex] of [[51,'wish_sign_draw','08f1ee8ec6071033ba09020805'],[52,'wish_sign_claim','08f1ee8ec6071034c209020805']]) {
        assert.equal(encode(types.AutumnOperateRequest,{activity_id:2026092401,operate_type:cmd,[field]:{choose_id:5}}).toString('hex'),hex);
    }
});

test('fresh checks serialize double draws and claims use the server pending choice',async()=>{
    const h=harness();
    const results=await Promise.allSettled([h.service.operateAutumnActivity('wish','draw',{chooseId:5}),h.service.operateAutumnActivity('wish','draw',{chooseId:1})]);
    assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
    assert.equal(results[0].value.activity.pending.text,'顺应天时');
    assert.equal(h.calls.length,1);
    const claimed=await h.service.operateAutumnActivity('wish','claim',{chooseId:1});
    assert.equal(h.calls[1].wish_sign_claim.choose_id,'5');
    assert.equal(claimed.rewards[0].count,20);
    assert.equal(claimed.activity.canClaim,false);
    await assert.rejects(h.service.operateAutumnActivity('wish','claim'),/待领取/);
});

test('invalid choices, keys and mismatched actions send no mutations',async()=>{
    const h=harness();
    await assert.rejects(h.service.getAutumnActivity('constructor'),/未知/);
    await assert.rejects(h.service.operateAutumnActivity('wish','draw',{chooseId:7}),/有效/);
    await assert.rejects(h.service.operateAutumnActivity('wish','daily'),/不匹配/);
    h.state.activity.end_time=1;
    await assert.rejects(h.service.operateAutumnActivity('wish','draw',{chooseId:1}),/结束/);
    assert.equal(h.calls.length,0);
});

test('happy daily advances once and confirmed success survives a failed refresh',async()=>{
    const h=harness({happy:true});
    const result=await h.service.operateAutumnActivity('happy','daily');
    assert.equal(result.activity.score,5);
    assert.equal(result.activity.claimLimit,3);
    await assert.rejects(h.service.operateAutumnActivity('happy','daily'),/已领取/);
    assert.equal(h.calls.length,1);
    const other=harness({happy:true,offlineAfterWrite:true});
    const confirmed=await other.service.operateAutumnActivity('happy','daily');
    assert.equal(confirmed.result.granted_score,'5');
    assert.equal(confirmed.refreshRequired,true);
});

test('happy share obtains the daily award once without any messaging RPC',async()=>{
    const h=harness({happy:true});
    const result=await h.service.operateAutumnActivity('happy','share');
    assert.equal(result.result.granted_score,'5');
    assert.equal(result.activity.firstShareAwarded,true);
    assert.equal(result.activity.canShare,false);
    await assert.rejects(h.service.operateAutumnActivity('happy','share'),/已领取/);
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].operate_type,'70');
});

test('second account career draw changes the actual choice and text while retaining day-one rewards',()=>{
 const fixtures=require('./fixtures/autumn-live-capture.json');
 const frame=(file,type)=>object(type,Buffer.from(fixtures.find(v=>v.file===file).hex,'hex'));
 assert.equal(frame('001413-send.bin',types.AutumnOperateRequest).wish_sign_draw.choose_id,'3');
 const draw=frame('001414-recv.bin',types.ActivityOperateReply);
 assert.equal(draw.data.wish_sign.pending.choose_id,'3');
 assert.equal(draw.wish_sign_draw.text_id,'12');
 const text=require('../src/activity-data/autumn-20260924.json').texts.find(v=>v.choose_id===3&&v.text_id===12);
 assert.equal(text.desc,'这件事\n主要看你');
 assert.deepEqual(draw.wish_sign_draw.rewards,[{id:'6001',count:'20'}]);
 assert.equal(frame('001419-send.bin',types.AutumnOperateRequest).wish_sign_claim.choose_id,'3');
 const claim=frame('001420-recv.bin',types.ActivityOperateReply);
 assert.equal(claim.wish_sign_claim.awards[0].count,'20');
 assert.equal(claim.data.wish_sign.pending,undefined);
});

test('captured happy state and both log tabs retain actual earned rewards without repeat claims',async()=>{
 const frames=require('./fixtures/autumn-happy-sanitized.json').frames;
 const frame=file=>{
  const row=frames.find(v=>v.file===file);
  return object(types[row.type],Buffer.from(row.hex,'hex'));
 };
 const group=frame('000115-recv.bin').group;
 const find=e=>e.share_reward?e:(e.children||[]).map(find).find(Boolean);
 const entry=find(group);
 const h=harness({happy:true});
 h.state.share_reward=entry.share_reward;
 const state=await h.service.getAutumnActivity('happy');
 assert.equal(state.score,10);
 assert.equal(state.dailyReward,5);assert.equal(state.firstShareReward,5);
 assert.equal(state.canClaimDaily,false);assert.equal(state.canShare,false);
 assert.equal(state.milestones[0].state,3);
 assert.deepEqual(state.milestones[0].rewards.map(({id,count})=>({id,count})),[{id:80002,count:1}]);
 for(const action of ['daily','share','milestones'])await assert.rejects(h.service.operateAutumnActivity('happy',action));
 assert.equal(h.calls.length,0);
 for(const [tab,file]of [[1,'000130-send.bin'],[0,'000136-send.bin']]){
  await h.service.operateAutumnActivity('happy','logs',{tab});
  assert.deepEqual(h.calls.at(-1),{ ...frame(file), operate_type: '72' });
 }
 const logs=frame('000131-recv.bin').share_reward_get_logs;
 assert.equal(logs.total,2);
 assert.deepEqual(logs.logs.map(({kind,score})=>({kind,score})),[{kind:3,score:'5'},{kind:4,score:'5'}]);
 assert.equal((frame('000137-recv.bin').share_reward_get_logs.logs||[]).length,0);
});
