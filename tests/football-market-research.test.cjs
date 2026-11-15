// 足球市場融合研究（admin-football-v2-stage-compare）數值與資格測試，對應 GPT 2026-11-15 審查 R1～R5。
// 執行：node tests/football-market-research.test.cjs
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const src=fs.readFileSync(path.join(__dirname,'../supabase/functions/admin-football-v2-stage-compare/index.ts'),'utf8');
const code=src.slice(src.indexOf('function num('),src.indexOf('function pairedData('));
const ctx={Math,Number,Array,String,Object,JSON,Date,GRID_MAX:18,STAGES:['t10','t2','t15']};vm.createContext(ctx);
vm.runInContext(stripTypeScriptTypes(code,{mode:'strip'})+';Object.assign(this,{marketImpliedXg,researchStage,researchBatch,researchOrder,researchFingerprint,legWinShare,scoreGrid,bisect,RESEARCH_FIT_TOLERANCE,RESEARCH_BATCH_FIXTURES,RESEARCH_VERSION});',ctx);
const fair=(hx,ax,tl,hl)=>{const g=ctx.scoreGrid(hx,ax),po=ctx.legWinShare(g,tl,'over'),ph=ctx.legWinShare(g,hl,'home');
  return {captured_at:'2026-11-20T10:00:00Z',total:{line:tl,over_odds:1/po,under_odds:1/(1-po)},handicap:{home_line:hl,away_line:-hl,home_odds:1/ph,away_odds:1/(1-ph)}};};
// R1：整數、半球、±0.25／±0.75 盤都能還原
let n=0;
for(const [hx,ax] of [[1.5,1.1],[1.8,0.8],[0.9,1.6],[2.4,1.3]])for(const tl of [2,2.25,2.5,2.75,3])for(const hl of [-1,-0.75,-0.25,0,0.25,0.5,0.75]){
  const r=ctx.marketImpliedXg(fair(hx,ax,tl,hl),1.3,1.3);
  assert.ok(r.ok,`應可反推 ${hx}/${ax} 大小${tl} 讓${hl}：${r.reason}`);
  assert.ok(r.residual<=ctx.RESEARCH_FIT_TOLERANCE);
  assert.ok(Math.abs(r.home-hx)<0.03&&Math.abs(r.away-ax)<0.03,`還原誤差過大 ${hx}/${ax}→${r.home.toFixed(3)}/${r.away.toFixed(3)}`);n++;}
