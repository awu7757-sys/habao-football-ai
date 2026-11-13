// Isolated NBA T-2/T-15 capture. Never rewrites official T-10 or public results.
const STAGE_VERSION='nba-v2-stages-player-context-v0.2';
const ODDS_KEY=String(Deno.env.get('THE_ODDS_API_KEY')||Deno.env.get('ODDS_API_KEY')||'').trim();
const STAGE_REVISION='nba-stages-player-context-20261113-1';
const stageHeaders={...HEADERS,'X-Habao-Version':STAGE_REVISION};
const stageReply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{...stageHeaders,'Content-Type':'application/json'}});
const roleHeaders=()=>({apikey:ROLE,Authorization:'Bearer '+ROLE,'Content-Type':'application/json'});
async function rpc(name,body){
 const r=await fetch(URL_BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:roleHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('rpc_'+name+'_'+r.status);return r.json();
}
async function reserve(provider,cost){
 const raw=Number(Deno.env.get(provider==='nba'?'NBA_STAGE_DAILY_NBA_LIMIT':'NBA_STAGE_DAILY_ODDS_LIMIT')||(provider==='nba'?300:60));
 const limit=Number.isInteger(raw)&&raw>0?Math.min(raw,provider==='nba'?2000:300):0;
 if(!await rpc('reserve_nba_stage_api',{p_provider:provider,p_cost:cost,p_limit:limit}))throw Error(provider+'_stage_daily_budget_exhausted');
}
async function nbaRequest(path,params,context){
 if(context.nba_calls>=9)throw Error('stage_nba_request_limit');
 await reserve('nba',1);context.nba_calls++;
 const r=await fetch(NBA_ENDPOINT+path+'?'+new URLSearchParams(params),{headers:{'x-apisports-key':NBA_KEY},signal:AbortSignal.timeout(12000)});
 const b=await r.json().catch(()=>null);
 if(!r.ok||!b||!Array.isArray(b.response)||(Array.isArray(b.errors)?b.errors.length:Object.keys(b.errors||{}).length))throw Error('nba_source_unavailable');
 return b.response;
}
function stageWindow(kickoff,stage,now=Date.now()){
 const m=(Date.parse(kickoff)-now)/60000;
 return Number.isFinite(m)&&m>0&&(stage==='t2'?m<=120&&m>15:stage==='t15'&&m<=15);
}
function normalizedTeam(x){return String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^losangelesclippers$/,'laclippers');}
function parseMarket(events,snapshot,now){
 const f=snapshot.prediction_data?.fixture||{};
 const home=normalizedTeam(f.home?.api_name||f.home?.name||snapshot.home_team),away=normalizedTeam(f.away?.api_name||f.away?.name||snapshot.away_team);
 const matches=events.filter(e=>normalizedTeam(e.home_team)===home&&normalizedTeam(e.away_team)===away&&Math.abs(Date.parse(e.commence_time)-Date.parse(snapshot.fixture_time))<=15*60000);
 if(matches.length!==1)return {available:false,home_spread:null,total:null,reason:'event_not_uniquely_matched',origin:'current_stage_market'};
 const e=matches[0],books=[];
 for(const b of e.bookmakers||[]){
  const ms=(b.markets||[]).filter(m=>{const t=Date.parse(m.last_update||b.last_update||'');return Number.isFinite(t)&&t<=now+60000&&now-t<=20*60000;});
  const spread=ms.find(m=>m.key==='spreads'),total=ms.find(m=>m.key==='totals');
  const h=spread?.outcomes?.find(x=>x.name===e.home_team),a=spread?.outcomes?.find(x=>x.name===e.away_team);
  const over=total?.outcomes?.find(x=>x.name==='Over'),under=total?.outcomes?.find(x=>x.name==='Under');
  const hs=asNumber(h?.point),aw=asNumber(a?.point),t=asNumber(over?.point),ut=asNumber(under?.point);
  const validSpread=hs!==null&&aw!==null&&Math.abs(hs+aw)<1e-6&&Math.abs(hs)<=60&&Number(h?.price)>1&&Number(a?.price)>1;
  const validTotal=t!==null&&ut===t&&t>=120&&t<=350&&Number(over?.price)>1&&Number(under?.price)>1;
  if(validSpread||validTotal)books.push({bookmaker:b.key,home_spread:validSpread?hs:null,away_spread:validSpread?aw:null,total:validTotal?t:null,home_odds:validSpread?h.price:null,away_odds:validSpread?a.price:null,over_odds:validTotal?over.price:null,under_odds:validTotal?under.price:null});
 }
 // Select actual paired lines from a single bookmaker. Never synthesize or average a betting line.
 const chosen=books.find(x=>x.bookmaker==='pinnacle'&&x.home_spread!==null&&x.total!==null)||books.find(x=>x.home_spread!==null&&x.total!==null)||books[0];
 return chosen?{...chosen,available:true,event_id:e.id,origin:'current_stage_market',quotes:books,fetched_at:new Date(now).toISOString()}:{available:false,home_spread:null,total:null,reason:'no_fresh_paired_lines',origin:'current_stage_market'};
}
async function currentMarket(s,context){
 if(!ODDS_KEY)return {available:false,home_spread:null,total:null,reason:'odds_key_not_configured',origin:'current_stage_market'};
 const kickoff=parseMs(s.fixture_time);if(kickoff===null)throw Error('odds_invalid_fixture_time');
 // Use the documented UTC seconds format for both filter parameters.
 const secondsIso=ms=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'Z');
 await reserve('odds',2);context.odds_calls++;
 const params=new URLSearchParams({apiKey:ODDS_KEY,regions:'us',markets:'spreads,totals',oddsFormat:'decimal',dateFormat:'iso',commenceTimeFrom:secondsIso(kickoff-15*60000),commenceTimeTo:secondsIso(kickoff+15*60000)});
 let r;try{r=await fetch('https://api.the-odds-api.com/v4/sports/basketball_nba/odds?'+params,{signal:AbortSignal.timeout(12000)});}catch{throw Error('odds_network_error');}
 const b=await r.json().catch(()=>null);
 if(!r.ok){
  // Store only status and an allowlisted code, never provider messages, URLs or keys.
  const raw=String(b?.error_code||b?.code||'UNSPECIFIED');
  const code=/^[A-Za-z0-9_]{1,80}$/.test(raw)?raw:'UNSPECIFIED';
  throw Error('odds_http_'+r.status+'_'+code);
 }
 if(!Array.isArray(b))throw Error('invalid_current_odds');
 return parseMarket(b,s,Date.now());
}
async function stageModel(s,market,context,cutoff){
 const f=s.prediction_data?.fixture||{},home=Number(f.home?.id),away=Number(f.away?.id),season=Number(f.season);
 if(!Number.isSafeInteger(home)||!Number.isSafeInteger(away)||home<=0||away<=0||home===away||!Number.isInteger(season)||season<2020)throw Error('official_fixture_metadata_missing');
 const [hc,hp,ac,ap]=await Promise.all([nbaRequest('/games',{league:'standard',season:String(season),team:String(home)},context),nbaRequest('/games',{league:'standard',season:String(season-1),team:String(home)},context),nbaRequest('/games',{league:'standard',season:String(season),team:String(away)},context),nbaRequest('/games',{league:'standard',season:String(season-1),team:String(away)},context)]);
 const hg=historicalGames(hc,hp,home,season,cutoff),ag=historicalGames(ac,ap,away,season,cutoff);
 const prior=researchModel(hg,ag,cutoff,market,season);if(!prior.model)return {status:'insufficient_data',reason:prior.reason};
 const choices=[];for(let i=0;i<24;i++){if(hg[i])choices.push(hg[i]);if(ag[i])choices.push(ag[i]);}
 const ids=[...new Set(choices.map(g=>g.id))],cache=await boxCacheGet(ids),boxes=new Map(cache.filter(x=>x.status==='valid'&&x.box_data).map(x=>[Number(x.game_id),x.box_data]));
 const all=new Map([...hc,...hp,...ac,...ap].map(g=>[Number(g.id),g]));
 const invalid=new Set(cache.filter(x=>x.status==='invalid').map(x=>Number(x.game_id)));
 let boxCalls=0;
 for(const g of choices){
  if(boxCalls>=4)break;
  if(boxes.has(g.id)||invalid.has(g.id))continue;
  const hCount=hg.filter(x=>boxes.has(x.id)).length,aCount=ag.filter(x=>boxes.has(x.id)).length;
  if(hCount>=3&&aCount>=3)break;
  if((g.team_id===home&&hCount>=3)||(g.team_id===away&&aCount>=3))continue;
  boxCalls++;
  const rows=await nbaRequest('/games/statistics',{id:String(g.id)},context),box=completedBox(all.get(g.id),rows);
  if(box){boxes.set(g.id,box);await boxCachePut(g.id,{box});}else {invalid.add(g.id);await boxCachePut(g.id,{box:null,reason:'invalid_statistics'});}
 }
 const efficiency=efficiencyResearch(hg,ag,boxes,cutoff,market,season,prior.model);
 const model=efficiency||{...prior.model,model_family:'bayesian_score_fallback'};
 return {status:'ready',model:{...model,version:STAGE_VERSION,market,research_only:true,formal_recommendation:false},history_counts:{home:hg.length,away:ag.length},box_calls:boxCalls};
}
function stageResult(s,stage,model,meta){
 const f=s.prediction_data?.fixture||{},m=model.market||{},p=model.home_win_probability;
 const {player_evidence,...captureMeta}=meta;
 const evidence=player_evidence||{availability:{status:'not_available',items:[],teams:[]},lineups:{status:'not_available',teams:[]}};
 const adjustment=model.player_context_adjustment||{status:'not_applied',injury_adjustment_applied:false,lineup_adjustment_applied:false};
 const conf=x=>Math.round(100*Math.max(x,1-x));
 const pick=(p,home,away,line=null)=>p===null?{pick:'暫不推薦',line:null,confidence:0,reason:'本階段未取得有效實際盤線'}:(p>.45&&p<.55)?{pick:'暫不推薦',line:null,confidence:conf(p),reason:'模型優勢未達統合模型門檻'}:{pick:p>=.5?home:away,line,confidence:conf(p),reason:'依本階段統合模型與封存盤線'};
 const spread=pick(model.home_cover_probability,'主隊','客隊',model.home_cover_probability>=.5?m.home_spread:m.home_spread===null?null:-m.home_spread);
 const label=stage==='t2'?'T-2 深度分析':'T-15 最終分析';
 const note=meta.capture_mode==='scheduled'?'本階段於目標時間附近自動封存。':'此為賽前補抓，依實際擷取時間標示，不列入準時階段比較。';
 return {success:true,sport:'basketball',game_id:Number(s.game_id),research_only:true,formal_recommendation:false,v2_stage:stage,v2_stage_label:label,
 fixture:{...f,id:Number(s.game_id),date:s.fixture_time,league:f.league||{name:'NBA'}},
 analysis:{model_version:STAGE_VERSION,recommendations:{moneyline:pick(p,'主隊','客隊'),handicap:spread,over_under:pick(model.over_probability,'大','小',m.total)},summary:label+'；'+note,
  market_analysis:'本階段重新擷取市場、歷史與球員出賽資料；球員修正依實際取得與驗證狀態套用。',
  v2_stage_evidence:{stage,captured_at:meta.captured_at,capture_mode:meta.capture_mode,...evidence,player_adjustment:adjustment,note}},
 model:{...model,predicted_score:{home:model.expected_home_points,away:model.expected_away_points},fair_total:model.expected_total,fair_spread:{display:String(-model.expected_margin)},win_probability:{home:round(p*100,1),away:round((1-p)*100,1)}},
 market_data:{market:{...m,consensus:{home_spread:m.home_spread,total:m.total,spread_bookmakers:(m.quotes||[]).filter(x=>x.home_spread!==null).length,total_bookmakers:(m.quotes||[]).filter(x=>x.total!==null).length}},injuries:{available:evidence.availability.status==='data_returned',status:evidence.availability.status,items:evidence.availability.items||[]}},
 warnings:[...(m.available?[]:['本階段實際市場盤線未取得，缺盤項目暫不推薦。']),...(evidence.warnings||[])],stage_capture:captureMeta};
}
async function patchStage(id,stage,token,patch){
 const params=new URLSearchParams({game_id:'eq.'+id,stage:'eq.'+stage,status:'eq.processing',lease_token:'eq.'+token});
 const r=await fetch(URL_BASE+'/rest/v1/basketball_v2_stage_snapshots?'+params,{method:'PATCH',headers:{...roleHeaders(),Prefer:'return=representation'},body:JSON.stringify({...patch,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('stage_write_failed');if((await r.json()).length!==1)throw Error('stage_capture_lease_lost');
}
async function captureStage(s,stage){
 if(!stageWindow(s.fixture_time,stage))return {game_id:s.game_id,stage,status:'outside_capture_window'};
 const token=crypto.randomUUID();if(!await rpc('acquire_nba_stage_capture',{p_game_id:Number(s.game_id),p_stage:stage,p_token:token}))return {game_id:s.game_id,stage,status:'already_captured_or_processing'};
 const context={nba_calls:0,odds_calls:0},cutoff=Date.now();
 try{
  // Recheck the actual provider fixture; a stale schedule must not admit an in-play capture.
  const live=await nbaRequest('/games',{id:String(s.game_id)},context);
  const g=live.find(x=>Number(x.id)===Number(s.game_id));
  const fx=s.prediction_data?.fixture||{};
  const actualStart=parseMs(g?.date?.start),savedStart=parseMs(s.fixture_time);
  if(!g||actualStart===null||savedStart===null||String(g.league||'').toLowerCase()!=='standard'||Number(g.status?.short)!==1||Math.abs(actualStart-savedStart)>60000||Number(g.teams?.home?.id)!==Number(fx.home?.id)||Number(g.teams?.visitors?.id)!==Number(fx.away?.id))throw Error('fixture_started_changed_or_unverified');
  const evidencePromise=collectPlayerContext(s,context);
  const market=await currentMarket(s,context);
  const out=await stageModel(s,market,context,cutoff),evidence=await evidencePromise;
  if(evidence.warnings.some(x=>['context_fixture_not_pregame','context_window_closed_during_capture'].includes(x)))throw Error('fixture_started_or_context_window_closed');
  if(out.model)out.model=applyPlayerContext(out.model,evidence);
  if(!stageWindow(s.fixture_time,stage))throw Error('stage_window_closed_during_capture');
  const captured_at=new Date().toISOString(),target=Date.parse(s.fixture_time)-(stage==='t2'?120:15)*60000;
  const scheduled=Date.parse(captured_at)-target<=90000;
  const publicEvidence={version:evidence.version,event_id:evidence.event_id,availability:evidence.availability,lineups:evidence.lineups,source_urls:evidence.source_urls,warnings:evidence.warnings,
   history_sources:Object.fromEntries(['home','away'].map(side=>[side,evidence.history[side].map(g=>({event_id:g.event_id,date:g.date}))]))};
  const meta={captured_at,runner_revision:STAGE_REVISION,feature_as_of:captured_at,history_cutoff:new Date(cutoff).toISOString(),scheduled_target_at:new Date(target).toISOString(),capture_mode:scheduled?'scheduled':'late_pre_match_recovery',include_in_stage_comparison:scheduled,nba_calls:context.nba_calls,odds_calls:context.odds_calls,context_calls:context.context_calls||0,
   injury_adjustment_applied:out.model?.player_context_adjustment?.injury_adjustment_applied===true,lineup_adjustment_applied:out.model?.player_context_adjustment?.lineup_adjustment_applied===true,
   availability_status:evidence.availability.status,lineup_status:evidence.lineups.status,history_counts:out.history_counts};
  await patchStage(s.game_id,stage,token,{status:out.status,captured_at:out.status==='ready'?captured_at:null,model_output:out.model||null,result_data:out.model?stageResult(s,stage,out.model,{...meta,player_evidence:publicEvidence}):null,source_meta:{...meta,reason:out.reason||null,player_context_features:evidence}});
  return {game_id:s.game_id,stage,status:out.status,capture_mode:meta.capture_mode,nba_calls:context.nba_calls,odds_calls:context.odds_calls};
 }catch(e){const reason=String(e?.message||e).slice(0,150);await patchStage(s.game_id,stage,token,{status:'source_error',source_meta:{reason,runner_revision:STAGE_REVISION,nba_calls:context.nba_calls,odds_calls:context.odds_calls}}).catch(()=>{});return {game_id:s.game_id,stage,status:'source_error',reason};}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:stageHeaders});
 if(req.method!=='POST')return stageReply(405,{success:false,error:'method_not_allowed'});
 const internal=ROLE&&req.headers.get('authorization')==='Bearer '+ROLE;
 if(!internal&&(!CRON_KEY||req.headers.get('x-habao-cron-key')!==CRON_KEY))return stageReply(401,{success:false,error:'unauthorized'});
 if(!URL_BASE||!ROLE||!NBA_KEY)return stageReply(503,{success:false,error:'missing_backend_configuration'});
 try{
  const body=await req.json().catch(()=>({})),action=String(body?.action||'run');
  if(!['run','capture','dry_run','probe_context'].includes(action))return stageReply(400,{success:false,error:'invalid_action'});
  const settings=await dbGet('basketball_v2_stage_settings',new URLSearchParams({select:'pilot_account,all_members_enabled',id:'eq.true',limit:'1'}));
  if(!settings[0])throw Error('stage_settings_missing');
  const params=new URLSearchParams({select:'game_id,fixture_time,generated_at,home_team,away_team,prediction_data',fixture_time:'gt.'+new Date().toISOString(),order:'fixture_time.asc',limit:'50'});
  if(action==='probe_context'){
   params.set('and','(fixture_time.lte.'+new Date(Date.now()+36*3600000).toISOString()+')');
   if(body.game_id!=null){if(!Number.isSafeInteger(Number(body.game_id))||Number(body.game_id)<=0)return stageReply(400,{success:false,error:'invalid_game_id'});params.set('game_id','eq.'+Number(body.game_id));}
   params.set('limit','1');
  }else if(action==='capture'){
   if(!Number.isSafeInteger(Number(body.game_id))||Number(body.game_id)<=0||!['t2','t15'].includes(body.stage))return stageReply(400,{success:false,error:'invalid_capture_request'});
   params.set('game_id','eq.'+Number(body.game_id));
  }else params.set('and','(fixture_time.lte.'+new Date(Date.now()+120*60000).toISOString()+')');
  const snapshots=await dbGet('basketball_prediction_snapshots',params),candidates=[];
  if(action==='probe_context'){
   if(!snapshots.length)return stageReply(200,{success:false,read_only:true,error:'no_upcoming_t10_snapshot',runner_revision:STAGE_REVISION});
   const evidence=await collectPlayerContext(snapshots[0],{context_calls:0});
   return stageReply(200,{success:!!evidence.event_id,read_only:true,snapshot_written:false,member_credits_consumed:0,runner_revision:STAGE_REVISION,game_id:Number(snapshots[0].game_id),fixture_time:snapshots[0].fixture_time,evidence});
  }
  for(const s of snapshots){const stage=body.stage&&action==='capture'?body.stage:(Date.parse(s.fixture_time)-Date.now()<=15*60000?'t15':'t2');if(stageWindow(s.fixture_time,stage))candidates.push({s,stage});}
  const rows=candidates.length?await dbGet('basketball_v2_stage_snapshots',new URLSearchParams({select:'game_id,stage,status,updated_at,attempts',game_id:'in.('+candidates.map(x=>x.s.game_id).join(',')+')',limit:'100'})):[];
  const pending=candidates.filter(x=>{const r=rows.find(r=>Number(r.game_id)===Number(x.s.game_id)&&r.stage===x.stage);return !r||(r.attempts<4&&((r.status==='processing'&&Date.now()-Date.parse(r.updated_at)>5*60000)||(['source_error','insufficient_data'].includes(r.status)&&Date.now()-Date.parse(r.updated_at)>2*60000)));});
  pending.sort((a,b)=>(a.stage==='t15'?0:1)-(b.stage==='t15'?0:1)||Date.parse(a.s.fixture_time)-Date.parse(b.s.fixture_time));
  if(action==='dry_run')return stageReply(200,{success:true,read_only:true,candidates:pending.map(x=>({game_id:x.s.game_id,stage:x.stage,fixture_time:x.s.fixture_time})),max_games_per_run:1,max_nba_requests_per_stage:9});
  const items=[];for(const x of pending.slice(0,1))items.push(await captureStage(x.s,x.stage));
  return stageReply(200,{success:true,research_only:true,items,processed:items.length});
 }catch(e){console.error('NBA_STAGE',String(e?.message||e));return stageReply(500,{success:false,error:'stage_runner_failed'});}
});
