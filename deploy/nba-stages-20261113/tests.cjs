const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require('../football-audit/runtime/node_modules/@electric-sql/pglite'));}
const root=__dirname,db=new PGlite(),pilot='google_2d3cef6b6e2d';let passed=0,failed=0;
const src=n=>fs.readFileSync(fs.existsSync(root+'/'+n)?root+'/'+n:root+'/../../'+n,'utf8');
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack)}}
const iso=x=>new Date(x).toISOString(),now=Date.now();
const json=(b,status=200)=>new Response(JSON.stringify(b),{status});
function runner(fetchImpl=async()=>{throw Error('unexpected fetch')}){
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'role-private',API_NBA_KEY:'nba-private',BASKETBALL_T10_CRON_KEY:'cron-private',ODDS_API_KEY:'odds-private'};
 const c=vm.createContext({Date,Math,JSON,Number,Set,Map,URL,URLSearchParams,Response,Request,AbortSignal,crypto:require('node:crypto').webcrypto,console,fetch:fetchImpl,Deno:{env:{get:k=>env[k]},serve:fn=>c.handler=fn}});vm.runInContext(src('nba-v2-stage-runner.index.txt'),c);return c;
}
function endpoint(fetchImpl){const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'role-private'};const c=vm.createContext({Date,Number,JSON,Set,URLSearchParams,Response,Request,AbortSignal,console,fetch:fetchImpl,Deno:{env:{get:k=>env[k]},serve:fn=>c.handler=fn}});vm.runInContext(src('nba-v2-stage-member.index.txt'),c);return c;}
const req=(b,auth='Bearer user-token')=>new Request('https://test/',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(b)});
async function add(id,stage='t2',minutes=60){const result={success:true,sport:'basketball',game_id:id,v2_stage:stage,fixture:{id},analysis:{recommendations:{}}};await db.query("INSERT INTO basketball_v2_stage_snapshots(game_id,stage,fixture_time,source_snapshot_at,model_version,status,captured_at,model_output,result_data) VALUES($1,$2,clock_timestamp()+($3||' minutes')::interval,clock_timestamp()-interval '9 hours','test','ready',clock_timestamp()+(($3::integer-(CASE WHEN $2='t2' THEN 120 ELSE 15 END)+1)||' minutes')::interval,'{}',$4)",[id,stage,String(minutes),result]);}
async function claim(id,stage='t2',account=pilot){return(await db.query('SELECT claim_nba_stage_atomic($1,$2,$3) AS value',[account,id,stage])).rows[0].value;}
const credits=async()=>Number((await db.query('SELECT analysis_credits FROM members WHERE account=$1',[pilot])).rows[0].analysis_credits);
(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE members(account text PRIMARY KEY,is_active boolean,analysis_unlimited boolean,analysis_credits integer);CREATE TABLE basketball_prediction_snapshots(game_id bigint PRIMARY KEY,fixture_time timestamptz,generated_at timestamptz);CREATE FUNCTION consume_member_analysis_credit(p_account text) RETURNS TABLE(success boolean,paid_remaining integer,daily_free_remaining integer) LANGUAGE plpgsql AS $$BEGIN RETURN QUERY UPDATE members SET analysis_credits=analysis_credits-1 WHERE account=p_account AND analysis_credits>0 RETURNING true,analysis_credits,0;END;$$;`);
 await db.exec(src('01_nba_stages.sql'));await db.query('INSERT INTO members VALUES($1,true,false,30)',[pilot]);
 await test('same game repeated/concurrent stage claim debits one point',async()=>{await add(1);const before=await credits(),results=await Promise.all([claim(1),claim(1),claim(1)]);assert.equal(await credits(),before-1);assert.equal(results.filter(x=>!x.already_claimed).length,1);});
 await test('same game T-15 is a separate point and immutable result',async()=>{await add(1,'t15',10);const before=await credits();const x=await claim(1,'t15');assert.equal(x.result.v2_stage,'t15');assert.equal(await credits(),before-1);assert.equal(x.member_access.paid_remaining,before-1);});
 await test('write failure rolls credit debit back in same transaction',async()=>{await add(2);await db.exec("CREATE FUNCTION fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.game_id=2 THEN RAISE EXCEPTION 'forced_failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER fail_claim BEFORE INSERT ON basketball_v2_stage_claims FOR EACH ROW EXECUTE FUNCTION fail_claim();");const before=await credits();await assert.rejects(claim(2),/forced_failure/);assert.equal(await credits(),before);});
 await test('empty balance creates no claim',async()=>{await add(3);await db.query('UPDATE members SET analysis_credits=0 WHERE account=$1',[pilot]);await assert.rejects(claim(3),/analysis_credits_empty/);assert.equal((await db.query('SELECT count(*)::int n FROM basketball_v2_stage_claims WHERE game_id=3')).rows[0].n,0);await db.query('UPDATE members SET analysis_credits=30 WHERE account=$1',[pilot]);});
 await test('T-15 early request rejected without debit',async()=>{await add(4,'t15',30);const before=await credits();await assert.rejects(claim(4,'t15'),/stage_not_open/);assert.equal(await credits(),before);});
 await test('saved T-2 can be claimed during T-15',async()=>{await add(5,'t2',10);assert.equal((await claim(5)).success,true);});
 await test('new claim blocked after tipoff; old claim remains free',async()=>{await add(6,'t2',-1);await assert.rejects(claim(6),/match_already_started/);await db.exec("UPDATE basketball_v2_stage_snapshots SET fixture_time=clock_timestamp()-interval '10 seconds' WHERE game_id=1");const before=await credits();assert.equal((await claim(1)).already_claimed,true);assert.equal(await credits(),before);});
 await test('missing snapshot cannot debit',async()=>{const before=await credits();await assert.rejects(claim(999),/stage_snapshot_not_ready/);assert.equal(await credits(),before);});
 await test('ordinary member cannot enter pilot stages',async()=>{await db.exec("INSERT INTO members VALUES('ordinary',true,false,10)");await assert.rejects(claim(3,'t2','ordinary'),/stage_access_disabled/);});
 await test('inactive member blocked',async()=>{await db.query('UPDATE members SET is_active=false WHERE account=$1',[pilot]);await assert.rejects(claim(3),/member_inactive/);await db.query('UPDATE members SET is_active=true WHERE account=$1',[pilot]);});
 await test('unlimited membership does not consume points',async()=>{await add(7);await db.query('UPDATE members SET analysis_unlimited=true WHERE account=$1',[pilot]);const before=await credits();await claim(7);assert.equal(await credits(),before);await db.query('UPDATE members SET analysis_unlimited=false WHERE account=$1',[pilot]);});
 await test('browser roles cannot execute financial or capture RPCs',async()=>{for(const role of ['anon','authenticated'])for(const fn of ['claim_nba_stage_atomic(text,bigint,text)','acquire_nba_stage_capture(bigint,text,text)','reserve_nba_stage_api(text,integer,integer)'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS ok',[role,'public.'+fn])).rows[0].ok,false);});
 await test('API budget reservation is capped and repeat-safe',async()=>{const r=await Promise.all([db.query("SELECT reserve_nba_stage_api('nba',1,1) AS ok"),db.query("SELECT reserve_nba_stage_api('nba',1,1) AS ok")]);assert.equal(r.filter(x=>x.rows[0].ok).length,1);});
 await test('capture lease cannot double capture or rewrite ready stage',async()=>{await db.exec("INSERT INTO basketball_prediction_snapshots VALUES(8,clock_timestamp()+interval '60 minutes',clock_timestamp()-interval '9 hours')");assert.equal((await db.query("SELECT acquire_nba_stage_capture(8,'t2','token-abcdefghijk') AS ok")).rows[0].ok,true);assert.equal((await db.query("SELECT acquire_nba_stage_capture(8,'t2','token-lmnopqrst') AS ok")).rows[0].ok,false);assert.equal((await db.query("SELECT acquire_nba_stage_capture(5,'t2','token-lmnopqrst') AS ok")).rows[0].ok,false);});
 await test('missed T-2 is not reconstructed during T-15',async()=>{await db.exec("INSERT INTO basketball_prediction_snapshots VALUES(9,clock_timestamp()+interval '10 minutes',clock_timestamp()-interval '9 hours')");assert.equal((await db.query("SELECT acquire_nba_stage_capture(9,'t2','token-abcdefghijk') AS ok")).rows[0].ok,false);});
 await test('ready snapshot cannot be stored after tipoff',async()=>{await assert.rejects(db.exec("INSERT INTO basketball_v2_stage_snapshots(game_id,stage,fixture_time,source_snapshot_at,model_version,status,captured_at,model_output,result_data) VALUES(10,'t2',now()-interval '1 minute',now()-interval '9 hours','test','ready',now(),'{}','{}')"),/check constraint/);});
 await test('odds repair requeues only observed legacy failures once, preserving ready rows and usage',async()=>{
  await db.exec("CREATE SCHEMA net;CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);INSERT INTO vault.decrypted_secrets VALUES('nba_v2_cron_key','private-test');CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,body jsonb);CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE v bigint;BEGIN INSERT INTO net.calls(body) VALUES(body) RETURNING id INTO v;RETURN v;END;$$;");
  await db.exec("INSERT INTO basketball_v2_stage_snapshots(game_id,stage,fixture_time,source_snapshot_at,model_version,status,attempts,source_meta) VALUES(17111,'t2',now()+interval '60 minutes',now()-interval '9 hours','test','source_error',4,'{\"reason\":\"current_odds_source_unavailable\"}')");
  await add(17112);const before=await db.query('SELECT * FROM basketball_v2_stage_api_budget');
  const first=await db.exec(src('04_retry_odds_format_fix.sql'));assert.equal(first[0].rows.length,1);assert.equal(Number(first[0].rows[0].game_id),17111);
  assert.equal((await db.query('SELECT attempts FROM basketball_v2_stage_snapshots WHERE game_id=17111')).rows[0].attempts,0);
  assert.equal((await db.query('SELECT status FROM basketball_v2_stage_snapshots WHERE game_id=17112')).rows[0].status,'ready');
  const repeat=await db.exec(src('04_retry_odds_format_fix.sql'));assert.equal(repeat[0].rows.length,0);assert.deepEqual((await db.query('SELECT * FROM basketball_v2_stage_api_budget')).rows,before.rows);
 });
 const r=runner();
 await test('NBA stage capture windows have exact boundaries',()=>{assert.equal(r.stageWindow(iso(now+121*60000),'t2',now),false);assert.equal(r.stageWindow(iso(now+120*60000),'t2',now),true);assert.equal(r.stageWindow(iso(now+15*60000),'t2',now),false);assert.equal(r.stageWindow(iso(now+15*60000),'t15',now),true);assert.equal(r.stageWindow(iso(now),'t15',now),false);});
 const snapshot={game_id:99,fixture_time:iso(now+60*60000),home_team:'Home Team',away_team:'Away Team',prediction_data:{fixture:{home:{name:'Home Team',id:1},away:{name:'Away Team',id:2},season:2026}}};
 const event={id:'ev',home_team:'Home Team',away_team:'Away Team',commence_time:snapshot.fixture_time,bookmakers:[{key:'test',last_update:iso(now),markets:[{key:'spreads',outcomes:[{name:'Home Team',point:-3.5,price:1.9},{name:'Away Team',point:3.5,price:1.9}]},{key:'totals',outcomes:[{name:'Over',point:225.5,price:1.9},{name:'Under',point:225.5,price:1.9}]}]}]};
 await test('stage uses actual paired betting lines',()=>{const m=r.parseMarket([event],snapshot,now);assert.equal(m.home_spread,-3.5);assert.equal(m.total,225.5);assert.equal(m.available,true);});
 await test('wrong teams, stale or conflicting markets are rejected',()=>{assert.equal(r.parseMarket([{...event,away_team:'Wrong Team'}],snapshot,now).available,false);assert.equal(r.parseMarket([event,event],snapshot,now).available,false);assert.equal(r.parseMarket([{...event,bookmakers:[{...event.bookmakers[0],last_update:iso(now-21*60000)}]}],snapshot,now).available,false);});
 await test('away cover keeps positive original line; missing line stays null',()=>{const model={home_win_probability:.6,home_cover_probability:.4,over_probability:.6,expected_home_points:115,expected_away_points:110,expected_margin:5,expected_total:225,market:{home_spread:-3.5,total:225.5,available:true}};const a=r.stageResult(snapshot,'t2',model,{capture_mode:'scheduled'});assert.equal(a.analysis.recommendations.handicap.line,3.5);assert.equal(a.analysis.recommendations.handicap.pick,'客隊');assert.equal(a.sport,'basketball');assert.equal(a.market_data.injuries.available,false);const b=r.stageResult(snapshot,'t15',{...model,home_cover_probability:null,over_probability:null,market:{available:false,home_spread:null,total:null}},{capture_mode:'late_pre_match_recovery'});assert.equal(b.analysis.recommendations.handicap.pick,'暫不推薦');assert.equal(b.analysis.recommendations.over_under.line,null);assert.match(b.analysis.v2_stage_evidence.note,/補抓/);});
 await test('runner unauthorized calls cannot read DB or spend API',async()=>{const res=await r.handler(req({action:'run'}));assert.equal(res.status,401);});
 await test('odds time filters use UTC whole seconds and never milliseconds',async()=>{
  let url;
  const c=runner(async(raw)=>{if(String(raw).includes('/rpc/'))return json(true);url=new URL(raw);return json([event]);});
  await c.currentMarket(snapshot,{nba_calls:0,odds_calls:0});
  for(const name of ['commenceTimeFrom','commenceTimeTo'])assert.match(url.searchParams.get(name),/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(Date.parse(url.searchParams.get('commenceTimeTo'))-Date.parse(url.searchParams.get('commenceTimeFrom')),30*60000);
 });
 await test('odds HTTP status and safe provider code remain distinguishable',async()=>{
  for(const [status,code] of [[401,'INVALID_KEY'],[422,'INVALID_COMMENCE_TIME_FROM'],[429,'EXCEEDED_FREQ_LIMIT'],[401,'OUT_OF_USAGE_CREDITS']]){
   const c=runner(async raw=>String(raw).includes('/rpc/')?json(true):json({error_code:code,message:'sensitive-url-with-odds-private'},status));
   await assert.rejects(c.currentMarket(snapshot,{odds_calls:0}),e=>e.message==='odds_http_'+status+'_'+code&&!e.message.includes('odds-private'));
  }
 });
 await test('malformed error bodies and network errors cannot leak request keys',async()=>{
  const c=runner(async raw=>String(raw).includes('/rpc/')?json(true):json({error_code:'https://private/?apiKey=odds-private'},500));
  await assert.rejects(c.currentMarket(snapshot,{odds_calls:0}),/odds_http_500_UNSPECIFIED/);
  const n=runner(async raw=>{if(String(raw).includes('/rpc/'))return json(true);throw Error('https://private/?apiKey=odds-private');});
  await assert.rejects(n.currentMarket(snapshot,{odds_calls:0}),e=>e.message==='odds_network_error');
 });
 await test('member spoofing cannot read claims or spend points',async()=>{let calls=0;const c=endpoint(async url=>{calls++;if(String(url).includes('settings'))return json([{pilot_account:pilot,all_members_enabled:false}]);if(String(url).includes('oauth-member-login'))return json({success:true,member:{account:'attacker'}});throw Error('unexpected');});const res=await c.handler(req({action:'claim',account:pilot,game_id:99,stage:'t2'}));assert.equal(res.status,401);assert.equal(calls,2);});
 await test('OPTIONS succeeds without authentication for both functions',async()=>{for(const c of [r,endpoint(async()=>{throw Error('unexpected')})]){const res=await c.handler(new Request('https://test/',{method:'OPTIONS'}));assert.equal(res.status,204);assert.equal(res.headers.get('Access-Control-Allow-Origin'),'*');}});
 await test('full scheduled capture stores a fresh model, actual lines and late-capture marker',async()=>{
  const calls=[],writes=[];let reservations=0;
  const game=(id,team)=>({id,league:'standard',date:{start:iso(now-5*86400000)},status:{short:3},teams:{home:{id:team},visitors:{id:team+10}},scores:{home:{points:114},visitors:{points:108}}});
  const home=[101,102,103].map(id=>game(id,1)),away=[201,202,203].map(id=>game(id,2));
  const c=runner(async(raw,init={})=>{
   const u=new URL(raw),method=init.method||'GET';calls.push({path:u.pathname,method});
   if(u.pathname.endsWith('/acquire_nba_stage_capture'))return json(true);
   if(u.pathname.endsWith('/reserve_nba_stage_api')){reservations++;return json(true);}
   if(u.pathname.endsWith('/basketball_v2_stage_snapshots')&&method==='PATCH'){writes.push(JSON.parse(init.body));return json([{}]);}
   if(u.pathname.endsWith('/basketball_v2_box_cache'))return json([...home,...away].map(g=>({game_id:g.id,status:'valid',box_data:{home_id:g.teams.home.id,away_id:g.teams.visitors.id,pace:99,home_ortg:115,away_ortg:109}})));
   if(u.hostname==='api.the-odds-api.com')return json([event]);
   if(u.hostname==='v2.nba.api-sports.io'){
    if(u.searchParams.has('id'))return json({errors:[],response:[{id:99,league:'standard',date:{start:snapshot.fixture_time},status:{short:1},teams:{home:{id:1},visitors:{id:2}}}]});
    const season=Number(u.searchParams.get('season')),team=Number(u.searchParams.get('team'));
    return json({errors:[],response:season===2026?(team===1?home:away):[]});
   }
   throw Error('Unexpected route '+u.pathname);
  });
  const out=await c.captureStage(snapshot,'t2');assert.equal(out.status,'ready');assert.equal(out.capture_mode,'late_pre_match_recovery');assert.equal(out.nba_calls,5);assert.equal(out.odds_calls,1);assert.equal(reservations,6);assert.equal(writes.length,1);assert.equal(writes[0].model_output.market.home_spread,-3.5);assert.equal(writes[0].source_meta.include_in_stage_comparison,false);assert.ok(!calls.some(x=>x.method!=='GET'&&x.path.endsWith('/basketball_prediction_snapshots')));
 });
 await test('provider started/changed fixture never stores a ready stage',async()=>{
  const writes=[];const c=runner(async(raw,init={})=>{const u=new URL(raw);if(u.pathname.includes('/rpc/'))return json(true);if(u.hostname==='v2.nba.api-sports.io')return json({errors:[],response:[{id:99,status:{short:2}}]});if(init.method==='PATCH'){writes.push(JSON.parse(init.body));return json([{}]);}throw Error('Unexpected request');});
  const out=await c.captureStage(snapshot,'t2');assert.equal(out.status,'source_error');assert.match(out.reason,/fixture_started/);assert.equal(writes[0].status,'source_error');assert.equal(writes[0].model_output,undefined);
 });
 await test('member repeat read uses saved stage before time or capture requests',async()=>{
  let consumed=false;const saved={success:true,sport:'basketball',game_id:99,v2_stage:'t2',analysis:{}};
  const c=endpoint(async(raw,init={})=>{const u=new URL(raw);if(u.pathname.endsWith('/basketball_v2_stage_settings'))return json([{pilot_account:pilot,all_members_enabled:false}]);if(u.pathname.includes('oauth-member-login'))return json({success:true,member:{account:pilot}});if(u.pathname.endsWith('/members'))return json([{account:pilot,is_active:true}]);if(u.pathname.endsWith('/basketball_v2_stage_claims'))return json([{result_data:saved}]);consumed=true;throw Error('Unexpected request');});
  const out=await(await c.handler(req({action:'claim',account:pilot,game_id:99,stage:'t2'}))).json();assert.equal(out.success,true);assert.equal(out.already_claimed,true);assert.equal(consumed,false);
 });
 let ui;const c=vm.createContext({window:{setInterval(){},addEventListener(){},location:{}},document:{createElement:()=>({}),head:{appendChild(){}},querySelector:()=>null},sessionStorage:{getItem:()=>JSON.stringify({account:pilot})},console,Date,Number,Map,Set,JSON});vm.runInContext(src('nba-stages.js'),c);ui=c.window.habaoNbaStages;
 await test('after T-10 claim button immediately waits for blue T-2',()=>{const x=ui.decision(iso(now+180*60000),{t10:true},now);assert.equal(x.stage,'t2');assert.equal(x.disabled,true);});
 await test('T-2 opens without requiring earlier claim; T-15 follows',()=>{assert.equal(ui.decision(iso(now+90*60000),{},now).stage,'t2');const x=ui.decision(iso(now+90*60000),{t2:true},now);assert.equal(x.stage,'t15');assert.equal(x.disabled,true);assert.equal(ui.decision(iso(now+10*60000),{},now).disabled,false);});
 await test('completed current stage is disabled; tipoff always closes',()=>{assert.equal(ui.decision(iso(now+10*60000),{t15:true},now).disabled,true);assert.equal(ui.decision(iso(now),{},now).label,'分析已截止');});
 await test('all updated page scripts and both function bundles parse',()=>{for(const file of ['football.html','analysis.html'])for(const m of src(file).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/src\s*=|application\/ld\+json|application\/json/.test(m[1])||!m[2].trim())continue;new vm.Script(m[2]);}new vm.Script(src('nba-stages.js'));new vm.Script(src('nba-v2-stage-member.index.txt'));new vm.Script(src('nba-v2-stage-runner.index.txt'));assert.ok(src('football.html').includes('nba-stages.js?v=20261113-2'));});
 await test('read-only live-evidence SQL compares member results with their frozen stage snapshot',async()=>{
  await db.exec("ALTER TABLE basketball_prediction_snapshots ADD COLUMN model_version text;ALTER TABLE basketball_prediction_snapshots ADD COLUMN prediction_data jsonb;");
  const rows=(await db.exec(src('05_verify_stage_results.sql')))[0].rows;
  assert.ok(rows.length>0);assert.ok(rows.every(x=>Number(x.claim_snapshot_mismatches)===0));
 });
 console.log(JSON.stringify({suite:'NBA stage financial, capture, frontend tests',passed,failed}));await db.close();process.exitCode=failed?1:0;
})().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