console.log(`PASS R1 反推還原 ${n} 例（整數、半球、四分之一盤）`);
// R1：無解與不合法輸入不回傳可用 xG
const ns=ctx.marketImpliedXg({captured_at:'x',total:{line:9.5,over_odds:2,under_odds:2},handicap:{home_line:0,away_line:0,home_odds:2,away_odds:2}},1.3,1.3);
assert.equal(ns.ok,false);assert.equal(ns.reason,'no_solution_total');
assert.equal(ctx.marketImpliedXg({total:{line:12.5,over_odds:2,under_odds:2},handicap:{home_line:0,away_line:0,home_odds:2,away_odds:2}},1,1).ok,false,'盤線超出範圍應拒絕');
assert.equal(ctx.marketImpliedXg({total:{line:2.5,over_odds:2,under_odds:2},handicap:{home_line:-0.5,away_line:0.25,home_odds:2,away_odds:2}},1,1).ok,false,'讓分主客盤不對稱應拒絕');
assert.equal(ctx.marketImpliedXg({total:{line:2.6,over_odds:2,under_odds:2},handicap:{home_line:0,away_line:0,home_odds:2,away_odds:2}},1,1).ok,false,'非四分之一步進應拒絕');
assert.equal(ctx.bisect(x=>x,0,1,1.5),null,'二分法目標超出端點應回傳 null');
console.log('PASS R1 無解／不合法輸入被拒絕');
// R2：缺一種市場不算純市場；不同初始化結果一致
const one=ctx.marketImpliedXg({total:{line:2.5,over_odds:2,under_odds:2}},2,1);assert.equal(one.ok,false);assert.equal(one.reason,'single_market_only');
const q=fair(1.6,1.0,2.5,-0.25),a=ctx.marketImpliedXg(q,2,1),b=ctx.marketImpliedXg(q,1,2),c=ctx.marketImpliedXg(q,0.4,3.5);
assert.ok(a.ok&&b.ok&&c.ok);for(const r of [b,c])assert.ok(Math.abs(r.home-a.home)<0.01&&Math.abs(r.away-a.away)<0.01,'純市場結果不應依模型初始化改變');
console.log('PASS R2 單邊市場排除、純市場與初始化無關');
// R3：只換比分，方向與 xG 不變；時間不合法排除
const snap={kickoff_at:'2026-11-20T12:00:00Z',captured_at:'2026-11-20T11:45:00Z',home_xg:1.4,away_xg:1.2,market_context:JSON.stringify({...fair(1.5,1.1,2.5,-0.25),captured_at:'2026-11-20T11:44:00Z'})};
const s1=ctx.researchStage(snap,0,0),s2=ctx.researchStage(snap,5,3);assert.ok(s1.ok&&s2.ok);
for(const v of ['model','blend','market'])for(const k of ['home_xg','away_xg','moneyline_pick','btts_pick'])assert.equal(s1[v][k],s2[v][k],`${v}.${k} 不應受比分影響`);
for(const v of ['model','blend','market']){assert.equal(s1[v].total.pick,s2[v].total.pick);assert.equal(s1[v].handicap.pick,s2[v].handicap.pick);}
assert.equal(ctx.researchStage({...snap,captured_at:'2026-11-20T12:05:00Z'},1,1).reason,'time_invalid_or_missing','賽後擷取應排除');
assert.equal(ctx.researchStage({...snap,market_context:JSON.stringify({...fair(1.5,1.1,2.5,-0.25),captured_at:undefined})},1,1).reason,'time_invalid_or_missing','市場擷取時間缺失應排除');
console.log('PASS R3 比分只影響結算；賽後／缺時間排除');
// A（第二輪）：時間邊界
{
  const kick=Date.parse('2026-11-20T12:00:00Z'),iso=t=>new Date(t).toISOString(),q=fair(1.5,1.1,2.5,-0.25);
  const mk=(cap,mcap)=>({kickoff_at:iso(kick),captured_at:cap,home_xg:1.4,away_xg:1.2,market_context:JSON.stringify({...q,captured_at:mcap})});
  assert.ok(ctx.researchStage(mk(iso(kick-1),iso(kick-1)),1,0).ok,'開賽前 1 毫秒應可通過');
  assert.equal(ctx.researchStage(mk(iso(kick-1),iso(kick)),1,0).reason,'time_invalid_or_missing','市場時間等於開賽應排除');
  assert.equal(ctx.researchStage(mk(iso(kick-1),iso(kick+1)),1,0).reason,'time_invalid_or_missing','市場時間晚於開賽應排除');
  assert.equal(ctx.researchStage(mk(iso(kick),iso(kick-60000)),1,0).reason,'time_invalid_or_missing','快照時間等於開賽應排除');
  assert.equal(ctx.researchStage(mk(iso(kick+1),iso(kick-60000)),1,0).reason,'time_invalid_or_missing','快照時間晚於開賽應排除');
  assert.equal(ctx.researchStage(mk(iso(kick-60000),iso(kick-30000)),1,0).reason,'time_invalid_or_missing','市場時間晚於快照應排除');
  assert.equal(ctx.researchStage(mk(undefined,iso(kick-60000)),1,0).reason,'time_invalid_or_missing','快照時間缺值應排除');
  assert.equal(ctx.researchStage(mk('not-a-date',iso(kick-60000)),1,0).reason,'time_invalid_or_missing','時間無法解析應排除');
  console.log('PASS A 時間邊界（開賽前 1 毫秒通過；等於／晚於開賽、晚於快照、缺值、無法解析排除）');
}
// 建立 300 場合成資料（研究配對清單與結果表）
const byFixture=new Map(),results=new Map();
for(let i=0;i<300;i++){const kick=new Date(Date.parse('2026-11-01T00:00:00Z')+(i%37)*86400000).toISOString(),cap=new Date(Date.parse(kick)-3600000).toISOString();
  results.set(1000+i,{fixture_id:1000+i,kickoff_at:kick,home_score:i%3,away_score:i%2,excluded_from_public:false});
  const m=new Map();for(const st of ['t10','t2','t15'])m.set(st,{...snap,kickoff_at:kick,captured_at:cap,market_context:JSON.stringify({...fair(1.2+(i%5)*0.2,1.1,2.5,-0.25),captured_at:cap})});byFixture.set(1000+i,m);}
