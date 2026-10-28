// Shadow-only T-48/T-24 history feature preparation. No writes to V1/member/public-result tables.
const VERSION = 'football-v2-shadow-features-0.1';
const DAY = 86_400_000, HOUR = 3_600_000, CACHE_TTL = 6 * HOUR, CALENDAR_TTL = HOUR;
const SPORTS = new Set([39,140,78,135,61,2,3,88,40,253,262,848]);
const cfg = {
  url: (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, ''),
  role: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  footballKey: Deno.env.get('API_FOOTBALL_KEY') || '',
  cronKey: Deno.env.get('FOOTBALL_V2_FEATURE_CRON_KEY') || '',
  dailyCallCap: Number(Deno.env.get('FOOTBALL_V2_FEATURE_DAILY_CALL_CAP') || 0)
};
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
});
const safe = (x: unknown) => String(x ?? '').slice(0,220).replace(/[\r\n]/g,' ');
const dbHeaders = (prefer?: string) => ({ apikey:cfg.role, authorization:`Bearer ${cfg.role}`, 'content-type':'application/json', ...(prefer?{prefer}:{}) });
type Fixture = { fixture:{id:number;date:string;status?:{short?:string}}; league:{id:number;season:number}; teams:{home:{id:number;name:string};away:{id:number;name:string}}; goals?:{home:number|null;away:number|null} };
type CacheRow = { fetched_at:string; matches?: any[]; standings?: Record<string,any>; fixtures?: Fixture[] };
type Audit = { fixture_id:number; stage:string; attempts:number; next_retry_at:string|null; terminal:boolean };
let apiCalls = 0;

