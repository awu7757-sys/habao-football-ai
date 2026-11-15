// 足球市場融合研究（admin-football-v2-stage-compare）數值與資格測試，對應 GPT 2026-11-15 審查 R1～R5。
// 執行：node tests/football-market-research.test.cjs
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const src=fs.readFileSync(path.join(__dirname,'../supabase/functions/admin-football-v2-stage-compare/index.ts'),'utf8');
const code=src.slice(src.indexOf('function num('),src.indexOf('function pairedData('));
const ctx={Math,Number,Array,String,Object,JSON,Date,GRID_MAX:18,STAGES:['t10','t2','t15']};vm.createContext(ctx);
vm.runInContext(stripTypeScriptTypes(code,{mode:'strip'})+';Object.assign(this,{marketImpliedXg,researchStage,researchBatch,legWinShare,scoreGrid,bisect,RESEARCH_FIT_TOLERANCE,RESEARCH_BATCH_FIXTURES});',ctx);
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
// R5：分批合併不漏不重、同資料重跑一致
const paired=[],byFixture=new Map();
for(let i=0;i<300;i++){const kick=new Date(Date.parse('2026-11-01T00:00:00Z')+(i%37)*86400000).toISOString();paired.push({fixture_id:1000+i,kickoff_at:kick,home_score:i%3,away_score:i%2});
  const m=new Map();for(const st of ['t10','t2','t15'])m.set(st,{...snap,kickoff_at:kick,captured_at:new Date(Date.parse(kick)-3600000).toISOString(),market_context:JSON.stringify({...fair(1.5,1.1,2.5,-0.25),captured_at:new Date(Date.parse(kick)-3600000).toISOString()})});byFixture.set(1000+i,m);}
const seen=new Set();let off=0,batches=0;while(off!==null){const r=ctx.researchBatch(paired,byFixture,off);for(const id of r.batch_fixture_ids){assert.ok(!seen.has(id),'分批不應重複');seen.add(id);}off=r.next_offset;batches++;}
assert.equal(seen.size,300,'分批應涵蓋全部場次');
const r1=ctx.researchBatch(paired,byFixture,0),r2=ctx.researchBatch(paired,byFixture,0);assert.deepEqual(JSON.parse(JSON.stringify(r1)),JSON.parse(JSON.stringify(r2)),'同資料重跑應一致');
console.log(`PASS R5 ${batches} 批合併 300 場不漏不重，重跑一致`);