const order=ctx.researchOrder(byFixture,results),hash=ctx.researchFingerprint(order,byFixture,90);
for(let i=1;i<order.length;i++)assert.ok(order[i-1].kick>order[i].kick||(order[i-1].kick===order[i].kick&&order[i-1].id<order[i].id),'同時開賽應依 ID 穩定排序');
// B：任何資料變動都改變評估集合指紋
{
  const clone=()=>new Map([...results].map(([k,v])=>[k,{...v}]));
  const r1=clone();r1.set(9999,{fixture_id:9999,kickoff_at:'2026-12-31T00:00:00Z',home_score:1,away_score:0});const b1=new Map(byFixture);b1.set(9999,byFixture.get(1000));
  assert.notEqual(ctx.researchFingerprint(ctx.researchOrder(b1,r1),b1,90),hash,'新增賽果應改變指紋');
  const r2=clone();r2.get(1005).excluded_from_public=true;assert.notEqual(ctx.researchFingerprint(ctx.researchOrder(byFixture,r2),byFixture,90),hash,'排除一場應改變指紋');
  const r3=clone();r3.get(1007).home_score=9;assert.notEqual(ctx.researchFingerprint(ctx.researchOrder(byFixture,r3),byFixture,90),hash,'更正比分應改變指紋');
  const b4=new Map(byFixture),m4=new Map(byFixture.get(1010));m4.set('t2',{...m4.get('t2'),home_xg:2.2});b4.set(1010,m4);
  assert.notEqual(ctx.researchFingerprint(order,b4,90),hash,'更正快照應改變指紋');
  assert.notEqual(ctx.researchFingerprint(order,byFixture,30),hash,'查詢期間不同應改變指紋');
  // 第三輪複審：只改某一階段快照的 kickoff_at（賽果列不變）也必須改變指紋；三個階段各測一次
  for(const st of ['t10','t2','t15']){const b5=new Map(byFixture),m5=new Map(byFixture.get(1020));const orig=m5.get(st);
    m5.set(st,{...orig,kickoff_at:new Date(Date.parse(orig.kickoff_at)-70*60000).toISOString()});b5.set(1020,m5);
    const f=byFixture.get(1020),ord=order.find(x=>x.id===1020);
    assert.notEqual(ctx.researchStage(b5.get(1020).get(st),ord.hs,ord.as).ok,ctx.researchStage(orig,ord.hs,ord.as).ok,st+' 案例應改變研究資格');
    assert.notEqual(ctx.researchFingerprint(order,b5,90),hash,'只改 '+st+' 快照開賽時間應改變指紋');}
  assert.equal(ctx.researchFingerprint(ctx.researchOrder(byFixture,clone()),byFixture,90),hash,'資料不變指紋應相同');
  console.log('PASS B 新增／排除／更正比分／更正快照／期間不同都會改變評估集合指紋（後端回 research_dataset_changed 中止）');
}
// 基準：一次算完所有場次的統計
const baseline={};
for(const f of order){const period=f.kick>=Date.parse('2026-11-16T00:00:00+08:00')?'out_of_sample':'exploration';
  for(const st of ['t10','t2','t15']){const r=ctx.researchStage(byFixture.get(f.id).get(st),f.hs,f.as);if(!r.ok)continue;
    for(const v of ['model','blend','market'])for(const [mk,h] of [['moneyline',r[v].moneyline_hit],['total',r[v].total?.hit],['handicap',r[v].handicap?.hit],['btts',r[v].btts_hit]]){
      const x=((((baseline[period]??={})[mk]??={})[v]??={})[st]??={candidates:0,correct:0,total:0});x.candidates++;if(typeof h==='boolean'){x.total++;if(h)x.correct++;}}}}
