const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const now=Date.now(),iso=t=>new Date(t).toISOString();
const clone=x=>JSON.parse(JSON.stringify(x));
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
function load(name,fetchImpl=async()=>{throw Error('unexpected fetch')}){
 const code=fs.readFileSync(path.join(root,'supabase/functions',name,'index.ts'),'utf8');
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-role',API_NBA_KEY:'private-nba',BASKETBALL_T10_CRON_KEY:'private-cron'};
 const c=vm.createContext({Response,Request,URL,URLSearchParams,AbortSignal,Date,console:{log(){},warn(){},error(){}},fetch:fetchImpl,Deno:{env:{get:k=>env[k]},serve:fn=>c.handler=fn}});
 vm.runInContext(stripTypeScriptTypes(code),c);if(name==='nba-v2-unified-runner')c.boxNumber=vm.runInContext('boxNumber',c);return c;
}
const request=(body,key='private-cron',method='POST')=>new Request('https://test/',{method,headers:{'Content-Type':'application/json','x-habao-cron-key':key,'x-admin-session':'test-session'},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const snap={game_id:17079,fixture_time:iso(now+5*3600000),generated_at:iso(now-5*3600000),home_team:'Home',away_team:'Away',source:'SYSTEM_AUTO',prediction_data:{fixture:{season:2026,home:{id:1},away:{id:2}},market_data:{market:{available:true,primary:{home_spread:-3.5,away_spread:3.5,total:225.5}}},analysis:{recommendations:{moneyline:{pick:'home'},handicap:{pick:'home',line:-3.5},over_under:{pick:'over',line:225.5}}}},status:'verified',final_home:110,final_away:108};
function game(id,team,days=4){return {id,league:'standard',date:{start:iso(now-days*86400000)},status:{short:3},teams:{home:{id:team},visitors:{id:team+10}},scores:{home:{points:114},visitors:{points:106}}};}
const hg=[101,102,103,104].map((id,i)=>game(id,1,i+3)),ag=[201,202,203,204].map((id,i)=>game(id,2,i+3));
function statistics(g){return [{team:g.teams.home,statistics:[{fga:89,fta:24,offReb:9,turnovers:13,points:g.scores.home.points}]},{team:g.teams.visitors,statistics:[{fga:88,fta:23,offReb:8,turnovers:14,points:g.scores.visitors.points}]}];}
function backendMock(opts={}){
 const calls=[],unified=new Map((opts.unified||[]).map(x=>[x.game_id,clone(x)])),cache=new Map((opts.cache||[]).map(x=>[x.game_id,clone(x)]));
 const snapshots=opts.snapshots||[snap];
 async function fetchImpl(raw,init={}){
  const u=new URL(raw),method=init.method||'GET';calls.push({url:u.toString(),method,body:init.body?JSON.parse(init.body):null});
  if(u.pathname==='/functions/v1/admin-center')return opts.authError?json({success:false},503):json({success:true,admin:{is_super_admin:true}});
  if(u.hostname==='v2.nba.api-sports.io'){
   if(u.pathname==='/games'){
    if(opts.historyBroken)return json({});
    const team=Number(u.searchParams.get('team')),season=Number(u.searchParams.get('season'));
    return json({errors:[],response:season===2026?(team===1?hg:ag):[]});
   }
   if(opts.boxError)return json({errors:{rateLimit:'temporary'}},429);
   if(opts.boxMalformed)return json({});
   const g=[...hg,...ag].find(x=>x.id===Number(u.searchParams.get('id')));
   return json({errors:[],response:opts.boxInvalid?[]:statistics(g)});
  }
  if(u.pathname.startsWith('/rest/v1/')){
   const table=u.pathname.split('/').at(-1);
   if(table==='basketball_prediction_snapshots'){
    assert.equal(method,'GET','formal snapshots must remain read-only');
    // Column names supplied by the user's live information_schema result.
    const columns=new Set(['id','game_id','fixture_time','home_team','away_team','model_version','prediction_data','generated_at','source','league_name','status','final_home','final_away','final_score','game_status','settlement','verified_at','verification_error','excluded_from_public','excluded_at']);
    for(const field of (u.searchParams.get('select')||'*').split(','))assert.ok(field==='*'||columns.has(field),'unknown live DB column '+field);
    return json(snapshots);
   }
   assert.ok(['basketball_v2_unified_snapshots','basketball_v2_box_cache'].includes(table),'write allowlist');
   const db=table==='basketball_v2_box_cache'?cache:unified;
   if(method==='GET'){
    let rows=[...db.values()];const id=u.searchParams.get('game_id');
    if(id?.startsWith('eq.'))rows=rows.filter(x=>String(x.game_id)===id.slice(3));
    if(id?.startsWith('in.')){const ids=id.slice(4,-1).split(',').map(Number);rows=rows.filter(x=>ids.includes(x.game_id));}
    return json(rows);
   }
   const b=JSON.parse(init.body);
   if(method==='POST'){
    if(table==='basketball_v2_unified_snapshots'&&db.has(b.game_id))return json([]);
    db.set(b.game_id,clone(b));return json(table==='basketball_v2_box_cache'?null:[b]);
   }
   if(method==='PATCH'){
    let rows=[...db.values()].filter(x=>String(x.game_id)===u.searchParams.get('game_id')?.slice(3));
    const status=u.searchParams.get('status');if(status)rows=rows.filter(x=>x.status===status.slice(3));
    const updated=u.searchParams.get('updated_at');
    if(updated?.startsWith('eq.'))rows=rows.filter(x=>Date.parse(x.updated_at)===Date.parse(updated.slice(3)));
    if(updated?.startsWith('lt.'))rows=rows.filter(x=>Date.parse(x.updated_at)<Date.parse(updated.slice(3)));
    for(const r of rows)Object.assign(r,clone(b));return json(rows);
   }
  }
  throw Error('unexpected route '+raw);
 }
 return {fetchImpl,calls,unified,cache};
}
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const r=load('nba-v2-unified-runner'),c=load('admin-nba-v2-compare');
const ready={status:'ready',model_output:{expected_home_points:114,expected_away_points:111,expected_total:225,home_win_probability:.6,market:{home_spread:-3.5,total:225.5},shadow_directions:{moneyline:'away',handicap:'away',over_under:'under'}}};
test('preflight both functions returns empty 204',async()=>{for(const ctx of [r,c]){const x=await ctx.handler(request({},'', 'OPTIONS'));assert.equal(x.status,204);assert.equal(await x.text(),'');assert.equal(x.headers.get('Access-Control-Allow-Origin'),'*');}});
test('unauthorized runner performs no DB/provider request',async()=>{assert.equal((await r.handler(request({action:'run'},'bad'))).status,401)});
test('methods and malformed JSON rejected',async()=>{assert.equal((await r.handler(request({},'', 'GET'))).status,405);assert.equal((await r.handler(request('{'))).status,400)});
test('T10 metadata validation and after-tipoff exclusion',()=>{assert.ok(r.unifiedMeta(snap));for(const x of [{game_id:-1},{generated_at:snap.fixture_time},{generated_at:iso(now-20*3600000)},{prediction_data:{fixture:{season:2026,home:{id:1},away:{id:1}}}}])assert.equal(r.unifiedMeta({...snap,...x}),null)});
test('future, recent, unfinished, wrong league and malformed IDs excluded',()=>{const base=game(1,1);assert.ok(r.validLeagueGame(base,1,2026,now));for(const x of [{date:{start:iso(now+86400000)}},{date:{start:iso(now-3600000)}},{status:{short:2}},{league:'vegas'},{id:'bad'},{scores:{home:{points:null},visitors:{points:110}}}])assert.equal(r.validLeagueGame({...base,...x},1,2026,now),null)});
test('history deduplicates games',()=>{assert.equal(r.historicalGames([hg[0],hg[0]],[],1,2026,now).length,1)});
test('missing markets produce no spread or total selection',()=>{const model=r.researchModel(r.historicalGames(hg,[],1,2026,now),r.historicalGames(ag,[],2,2026,now),now,{home_spread:null,total:null},2026).model;assert.equal(model.shadow_directions.handicap,null);assert.equal(model.shadow_directions.over_under,null);assert.ok(model.home_win_probability>=0&&model.home_win_probability<=1)});
test('insufficient history never fabricates model',()=>{assert.equal(r.researchModel([],[],now,{},2026).model,null)});
test('strict box numbers reject booleans and blank data',()=>{assert.equal(r.boxNumber(true),null);assert.equal(r.boxNumber(' '),null);const b=statistics(hg[0]);assert.ok(r.completedBox(hg[0],b));b[0].statistics[0].fta=true;assert.equal(r.completedBox(hg[0],b),null)});
test('opposite spread picks on same market are comparable',()=>{const x=c.compare(snap,ready);assert.equal(x.markets.handicap.same_line,true);assert.equal(x.markets.handicap.comparable,true);assert.equal(x.markets.handicap.v1_result,'loss');assert.equal(x.markets.handicap.v2_result,'win')});
test('away V1 line converted back to underlying home line',()=>{const s=clone(snap);s.prediction_data.analysis.recommendations.handicap={pick:'away',line:3.5};const v=clone(ready);v.model_output.shadow_directions.handicap='home';assert.equal(c.compare(s,v).markets.handicap.comparable,true)});
test('different spread lines do not enter paired sample',()=>{const x=clone(ready);x.model_output.market.home_spread=-4.5;assert.equal(c.compare(snap,x).markets.handicap.comparable,false)});
test('unverified excluded missing negative and tied scores not graded',()=>{for(const patch of [{status:'pending'},{excluded_from_public:true},{final_home:null},{final_home:-1},{final_home:108},{final_home:true}]){const row=c.compare({...snap,...patch},ready);assert.equal(row.verified,false);assert.equal(row.markets.moneyline.v1_result,null)}});
test('whole-line pushes and quarter-line split settlements',()=>{assert.equal(c.settleTotal('over',220,110,110),'push');assert.equal(c.settleTotal('over',219.75,110,110),'half_win');assert.equal(c.settleTotal('under',219.75,110,110),'half_loss');assert.equal(c.settleSpread('away',2,110,108),'push');assert.equal(c.settleSpread('home',-2.25,110,108),'half_loss')});
test('source-error row never contributes V2 result',()=>{const v={...ready,status:'source_error'};assert.equal(c.compare(snap,v).markets.moneyline.v2_result,null)});
test('live final_home/final_away map to existing dashboard score fields',()=>{
 const row=c.compare({...snap,home_score:999,away_score:998},ready);
 assert.equal(row.home_score,110);assert.equal(row.away_score,108);assert.equal(row.verified,true);
 assert.equal(c.compare({...snap,final_home:null,home_score:110},ready).verified,false);
});
test('paired stats retain differing picks with same market',()=>{const x=c.rate([c.compare(snap,ready)]).handicap;assert.equal(x.paired_count,1);assert.equal(x.paired_v1_rate,0);assert.equal(x.paired_v2_rate,100)});
test('admin auth outage is 500 and not false expired-session 401',async()=>{const m=backendMock({authError:true}),x=load('admin-nba-v2-compare',m.fetchImpl);assert.equal((await x.handler(request({action:'compare'}))).status,500)});
test('compare API is read-only and returns shape frontend expects',async()=>{const m=backendMock(),x=load('admin-nba-v2-compare',m.fetchImpl);const response=await x.handler(request({action:'compare',days:30}));const body=await response.json();assert.equal(response.status,200);assert.ok(Array.isArray(body.rows));assert.equal(body.read_only,true);assert.equal(m.calls.filter(v=>v.url.includes('/rest/')&&v.method!=='GET').length,0)});
test('efficiency probe uses at most 10 provider calls with cache writes isolated',async()=>{const m=backendMock(),x=load('nba-v2-unified-runner',m.fetchImpl),z=await x.probeEfficiency(snap);assert.equal(z.status,'ready');assert.equal(z.model.model_family,'possession_efficiency_with_bayesian_shrinkage');assert.ok(z.api_requests<=10);assert.equal(m.unified.size,0);assert.ok(m.cache.size<=6);assert.equal(m.calls.filter(v=>v.url.includes('api-sports.io')).length,z.api_requests)});
test('transient statistics outage stays retryable with no poisoned invalid cache',async()=>{for(const opts of [{boxError:true},{boxMalformed:true}]){const m=backendMock(opts),x=load('nba-v2-unified-runner',m.fetchImpl),z=await x.probeEfficiency(snap);assert.equal(z.status,'source_error');assert.equal(z.model,null);assert.equal(m.cache.size,0)}});
test('genuinely unavailable statistics use scoring fallback',async()=>{const m=backendMock({boxInvalid:true}),x=load('nba-v2-unified-runner',m.fetchImpl),z=await x.probeEfficiency(snap);assert.equal(z.status,'ready');assert.equal(z.model.model_family,'bayesian_score_fallback')});
test('malformed history response is source error, never terminal insufficient data',async()=>{const m=backendMock({historyBroken:true}),x=load('nba-v2-unified-runner',m.fetchImpl),z=await x.unifiedCalculate(snap,true);assert.equal(z.status,'source_error');assert.equal(m.unified.get(snap.game_id).status,'source_error')});
test('warm cache avoids extra statistics API requests',async()=>{const m=backendMock(),x=load('nba-v2-unified-runner',m.fetchImpl);await x.probeEfficiency(snap);m.calls.length=0;await x.probeEfficiency(snap);assert.equal(m.calls.filter(v=>v.url.includes('games/statistics')).length,0)});
test('corrupt cache is refetched and cannot produce NaN-ready model',async()=>{const m=backendMock({cache:[{game_id:101,status:'valid',box_data:{home_id:999,away_id:11,pace:null,home_ortg:100,away_ortg:100}}]}),x=load('nba-v2-unified-runner',m.fetchImpl),z=await x.probeEfficiency(snap);assert.ok(m.calls.some(v=>v.url.includes('/games/statistics?id=101')));assert.equal(z.status,'ready');assert.ok(Number.isFinite(z.model.expected_total))});
test('simultaneous calculation claims exactly one processing row',async()=>{const m=backendMock(),x=load('nba-v2-unified-runner',m.fetchImpl),results=await Promise.all([x.unifiedCalculate(snap,true),x.unifiedCalculate(snap,true)]);assert.equal(results.filter(v=>v.status==='ready').length,1);assert.equal(results.filter(v=>v.status==='already_processed_or_running').length,1);assert.equal(m.unified.size,1);assert.equal(m.unified.get(snap.game_id).status,'ready')});
test('ready and fresh processing rows are not overwritten',async()=>{for(const status of ['ready','insufficient_data','processing']){const m=backendMock({unified:[{game_id:snap.game_id,status,updated_at:iso(now)}]}),x=load('nba-v2-unified-runner',m.fetchImpl);assert.equal((await x.unifiedCalculate(snap,true)).status,'already_processed_or_running');assert.equal(m.calls.filter(v=>v.url.includes('api-sports.io')).length,0)}});
test('source_error and stale processing can be reclaimed',async()=>{for(const status of ['source_error','processing']){const m=backendMock({unified:[{game_id:snap.game_id,status,updated_at:iso(now-31*60000)}]}),x=load('nba-v2-unified-runner',m.fetchImpl);assert.equal((await x.unifiedCalculate(snap,true)).status,'ready')}});
test('old worker cannot overwrite a reclaimed processing lease',async()=>{const m=backendMock({unified:[{game_id:snap.game_id,status:'processing',updated_at:iso(now)}]}),x=load('nba-v2-unified-runner',m.fetchImpl);await assert.rejects(x.unifiedPatch(snap.game_id,{status:'ready'},{updated_at:iso(now-31*60000)}),/LEASE_LOST/);assert.equal(m.unified.get(snap.game_id).status,'processing')});
test('dry run is read-only and prioritizes new fixtures over retries',async()=>{const a={...snap,game_id:1},b={...snap,game_id:2,fixture_time:iso(now+6*3600000),generated_at:iso(now-4*3600000)};const m=backendMock({snapshots:[a,b],unified:[{game_id:1,status:'source_error',updated_at:iso(now)}]}),x=load('nba-v2-unified-runner',m.fetchImpl),res=await(await x.handler(request({action:'dry_run'}))).json();assert.equal(res.candidates[0].game_id,2);assert.equal(res.max_games_per_run,1);assert.ok(m.calls.every(v=>v.method==='GET'))});
test('no eligible matches succeeds without provider calls or writes',async()=>{const m=backendMock({snapshots:[]}),x=load('nba-v2-unified-runner',m.fetchImpl),res=await(await x.handler(request({action:'run'}))).json();assert.equal(res.success,true);assert.equal(res.processed,0);assert.ok(m.calls.every(v=>v.method==='GET'))});
(async()=>{let fail=0;for(const t of tests){try{await t.fn();console.log('PASS '+t.name)}catch(e){fail++;console.error('FAIL '+t.name+'\n'+e.stack)}}console.log(JSON.stringify({suite:'NBA backend functional regression',passed:tests.length-fail,failed:fail}));process.exitCode=fail?1:0;})();
