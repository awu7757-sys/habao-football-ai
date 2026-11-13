const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(__dirname+'/fixtures/player-context-pregame-20261113.json','utf8'));
const source=fs.readFileSync(__dirname+'/nba-v2-stage-runner.index.txt','utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const snapshot={game_id:17114,fixture_time:fixture.kickoff,prediction_data:{fixture:{home:{id:1,name:'Phoenix Suns'},away:{id:2,name:'Charlotte Hornets'},season:2026}}};
const base={expected_home_points:114,expected_away_points:110,expected_margin:4,expected_total:224,margin_sigma:16,total_sigma:20,home_win_probability:.59871,home_cover_probability:.53735,over_probability:.53785,market:{available:true,home_spread:-2.5,total:222.5}};
function setup(options={}){
 const clock={now:Date.parse(options.now||fixture.as_of)},calls=[];class Clock extends Date{constructor(...args){super(...(args.length?args:[clock.now]))}static now(){return clock.now}}
 const data=clone(fixture);
 const c=vm.createContext({Date:Clock,Intl,Math,Number,String,JSON,Object,Array,Map,Set,URL,URLSearchParams,TextDecoder,Uint8Array,Response,Request,AbortSignal,crypto:require('node:crypto').webcrypto,console,
 Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-role',API_NBA_KEY:'private-nba',BASKETBALL_T10_CRON_KEY:'private-cron'})[k]||''},serve:handler=>c.handler=handler},fetch:async raw=>{
  calls.push(String(raw));if(options.unavailable)throw Error('fetch failed');const u=new URL(raw);
  let body;if(u.hostname==='stats.nba.com'){if(options.noLineups)throw Error('blocked');body=data.lineups;}
  else if(u.pathname.endsWith('/scoreboard'))body=data.scoreboard;
  else if(u.searchParams.get('event')==='401909979')body=data.summary;
  else body=data.history[u.searchParams.get('event')];
  if(options.advance)clock.now+=options.advance;return new Response(JSON.stringify(body));
 }});vm.runInContext(source,c);return {c,clock,calls,data};
}
const tests=[];function test(n,f){tests.push([n,f]);}
test('observed pregame feeds yield four injury names, expected lineups and five completed boxes per team',async()=>{
 const x=setup(),budget={},e=await x.c.collectPlayerContext(snapshot,budget);assert.equal(e.availability.status,'data_returned');assert.equal(e.availability.items.length,4);assert.equal(e.lineups.status,'expected');assert.equal(e.history.home.length,5);assert.equal(e.history.away.length,5);assert.ok(budget.context_calls<=13);assert.equal(e.event_id,'401909979');
 assert.deepEqual(Array.from(e.availability.items,p=>p.name),['Mark Williams','Brandon Miller','Kon Knueppel','Dennis Schroder']);
});
test('source cache avoids repeat calls and records original fetch time',async()=>{
 const x=setup();const a=await x.c.collectPlayerContext(snapshot,{}),before=x.calls.length,b=await x.c.collectPlayerContext(snapshot,{});assert.equal(x.calls.length,before);assert.equal(b.availability.fetched_at,a.availability.fetched_at);
});
test('fixture ID mapping requires both teams, exact date, home/away and matching season',async()=>{
 for(const mutate of [d=>d.summary.header.season.year=2026,d=>d.scoreboard.events.push(clone(d.scoreboard.events.at(-1))),d=>d.summary.header.competitions[0].date='2026-11-14T02:00Z',d=>d.summary.header.competitions[0].competitors[0].team.displayName='Wrong Team']){
  const x=setup();mutate(x.data);const e=await x.c.collectPlayerContext(snapshot,{});assert.equal(e.availability.status,'not_available');assert.equal(e.event_id,undefined);
 }
});
test('an expected five is never labeled confirmed or applied as confirmed starters',async()=>{
 const x=setup(),e=await x.c.collectPlayerContext(snapshot,{}),m=x.c.applyPlayerContext(base,e);assert.equal(e.lineups.status,'expected');assert.equal(m.player_context_adjustment.lineup_adjustment_applied,false);assert.equal(m.player_context_adjustment.injury_adjustment_applied,true);
});
test('exactly five explicitly confirmed active positions unlock lineup adjustment',async()=>{
 const x=setup();for(const t of [x.data.lineups.games.at(-1).homeTeam,x.data.lineups.games.at(-1).awayTeam])for(const p of t.players)p.lineupStatus='Confirmed';
 const e=await x.c.collectPlayerContext(snapshot,{}),m=x.c.applyPlayerContext(base,e);assert.equal(e.lineups.status,'data_returned');assert.equal(m.player_context_adjustment.lineup_adjustment_applied,true);
});
test('incomplete, duplicate, wrong-team and future lineup rows cannot confirm a team',async()=>{
 for(const mutate of [t=>t.players.pop(),t=>t.players.push(clone(t.players[0])),t=>t.players[0].teamId=999,t=>t.players[0].timestamp='2026-11-13T19:30:00']){
  const x=setup();const t=x.data.lineups.games.at(-1).homeTeam;t.players.forEach(p=>p.lineupStatus='Confirmed');mutate(t);const e=await x.c.collectPlayerContext(snapshot,{});assert.notEqual(e.lineups.teams.find(t=>t.side==='home').status,'confirmed');
 }
});
test('NBA timestamps respect Eastern daylight and standard time rather than server timezone',()=>{
 const x=setup();assert.equal(x.c.contextLocalTime('2026-11-12T19:30:00'),Date.parse('2026-11-13T00:30:00Z'));assert.equal(x.c.contextLocalTime('2026-07-12T19:30:00'),Date.parse('2026-07-12T23:30:00Z'));assert.equal(x.c.contextDay(Date.parse(fixture.kickoff)),'20261112');
});
test('fresh game report retains old-onset injuries and rejects future reports',async()=>{
 const x=setup();x.data.summary.injuries[1].injuries[0].date='2026-11-14T00:00Z';const e=await x.c.collectPlayerContext(snapshot,{});assert.ok(e.availability.items.some(p=>p.name==='Mark Williams'));assert.ok(!e.availability.items.some(p=>p.name==='Brandon Miller'));assert.notEqual(e.availability.status,'data_returned');
});
test('questionable and probable do not become confirmed absences',async()=>{
 const x=setup(),e=await x.c.collectPlayerContext(snapshot,{});for(const p of e.availability.items)p.status='questionable';const m=x.c.applyPlayerContext(base,e);assert.equal(m.player_context_adjustment.injury_adjustment_applied,false);assert.equal(m.expected_margin,base.expected_margin);
});
test('confirmed active lineup overrides conflicting secondary injury status without hiding conflict',async()=>{
 const x=setup(),e=await x.c.collectPlayerContext(snapshot,{});e.lineups.teams.find(t=>t.side==='away').active=['Brandon Miller'];const m=x.c.applyPlayerContext(base,e);assert.ok(m.player_context_adjustment.teams.find(t=>t.side==='away').conflicts.includes('Brandon Miller'));assert.ok(!m.player_context_adjustment.teams.find(t=>t.side==='away').players.some(p=>p.name==='Brandon Miller'&&p.reason==='confirmed_absence'));
});
test('long-term absence already absent from recent boxes causes no second penalty',async()=>{
 const x=setup(),e=await x.c.collectPlayerContext(snapshot,{}),h=x.c.contextTeamImpact('home',e);assert.equal(h.injury_applied,false);assert.equal(h.net_margin_delta,0);assert.equal(h.players.length,0);
});
test('real historical appearances yield reproducible bounded margin correction and unchanged totals',async()=>{
 const x=setup(),e=await x.c.collectPlayerContext(snapshot,{}),raw=JSON.stringify(e),m=x.c.applyPlayerContext(base,e);assert.equal(m.player_context_adjustment.injury_adjustment_applied,true);assert.notEqual(m.expected_margin,base.expected_margin);assert.ok(Math.abs(m.player_context_adjustment.net_margin_delta)<=3);assert.equal(m.expected_total,base.expected_total);assert.equal(m.over_probability,base.over_probability);assert.notEqual(m.home_win_probability,base.home_win_probability);assert.notEqual(m.home_cover_probability,base.home_cover_probability);assert.deepEqual(JSON.parse(JSON.stringify(x.c.applyPlayerContext(base,e))),JSON.parse(JSON.stringify(m)));assert.equal(JSON.stringify(e),raw);assert.equal(base.expected_margin,4);
});
test('too few completed player boxes never silently substitute invented ratings',async()=>{
 const x=setup(),e=await x.c.collectPlayerContext(snapshot,{});e.history.home=e.history.home.slice(0,2);e.history.away=e.history.away.slice(0,2);const m=x.c.applyPlayerContext(base,e);assert.equal(m.expected_margin,4);assert.equal(m.player_context_adjustment.status,'not_applied');
});
test('unfinished, wrong-date, wrong-season and malformed historical boxes are rejected',()=>{
 for(const mutate of [d=>d.header.competitions[0].status.type.completed=false,d=>d.header.season.year=2026,d=>d.header.competitions[0].date=fixture.kickoff,d=>d.boxscore.players.find(t=>t.team.id==='21').statistics[0].athletes[0].stats[0]='garbage']){
  const x=setup(),event=x.data.summary.lastFiveGames[0].events.at(-1),h=clone(x.data.history[event.id]);mutate(h);assert.equal(x.c.contextHistory(h,'21',event,x.clock.now,2026),null);
 }
});
test('missing feed does not imply a clean injury report or suppress available independent injuries',async()=>{
 const no=setup({unavailable:true}),none=await no.c.collectPlayerContext(snapshot,{});assert.equal(none.availability.status,'not_available');assert.equal(no.c.applyPlayerContext(base,none).player_context_adjustment.status,'not_applied');
 const x=setup({noLineups:true}),e=await x.c.collectPlayerContext(snapshot,{});assert.equal(e.availability.status,'data_returned');assert.equal(e.lineups.status,'source_unavailable');assert.equal(x.c.applyPlayerContext(base,e).player_context_adjustment.injury_adjustment_applied,true);
});
test('started fixtures never fetch or masquerade as pregame evidence',async()=>{
 const x=setup({now:'2026-11-13T02:01:00Z'}),e=await x.c.collectPlayerContext(snapshot,{});assert.equal(x.calls.length,0);assert.equal(e.event_id,undefined);assert.ok(e.warnings.includes('context_fixture_not_pregame'));
 const y=setup();y.data.summary.header.competitions[0].status.type.state='in';const b=await y.c.collectPlayerContext(snapshot,{});assert.equal(b.event_id,undefined);assert.ok(b.warnings.includes('context_fixture_not_pregame'));
 const z=setup();z.data.lineups.games.at(-1).gameStatus=2;const d=await z.c.collectPlayerContext(snapshot,{});assert.equal(d.event_id,undefined);assert.ok(d.warnings.includes('context_fixture_not_pregame'));
});
test('conflicting duplicate injury rows are excluded rather than choosing the first status',async()=>{
 const x=setup();const rows=x.data.summary.injuries[1].injuries;rows.push({...clone(rows[0]),status:'Probable'});const e=await x.c.collectPlayerContext(snapshot,{});assert.ok(!e.availability.items.some(p=>p.name==='Brandon Miller'));assert.equal(e.availability.status,'partial');
});
test('source probe is cron authenticated, read-only and consumes no member credits',async()=>{
 const x=setup();x.c.dbGet=async t=>t==='basketball_v2_stage_settings'?[{id:true,all_members_enabled:true}]:[snapshot];x.c.rpc=async()=>{throw Error('probe must not call a mutation RPC')};x.c.patchStage=async()=>{throw Error('probe must not store a stage')};
 const req=key=>new Request('https://test/',{method:'POST',headers:{'x-habao-cron-key':key,'Content-Type':'application/json'},body:JSON.stringify({action:'probe_context',game_id:17114})});
 const no=await x.c.handler(req('wrong'));assert.equal(no.status,401);assert.equal(x.calls.length,0);
 const r=await x.c.handler(req('private-cron')),p=await r.json();assert.equal(p.success,true);assert.equal(p.read_only,true);assert.equal(p.snapshot_written,false);assert.equal(p.member_credits_consumed,0);assert.equal(p.evidence.availability.status,'data_returned');
});
test('bounded public requests reject arbitrary domains and oversized bodies',async()=>{
 const x=setup();await assert.rejects(x.c.contextJson('https://example.com/secret',{}),/context_origin_rejected/);assert.equal(x.calls.length,0);await assert.rejects(x.c.contextJson('https://stats.nba.com/x',{context_calls:13}),/context_request_limit/);
 x.c.fetch=async()=>new Response('x'.repeat(2000001));await assert.rejects(x.c.contextJson('https://stats.nba.com/x',{}),/context_body_too_large/);
});
test('full T-15 capture persists source features, actual flags and adjusted result atomically by lease',async()=>{
 const x=setup({now:'2026-11-13T01:50:00Z'});let stored;
 x.c.rpc=async()=>true;x.c.nbaRequest=async()=>[{id:17114,date:{start:fixture.kickoff},league:'standard',status:{short:1},teams:{home:{id:1},visitors:{id:2}}}];
 x.c.currentMarket=async()=>base.market;x.c.stageModel=async()=>({status:'ready',model:clone(base),history_counts:{home:5,away:5}});x.c.patchStage=async(id,stage,token,row)=>{stored={id,stage,token,row};};
 const reply=await x.c.captureStage(snapshot,'t15');assert.equal(reply.status,'ready');assert.equal(stored.row.result_data.v2_stage,'t15');assert.equal(stored.row.source_meta.availability_status,'data_returned');assert.equal(stored.row.source_meta.lineup_status,'expected');assert.equal(stored.row.source_meta.injury_adjustment_applied,true);assert.equal(stored.row.source_meta.lineup_adjustment_applied,false);assert.equal(stored.row.source_meta.player_context_features.history.away.length,5);assert.equal(stored.row.model_output.expected_margin,stored.row.result_data.model.expected_margin);assert.notEqual(stored.row.model_output.expected_margin,base.expected_margin);assert.equal(stored.row.result_data.analysis.v2_stage_evidence.availability.items.length,4);
});
test('source signaling in-play prevents even an otherwise successful base-model capture',async()=>{
 const x=setup({now:'2026-11-13T01:50:00Z'});let stored;x.data.summary.header.competitions[0].status.type.state='in';x.c.rpc=async()=>true;x.c.nbaRequest=async()=>[{id:17114,date:{start:fixture.kickoff},league:'standard',status:{short:1},teams:{home:{id:1},visitors:{id:2}}}];x.c.currentMarket=async()=>base.market;x.c.stageModel=async()=>({status:'ready',model:clone(base)});x.c.patchStage=async(id,stage,token,row)=>{stored=row;};const reply=await x.c.captureStage(snapshot,'t15');assert.equal(reply.status,'source_error');assert.equal(stored.status,'source_error');assert.equal(stored.result_data,undefined);
});
test('result presentation distinguishes names, confirmation and actually applied context, escaping provider text',()=>{
 const html=fs.readFileSync(__dirname+'/analysis.html','utf8'),start=html.indexOf('    const nbaStage=['),end=html.indexOf('    const resultTeamLogo=',start),body=html.slice(start,end);
 const render=new Function('data',`const isBasketballAnalysis=true,footballV2Evidence=data.analysis.v2_stage_evidence;const escapePartnerHtml=x=>String(x).replaceAll('<','&lt;').replaceAll('>','&gt;'),confidenceBar=x=>Number(x),confidenceFire=()=>'',analysisT=(k,f)=>f;${body};return nbaEvidenceHtml;`);
 const d={v2_stage:'t15',analysis:{v2_stage_evidence:{availability:{status:'data_returned',source:'ESPN',items:[{side:'home',name:'<script>',status:'out'}],teams:[{side:'home',status:'data_returned'}]},lineups:{status:'expected',teams:[{side:'home',status:'expected',starters:[{name:'Player'}]}]},player_adjustment:{status:'applied',injury_adjustment_applied:true,lineup_adjustment_applied:false}}}};
 const out=render(d);assert.ok(out.includes('預估名單，尚未確認'));assert.ok(out.includes('確認缺陣已納入'));assert.ok(out.includes('&lt;script&gt;'));assert.ok(!out.includes('<script>'));assert.ok(!out.includes('雙方已確認'));
});
(async()=>{let failed=0;for(const [name,fn]of tests){try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}console.log(JSON.stringify({suite:'NBA pregame player context',passed:tests.length-failed,failed}));process.exitCode=failed?1:0;})();