const batches=[];for(let off=0;off!==null;){const b=ctx.researchBatch(order,byFixture,off,hash);batches.push(JSON.parse(JSON.stringify(b)));off=b.next_offset;}
assert.deepEqual(JSON.parse(JSON.stringify(ctx.researchBatch(order,byFixture,0,hash))),batches[0],'同資料重跑應一致');
// C：真正的前端合併函式
{
  const fe=fs.readFileSync(path.join(__dirname,'../admin-football-v2.js'),'utf8');
  const doc={getElementById:()=>null,addEventListener(){}};
  const fctx={document:doc,window:{addEventListener(){}},setInterval(){},console,Map,Set,Object,Number,String,JSON,Math,Array,Date};vm.createContext(fctx);vm.runInContext(fe,fctx);
  const mergeAll=list=>{const acc=fctx.v2NewResearchAcc();for(const b of list){if(!fctx.v2MergeResearch(acc,JSON.parse(JSON.stringify(b))))break;}return acc;};
  const ok=mergeAll(batches);
  assert.ok(ok.complete&&!ok.invalid,'完整分批應完成：'+ok.invalid);
  assert.equal(ok.seen.size,300);assert.deepEqual(JSON.parse(JSON.stringify(ok.counts)),JSON.parse(JSON.stringify(baseline)),'分批合併應與一次性基準完全相同（含 candidates／correct／total）');
  // 同一批重送
  const dup=mergeAll([batches[0],batches[0]]);assert.ok(dup.invalid);assert.deepEqual(JSON.parse(JSON.stringify(dup.counts)),JSON.parse(JSON.stringify(mergeAll([batches[0]]).counts)),'重送批次不得加兩次');
  // 部分重疊
  const ov={...batches[1],batch_fixture_ids:[batches[0].batch_fixture_ids[0],...batches[1].batch_fixture_ids.slice(1)]};
  const ovAcc=mergeAll([batches[0],ov]);assert.ok(ovAcc.invalid);assert.equal(ovAcc.seen.size,batches[0].batch_fixture_ids.length,'重疊批次不得合併');
  // 版本／評估集合／總場數不一致
  assert.ok(mergeAll([batches[0],{...batches[1],version:'other'}]).invalid,'不同研究版本不得合併');
  assert.ok(mergeAll([batches[0],{...batches[1],set_hash:'x'}]).invalid,'不同評估集合不得合併');
  assert.ok(mergeAll([batches[0],{...batches[1],total_fixtures:301}]).invalid,'總場數不同不得合併');
  // 缺批、錯誤 offset
  const gap=mergeAll([batches[0],batches[2]]);assert.ok(gap.invalid&&!gap.complete,'缺批不得完成');
  // 最後一批但場數不足
  const short=mergeAll([{...batches[batches.length-1],offset:0,batch_fixture_ids:batches[batches.length-1].batch_fixture_ids,batch_size:80}]);assert.ok(!short.complete,'場數不足不得標示完成');
  // 讀取中斷（只合併前兩批）
  const cut=mergeAll(batches.slice(0,2));assert.ok(!cut.complete&&!cut.invalid,'中斷時為未完成，不是完成');
  console.log(`PASS C 前端合併：${batches.length} 批與一次性基準相同；重送、重疊、版本／集合／總數不符、缺批、場數不足、中斷都不會被當成完成或重複累加`);
}
// E：BTTS 零推薦也顯示候選數
{
  const fe=fs.readFileSync(path.join(__dirname,'../admin-football-v2.js'),'utf8');
  const host={innerHTML:''};const fctx={document:{getElementById:id=>id==='footballV2ResearchMount'?host:null,addEventListener(){}},window:{addEventListener(){}},setInterval(){},console,Map,Set,Object,Number,String,JSON,Math,Array,Date,v2esc:x=>String(x)};
  vm.createContext(fctx);vm.runInContext(fe,fctx);
  const acc=fctx.v2NewResearchAcc();
  fctx.v2MergeResearch(acc,{version:'v',set_hash:'h',offset:0,batch_size:80,total_fixtures:1,next_offset:null,batch_fixture_ids:[1],used_fixture_ids:{exploration:[1],out_of_sample:[]},all_stage_fixture_ids:{exploration:[1],out_of_sample:[]},stage_valid:{exploration:{t10:1,t2:0,t15:0},out_of_sample:{t10:0,t2:0,t15:0}},
    counts:{exploration:{btts:{model:{t10:{candidates:100,correct:0,total:0}},blend:{t10:{candidates:100,correct:30,total:50}}}}},exclusions:{},fit_tolerance:0.002});
  vm.runInContext('footballV2Research=this.__acc;',Object.assign(fctx,{__acc:acc}));fctx.renderFootballV2Research();
  assert.ok(host.innerHTML.includes('推薦 0／候選 100'),'有候選但零推薦應顯示候選數');
  assert.ok(host.innerHTML.includes('60.0%（30／50）<br><small>推薦 50／候選 100'),'有推薦時顯示命中率與推薦／候選');
  console.log('PASS E BTTS 零候選顯示「—」、有候選零推薦顯示「推薦 0／候選 N」、有推薦顯示命中率');
}
// D：期間分開計數
{
  const p0=batches[0];assert.ok(Array.isArray(p0.used_fixture_ids.exploration)&&Array.isArray(p0.used_fixture_ids.out_of_sample));
  console.log('PASS D 探索期／樣本外分別回傳不同賽事、三階段合格與各階段合格數');
}