async function dbGet<T>(table:string, query:string):Promise<T[]> {
  const r=await fetch(`${cfg.url}/rest/v1/${table}?${query}`,{headers:dbHeaders(),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`db_read_${table}_${r.status}`);
  const data=await r.json();if(!Array.isArray(data))throw new Error(`db_bad_${table}`);return data as T[];
}
async function dbWrite(table:string, value:Record<string,unknown>, conflict:string, prefer='resolution=merge-duplicates,return=minimal') {
  const r=await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=${conflict}`,{method:'POST',headers:dbHeaders(prefer),body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`db_write_${table}_${r.status}_${safe(await r.text())}`);
}
async function api(path:string):Promise<any[]> {
  if(!cfg.footballKey)throw new Error('football_api_key_missing');
  const reserve=await fetch(`${cfg.url}/rest/v1/rpc/reserve_football_v2_shadow_api_call`,{
    method:'POST',headers:dbHeaders(),body:JSON.stringify({p_daily_cap:cfg.dailyCallCap}),signal:AbortSignal.timeout(10000)
  });
  if(!reserve.ok||await reserve.json()!==true)throw new Error('daily_api_budget_exhausted_or_unconfigured');
  apiCalls++;
  const r=await fetch(`https://v3.football.api-sports.io${path}`,{headers:{'x-apisports-key':cfg.footballKey},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`football_http_${r.status}`);
  const body=await r.json();
  if(!Array.isArray(body?.response)||body?.errors&&Object.keys(body.errors).length)throw new Error('football_invalid_or_error_payload');
  return body.response;
}
function dayKey(ms:number){return new Date(ms).toISOString().slice(0,10)}
function okayCache(row:CacheRow|undefined,now:number,ttl=CACHE_TTL){return !!row&&Date.parse(row.fetched_at)>now-ttl}
function validGame(g:any,teamId:number,leagueId:number,season:number,asof:number){
  const ms=Date.parse(String(g?.fixture?.date||'')), h=g?.goals?.home, a=g?.goals?.away;
  return Number.isFinite(ms)&&ms>=asof-550*DAY&&ms<=asof-4*HOUR&&
    ['FT','AET','PEN'].includes(String(g?.fixture?.status?.short||''))&&
    typeof h==='number'&&Number.isFinite(h)&&typeof a==='number'&&Number.isFinite(a)&&
    Number(g?.league?.id)===leagueId&&Number(g?.league?.season)===season&&
    (Number(g?.teams?.home?.id)===teamId||Number(g?.teams?.away?.id)===teamId);
}
async function loadCalendar(now:number, allowFetch:boolean):Promise<{fixtures:Fixture[];missingDates:string[]}> {
  const dates=[0,1,2].map(d=>dayKey(now+d*DAY));
  const cached=await dbGet<CacheRow & {calendar_date:string}>('football_v2_shadow_fixture_calendar',`select=calendar_date,fetched_at,fixtures&calendar_date=in.(${dates.join(',')})`);
  const byDate=new Map(cached.map(x=>[x.calendar_date,x]));
  const result:Fixture[]=[],missingDates:string[]=[];
  for(const date of dates){
    const old=byDate.get(date);
    let rows:Fixture[];
    if(okayCache(old,now,CALENDAR_TTL)&&Array.isArray(old?.fixtures))rows=old.fixtures;
    else if (allowFetch) {
      rows=await api(`/fixtures?date=${date}&timezone=UTC`) as Fixture[];
      await dbWrite('football_v2_shadow_fixture_calendar',{calendar_date:date,fetched_at:new Date().toISOString(),fixtures:rows,source_meta:{provider:'api_football',version:VERSION}},'calendar_date');
    } else { missingDates.push(date); continue; }
    result.push(...rows.filter(f=>SPORTS.has(Number(f?.league?.id))));
  }
  const seen=new Set<number>();
  return {fixtures:result.filter(f=>{const id=Number(f?.fixture?.id);if(!Number.isSafeInteger(id)||seen.has(id))return false;seen.add(id);return true;}),missingDates};
}
async function getTeamSeason(league:number,season:number,team:number,asof:number):Promise<any[]> {
  const q=`select=fetched_at,matches&league_id=eq.${league}&season=eq.${season}&team_id=eq.${team}&limit=1`;
  const old=(await dbGet<CacheRow>('football_v2_shadow_team_history_cache',q))[0];
  if(okayCache(old,asof)&&Array.isArray(old?.matches))return old.matches;
  const from=dayKey(asof-550*DAY),to=dayKey(asof-4*HOUR);
  const raw=await api(`/fixtures?team=${team}&league=${league}&season=${season}&from=${from}&to=${to}`);
  const good=raw.filter(g=>validGame(g,team,league,season,asof)).map(g=>{
    const isHome=Number(g.teams.home.id)===team;
    return {fixture_id:Number(g.fixture.id),played_at:new Date(g.fixture.date).toISOString(),league_id:league,season,
      team_id:team,opponent_id:Number(isHome?g.teams.away.id:g.teams.home.id),opponent_name:String(isHome?g.teams.away.name:g.teams.home.name),
      venue:isHome?'home':'away',goals_for:Number(isHome?g.goals.home:g.goals.away),goals_against:Number(isHome?g.goals.away:g.goals.home)};
  });
  await dbWrite('football_v2_shadow_team_history_cache',{league_id:league,season,team_id:team,fetched_at:new Date(asof).toISOString(),matches:good,source_meta:{provider:'api_football_fixtures',from,to,version:VERSION}},'league_id,season,team_id');
  return good;
}
async function getTeamHistory(league:number,season:number,team:number,asof:number){
  const current=await getTeamSeason(league,season,team,asof);
  let all=[...current];
  if(all.length<12)all.push(...await getTeamSeason(league,season-1,team,asof));
  const seen=new Set<number>();
  return all.sort((a,b)=>Date.parse(b.played_at)-Date.parse(a.played_at)).filter(g=>{
    const id=Number(g.fixture_id);if(seen.has(id))return false;seen.add(id);return true;
  }).slice(0,12);
}
async function getStandings(league:number,season:number,asof:number):Promise<Record<string,any>>{
  const old=(await dbGet<CacheRow>('football_v2_shadow_standings_cache',`select=fetched_at,standings&league_id=eq.${league}&season=eq.${season}&limit=1`))[0];
  if(okayCache(old,asof)&&old.standings)return old.standings;
  const raw=await api(`/standings?league=${league}&season=${season}`);
  const groups=raw?.[0]?.league?.standings;
  const rows=Array.isArray(groups)?groups.flat():[];
  const teams:Record<string,any>={},allStats:{gf:number;ga:number;played:number}[]=[];
  for(const r of rows){
    const id=Number(r?.team?.id), played=Number(r?.all?.played), points=Number(r?.points);
    const gf=Number(r?.all?.goals?.for),ga=Number(r?.all?.goals?.against);
    if(Number.isSafeInteger(id)&&Number.isFinite(played)&&played>0&&Number.isFinite(points)){
      teams[String(id)]={points_per_game:Number((points/played).toFixed(4)),goals_for_per_match:Number.isFinite(gf)?Number((gf/played).toFixed(4)):null,
        goals_against_per_match:Number.isFinite(ga)?Number((ga/played).toFixed(4)):null,rank:Number(r.rank)||null,goal_difference:Number(r.goalsDiff)||0,as_of:new Date(asof).toISOString()};
      if(Number.isFinite(gf)&&Number.isFinite(ga))allStats.push({gf,ga,played});
    }
  }
  const totalPlayed=allStats.reduce((n,x)=>n+x.played,0);
  const leagueBase={avg_goals_for_per_match:totalPlayed?Number((allStats.reduce((n,x)=>n+x.gf,0)/totalPlayed).toFixed(4)):null,
    avg_goals_against_per_match:totalPlayed?Number((allStats.reduce((n,x)=>n+x.ga,0)/totalPlayed).toFixed(4)):null,
    avg_points_per_team_match:teams&&Object.keys(teams).length?Number((Object.values(teams).reduce((n:any,x:any)=>n+x.points_per_game,0)/Object.keys(teams).length).toFixed(4)):null};
  const result={teams,league:leagueBase};
  await dbWrite('football_v2_shadow_standings_cache',{league_id:league,season,fetched_at:new Date(asof).toISOString(),standings:result,source_meta:{provider:'api_football_standings',version:VERSION}},'league_id,season');
  return result;
}
function weightedFeatures(history:any[], venue:'home'|'away', standingsBySeason:Record<string,Record<string,any>>){
  const enriched=history.map(g=>{
    const standings=standingsBySeason[String(g.season)]||{},opp=standings.teams?.[String(g.opponent_id)]||null,league=standings.league||{};
    const ageDays=Math.max(0,(Date.now()-Date.parse(g.played_at))/DAY);
    const opponentAttack=opp?.goals_for_per_match&&league.avg_goals_for_per_match?opp.goals_for_per_match/league.avg_goals_for_per_match:null;
    const opponentDefense=opp?.goals_against_per_match&&league.avg_goals_against_per_match?opp.goals_against_per_match/league.avg_goals_against_per_match:null;
    return {...g,opponent_points_per_game:opp?.points_per_game??null,opponent_rank:opp?.rank??null,
      opponent_attack_index:opponentAttack,opponent_defense_index:opponentDefense,
      adjusted_goals_for:opponentDefense&&opponentDefense>0?Number((g.goals_for/opponentDefense).toFixed(4)):g.goals_for,
      adjusted_goals_against:opponentAttack&&opponentAttack>0?Number((g.goals_against/opponentAttack).toFixed(4)):g.goals_against,
      recency_weight:Number(Math.exp(-Math.LN2*ageDays/120).toFixed(6))};
  });
  const avg=(items:any[],key:string)=>{
    const rows=items.filter(x=>x[key]!==null&&x[key]!==undefined&&Number.isFinite(Number(x[key]))),den=rows.reduce((s,x)=>s+x.recency_weight,0);
    return den?Number((rows.reduce((s,x)=>s+Number(x[key])*x.recency_weight,0)/den).toFixed(4)):null;
  };
  const venueRows=enriched.filter(x=>x.venue===venue);
  return {matches:enriched.length,avg_goals_for:avg(enriched,'goals_for'),avg_goals_against:avg(enriched,'goals_against'),
    opponent_adjusted_avg_goals_for:avg(enriched,'adjusted_goals_for'),opponent_adjusted_avg_goals_against:avg(enriched,'adjusted_goals_against'),
    opponent_points_per_game:avg(enriched,'opponent_points_per_game'),
    venue:{venue,matches:venueRows.length,avg_goals_for:avg(venueRows,'goals_for'),avg_goals_against:avg(venueRows,'goals_against'),
      opponent_adjusted_avg_goals_for:avg(venueRows,'adjusted_goals_for'),opponent_adjusted_avg_goals_against:avg(venueRows,'adjusted_goals_against')},history:enriched};
}
async function writeAudit(f:Fixture,stage:string,prior:Audit|undefined,status:string,reason:string,detail:Record<string,unknown>,retryMinutes:number|null,terminal:boolean){
  const attempts=Number(prior?.attempts||0)+(status==='processing'?1:0);
  await dbWrite('football_v2_shadow_feature_audit',{fixture_id:f.fixture.id,stage,kickoff_at:f.fixture.date,status,reason_code:reason,attempts,
    next_retry_at:retryMinutes===null?null:new Date(Date.now()+retryMinutes*60_000).toISOString(),terminal,detail,updated_at:new Date().toISOString()},'fixture_id,stage');
  return {fixture_id:f.fixture.id,stage,attempts,next_retry_at:null,terminal} as Audit;
}
async function run(action:'dry_run'|'run'){
  apiCalls=0;
  if(action==='run'&&(!Number.isSafeInteger(cfg.dailyCallCap)||cfg.dailyCallCap<1))
    return {success:false,version:VERSION,action,status:'daily_api_cap_not_configured',api_football_calls:0};
  const now=Date.now(),calendar=await loadCalendar(now,action==='run'),cal=calendar.fixtures;
  const upcoming=cal.filter(f=>{
    const t=Date.parse(f.fixture.date)-now;return Number.isFinite(t)&&t>10*HOUR&&t<=48*HOUR&&String(f.fixture.status?.short||'NS')==='NS';
  }).sort((a,b)=>Date.parse(a.fixture.date)-Date.parse(b.fixture.date));
  if(!upcoming.length)return {success:true,version:VERSION,action,status:calendar.missingDates.length?'calendar_cache_missing':'no_fixture_in_prep_window',scheduled_dates:3,calendar_cache_misses:calendar.missingDates,api_football_calls:apiCalls};
  const ids=[...new Set(upcoming.map(f=>Number(f.fixture.id)))],inFilter=`fixture_id=in.(${ids.join(',')})`;
  const [saved,audits]=await Promise.all([
    dbGet<{fixture_id:number;stage:string}>('football_v2_shadow_feature_snapshots',`select=fixture_id,stage&${inFilter}`),
    dbGet<Audit>('football_v2_shadow_feature_audit',`select=fixture_id,stage,attempts,next_retry_at,terminal&${inFilter}`)
  ]);
  const savedKeys=new Set(saved.map(x=>`${x.fixture_id}:${x.stage}`)),auditMap=new Map(audits.map(x=>[`${x.fixture_id}:${x.stage}`,x]));
  const due=upcoming.flatMap(f=>{
    const t=Date.parse(f.fixture.date)-now,stage=t>24*HOUR?'prep_t48':'prep_t24',key=`${f.fixture.id}:${stage}`,a=auditMap.get(key);
    if(savedKeys.has(key)||a?.terminal||Number(a?.attempts||0)>=3||(a?.next_retry_at&&Date.parse(a.next_retry_at)>now))return[];
    return [{f,stage,prior:a}];
  });
  if(action==='dry_run')return {success:true,version:VERSION,action,status:'preview',upcoming_in_prep_window:upcoming.length,due:due.slice(0,20).map(x=>({fixture_id:x.f.fixture.id,league_id:x.f.league.id,stage:x.stage,kickoff_at:x.f.fixture.date})),calendar_cache_misses:calendar.missingDates,api_football_calls:apiCalls};
  if(!due.length)return {success:true,version:VERSION,action,status:'all_done_or_backoff',scanned:upcoming.length,api_football_calls:apiCalls};
  const {f,stage,prior}=due[0],id=Number(f.fixture.id),league=Number(f.league.id),season=Number(f.league.season),homeId=Number(f.teams.home.id),awayId=Number(f.teams.away.id);
  if(![league,season,homeId,awayId].every(Number.isSafeInteger))return {success:false,version:VERSION,status:'fixture_identity_missing',fixture_id:id,api_football_calls:apiCalls};
  const attempt=Number(prior?.attempts||0)+1;let a=await writeAudit(f,stage,prior,'processing','processing',{started_at:new Date().toISOString()},15,false);
  try{
    const [homeHistory,awayHistory]=await Promise.all([getTeamHistory(league,season,homeId,now),getTeamHistory(league,season,awayId,now)]);
    if(homeHistory.length<3||awayHistory.length<3){
      const terminal=attempt>=3||Date.parse(f.fixture.date)-now<(stage==='prep_t48'?24*HOUR:10*HOUR);
      await writeAudit(f,stage,a,'insufficient_data','fewer_than_3_league_matches',{home_matches:homeHistory.length,away_matches:awayHistory.length,api_football_calls:apiCalls},terminal?null:60,terminal);
      return {success:true,version:VERSION,action,status:'insufficient_data',fixture_id:id,home_matches:homeHistory.length,away_matches:awayHistory.length,terminal,api_football_calls:apiCalls};
    }
    const seasons=[...new Set([...homeHistory,...awayHistory].map(x=>Number(x.season)))];
    const standingsBySeason:Record<string,Record<string,any>>={};
    for(const y of seasons)standingsBySeason[String(y)]=await getStandings(league,y,now);
    const hf=weightedFeatures(homeHistory,'home',standingsBySeason),af=weightedFeatures(awayHistory,'away',standingsBySeason);
    const quality=Math.min(hf.matches,af.matches)>=5?'research_ready':'low_sample';
    const payload={fixture_id:id,stage,kickoff_at:new Date(f.fixture.date).toISOString(),captured_at:new Date(now).toISOString(),league_id:league,season,
      home_team_id:homeId,away_team_id:awayId,home_features:hf,away_features:af,data_quality:quality,
      source_meta:{provider:'api_football',version:VERSION,capture_mode:stage,history_window_days:550,history_limit_per_team:12,
        home_match_count:hf.matches,away_match_count:af.matches,standings_seasons:seasons,api_football_calls:apiCalls,
        recency_half_life_days:120,late_capture:false},model_version:'football-v2-features-0.1',research_only:true};
    await dbWrite('football_v2_shadow_feature_snapshots',payload,'fixture_id,stage','resolution=ignore-duplicates,return=minimal');
    await writeAudit(f,stage,a,'ready','feature_snapshot_saved',{data_quality:quality,home_matches:hf.matches,away_matches:af.matches,api_football_calls:apiCalls},null,true);
    return {success:true,version:VERSION,action,status:'ready',fixture_id:id,stage,data_quality:quality,home_matches:hf.matches,away_matches:af.matches,api_football_calls:apiCalls};
  }catch(error){
    const terminal=attempt>=3||Date.parse(f.fixture.date)-now<(stage==='prep_t48'?24*HOUR:10*HOUR),reason=safe(error);
    await writeAudit(f,stage,a,'failed',reason,{api_football_calls:apiCalls},terminal?null:60,terminal);
    return {success:false,version:VERSION,action,status:'failed',fixture_id:id,stage,reason,attempt,terminal,api_football_calls:apiCalls};
  }
}
Deno.serve(async request=>{
  if(request.method!=='POST')return response(405,{success:false,error:'method_not_allowed'});
  if(!cfg.cronKey||request.headers.get('x-habao-cron-key')!==cfg.cronKey)return response(401,{success:false,error:'unauthorized'});
  if(!cfg.url||!cfg.role)return response(503,{success:false,error:'storage_not_configured'});
  let body:any;try{body=await request.json()}catch{return response(400,{success:false,error:'invalid_json'})}
  const action=String(body?.action||'dry_run');if(action!=='dry_run'&&action!=='run')return response(422,{success:false,error:'unknown_action'});
  try{const result=await run(action);return response(result.success?200:503,result)}catch(e){return response(503,{success:false,version:VERSION,error:safe(e),api_football_calls:apiCalls})}
});
