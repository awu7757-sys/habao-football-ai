// Current-time MLB stages. Historical verification never creates pre-game snapshots.
const BASE=String(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,''),ROLE=String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SUPABASE_SECRET_KEY')||'');
const CRON=String(Deno.env.get('BASKETBALL_T10_CRON_KEY')||''),ODDS_KEY=String(Deno.env.get('THE_ODDS_API_KEY')||Deno.env.get('ODDS_API_KEY')||'');
const REVISION='sports-release-mlb-20261114-players-1',MODEL='mlb-stages-players-v0.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-habao-cron-key','Access-Control-Allow-Methods':'POST,OPTIONS','X-Habao-Version':REVISION};
const reply=(code,body)=>new Response(JSON.stringify(body),{status:code,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const dbHeaders=()=>({apikey:ROLE,Authorization:'Bearer '+ROLE,'Content-Type':'application/json'});
async function db(table,params){const r=await fetch(BASE+'/rest/v1/'+table+'?'+new URLSearchParams(params),{headers:dbHeaders(),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('storage_read_'+table+'_'+r.status);const p=await r.json();if(!Array.isArray(p))throw Error('invalid_storage_rows');return p;}
async function rpc(name,body){const r=await fetch(BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:dbHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('storage_rpc_'+name);return r.json();}
function innings(v){const m=/^(\d+)(?:\.([012]))?$/.exec(String(v??''));return m?Number(m[1])+Number(m[2]||0)/3:0;}
function projectMlb(hs,as,hp,ap,hr,ar){
 if(![hs.runs_per_game,hs.runs_allowed_per_game,as.runs_per_game,as.runs_allowed_per_game].every(Number.isFinite)||hs.games_played<5||as.games_played<5)return null;
 const blend=(base,v,count)=>{const w=Number.isFinite(v)?.25*Math.min(10,count||0)/10:0;return base*(1-w)+(Number.isFinite(v)?v:base)*w;};
 let h=(blend(hs.runs_per_game,hr?.runs_per_game,hr?.games_used)+blend(as.runs_allowed_per_game,ar?.runs_allowed_per_game,ar?.games_used))/2;
 let a=(blend(as.runs_per_game,ar?.runs_per_game,ar?.games_used)+blend(hs.runs_allowed_per_game,hr?.runs_allowed_per_game,hr?.games_used))/2;
 const hd=Number.isFinite(hp.era)&&innings(hp.innings)>=20&&Number.isFinite(hs.era)?Math.max(-.65,Math.min(.65,(hp.era-hs.era)*.15)):0;
 const ad=Number.isFinite(ap.era)&&innings(ap.innings)>=20&&Number.isFinite(as.era)?Math.max(-.65,Math.min(.65,(ap.era-as.era)*.15)):0;
 h=Math.max(.5,h+.14+ad);a=Math.max(.5,a+hd);
 return {home_runs:round(h),away_runs:round(a),total_runs:round(h+a),home_run_margin:round(h-a),winner:h>=a?'home':'away',method:'season_recent10_blend_plus_qualified_starters_v0.3',starter_impact:{home_starter_opponent_delta:round(hd,4),away_starter_opponent_delta:round(ad,4),home_qualified:innings(hp.innings)>=20&&Number.isFinite(hp.era),away_qualified:innings(ap.innings)>=20&&Number.isFinite(ap.era)}};
}
async function mlbPlayerContext(gameId,expected,now=new Date().toISOString()){
 const feed=await fetchJson('https://statsapi.mlb.com/api/v1.1/game/'+gameId+'/feed/live');const gd=feed.gameData||{};
 if(Number(gd.game?.pk)!==Number(gameId)||Number(gd.teams?.home?.id)!==Number(expected.home.id)||Number(gd.teams?.away?.id)!==Number(expected.away.id)||Math.abs(Date.parse(gd.datetime?.dateTime)-Date.parse(expected.kickoff_at))>60000)throw Error('mlb_context_fixture_mismatch');
 const teams=[],items=[],pitchers={};const day=new Date(now).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 for(const side of ['home','away']){
  const t=gd.teams[side],box=feed.liveData?.boxscore?.teams?.[side]||{},order=Array.isArray(box.battingOrder)?box.battingOrder:[];
  const unique=[...new Set(order.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))],players=box.players||{};
  const names=unique.map(id=>({id,name:players['ID'+id]?.person?.fullName||gd.players?.['ID'+id]?.fullName||''}));
  const confirmed=names.length===9&&names.every(x=>x.name);teams.push({side,team_id:t.id,status:confirmed?'confirmed':names.length?'partial':'not_published',batting_order:names});
  const pitcher=gd.probablePitchers?.[side];pitchers[side]=pitcher?.id?{id:pitcher.id,name:pitcher.fullName,status:'expected'}:null;
  try{const roster=await fetchJson('https://statsapi.mlb.com/api/v1/teams/'+t.id+'/roster?rosterType=fullRoster&date='+day);if(!Array.isArray(roster.roster))throw Error('invalid_roster');
   teams.find(x=>x.side===side).active_roster_ids=roster.roster.filter(p=>p.status?.code==='A').map(p=>Number(p.person?.id));
   for(const p of roster.roster)if(/^D(7|10|15|60)$|^IL/.test(String(p.status?.code||''))||/injured|disabled/i.test(String(p.status?.description||'')))items.push({side,team_id:t.id,id:p.person?.id,name:p.person?.fullName,status:'out',reason:p.status.description});
   teams.find(x=>x.side===side).roster_status='data_returned';
  }catch{teams.find(x=>x.side===side).roster_status='source_unavailable';}
 }
 const rosterOk=teams.every(t=>t.roster_status==='data_returned');
 return {availability:{source:'mlb_official_dated_full_roster',status:rosterOk?(items.length?'data_returned':'no_rows_returned'):'partial',items,fetched_at:now},lineups:{source:'mlb_official_game_feed',status:teams.every(t=>t.status==='confirmed')?'data_returned':teams.some(t=>t.status==='confirmed')?'partial_confirmed':teams.some(t=>t.batting_order.length)?'partial':'not_published',teams,probable_pitchers:pitchers,fetched_at:now},fixture_status:gd.status?.abstractGameState||'',raw_started:gd.status?.abstractGameState==='Live'||gd.status?.abstractGameState==='Final'};
}
async function currentMlbOdds(fixture,now){
 const empty=reason=>({available:false,home_spread:null,total:null,reason,quotes:[],origin:'current_stage_market',fetched_at:now});if(!ODDS_KEY)return empty('odds_key_missing');
 if(!await rpc('reserve_mlb_stage_api',{p_provider:'odds',p_cost:1,p_limit:Math.max(1,Math.min(300,Number(Deno.env.get('MLB_STAGE_DAILY_ODDS_LIMIT')||24)))}))return empty('odds_daily_budget');
 const start=new Date(Date.parse(fixture.kickoff_at)-15*60000).toISOString().replace('.000Z','Z'),end=new Date(Date.parse(fixture.kickoff_at)+15*60000).toISOString().replace('.000Z','Z');
 const p=await fetchJson('https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?'+new URLSearchParams({apiKey:ODDS_KEY,regions:'us',markets:'spreads,totals',oddsFormat:'decimal',commenceTimeFrom:start,commenceTimeTo:end}));
 if(!Array.isArray(p))return empty('odds_invalid');const event=p.find(x=>x.home_team===fixture.home.name&&x.away_team===fixture.away.name&&Math.abs(Date.parse(x.commence_time)-Date.parse(fixture.kickoff_at))<=60000);if(!event)return empty('odds_event_missing');
 const quotes=[];for(const book of event.bookmakers||[]){const spreads=book.markets?.find(x=>x.key==='spreads'),totals=book.markets?.find(x=>x.key==='totals'),h=spreads?.outcomes?.find(x=>x.name===fixture.home.name),a=spreads?.outcomes?.find(x=>x.name===fixture.away.name),over=totals?.outcomes?.find(x=>x.name==='Over'),under=totals?.outcomes?.find(x=>x.name==='Under');
  if((spreads&&Date.parse(spreads.last_update||book.last_update)>Date.parse(now))||(totals&&Date.parse(totals.last_update||book.last_update)>Date.parse(now)))continue;
  const spread=Number.isFinite(h?.point)&&Number.isFinite(a?.point)&&h.point===-a.point?h.point:null,total=Number.isFinite(over?.point)&&over.point===under?.point?over.point:null;if(spread===null&&total===null)continue;
  quotes.push({bookmaker:book.key,home_spread:spread,away_spread:spread===null?null:-spread,total,over_odds:over?.price??null,under_odds:under?.price??null});}
 const q=quotes.find(x=>x.home_spread!==null&&x.total!==null)||quotes[0];return q?{...q,quotes,available:true,event_id:event.id,origin:'current_stage_market',fetched_at:now}:empty('odds_markets_missing');
}
async function buildMlbStage(source,stage){
 const gameId=Number(source.game_id),now=new Date().toISOString(),f={...source.prediction_data.fixture,kickoff_at:source.fixture_time};
 const context=await mlbContextOrUnavailable(gameId,f,now);if(context.raw_started)throw Error('mlb_match_started');
 const season=Number(f.season);if(!Number.isInteger(season)||!f.home?.id||!f.away?.id)throw Error('fixture_metadata_missing');
 const [hs,as,hp,ap,hr,ar,market,homePlayers,awayPlayers]=await Promise.all([teamSummaryWithCache(f.home.id,season),teamSummaryWithCache(f.away.id,season),pitcherSummary(context.lineups.probable_pitchers.home?.id||null,season),pitcherSummary(context.lineups.probable_pitchers.away?.id||null,season),recentTeamForm(f.home.id,now).catch(()=>null),recentTeamForm(f.away.id,now).catch(()=>null),currentMlbOdds(f,now),mlbPlayerStats(f.home.id,season,now),mlbPlayerStats(f.away.id,season,now)]);
 const outIds=new Set(context.availability.items.filter(p=>p.status==='out').map(p=>Number(p.id)));
 const baseProjection=projectMlb(hs,as,outIds.has(Number(hp.pitcher_id))?{...hp,era:null}:hp,outIds.has(Number(ap.pitcher_id))?{...ap,era:null}:ap,hr,ar);if(!baseProjection)throw Error('insufficient_official_team_stats');
 const adjusted=applyMlbPlayers(baseProjection,context,homePlayers,awayPlayers,hs,as),projection=adjusted.projection;
 const odds={lines:{home_spread:market.home_spread,total:market.total},status:market.available?'found':'not_available'},prob=projectedProbabilityResearch(projection,odds,now);
 // Same directional rules as the existing MLB T-10 model; no averaging/synthesizing market lines.
 const recommendations={moneyline:{pick:projection.winner,line:null,reason:'依本階段封存球隊模型'},handicap:{pick:market.home_spread===null?'暫不推薦':projection.home_run_margin+market.home_spread>0?'home':'away',line:market.home_spread===null?null:projection.home_run_margin+market.home_spread>0?market.home_spread:-market.home_spread,reason:market.home_spread===null?'未取得有效實際盤線':'依本階段模型與實際封存盤線'},over_under:{pick:market.total===null?'暫不推薦':projection.total_runs>market.total?'over':'under',line:market.total,reason:market.total===null?'未取得有效實際盤線':'依本階段模型與實際封存盤線'}};
 const captured=new Date().toISOString();if(Date.parse(captured)>=Date.parse(source.fixture_time))throw Error('capture_finished_after_kickoff');if(stage==='t2'&&Date.parse(captured)>=Date.parse(source.fixture_time)-15*60000)throw Error('t2_capture_window_closed');
 const target=Date.parse(source.fixture_time)-(stage==='t2'?120:15)*60000,scheduled=Date.parse(captured)-target<=5*60000;
 const adjustment={...adjusted.adjustment,starter_adjustment_applied:baseProjection.starter_impact.home_qualified||baseProjection.starter_impact.away_qualified,...baseProjection.starter_impact};
 const meta={runner_revision:REVISION,captured_at:captured,feature_as_of:now,capture_mode:scheduled?'scheduled':'late_pre_match_recovery',include_in_stage_comparison:scheduled,availability_status:context.availability.status,lineup_status:context.lineups.status,injury_adjustment_applied:adjustment.injury_adjustment_applied,lineup_adjustment_applied:adjustment.lineup_adjustment_applied};
 const model={version:MODEL,projection,probability_research:prob,player_context_adjustment:adjustment};
 const result={success:true,sport:'baseball',game_id:gameId,v2_stage:stage,fixture:{...f,id:gameId,game_id:gameId,date:source.fixture_time,sport:'baseball',league:'MLB'},snapshot:{id:'mlb-stage:'+gameId+':'+stage,game_id:gameId,captured_at:captured,model_version:MODEL},analysis:{model_version:MODEL,summary:'依本階段封存的球隊數據、可取得的球員資料與市場盤線提供分析。',recommendations,v2_stage_evidence:{...context,stage,captured_at:captured,capture_mode:meta.capture_mode,player_adjustment:adjustment}},model,data:{home_team:hs,away_team:as,home_starter:hp,away_starter:ap,home_recent:hr,away_recent:ar,home_players:homePlayers,away_players:awayPlayers},stage_capture:meta,market_data:{market}};
 return {result,model,meta};
}
async function captureMlb(source,stage){const token=crypto.randomUUID(),ok=await rpc('acquire_mlb_stage_capture',{p_game_id:Number(source.game_id),p_stage:stage,p_token:token});if(!ok)return {game_id:source.game_id,stage,status:'already_saved_or_not_due'};
 let value;try{const out=await buildMlbStage(source,stage);value={status:'ready',captured_at:out.meta.captured_at,model_output:out.model,result_data:out.result,source_meta:out.meta};}catch(e){value={status:'source_error',source_meta:{runner_revision:REVISION,reason:String(e?.message||e).slice(0,160)}};}
 const r=await fetch(BASE+'/rest/v1/baseball_v2_stage_snapshots?'+new URLSearchParams({game_id:'eq.'+source.game_id,stage:'eq.'+stage,lease_token:'eq.'+token,status:'eq.processing'}),{method:'PATCH',headers:dbHeaders(),body:JSON.stringify({...value,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('stage_write_failed');return {game_id:source.game_id,stage,status:value.status};}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});if(req.method!=='POST')return reply(405,{success:false,error:'method_not_allowed'});
 const internal=ROLE&&req.headers.get('authorization')==='Bearer '+ROLE;if(!internal&&(!CRON||req.headers.get('x-habao-cron-key')!==CRON))return reply(401,{success:false,error:'unauthorized'});
 try{const body=await req.json().catch(()=>({})),action=body.action||'run';if(!['run','capture','probe_context','probe_players'].includes(action))return reply(400,{success:false,error:'invalid_action'});
  if(action==='probe_players'){
   if(!Number.isSafeInteger(Number(body.game_id))||Number(body.game_id)<=0)return reply(400,{success:false,error:'invalid_game_id'});
   const saved=await db('sports_mlb_t10_source',{select:'*',game_id:'eq.'+Number(body.game_id),limit:'1'});
   if(!saved[0])return reply(404,{success:false,error:'saved_game_not_found'});
   const source=saved[0],f={...source.prediction_data.fixture,kickoff_at:source.fixture_time},now=new Date().toISOString();
   const context=await mlbContextOrUnavailable(Number(source.game_id),f,now);
   const [hs,as,hp,ap]=await Promise.all([teamSummary(f.home.id,Number(f.season)),teamSummary(f.away.id,Number(f.season)),mlbPlayerStats(f.home.id,Number(f.season),now),mlbPlayerStats(f.away.id,Number(f.season),now)]);
   return reply(200,{success:true,revision:REVISION,source_only:true,snapshot_written:false,member_credits_consumed:0,historical_fixture:Date.parse(source.fixture_time)<=Date.now(),note:'Current provider availability and stats. Past game lineup only checks parsing; NOT a historical prediction or pregame backtest.',source_status:{injuries:context.availability.status,lineups:context.lineups.status},sides:['home','away'].map(side=>{const stats=side==='home'?hp:ap,team=side==='home'?hs:as;return {side,stats_status:stats.status,hitters:stats.hitters.length,pitchers:stats.pitchers.length,adjustment:mlbSideAdjustment(context,side,stats,team)};})});
  }
  const p={select:'*',fixture_time:'gt.'+new Date().toISOString(),order:'fixture_time.asc',limit:'30'};if(action==='capture'){if(!Number.isSafeInteger(Number(body.game_id))||!['t2','t15'].includes(body.stage))return reply(400,{success:false,error:'invalid_capture'});p.game_id='eq.'+Number(body.game_id);}else p.and='(fixture_time.lte.'+new Date(Date.now()+(action==='probe_context'?36*3600000:120*60000)).toISOString()+')';
  const sources=await db('sports_mlb_t10_source',p);if(action==='probe_context'){if(!sources[0])return reply(200,{success:true,status:'no_upcoming_t10_snapshot',revision:REVISION});const s=sources[0];return reply(200,{success:true,source_only:true,revision:REVISION,game_id:s.game_id,evidence:await mlbPlayerContext(Number(s.game_id),{...s.prediction_data.fixture,kickoff_at:s.fixture_time})});}
  const existing=sources.length?await db('baseball_v2_stage_snapshots',{select:'game_id,stage,status,attempts,updated_at',game_id:'in.('+sources.map(s=>s.game_id).join(',')+')',limit:'100'}):[];
  const items=[];for(const s of sources){const m=(Date.parse(s.fixture_time)-Date.now())/60000,stage=action==='capture'?body.stage:m<=15?'t15':'t2';if(m<=0||m>(stage==='t2'?120:15)||stage==='t2'&&m<=15)continue;const old=existing.find(r=>Number(r.game_id)===Number(s.game_id)&&r.stage===stage);if(old&&(old.status==='ready'||old.attempts>=4||Date.now()-Date.parse(old.updated_at)<(old.status==='processing'?5:2)*60000))continue;items.push(await captureMlb(s,stage));if(items.length>=1)break;}return reply(200,{success:true,revision:REVISION,items});
 }catch(e){console.error('MLB_STAGE',String(e?.message||e));return reply(503,{success:false,error:'stage_runner_unavailable',revision:REVISION});}
});