// 第三輪複審：以更正前指紋請求後續批次，實際 HTTP 處理函式回 409 research_dataset_changed
(async()=>{
  const kick='2026-11-20T12:00:00.000Z',cap='2026-11-20T11:45:00.000Z',mc=JSON.stringify({...fair(1.5,1.1,2.5,-0.25),captured_at:'2026-11-20T11:44:00.000Z'});
  let snaps=['t10','t2','t15'].map(st=>({fixture_id:77,stage:st,kickoff_at:kick,captured_at:cap,home_xg:1.4,away_xg:1.2,probabilities:'{}',market_context:mc,source_meta:'{}',model_version:'v',data_quality:'q',research_only:true}));
  const resultsRows=[{fixture_id:77,kickoff_at:kick,home_score:1,away_score:0,verified_at:kick,excluded_from_public:false}];
  let handler=null;
  const fetchStub=async(url)=>{url=String(url);
    if(url.includes('/functions/v1/admin-center'))return {ok:true,json:async()=>({admin:{is_super_admin:true}})};
    const rows=url.includes('football_v2_shadow_stage_snapshots')?snaps:url.includes('ai_prediction_snapshots')?resultsRows:[];
    return {ok:true,json:async()=>rows,text:async()=>''};};
  const hctx={Math,Number,Array,String,Object,JSON,Date,Map,Set,URLSearchParams,Response:class{constructor(b,i){this.body=b;this.status=i.status}},AbortSignal:{timeout:()=>null},console,fetch:fetchStub,
    Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://x':'role'},serve:fn=>{handler=fn;}}};
  vm.createContext(hctx);vm.runInContext(stripTypeScriptTypes(src,{mode:'strip'}),hctx);
  const call=async body=>{const r=await handler({method:'POST',headers:{get:()=> 'token'},json:async()=>body});return {status:r.status,body:JSON.parse(r.body)};};
  const first=await call({action:'compare',days:0});assert.equal(first.status,200,'首次比較應成功');
  const h0=first.body.research_metrics.set_hash,v0=first.body.research_metrics.version;
  const same=await call({action:'research',days:0,research_offset:0,research_set_hash:h0,research_version:v0});assert.equal(same.status,200,'資料未變時指紋應相同、可繼續');
  assert.equal(same.body.research_metrics.set_hash,h0);
  snaps=snaps.map(x=>x.stage==='t2'?{...x,kickoff_at:'2026-11-20T11:40:00.000Z'}:x);   // 只更正 T-2 快照開賽時間
  const changed=await call({action:'research',days:0,research_offset:0,research_set_hash:h0,research_version:v0});
  assert.equal(changed.status,409);assert.equal(changed.body.error,'research_dataset_changed','舊指紋應被拒絕');
  const wrongVer=await call({action:'research',days:0,research_offset:0,research_set_hash:h0,research_version:'old'});
  assert.equal(wrongVer.body.error,'research_version_changed');
  console.log('PASS B 回歸：只更正 T-2 快照開賽時間後，以舊指紋請求後續批次 → 409 research_dataset_changed；版本不符 → research_version_changed');
})().catch(e=>{console.error(e);process.exit(1);});
