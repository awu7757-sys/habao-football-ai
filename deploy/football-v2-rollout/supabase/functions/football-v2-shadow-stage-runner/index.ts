// V2 research probabilities are captured near T-15, T-10 and T-2.
// T-10 also ensures the member-facing V2 snapshot through match-analysis.
const VERSION = 'football-v2-poisson-player-impact-0.3.0';
const OFFICIAL_VERSION = 'football-v2-poisson-shrinkage-0.2.1';
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const T10_WATCHDOG_MINUTE = 10 * 60 - 5;
const STAGES = [
  { key: 't15', target: 15 },
  { key: 't10', target: 10 * 60 },
  { key: 't2', target: 2 * 60 },
] as const;
const SPORTS = new Set([39,140,78,135,61,2,3,88,40,253,262,848]);
const ODDS_SPORTS:Record<number,string>={39:'soccer_epl',140:'soccer_spain_la_liga',78:'soccer_germany_bundesliga',135:'soccer_italy_serie_a',61:'soccer_france_ligue_one',2:'soccer_uefa_champs_league',3:'soccer_uefa_europa_league',88:'soccer_netherlands_eredivisie',40:'soccer_efl_champ',253:'soccer_usa_mls',262:'soccer_mexico_ligamx',848:'soccer_uefa_europa_conference_league'};
const cfg = {
  url:(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,''), role:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
  footballKey:Deno.env.get('API_FOOTBALL_KEY')||'', oddsKey:Deno.env.get('THE_ODDS_API_KEY')||Deno.env.get('ODDS_API_KEY')||'', cronKey:Deno.env.get('FOOTBALL_V2_STAGE_CRON_KEY')||'',
  dailyCallCap:Number(Deno.env.get('FOOTBALL_V2_FEATURE_DAILY_CALL_CAP')||0)
};
const response=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const safe=(x:unknown)=>String(x??'').slice(0,220).replace(/[\r\n]/g,' ');
const headers=(prefer?:string)=>({apikey:cfg.role,authorization:`Bearer ${cfg.role}`,'content-type':'application/json',...(prefer?{prefer}:{})});
type Fixture={fixture:{id:number;date:string;status?:{short?:string}};league:{id:number;season:number};teams:{home:{id:number;name:string};away:{id:number;name:string}};lineups?:any[]};
type Stage={key:'t15'|'t10'|'t2';target:number};
type Audit={fixture_id:number;stage:string;attempts:number;terminal:boolean;updated_at?:string};
let calls=0;
async function dbGet<T>(table:string,q:string):Promise<T[]>{const r=await fetch(`${cfg.url}/rest/v1/${table}?${q}`,{headers:headers(),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`db_read_${table}_${r.status}`);const x=await r.json();if(!Array.isArray(x))throw new Error(`db_bad_${table}`);return x as T[];}
async function dbWrite(table:string,value:Record<string,unknown>,conflict:string,prefer='resolution=merge-duplicates,return=minimal'){
  const r=await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=${conflict}`,{method:'POST',headers:headers(prefer),body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`db_write_${table}_${r.status}_${safe(await r.text())}`);
}
async function leaseRpc(name:string,body:Record<string,unknown>):Promise<boolean>{
  const r=await fetch(`${cfg.url}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`lease_${name}_${r.status}_${safe(await r.text())}`);
  return await r.json()===true;
}
async function football(path:string):Promise<any[]>{
  if(!cfg.footballKey)throw new Error('football_api_key_missing');
  const reserve=await fetch(`${cfg.url}/rest/v1/rpc/reserve_football_v2_shadow_api_call`,{method:'POST',headers:headers(),body:JSON.stringify({p_daily_cap:cfg.dailyCallCap}),signal:AbortSignal.timeout(10000)});
  if(!reserve.ok||await reserve.json()!==true)throw new Error('daily_api_budget_exhausted_or_unconfigured');
  calls++;const r=await fetch(`https://v3.football.api-sports.io${path}`,{headers:{'x-apisports-key':cfg.footballKey},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`football_http_${r.status}`);const b=await r.json();if(!Array.isArray(b?.response)||b?.errors&&Object.keys(b.errors).length)throw new Error('football_invalid_or_error_payload');return b.response;
}
async function footballPage(path:string):Promise<{rows:any[];totalPages:number}>{
  if(!cfg.footballKey)throw new Error('football_api_key_missing');
  const reserve=await fetch(`${cfg.url}/rest/v1/rpc/reserve_football_v2_shadow_api_call`,{method:'POST',headers:headers(),body:JSON.stringify({p_daily_cap:cfg.dailyCallCap}),signal:AbortSignal.timeout(10000)});
  if(!reserve.ok||await reserve.json()!==true)throw new Error('daily_api_budget_exhausted_or_unconfigured');
  calls++;const r=await fetch(`https://v3.football.api-sports.io${path}`,{headers:{'x-apisports-key':cfg.footballKey},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`football_http_${r.status}`);const b=await r.json();if(!Array.isArray(b?.response)||b?.errors&&Object.keys(b.errors).length)throw new Error('football_invalid_or_error_payload');
  return {rows:b.response,totalPages:Math.max(1,Number(b?.paging?.total)||1)};
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
function predict(home:any,away:any,baseline:any,currentSeason:number,homeXgDelta=0,awayXgDelta=0){
  const base=nval(baseline?.avg_goals_for_per_match);
  if(base===null||base<=0)throw new Error('league_goal_baseline_missing');

  const blend=(team:any,recent:number|null,seasonValue:number|null,n:number,seasonN:number)=>{
    const r=shrunk(recent,base,n);
    if(seasonValue===null||seasonN<=0)return r;

    const history=Array.isArray(team?.history)?team.history:[];
    const overlap=history.filter((g:any)=>Number(g?.season)===currentSeason).length;
    const independentShare=clamp((seasonN-Math.min(seasonN,overlap))/seasonN,0,1);
    const seasonWeight=0.4*independentShare;
    const s=shrunk(seasonValue,base,seasonN);

    return (1-seasonWeight)*r+seasonWeight*s;
  };

  const ha=blend(home,nval(home?.opponent_adjusted_avg_goals_for),nval(home?.season_features?.goals_for_per_match),Number(home?.matches||0),Number(home?.season_features?.matches_played||0));
  const hd=blend(home,nval(home?.opponent_adjusted_avg_goals_against),nval(home?.season_features?.goals_against_per_match),Number(home?.matches||0),Number(home?.season_features?.matches_played||0));
  const aa=blend(away,nval(away?.opponent_adjusted_avg_goals_for),nval(away?.season_features?.goals_for_per_match),Number(away?.matches||0),Number(away?.season_features?.matches_played||0));
  const ad=blend(away,nval(away?.opponent_adjusted_avg_goals_against),nval(away?.season_features?.goals_against_per_match),Number(away?.matches||0),Number(away?.season_features?.matches_played||0));
  const hxg=clamp(((ha+ad)/2)*venueMultiplier(home,ha)+homeXgDelta,.15,4);
  const axg=clamp(((aa+hd)/2)*venueMultiplier(away,aa)+awayXgDelta,.15,4);
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
  return {source:'api_football_injuries',status:entries.length?'data_returned':'no_rows_returned',items:entries,captured_at:new Date().toISOString(),documented_update_interval:'4 hours'};
}
type PlayerImpactRow={id:number;name:string;position:string;minutes:number;starts:number;appearances:number;goals:number;assists:number;defensive_actions:number;conceded:number|null};
async function teamPlayerStats(teamId:number,leagueId:number,season:number):Promise<{status:string;players:PlayerImpactRow[];api_calls:number}> {
  const prior=await dbGet<any>('football_v2_player_impact_cache',`select=team_id,league_id,season,cached_at,players,roster_complete&team_id=eq.${teamId}&league_id=eq.${leagueId}&season=eq.${season}&limit=1`).catch(()=>null);
  if(!prior)return {status:'cache_table_unavailable',players:[],api_calls:0};
  if(prior[0]&&Date.parse(prior[0].cached_at)>Date.now()-DAY&&Array.isArray(prior[0].players))return {status:prior[0].roster_complete===true?'cached':'cached_partial',players:prior[0].players,api_calls:0};
  const startCalls=calls;
  try{
    const first=await footballPage(`/players?team=${teamId}&league=${leagueId}&season=${season}&page=1`);
    const normalized:PlayerImpactRow[]=first.rows.map((row:any)=>{
      const p=row?.player||{},s=(row?.statistics||[]).find((x:any)=>Number(x?.league?.id)===leagueId&&Number(x?.team?.id)===teamId)||row?.statistics?.[0]||{};
      const number=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
      return {id:number(p.id),name:String(p.name||''),position:String(s?.games?.position||''),minutes:number(s?.games?.minutes),starts:number(s?.games?.lineups),appearances:number(s?.games?.appearences??s?.games?.appearances),goals:number(s?.goals?.total),assists:number(s?.goals?.assists),defensive_actions:number(s?.tackles?.total||0)+number(s?.tackles?.interceptions)+number(s?.tackles?.blocks),conceded:s?.goals?.conceded==null?null:number(s.goals.conceded)};
    }).filter((p:any)=>p.id>0&&p.minutes>0);
    const complete=first.totalPages===1;
    await dbWrite('football_v2_player_impact_cache',{team_id:teamId,league_id:leagueId,season,players:normalized,roster_complete:complete,cached_at:new Date().toISOString(),source:'api_football_players_team_league_season'},'team_id,league_id,season');
    return {status:complete?'fresh':'fresh_partial',players:normalized,api_calls:calls-startCalls};
  }catch(error){return {status:`unavailable:${safe(error)}`,players:[],api_calls:calls-startCalls};}
}
function lineupPlayerIds(rows:any[],teamId:number):number[]{
  const team=rows.find((x:any)=>Number(x?.team?.id||x?.team_id)===teamId);const xi=Array.isArray(team?.startXI)?team.startXI:[];
  return xi.map((x:any)=>Number(x?.player?.id||x?.id)).filter((id:number)=>Number.isSafeInteger(id)&&id>0);
}
function playerTeamAdjustment(players:PlayerImpactRow[],injuries:any[],lineups:any[],teamId:number,opponentBaseXg:number):{status:string;attack_delta:number;keeper_conceded_delta:number;defense_opponent_xg_delta:number;injury_count:number;lineup_count:number;matched_injuries:number} {
  const valid=players.filter(p=>p.minutes>=270&&p.starts>=1);
  const injuryIds=new Set(injuries.filter((x:any)=>Number(x?.team_id)===teamId).map((x:any)=>Number(x?.player_id)).filter((n:number)=>Number.isSafeInteger(n)&&n>0));
  const baseline=valid.slice().sort((a,b)=>b.starts-a.starts||b.minutes-a.minutes).slice(0,11);
  if(baseline.length<11)return {status:'insufficient_player_sample',attack_delta:0,keeper_conceded_delta:0,defense_opponent_xg_delta:0,injury_count:injuryIds.size,lineup_count:lineupPlayerIds(lineups,teamId).length,matched_injuries:players.filter(p=>injuryIds.has(p.id)).length};
  const totalGoals=players.reduce((s,p)=>s+p.goals,0),totalAssists=players.reduce((s,p)=>s+p.assists,0);
  const goalEquivalentFactor=totalGoals+totalAssists>0?clamp(totalGoals/(totalGoals+totalAssists),.35,.85):1;
  const output=(p:PlayerImpactRow)=>((p.goals+p.assists)*goalEquivalentFactor*90/p.minutes)*(p.minutes/(p.minutes+900));
  const expectedOutput=baseline.reduce((s,p)=>s+output(p),0);
  let actual:PlayerImpactRow[]=[];const officialIds=lineupPlayerIds(lineups,teamId);
  if(officialIds.length>=11){const byId=new Map(players.map(p=>[p.id,p]));actual=officialIds.map(id=>byId.get(id)).filter((p):p is PlayerImpactRow=>!!p);}
  if(actual.length<11){
    const available=valid.filter(p=>!injuryIds.has(p.id));actual=available.slice().sort((a,b)=>b.starts-a.starts||b.minutes-a.minutes).slice(0,11);
  }
  if(actual.length<11)return {status:'insufficient_confirmed_lineup_data',attack_delta:0,keeper_conceded_delta:0,defense_opponent_xg_delta:0,injury_count:injuryIds.size,lineup_count:officialIds.length,matched_injuries:players.filter(p=>injuryIds.has(p.id)).length};
  const projectedOutput=actual.reduce((s,p)=>s+output(p),0);
  const attackDelta=clamp(projectedOutput-expectedOutput,-.35,.35);
  const defenseRate=(p:PlayerImpactRow)=>/goalkeeper/i.test(p.position)?0:(p.defensive_actions*90/p.minutes)*(p.minutes/(p.minutes+900));
  const expectedDefense=baseline.reduce((s,p)=>s+defenseRate(p),0),projectedDefense=actual.reduce((s,p)=>s+defenseRate(p),0);
  const defenseOpponentXgDelta=expectedDefense>0?clamp(-opponentBaseXg*(projectedDefense-expectedDefense)/expectedDefense,-.25,.25):0;
  const expectedKeeper=baseline.filter(p=>/goalkeeper/i.test(p.position)).sort((a,b)=>b.starts-a.starts)[0];
  const actualKeeper=actual.filter(p=>/goalkeeper/i.test(p.position)).sort((a,b)=>b.minutes-a.minutes)[0];
  const keeperDelta=expectedKeeper&&actualKeeper&&expectedKeeper.id!==actualKeeper.id&&expectedKeeper.conceded!==null&&actualKeeper.conceded!==null
    ?clamp((actualKeeper.conceded/Math.max(actualKeeper.minutes,1)-expectedKeeper.conceded/Math.max(expectedKeeper.minutes,1))*90,-.25,.25):0;
  return {status:officialIds.length>=11?'confirmed_lineup':'injury_projected_lineup',attack_delta:Number(attackDelta.toFixed(4)),keeper_conceded_delta:Number(keeperDelta.toFixed(4)),defense_opponent_xg_delta:Number(defenseOpponentXgDelta.toFixed(4)),injury_count:injuryIds.size,lineup_count:officialIds.length,matched_injuries:players.filter(p=>injuryIds.has(p.id)).length};
}
async function playerImpact(fixture:Fixture,injuryEvidence:any,lineupRows:any[],basePrediction:any):Promise<Record<string,unknown>>{
  const homeId=Number(fixture.teams.home.id),awayId=Number(fixture.teams.away.id),leagueId=Number(fixture.league.id),season=Number(fixture.league.season);
  const [homeStats,awayStats]=await Promise.all([teamPlayerStats(homeId,leagueId,season),teamPlayerStats(awayId,leagueId,season)]);
  const injuries=Array.isArray(injuryEvidence?.items)?injuryEvidence.items:[];
  const home=playerTeamAdjustment(homeStats.players,injuries,lineupRows,homeId,basePrediction.away_xg),away=playerTeamAdjustment(awayStats.players,injuries,lineupRows,awayId,basePrediction.home_xg);
  const injuryDataReady=['data_returned','no_rows_returned'].includes(String(injuryEvidence?.status));
  const homeLineupReady=lineupPlayerIds(lineupRows,homeId).length>=11,awayLineupReady=lineupPlayerIds(lineupRows,awayId).length>=11;
  const homeInputReady=homeLineupReady||(injuryDataReady&&home.matched_injuries===home.injury_count),awayInputReady=awayLineupReady||(injuryDataReady&&away.matched_injuries===away.injury_count);
  const ready=['fresh','cached','fresh_partial','cached_partial'].includes(homeStats.status)&&['fresh','cached','fresh_partial','cached_partial'].includes(awayStats.status)&&!['insufficient_player_sample','insufficient_confirmed_lineup_data'].includes(home.status)&&!['insufficient_player_sample','insufficient_confirmed_lineup_data'].includes(away.status)&&homeInputReady&&awayInputReady;
  return {status:ready?'applied':'not_applied',model_adjustment_applied:ready,home,away,player_data:{home:homeStats.status,away:awayStats.status},additional_api_calls:homeStats.api_calls+awayStats.api_calls,method:'T-2/T-15 only: compare goal-involvement and defensive-action rates for the confirmed XI (or best available XI excluding listed injuries) against the team regular XI; shrink by minutes played, convert goals/assists using team observed goal-to-assist ratio, cap attack xG change at +/-0.35 and defensive-action xG change at +/-0.25. A changed goalkeeper adjusts opponent xG by observed goals-conceded-per-minute difference, capped at +/-0.25.'};
}
function normTeam(x:unknown){return String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(football club|futbol club|fc|afc|cf|sc|ac)\b/g,'').replace(/[^a-z0-9]/g,'');}
function sameTeam(a:unknown,b:unknown){
  const x=normTeam(a),y=normTeam(b);
  return !!x&&!!y&&(x===y||(Math.min(x.length,y.length)>=7&&(x.includes(y)||y.includes(x))));
}
function consensusAll<T extends Record<string,number>>(rows:T[],lineKey:string,oddsKeys:string[]){
  const groups=new Map<string,T[]>();for(const row of rows){const line=Number(row[lineKey]);if(!Number.isFinite(line))continue;const key=line.toFixed(2);groups.set(key,[...(groups.get(key)||[]),row]);}
  return [...groups.entries()].map(([key,list])=>{
    const averages:Record<string,number>={};
    for(const k of oddsKeys){const xs=list.map(r=>Number(r[k])).filter(n=>Number.isFinite(n)&&n>1&&n<=100);if(xs.length)averages[k]=Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(4));}
    return {line:Number(key),...averages,bookmaker_count:list.length};
  }).sort((a,b)=>a.line-b.line);
}
function consensus<T extends Record<string,number>>(rows:T[],lineKey:string,oddsKeys:string[]){
  return consensusAll(rows,lineKey,oddsKeys).sort((a,b)=>b.bookmaker_count-a.bookmaker_count||Math.abs(a.line)-Math.abs(b.line))[0]||null;
}
async function captureStageMarkets(f:Fixture):Promise<Record<string,unknown>>{
  const leagueId=Number(f.league?.id),sport=ODDS_SPORTS[leagueId];
  if(!sport)return {source:'the_odds_api',status:'unsupported_league',captured_at:new Date().toISOString()};
  if(!cfg.oddsKey)return {source:'the_odds_api',status:'key_missing',captured_at:new Date().toISOString()};
  try{
    const url=new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds/`);url.searchParams.set('apiKey',cfg.oddsKey);url.searchParams.set('regions','eu');url.searchParams.set('markets','totals,spreads');url.searchParams.set('oddsFormat','decimal');url.searchParams.set('dateFormat','iso');
    const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)return {source:'the_odds_api',status:`http_${r.status}`,captured_at:new Date().toISOString()};
    const games=await r.json();if(!Array.isArray(games))return {source:'the_odds_api',status:'invalid_payload',captured_at:new Date().toISOString()};
    const kickoff=Date.parse(f.fixture.date),game=games.filter((g:any)=>Number.isFinite(Date.parse(g.commence_time))&&Math.abs(Date.parse(g.commence_time)-kickoff)<=90*MINUTE&&sameTeam(f.teams.home.name,g.home_team)&&sameTeam(f.teams.away.name,g.away_team)).sort((a:any,b:any)=>Math.abs(Date.parse(a.commence_time)-kickoff)-Math.abs(Date.parse(b.commence_time)-kickoff))[0];
    if(!game)return {source:'the_odds_api',status:'fixture_not_matched',captured_at:new Date().toISOString()};
    const totals:any[]=[],spreads:any[]=[];
    for(const book of game.bookmakers||[])for(const market of book.markets||[]){
      if(market.key==='totals'){
        const pairs=new Map<number,any>();for(const o of market.outcomes||[]){const line=Number(o.point),price=Number(o.price),name=String(o.name||'').toLowerCase();if(!Number.isFinite(line)||line<0||line>10||!Number.isFinite(price)||price<=1)continue;const pair=pairs.get(line)||{line};if(name==='over')pair.over=price;if(name==='under')pair.under=price;pairs.set(line,pair);}
        for(const pair of pairs.values())if(pair.over&&pair.under)totals.push({...pair,bookmaker:String(book.key||'')});
      }else if(market.key==='spreads'){
        let home:any=null,away:any=null;for(const o of market.outcomes||[]){const line=Number(o.point),price=Number(o.price);if(!Number.isFinite(line)||Math.abs(line)>10||!Number.isFinite(price)||price<=1)continue;if(sameTeam(o.name,f.teams.home.name))home={line,odds:price};else if(sameTeam(o.name,f.teams.away.name))away={line,odds:price};}
        if(home&&away&&Math.abs(home.line+away.line)<=0.26)spreads.push({home_line:home.line,away_line:away.line,home_odds:home.odds,away_odds:away.odds,bookmaker:String(book.key||'')});
      }
    }
    const totalLines=consensusAll(totals,'line',['over','under']).map(x=>({line:x.line,over_odds:x.over,under_odds:x.under,bookmaker_count:x.bookmaker_count}));
    const spreadRows=spreads.map(x=>({...x,line:x.home_line}));
    const handicapLines=consensusAll(spreadRows,'line',['home_odds','away_odds']).map(x=>({home_line:x.line,away_line:-x.line,home_odds:x.home_odds,away_odds:x.away_odds,bookmaker_count:x.bookmaker_count}));
    const total=totalLines.slice().sort((a,b)=>b.bookmaker_count-a.bookmaker_count||Math.abs(a.line)-Math.abs(b.line))[0]||null;
    const spread=handicapLines.slice().sort((a,b)=>b.bookmaker_count-a.bookmaker_count||Math.abs(a.home_line)-Math.abs(b.home_line))[0]||null;
    return {source:'the_odds_api',status:totalLines.length||handicapLines.length?'captured':'markets_unavailable',captured_at:new Date().toISOString(),totals:totalLines,handicaps:handicapLines,total,handicap:spread,odds_api_requests:1};
  }catch(error){return {source:'the_odds_api',status:'capture_failed',error:safe(error),captured_at:new Date().toISOString()};}
}
async function audit(f:Fixture,s:Stage,status:string,reason:string,attempts:number,terminal:boolean,detail:Record<string,unknown>={}){
  await dbWrite('football_v2_shadow_stage_audit',{fixture_id:f.fixture.id,stage:s.key,kickoff_at:f.fixture.date,status,reason_code:reason,attempts,terminal,detail,updated_at:new Date().toISOString()},'fixture_id,stage');
}

async function diagnose(fixtureId: number) {
  calls = 0;

  if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
    return { success: false, action: 'diagnostic', status: 'invalid_fixture_id' };
  }

  const features = await dbGet<any>(
    'football_v2_shadow_feature_snapshots',
    `select=*&fixture_id=eq.${fixtureId}&order=captured_at.desc&limit=1`
  );
  const feature = features[0];

  if (!feature) {
    return {
      success: true,
      action: 'diagnostic',
      status: 'no_prior_feature_snapshot',
      fixture_id: fixtureId,
      api_football_calls: 0,
      writes: 0
    };
  }

  const prediction = predict(
    feature.home_features,
    feature.away_features,
    feature.league_baseline,
    Number(feature.season)
  );

  return {
    success: true,
    version: VERSION,
    action: 'diagnostic',
    status: 'preview',
    fixture_id: fixtureId,
    feature_stage: feature.stage,
    feature_captured_at: feature.captured_at,
    feature_data_quality: feature.data_quality,
    home_xg: prediction.home_xg,
    away_xg: prediction.away_xg,
    probabilities: prediction.probabilities,
    fair_odds: prediction.fair_odds,
    api_football_calls: 0,
    writes: 0
  };
}

async function ensureOfficialV2(f:Fixture):Promise<{status:string;model_version?:string}> {
  const fixtureId=Number(f.fixture.id);
  const features=await dbGet<any>('football_v2_shadow_feature_snapshots',`select=fixture_id&fixture_id=eq.${fixtureId}&limit=1`);
  if(!features.length) return {status:'feature_pending'};
  const existing=await dbGet<any>('ai_prediction_snapshots',`select=fixture_id,prediction&fixture_id=eq.${fixtureId}&limit=1`);
  if(existing[0]?.prediction?.model_version===OFFICIAL_VERSION) {
    return {status:'already_ready',model_version:OFFICIAL_VERSION};
  }

  // T-10 stage is ready: build the one member-facing snapshot through the
  // same official analysis path used by match-analysis, without a member call.
  const invoke=await fetch(`${cfg.url}/functions/v1/match-analysis`,{
    method:'POST',
    headers:{apikey:cfg.role,authorization:`Bearer ${cfg.role}`,'content-type':'application/json'},
    body:JSON.stringify({fixture_id:fixtureId,internal_public:true,language:'zh-Hant'}),
    signal:AbortSignal.timeout(55_000),
  });
  const confirmed=await dbGet<any>('ai_prediction_snapshots',`select=fixture_id,prediction&fixture_id=eq.${fixtureId}&limit=1`);
  const modelVersion=String(confirmed[0]?.prediction?.model_version||'');
  if(modelVersion!==OFFICIAL_VERSION) {
    throw new Error(`official_v2_snapshot_not_confirmed_http_${invoke.status}`);
  }
  return {status:invoke.ok?'created':'created_response_non2xx',model_version:modelVersion};
}

function officialReady(status:string|undefined){
  return status==='created'||status==='already_ready'||status==='created_response_non2xx';
}

async function captureDueStageUnlocked(
  f:Fixture, stage:Stage, now:number, captureMode:'scheduled'|'late_pre_match_recovery',
  officialResults:Array<{fixture_id:number;status:string;reason?:string}>,
  officialSnapshotBatch:Record<string,unknown>, validatedLive?:Fixture
):Promise<Record<string,unknown>>{
  const id=Number(f.fixture.id);
  const [saved,audits]=await Promise.all([
    dbGet<any>('football_v2_shadow_stage_snapshots',`select=fixture_id&fixture_id=eq.${id}&stage=eq.${stage.key}&limit=1`),
    dbGet<Audit>('football_v2_shadow_stage_audit',`select=fixture_id,stage,attempts,terminal,updated_at&fixture_id=eq.${id}&stage=eq.${stage.key}&limit=1`)
  ]);
  if(saved.length){
    if(stage.key==='t10'){
      try{
        let official=officialResults.find(x=>x.fixture_id===id);
        if(!official){const result=await ensureOfficialV2(f);official={fixture_id:id,status:result.status};}
        return {fixture_id:id,stage:stage.key,status:'already_captured',official_snapshot:official.status};
      }catch(error){
        return {fixture_id:id,stage:stage.key,status:'official_snapshot_pending',reason:safe(error)};
      }
    }
    return {fixture_id:id,stage:stage.key,status:'already_captured'};
  }
  const prior=audits[0],attempt=Number(prior?.attempts||0)+1;
  if(prior?.terminal)return {fixture_id:id,stage:stage.key,status:'terminal'};
  if(prior?.updated_at&&now-Date.parse(prior.updated_at)<5*MINUTE)return {fixture_id:id,stage:stage.key,status:'retry_backoff'};
  await audit(f,stage,'processing','processing',attempt,false,{started_at:new Date().toISOString()});
  try{
    const live=validatedLive||((await football(`/fixtures?id=${id}`)).find(x=>Number(x?.fixture?.id)===id) as Fixture|undefined);
    if(!live)throw new Error('fixture_not_found');
    const officialKickoff=Date.parse(String(live.fixture?.date||'')),scheduled=Date.parse(f.fixture.date),diff=(officialKickoff-now)/MINUTE;
    if(!Number.isFinite(officialKickoff)||Math.abs(officialKickoff-scheduled)>90||diff<=0||String(live.fixture?.status?.short||'NS')!=='NS'||(stage.key==='t10'&&Math.abs(diff-stage.target)>1.5)||(stage.key==='t2'&&!(diff<=120&&diff>15))||(stage.key==='t15'&&!(diff<=15&&diff>0))){
      await audit(f,stage,'expired','fixture_changed_or_capture_window_missed',attempt,true,{scheduled_kickoff:f.fixture.date,official_kickoff:live.fixture?.date,minutes_to_kickoff:diff,api_football_calls:calls});
      return {fixture_id:id,stage:stage.key,status:'expired'};
    }
    const features=await dbGet<any>('football_v2_shadow_feature_snapshots',`select=*&fixture_id=eq.${id}&captured_at=lte.${encodeURIComponent(new Date(now).toISOString())}&order=captured_at.desc&limit=1`);
    const feature=features[0];
    if(!feature){await audit(f,stage,'missing_features','no_prior_feature_snapshot',attempt,false,{api_football_calls:calls,capture_mode:captureMode});return {fixture_id:id,stage:stage.key,status:'missing_features'};}
    const featureTime=Date.parse(String(feature.captured_at||'')),featureKickoff=Date.parse(String(feature.kickoff_at||''));
    if(!Number.isFinite(featureTime)||!Number.isFinite(featureKickoff)||Math.abs(featureKickoff-officialKickoff)>90*MINUTE||featureTime<officialKickoff-52*HOUR){
      await audit(f,stage,'missing_features','stale_or_mismatched_feature_snapshot',attempt,false,{feature_kickoff:feature.kickoff_at,official_kickoff:live.fixture.date,feature_captured_at:feature.captured_at,api_football_calls:calls,capture_mode:captureMode});
      return {fixture_id:id,stage:stage.key,status:'missing_features',reason:'stale_or_mismatched_feature_snapshot'};
    }
    const basePrediction=predict(feature.home_features,feature.away_features,feature.league_baseline,Number(feature.season));
    const marketContext=await captureStageMarkets(f);
    let availabilityEvidence:any={status:'not_collected_at_this_stage',items:[],model_adjustment_applied:false};
    if(stage.key==='t2'||stage.key==='t15'){
      try{availabilityEvidence=await availability(id);}
      catch(error){availabilityEvidence={source:'api_football_injuries',status:'collection_failed',items:[],error:safe(error),captured_at:new Date().toISOString(),model_adjustment_applied:false};}
    }
    let lineupRows:any[]=[],lineupCollectionFailed=false;
    if(stage.key==='t2'||stage.key==='t15'){
      try{lineupRows=await football(`/fixtures/lineups?fixture=${id}`);}
      catch(error){lineupRows=[];lineupCollectionFailed=true;}
    }
    const playerAdjustment:Record<string,any>=stage.key==='t2'||stage.key==='t15'
      ?await playerImpact(live,availabilityEvidence,lineupRows,basePrediction)
      :{status:'not_collected_at_this_stage',model_adjustment_applied:false,home:{attack_delta:0,keeper_conceded_delta:0,defense_opponent_xg_delta:0},away:{attack_delta:0,keeper_conceded_delta:0,defense_opponent_xg_delta:0},additional_api_calls:0,method:'not applied at T-10'};
    const applied=playerAdjustment.model_adjustment_applied===true;
    availabilityEvidence={...availabilityEvidence,model_adjustment_applied:applied,adjustment_status:playerAdjustment.status};
    const lineups={source:'api_football_fixtures',status:lineupRows.length?'data_returned':lineupCollectionFailed?'collection_failed':'not_available',teams:lineupRows,captured_at:new Date().toISOString(),documented_availability:'20-40 minutes before kickoff when league coverage supports it',model_adjustment_applied:applied,adjustment_status:playerAdjustment.status};
    const homeDelta=applied?Number((playerAdjustment.home.attack_delta+playerAdjustment.away.keeper_conceded_delta+playerAdjustment.away.defense_opponent_xg_delta).toFixed(4)):0;
    const awayDelta=applied?Number((playerAdjustment.away.attack_delta+playerAdjustment.home.keeper_conceded_delta+playerAdjustment.home.defense_opponent_xg_delta).toFixed(4)):0;
    const prediction=predict(feature.home_features,feature.away_features,feature.league_baseline,Number(feature.season),homeDelta,awayDelta);
    const quality=feature.data_quality==='research_ready'?'research_ready_uncalibrated':'low_sample_uncalibrated';
    const payload={fixture_id:id,stage:stage.key,kickoff_at:new Date(officialKickoff).toISOString(),captured_at:new Date().toISOString(),home_team_id:feature.home_team_id,away_team_id:feature.away_team_id,
      home_xg:prediction.home_xg,away_xg:prediction.away_xg,probabilities:prediction.probabilities,fair_odds:prediction.fair_odds,
      market_context:marketContext,availability_evidence:availabilityEvidence,lineup_evidence:lineups,data_quality:quality,
      player_adjustment:playerAdjustment,
      source_meta:{provider:'api_football',feature_snapshot_stage:feature.stage,feature_captured_at:feature.captured_at,feature_quality:feature.data_quality,api_football_calls:calls,odds_api_requests:marketContext.odds_api_requests||0,market_capture_status:marketContext.status,
        model_inputs:'opponent-adjusted recent form shrunk toward league average; season standings contribution discounted by overlap with recent-history matches; T-2/T-15 player goal-involvement, defensive-action and goalkeeper evidence adjusts expected goals when player statistics are available',
        shrinkage_prior:`API-Football league average from season ${feature.league_baseline?.source_season}`,shrinkage_k:5,venue_adjustment:'recency-weighted venue attack ratio shrunk toward neutral; clipped 0.85-1.15',
        score_grid_max:18,xg_bounds:[0.15,4],post_match_backfill:false,player_adjustment_applied:applied,player_adjustment_status:playerAdjustment.status,player_xg_delta:{home:homeDelta,away:awayDelta},capture_mode:captureMode,scheduled_target_at:new Date(officialKickoff-stage.target*MINUTE).toISOString(),capture_lag_minutes:Number(Math.max(0,Math.abs((officialKickoff-stage.target*MINUTE-now)/MINUTE)).toFixed(2)),eligible_for_stage_metrics:captureMode==='scheduled'},model_version:VERSION,research_only:true};
    await dbWrite('football_v2_shadow_stage_snapshots',payload,'fixture_id,stage','resolution=ignore-duplicates,return=minimal');
    await audit(f,stage,'ready','shadow_prediction_saved',attempt,true,{feature_stage:feature.stage,feature_captured_at:feature.captured_at,api_football_calls:calls});
    if(stage.key==='t10'){
      try{
        let official=officialResults.find(x=>x.fixture_id===id);
        if(!official){const result=await ensureOfficialV2(f);official={fixture_id:id,status:result.status};}
        return {fixture_id:id,stage:stage.key,status:'ready',official_snapshot:official.status,home_xg:prediction.home_xg,away_xg:prediction.away_xg,data_quality:quality};
      }catch(error){
        return {fixture_id:id,stage:stage.key,status:'official_snapshot_pending',reason:safe(error)};
      }
    }
    return {fixture_id:id,stage:stage.key,status:'ready',home_xg:prediction.home_xg,away_xg:prediction.away_xg,data_quality:quality};
  }catch(e){
    const reason=safe(e);await audit(f,stage,'failed',reason,attempt,false,{api_football_calls:calls,capture_mode:captureMode});
    return {fixture_id:id,stage:stage.key,status:'failed',reason,attempt,terminal:false};
  }
}

async function captureDueStage(f:Fixture,stage:Stage,now:number,captureMode:'scheduled'|'late_pre_match_recovery',officialResults:Array<{fixture_id:number;status:string;reason?:string}>,officialSnapshotBatch:Record<string,unknown>):Promise<Record<string,unknown>>{
  if(stage.key==='t10')return captureDueStageUnlocked(f,stage,now,captureMode,officialResults,officialSnapshotBatch);
  const token=crypto.randomUUID(),leaseSeconds=120;
  const acquired=await leaseRpc('reserve_football_v2_stage_capture_lease',{p_fixture_id:Number(f.fixture.id),p_stage:stage.key,p_lease_token:token,p_lease_seconds:leaseSeconds});
  if(!acquired)return {fixture_id:Number(f.fixture.id),stage:stage.key,status:'capture_in_progress'};
  try{return await captureDueStageUnlocked(f,stage,now,captureMode,officialResults,officialSnapshotBatch);}
  finally{await leaseRpc('release_football_v2_stage_capture_lease',{p_fixture_id:Number(f.fixture.id),p_stage:stage.key,p_lease_token:token}).catch(()=>false);}
}
async function recoverStage(fixtureId:number,stageKey:'t2'|'t15'){
  calls=0;if(!Number.isSafeInteger(cfg.dailyCallCap)||cfg.dailyCallCap<1)return {success:false,status:'daily_api_cap_not_configured',api_football_calls:0};
  const stage=STAGES.find(x=>x.key===stageKey)!,token=crypto.randomUUID();
  const acquired=await leaseRpc('reserve_football_v2_stage_capture_lease',{p_fixture_id:fixtureId,p_stage:stageKey,p_lease_token:token,p_lease_seconds:120});
  if(!acquired)return {success:false,action:'recover_stage',status:'capture_in_progress',api_football_calls:0};
  try{
    const [saved,audits]=await Promise.all([
      dbGet<any>('football_v2_shadow_stage_snapshots',`select=fixture_id&fixture_id=eq.${fixtureId}&stage=eq.${stageKey}&limit=1`),
      dbGet<Audit>('football_v2_shadow_stage_audit',`select=attempts,terminal,updated_at&fixture_id=eq.${fixtureId}&stage=eq.${stageKey}&limit=1`)
    ]);
    if(saved.length)return {success:true,action:'recover_stage',fixture_id:fixtureId,stage:stageKey,status:'already_captured',api_football_calls:0};
    if(audits[0]?.terminal)return {success:false,action:'recover_stage',fixture_id:fixtureId,stage:stageKey,status:'terminal',api_football_calls:0};
    if(audits[0]?.updated_at&&Date.now()-Date.parse(audits[0].updated_at)<5*MINUTE)return {success:false,action:'recover_stage',fixture_id:fixtureId,stage:stageKey,status:'retry_backoff',api_football_calls:0};
    const liveRows=await football(`/fixtures?id=${fixtureId}`),live=liveRows.find(x=>Number(x?.fixture?.id)===fixtureId) as Fixture|undefined;
    if(!live)return {success:false,action:'recover_stage',status:'fixture_not_found',api_football_calls:calls};
    const delta=(Date.parse(live.fixture.date)-Date.now())/MINUTE;
    if(String(live.fixture?.status?.short||'NS')!=='NS'||!(stageKey==='t2'?delta<=120&&delta>15:delta<=15&&delta>0))return {success:false,action:'recover_stage',status:'stage_window_closed',minutes_to_kickoff:Number(delta.toFixed(2)),api_football_calls:calls};
    const captureMode=Math.abs(delta-stage.target)<=1.5?'scheduled':'late_pre_match_recovery';
    const result=await captureDueStageUnlocked(live,stage,Date.now(),captureMode,[],{eligible:0,ready:0,pending:0},live);
    return {success:result.status==='ready'||result.status==='already_captured',action:'recover_stage',...result,api_football_calls:calls};
  }finally{await leaseRpc('release_football_v2_stage_capture_lease',{p_fixture_id:fixtureId,p_stage:stageKey,p_lease_token:token}).catch(()=>false);}
}

async function run(action:'dry_run'|'run'){
  calls=0;if(action==='run'&&(!Number.isSafeInteger(cfg.dailyCallCap)||cfg.dailyCallCap<1))return {success:false,status:'daily_api_cap_not_configured',api_football_calls:0};
  const now=Date.now(),cal=await loadFixtures(now,action==='run');
  const due=cal.fixtures.flatMap(f=>{const delta=(Date.parse(f.fixture.date)-now)/MINUTE;return STAGES.filter(s=>s.key==='t10'?Math.abs(delta-s.target)<=1.5:s.key==='t2'?delta<=120&&delta>15:delta<=15&&delta>0).map(stage=>({f,stage,delta,captureMode:Math.abs(delta-stage.target)<=1.5?'scheduled' as const:'late_pre_match_recovery' as const}));});
  if(action==='dry_run')return {success:true,version:VERSION,action,status:due.length?'preview':cal.misses.length?'calendar_cache_missing':'outside_capture_windows',due:due.slice(0,20).map(x=>({fixture_id:x.f.fixture.id,stage:x.stage.key,capture_mode:x.captureMode,minutes_to_kickoff:Number(x.delta.toFixed(2))})),calendar_cache_misses:cal.misses,api_football_calls:0};

  // Process every unbuilt official T-10 snapshot, not just the single research
  // stage selected below. This prevents simultaneous kickoff groups being
  // silently skipped by the once-per-minute Cron schedule.
  const officialDue=cal.fixtures.filter(f=>{
    const minutes=(Date.parse(f.fixture.date)-now)/MINUTE;
    return minutes>0&&minutes<=10*60;
  });
  let officialCursor=0;
  const officialResults:Array<{fixture_id:number;status:string;reason?:string}> = [];
  const workerCount=Math.min(4,officialDue.length);
  await Promise.all(Array.from({length:workerCount},async()=>{
    while(true){
      const index=officialCursor++;
      if(index>=officialDue.length) return;
      const fixture=officialDue[index],fixtureId=Number(fixture.fixture.id);
      try{
        const result=await ensureOfficialV2(fixture);
        officialResults.push({fixture_id:fixtureId,status:result.status});
      }catch(error){
        officialResults.push({fixture_id:fixtureId,status:'pending',reason:safe(error)});
      }
    }
  }));
  // One explicit safety retry at T-9:55. The regular one-minute pass above
  // remains the primary path and continues catch-up retries through kickoff.
  // round() gives one scheduled minute bucket while tolerating the few seconds
  // of HTTP/Edge startup jitter seen in Cron-triggered invocations.
  const watchdogFixtures=officialDue.filter(f=>{
    const minutes=(Date.parse(f.fixture.date)-now)/MINUTE;
    return Math.round(minutes)===T10_WATCHDOG_MINUTE;
  });
  for(const fixture of watchdogFixtures){
    const fixtureId=Number(fixture.fixture.id);
    const resultIndex=officialResults.findIndex(x=>x.fixture_id===fixtureId);
    const firstStatus=officialResults[resultIndex]?.status;
    let retryStatus='not_needed';
    if(!officialReady(firstStatus)){
      try{
        const retry=await ensureOfficialV2(fixture);
        retryStatus=retry.status;
        if(resultIndex>=0)officialResults[resultIndex]={fixture_id:fixtureId,status:retry.status};
        else officialResults.push({fixture_id:fixtureId,status:retry.status});
      }catch(error){
        retryStatus='pending';
        if(resultIndex>=0)officialResults[resultIndex]={fixture_id:fixtureId,status:'pending',reason:safe(error)};
        else officialResults.push({fixture_id:fixtureId,status:'pending',reason:safe(error)});
      }
    }
    const finalStatus=officialResults.find(x=>x.fixture_id===fixtureId)?.status;
    console.log('FOOTBALL_V2_T10_WATCHDOG',JSON.stringify({
      fixture_id:fixtureId,
      minutes_to_kickoff:Number(((Date.parse(fixture.fixture.date)-now)/MINUTE).toFixed(2)),
      first_status:firstStatus||'not_recorded',
      retry_status:retryStatus,
      status:officialReady(finalStatus)?'ready_or_recovered':'late_warning'
    }));
  }
  const officialSnapshotBatch={
    eligible:officialDue.length,
    ready:officialResults.filter(x=>officialReady(x.status)).length,
    feature_pending:officialResults.filter(x=>x.status==='feature_pending').length,
    pending:officialResults.filter(x=>x.status==='pending').length,
    results:officialResults.slice(0,30),
  };
  console.log('FOOTBALL_V2_OFFICIAL_T10_BATCH',JSON.stringify(officialSnapshotBatch));
  if(!due.length)return {success:true,version:VERSION,action,status:'outside_capture_windows',official_snapshot_batch:officialSnapshotBatch,calendar_cache_misses:cal.misses,api_football_calls:calls};
  const orderedDue=due.slice().sort((a,b)=>a.delta-b.delta);
  const stageResults:Array<Record<string,unknown>>=[];
  let stageCursor=0;
  const stageWorkers=Math.min(3,orderedDue.length);
  await Promise.all(Array.from({length:stageWorkers},async()=>{
    while(true){
      const index=stageCursor++;
      if(index>=orderedDue.length)return;
      const item=orderedDue[index];
      try{
        stageResults.push(await captureDueStage(item.f,item.stage,now,item.captureMode,officialResults,officialSnapshotBatch));
      }catch(error){
        const result={fixture_id:Number(item.f.fixture.id),stage:item.stage.key,status:'stage_worker_failed',reason:safe(error)};
        stageResults.push(result);
        console.error('FOOTBALL_V2_STAGE_WORKER_ERROR',JSON.stringify(result));
      }
    }
  }));
  return {success:true,version:VERSION,action,status:stageResults.some(x=>x.status==='ready'||x.status==='already_captured')?'stages_processed':'stage_attempts_finished',
    due_stages:orderedDue.length,stage_results:stageResults.slice(0,80),official_snapshot_batch:officialSnapshotBatch,
    calendar_cache_misses:cal.misses,api_football_calls:calls};
}
Deno.serve(async request=>{
  if(request.method!=='POST')return response(405,{success:false,error:'method_not_allowed'});
  if(!cfg.url||!cfg.role)return response(503,{success:false,error:'storage_not_configured'});
  let body:any;try{body=await request.json()}catch{return response(400,{success:false,error:'invalid_json'})};const action = String(body?.action || 'dry_run');
  const serviceAuthorized=request.headers.get('apikey')===cfg.role&&request.headers.get('authorization')===`Bearer ${cfg.role}`;
  if(action==='recover_stage'?!serviceAuthorized:(!cfg.cronKey||request.headers.get('x-habao-cron-key')!==cfg.cronKey))return response(401,{success:false,error:'unauthorized'});
  if(action==='recover_stage'){const fixtureId=Number(body?.fixture_id),stage=String(body?.stage||'');if(!Number.isSafeInteger(fixtureId)||fixtureId<=0||!['t2','t15'].includes(stage))return response(400,{success:false,error:'valid_fixture_and_stage_required'});try{const result=await recoverStage(fixtureId,stage as 't2'|'t15');return response(result.success?200:409,result);}catch(e){return response(503,{success:false,action:'recover_stage',error:safe(e),api_football_calls:calls});}}

if (action === 'diagnostic') {
  const fixtureId = Number(body?.fixture_id);
  if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
    return response(400, {
      success: false,
      error: 'valid_fixture_id_required'
    });
  }
  try {
    const result = await diagnose(fixtureId);
    return response(result.success ? 200 : 503, result);
  } catch (e) {
    return response(503, {
      success: false,
      action: 'diagnostic',
      error: safe(e),
      api_football_calls: 0,
      writes: 0
    });
  }
}

if (action !== 'dry_run' && action !== 'run') {
  return response(422, { success: false, error: 'unknown_action' });
}

try {
  const result = await run(action as 'dry_run' | 'run');
  return response(result.success ? 200 : 503, result);
} catch (e) {
  return response(503, {
    success: false,
    version: VERSION,
    error: safe(e),
    api_football_calls: calls
  });
}
});
