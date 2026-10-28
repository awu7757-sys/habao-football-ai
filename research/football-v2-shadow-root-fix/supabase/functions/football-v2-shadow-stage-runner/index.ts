// Research-only V2 probabilities captured independently near T-15, T-10 and T-2.
// Does not write or serve member/public predictions.
const VERSION = 'football-v2-poisson-shrinkage-0.1';
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const STAGES = [{ key:'t15', target:15 }, { key:'t10', target:10 }, { key:'t2', target:2 }] as const;
const SPORTS = new Set([39,140,78,135,61,2,3,88,40,253,262,848]);
const cfg = {
  url:(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,''), role:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
  footballKey:Deno.env.get('API_FOOTBALL_KEY')||'', cronKey:Deno.env.get('FOOTBALL_V2_STAGE_CRON_KEY')||'',
  dailyCallCap:Number(Deno.env.get('FOOTBALL_V2_FEATURE_DAILY_CALL_CAP')||0)
};
const response=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const safe=(x:unknown)=>String(x??'').slice(0,220).replace(/[\r\n]/g,' ');
const headers=(prefer?:string)=>({apikey:cfg.role,authorization:`Bearer ${cfg.role}`,'content-type':'application/json',...(prefer?{prefer}:{})});
type Fixture={fixture:{id:number;date:string;status?:{short?:string}};league:{id:number;season:number};teams:{home:{id:number;name:string};away:{id:number;name:string}};lineups?:any[]};
type Stage={key:'t15'|'t10'|'t2';target:number};
type Audit={fixture_id:number;stage:string;attempts:number;terminal:boolean};
let calls=0;
async function dbGet<T>(table:string,q:string):Promise<T[]>{const r=await fetch(`${cfg.url}/rest/v1/${table}?${q}`,{headers:headers(),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`db_read_${table}_${r.status}`);const x=await r.json();if(!Array.isArray(x))throw new Error(`db_bad_${table}`);return x as T[];}
async function dbWrite(table:string,value:Record<string,unknown>,conflict:string,prefer='resolution=merge-duplicates,return=minimal'){
  const r=await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=${conflict}`,{method:'POST',headers:headers(prefer),body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`db_write_${table}_${r.status}_${safe(await r.text())}`);
}
async function football(path:string):Promise<any[]>{
  if(!cfg.footballKey)throw new Error('football_api_key_missing');
  const reserve=await fetch(`${cfg.url}/rest/v1/rpc/reserve_football_v2_shadow_api_call`,{method:'POST',headers:headers(),body:JSON.stringify({p_daily_cap:cfg.dailyCallCap}),signal:AbortSignal.timeout(10000)});
  if(!reserve.ok||await reserve.json()!==true)throw new Error('daily_api_budget_exhausted_or_unconfigured');
  calls++;const r=await fetch(`https://v3.football.api-sports.io${path}`,{headers:{'x-apisports-key':cfg.footballKey},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`football_http_${r.status}`);const b=await r.json();if(!Array.isArray(b?.response)||b?.errors&&Object.keys(b.errors).length)throw new Error('football_invalid_or_error_payload');return b.response;
}
function poisson(lambda:number,k:number){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function nval(v:any){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(x:number,lo:number,hi:number){return Math.max(lo,Math.min(hi,x));}
function shrunk(value:number|null,prior:number,n:number,k=5){return value===null?prior:(n/(n+k))*value+(k/(n+k))*prior;}
function venueMultiplier(team:any,overall:number|null){
  const v=nval(team?.venue?.opponent_adjusted_avg_goals_for),n=Number(team?.venue?.matches||0);
  if(v===null||overall===null||overall<=0||n===0)return 1;
  const observed=clamp(v/overall,.85,1.15),weight=n/(n+5);return 1+(observed-1)*weight;
}
function predict(home:any,away:any,baseline:any){
  const base=nval(baseline?.avg_goals_for_per_match);
  if(base===null||base<=0)throw new Error('league_goal_baseline_missing');
  const blend=(recent:any,season:number|null,n:number,seasonN:number)=>{
    const r=shrunk(nval(recent),base,n),s=shrunk(season,base,seasonN);
    return nval(season)===null?r:.6*r+.4*s;
  };
  const ha=blend(home?.opponent_adjusted_avg_goals_for,nval(home?.season_features?.goals_for_per_match),Number(home?.matches||0),Number(home?.season_features?.matches_played||0));
  const hd=blend(home?.opponent_adjusted_avg_goals_against,nval(home?.season_features?.goals_against_per_match),Number(home?.matches||0),Number(home?.season_features?.matches_played||0));
  const aa=blend(away?.opponent_adjusted_avg_goals_for,nval(away?.season_features?.goals_for_per_match),Number(away?.matches||0),Number(away?.season_features?.matches_played||0));
  const ad=blend(away?.opponent_adjusted_avg_goals_against,nval(away?.season_features?.goals_against_per_match),Number(away?.matches||0),Number(away?.season_features?.matches_played||0));
  const hxg=clamp(((ha+ad)/2)*venueMultiplier(home,ha),.15,4);
  const axg=clamp(((aa+hd)/2)*venueMultiplier(away,aa),.15,4);
  const max=18, hp=Array.from({length:max+1},(_,i)=>poisson(hxg,i)),ap=Array.from({length:max+1},(_,i)=>poisson(axg,i));
  const mass=hp.reduce((s,p)=>s+p,0)*ap.reduce((s,p)=>s+p,0);
  if(!Number.isFinite(mass)||mass<=0)throw new Error('poisson_probability_mass_invalid');
  let h=0,d=0,a=0,btts=0;const totals:Record<string,number>={};
  for(let i=0;i<=max;i++)for(let j=0;j<=max;j++){const p=hp[i]*ap[j]/mass;if(i>j)h+=p;else if(i===j)d+=p;else a+=p;if(i>0&&j>0)btts+=p;}
  for(const line of [1.5,2.5,3.5,4.5,5.5]){let over=0;for(let i=0;i<=max;i++)for(let j=0;j<=max;j++)if(i+j>line)over+=hp[i]*ap[j]/mass;totals[String(line)]=over;}
  const scores=[];for(let i=0;i<=max;i++)for(let j=0;j<=max;j++)scores.push({home:i,away:j,p:hp[i]*ap[j]/mass});
  scores.sort((x,y)=>y.p-x.p);
  const under=Object.fromEntries(Object.entries(totals).map(([line,p])=>[line,1-p]));
  const probs={home_win:h,draw:d,away_win:a,btts_yes:btts,btts_no:1-btts,totals_over:totals,totals_under:under,most_likely_scores:scores.slice(0,5).map(x=>({score:`${x.home}-${x.away}`,probability:x.p}))};
  const fair=(p:number)=>p>0?Number((1/p).toFixed(4)):null;
  return {home_xg:Number(hxg.toFixed(4)),away_xg:Number(axg.toFixed(4)),probabilities:probs,fair_odds:{home_win:fair(h),draw:fair(d),away_win:fair(a),btts_yes:fair(btts),btts_no:fair(1-btts),totals_over:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,fair(v)])),totals_under:Object.fromEntries(Object.entries(under).map(([k,v])=>[k,fair(v)]))}};
}
function day(ms:number){return new Date(ms).toISOString().slice(0,10);}
async function loadFixtures(now:number,allowFetch:boolean){
  const dates=[0,1,2].map(n=>day(now+n*DAY));const rows=await dbGet<any>('football_v2_shadow_fixture_calendar',`select=calendar_date,fetched_at,fixtures&calendar_date=in.(${dates.join(',')})`);
  const cached=new Map(rows.map(x=>[x.calendar_date,x]));const result:Fixture[]=[];const misses:string[]=[];
  for(const d of dates){const r=cached.get(d);let fs:any[];
    if(r&&Date.parse(r.fetched_at)>now-6*HOUR&&Array.isArray(r.fixtures))fs=r.fixtures;
    else if(allowFetch){fs=await football(`/fixtures?date=${d}&timezone=UTC`);await dbWrite('football_v2_shadow_fixture_calendar',{calendar_date:d,fetched_at:new Date().toISOString(),fixtures:fs,source_meta:{provider:'api_football',version:VERSION}},'calendar_date');}
    else{misses.push(d);continue;}result.push(...fs.filter(f=>SPORTS.has(Number(f?.league?.id))));
  }
  const seen=new Set<number>();return {fixtures:result.filter(f=>{const id=Number(f?.fixture?.id);if(!Number.isSafeInteger(id)||seen.has(id))return false;seen.add(id);return true;}),misses};
}
async function availability(fixtureId:number):Promise<Record<string,unknown>>{
  const rows=await football(`/injuries?fixture=${fixtureId}`);
  const entries=rows.map(x=>({player_id:Number(x?.player?.id)||null,player_name:String(x?.player?.name||''),team_id:Number(x?.team?.id)||null,type:String(x?.player?.type||x?.type||''),reason:String(x?.player?.reason||x?.reason||''),status:String(x?.player?.status||'')}));
  return {source:'api_football_injuries',status:entries.length?'data_returned':'no_rows_returned',items:entries,captured_at:new Date().toISOString(),documented_update_interval:'4 hours',model_adjustment_applied:false,reason:'No verified minutes/role impact model is available; evidence is recorded without an invented goal adjustment.'};
}
async function audit(f:Fixture,s:Stage,status:string,reason:string,attempts:number,terminal:boolean,detail:Record<string,unknown>={}){
  await dbWrite('football_v2_shadow_stage_audit',{fixture_id:f.fixture.id,stage:s.key,kickoff_at:f.fixture.date,status,reason_code:reason,attempts,terminal,detail,updated_at:new Date().toISOString()},'fixture_id,stage');
}
async function run(action:'dry_run'|'run'){
  calls=0;if(action==='run'&&(!Number.isSafeInteger(cfg.dailyCallCap)||cfg.dailyCallCap<1))return {success:false,status:'daily_api_cap_not_configured',api_football_calls:0};
  const now=Date.now(),cal=await loadFixtures(now,action==='run');
  const due=cal.fixtures.flatMap(f=>{const delta=(Date.parse(f.fixture.date)-now)/MINUTE;return STAGES.filter(s=>Math.abs(delta-s.target)<=1.5).map(stage=>({f,stage,delta}));});
  if(action==='dry_run')return {success:true,version:VERSION,action,status:due.length?'preview':cal.misses.length?'calendar_cache_missing':'outside_capture_windows',due:due.slice(0,20).map(x=>({fixture_id:x.f.fixture.id,stage:x.stage.key,minutes_to_kickoff:Number(x.delta.toFixed(2))})),calendar_cache_misses:cal.misses,api_football_calls:0};
  if(!due.length)return {success:true,version:VERSION,action,status:'outside_capture_windows',calendar_cache_misses:cal.misses,api_football_calls:0};
  const {f,stage}=due.sort((a,b)=>a.delta-b.delta)[0],id=Number(f.fixture.id);
  const [saved,audits]=await Promise.all([
    dbGet<any>('football_v2_shadow_stage_snapshots',`select=fixture_id&fixture_id=eq.${id}&stage=eq.${stage.key}&limit=1`),
    dbGet<Audit>('football_v2_shadow_stage_audit',`select=fixture_id,stage,attempts,terminal&fixture_id=eq.${id}&stage=eq.${stage.key}&limit=1`)
  ]);
  if(saved.length)return {success:true,version:VERSION,action,status:'already_captured',fixture_id:id,stage:stage.key,api_football_calls:0};
  const prior=audits[0],attempt=Number(prior?.attempts||0)+1;if(prior?.terminal||attempt>3)return {success:true,version:VERSION,action,status:'terminal',fixture_id:id,stage:stage.key,api_football_calls:0};
  await audit(f,stage,'processing','processing',attempt,false,{started_at:new Date().toISOString()});
  try{
    // Re-read the official fixture immediately before capture; do not turn a missed stage into a backfill.
    const liveRows=await football(`/fixtures?id=${id}`),live=liveRows.find(x=>Number(x?.fixture?.id)===id);
    if(!live)throw new Error('fixture_not_found');
    const officialKickoff=Date.parse(String(live.fixture?.date||'')),scheduled=Date.parse(f.fixture.date),diff=(officialKickoff-now)/MINUTE;
    if(!Number.isFinite(officialKickoff)||Math.abs(officialKickoff-scheduled)>90||Math.abs(diff-stage.target)>1.5||String(live.fixture?.status?.short||'NS')!=='NS'){
      await audit(f,stage,'expired','fixture_changed_or_capture_window_missed',attempt,true,{scheduled_kickoff:f.fixture.date,official_kickoff:live.fixture?.date,minutes_to_kickoff:diff,api_football_calls:calls});
      return {success:true,version:VERSION,action,status:'expired',fixture_id:id,stage:stage.key,api_football_calls:calls};
    }
    const features=await dbGet<any>('football_v2_shadow_feature_snapshots',`select=*&fixture_id=eq.${id}&captured_at=lte.${encodeURIComponent(new Date(now).toISOString())}&order=captured_at.desc&limit=1`);
    const feature=features[0];
    if(!feature){await audit(f,stage,'missing_features','no_prior_feature_snapshot',attempt,true,{api_football_calls:calls});return {success:true,version:VERSION,action,status:'missing_features',fixture_id:id,stage:stage.key,api_football_calls:calls};}
    const featureTime=Date.parse(String(feature.captured_at||'')),featureKickoff=Date.parse(String(feature.kickoff_at||''));
    if(!Number.isFinite(featureTime)||!Number.isFinite(featureKickoff)||Math.abs(featureKickoff-officialKickoff)>90*MINUTE||featureTime<officialKickoff-52*HOUR){
      await audit(f,stage,'missing_features','stale_or_mismatched_feature_snapshot',attempt,true,{feature_kickoff:feature.kickoff_at,official_kickoff:live.fixture.date,feature_captured_at:feature.captured_at,api_football_calls:calls});
      return {success:true,version:VERSION,action,status:'missing_features',reason:'stale_or_mismatched_feature_snapshot',fixture_id:id,stage:stage.key,api_football_calls:calls};
    }
    const prediction=predict(feature.home_features,feature.away_features,feature.league_baseline);
    const quotes=await dbGet<any>('football_v2_shadow_market_quotes',`select=captured_at,provider,market_key,total_line,over_odds,under_odds,bookmaker_count&fixture_id=eq.${id}&captured_at=lte.${encodeURIComponent(new Date(now).toISOString())}&order=captured_at.desc&limit=1`);
    let availabilityEvidence:any={status:'not_collected_at_this_stage',items:[],model_adjustment_applied:false};
    if(stage.key==='t15'){
      try{availabilityEvidence=await availability(id);}
      catch(error){availabilityEvidence={source:'api_football_injuries',status:'collection_failed',items:[],error:safe(error),captured_at:new Date().toISOString(),model_adjustment_applied:false};}
    }
    else {const priorAvailability=await dbGet<any>('football_v2_shadow_stage_snapshots',`select=availability_evidence,captured_at&fixture_id=eq.${id}&stage=eq.t15&captured_at=lte.${encodeURIComponent(new Date(now).toISOString())}&limit=1`);if(priorAvailability[0])availabilityEvidence={...priorAvailability[0].availability_evidence,carried_from_t15_at:priorAvailability[0].captured_at};}
    const lineupRows=Array.isArray(live.lineups)?live.lineups:[];
    const lineups={source:'api_football_fixtures',status:lineupRows.length?'data_returned':'not_available',teams:lineupRows,captured_at:new Date().toISOString(),documented_availability:'20-40 minutes before kickoff when league coverage supports it',model_adjustment_applied:false};
    const quality=feature.data_quality==='research_ready'?'research_ready_uncalibrated':'low_sample_uncalibrated';
    const payload={fixture_id:id,stage:stage.key,kickoff_at:new Date(officialKickoff).toISOString(),captured_at:new Date().toISOString(),home_team_id:feature.home_team_id,away_team_id:feature.away_team_id,
      home_xg:prediction.home_xg,away_xg:prediction.away_xg,probabilities:prediction.probabilities,fair_odds:prediction.fair_odds,
      market_context:quotes[0]||{status:'no_prior_quote'},availability_evidence:availabilityEvidence,lineup_evidence:lineups,data_quality:quality,
      source_meta:{provider:'api_football',feature_snapshot_stage:feature.stage,feature_captured_at:feature.captured_at,feature_quality:feature.data_quality,api_football_calls:calls,
        model_inputs:'60% opponent-adjusted recent form + 40% season standings attack/defense, each shrunk toward sourced league goal average',
        shrinkage_prior:`API-Football league average from season ${feature.league_baseline?.source_season}`,shrinkage_k:5,venue_adjustment:'recency-weighted venue attack ratio shrunk toward neutral; clipped 0.85-1.15',
        score_grid_max:18,xg_bounds:[0.15,4],post_match_backfill:false,player_adjustment_applied:false},model_version:VERSION,research_only:true};
    await dbWrite('football_v2_shadow_stage_snapshots',payload,'fixture_id,stage','resolution=ignore-duplicates,return=minimal');
    await audit(f,stage,'ready','shadow_prediction_saved',attempt,true,{feature_stage:feature.stage,feature_captured_at:feature.captured_at,api_football_calls:calls});
    return {success:true,version:VERSION,action,status:'ready',fixture_id:id,stage:stage.key,home_xg:prediction.home_xg,away_xg:prediction.away_xg,data_quality:quality,api_football_calls:calls};
  }catch(e){const reason=safe(e);await audit(f,stage,'failed',reason,attempt,attempt>=3,{api_football_calls:calls});return {success:false,version:VERSION,action,status:'failed',fixture_id:id,stage:stage.key,reason,attempt,terminal:attempt>=3,api_football_calls:calls};}
}
Deno.serve(async request=>{
  if(request.method!=='POST')return response(405,{success:false,error:'method_not_allowed'});
  if(!cfg.cronKey||request.headers.get('x-habao-cron-key')!==cfg.cronKey)return response(401,{success:false,error:'unauthorized'});
  if(!cfg.url||!cfg.role)return response(503,{success:false,error:'storage_not_configured'});
  let body:any;try{body=await request.json()}catch{return response(400,{success:false,error:'invalid_json'})};const action=String(body?.action||'dry_run');
  if(action!=='dry_run'&&action!=='run')return response(422,{success:false,error:'unknown_action'});
  try{const result=await run(action);return response(result.success?200:503,result);}catch(e){return response(503,{success:false,version:VERSION,error:safe(e),api_football_calls:calls});}
});
