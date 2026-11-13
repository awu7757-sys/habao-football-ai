/** MLB shared statistical helpers. Stage orchestration below owns captures. */
                               
const JSON_HEADERS = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
function respond(status       , body        ){return new Response(JSON.stringify(body,null,2),{status,headers:JSON_HEADERS});}
const n=(v        )            =>{const x=Number(v);return v===null||v===undefined||v===""||!Number.isFinite(x)?null:x;};
const round=(v       ,d=2)=>Number(v.toFixed(d));
const timeout=()=>AbortSignal.timeout(12000);
async function fetchJson(url       )             {const r=await fetch(url,{headers:{Accept:"application/json"},signal:timeout()});if(!r.ok)throw Error(`provider_http_${r.status}`);return await r.json();}
function statValue(s    ,keys         )            {for(const key of keys){const val=n(s?.[key]);if(val!==null)return val;}return null;}
/** Team stats cache is advisory only. Keep T-10 immutable; no missing-data fabrication. */
async function teamSummaryWithCache(teamId       ,season       ){
 const base=Deno.env.get('SUPABASE_URL')?.replace(/\/$/,'');
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(base&&key){
  try {
   const u=new URL(base+'/rest/v1/baseball_team_stats_cache');
   u.searchParams.set('select','stats,fetched_at');u.searchParams.set('team_id','eq.'+teamId);
   u.searchParams.set('season','eq.'+season);u.searchParams.set('limit','1');
   const r=await fetch(u,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(3500)});
   if(r.ok){
    const rows=await r.json();const row=rows?.[0],ts=Date.parse(row?.fetched_at||'');
    const age=Date.now()-ts;
    // Only use healthy cache from last 24h; stats were fetched before analysis clock.
    if(Number.isFinite(ts)&&age>=0&&age<=86400000&&
       row?.stats?.team_id===teamId&&Number(row?.stats?.games_played)>=5&&
       Number.isFinite(row?.stats?.runs_per_game)&&Number.isFinite(row?.stats?.runs_allowed_per_game))
      return {...row.stats,cache_source:'prefetched_last_24h',cache_fetched_at:row.fetched_at};
   }
  }catch{/* fall through to live official stats */}
 }
 const live=await teamSummary(teamId,season);
 return {...live,cache_source:'live_official'};
}

async function teamSummary(teamId       ,season       ){
 const u=new URL(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats`);
 u.searchParams.set("stats","season");u.searchParams.set("group","hitting,pitching");u.searchParams.set("season",String(season));
 const data=await fetchJson(u.toString());const entries=(data.stats||[])         ;
 const hitting=entries.find(x=>String(x.group?.displayName||x.group?.name||"").toLowerCase().includes("hitt"));
 const pitching=entries.find(x=>String(x.group?.displayName||x.group?.name||"").toLowerCase().includes("pitch"));
 const h=hitting?.splits?.[0]?.stat||{};const p=pitching?.splits?.[0]?.stat||{};
 const games=statValue(h,["gamesPlayed"])??statValue(p,["gamesPlayed"]);
 const runs=statValue(h,["runs"]);const allowed=statValue(p,["runs"]);
 return {team_id:teamId,games_played:games,runs_scored:runs,runs_allowed:allowed,
  runs_per_game:games&&runs!==null?round(runs/games,3):null,
  runs_allowed_per_game:games&&allowed!==null?round(allowed/games,3):null,
  batting_avg:statValue(h,["avg"]),ops:statValue(h,["ops"]),era:statValue(p,["era"]),whip:statValue(p,["whip"])};
}
// Only completed, earlier games contribute to recent form; never use future results.
async function recentTeamForm(teamId       ,asOf       ,limit=10){
 const end=new Date(Date.parse(asOf)-8*3600000); // conservative finished-game buffer
 const start=new Date(end.getTime()-35*86400000);
 const iso=(d     )=>d.toISOString().slice(0,10);
 const u=new URL("https://statsapi.mlb.com/api/v1/schedule");
 u.searchParams.set("sportId","1");u.searchParams.set("teamId",String(teamId));
 u.searchParams.set("startDate",iso(start));u.searchParams.set("endDate",iso(end));
 const d=await fetchJson(u.toString());
 const all=(d.dates||[]).flatMap((x    )=>x.games||[])
  .filter((g    )=>Date.parse(g.gameDate)<=Date.parse(asOf)-8*3600000
    && ["F","O"].includes(String(g.status?.abstractGameCode||""))
    && g.teams?.home?.score!=null && g.teams?.away?.score!=null
    && Number.isFinite(Number(g.teams.home.score)) && Number.isFinite(Number(g.teams.away.score))
    && (g.teams?.home?.team?.id===teamId||g.teams?.away?.team?.id===teamId))
  .sort((a    ,b    )=>Date.parse(b.gameDate)-Date.parse(a.gameDate)).slice(0,limit);
 const samples=all.map((g    )=>{
  const isHome=g.teams.home.team.id===teamId;
  const mine=Number(isHome?g.teams.home.score:g.teams.away.score);
  const opp=Number(isHome?g.teams.away.score:g.teams.home.score);
  return {game_id:g.gamePk,date:g.gameDate,runs_for:mine,runs_against:opp,win:mine>opp};
 });
 const count=samples.length;
 return {team_id:teamId,games_used:count,wins:samples.filter((g    )=>g.win).length,
  runs_per_game:count?round(samples.reduce((a       ,g    )=>a+g.runs_for,0)/count,3):null,
  runs_allowed_per_game:count?round(samples.reduce((a       ,g    )=>a+g.runs_against,0)/count,3):null,
  sample_game_ids:samples.map((g    )=>g.game_id)};
}
async function pitcherSummary(pitcherId            ,season       ){
 if(!pitcherId)return {pitcher_id:null,era:null,whip:null,innings:null,available:false};
 const u=new URL(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats`);
 u.searchParams.set("stats","season");u.searchParams.set("group","pitching");u.searchParams.set("season",String(season));
 try {const d=await fetchJson(u.toString());const s=d?.stats?.[0]?.splits?.[0]?.stat||{};
  return {pitcher_id:pitcherId,era:n(s.era),whip:n(s.whip),innings:String(s.inningsPitched??""),available:n(s.era)!==null};
 }catch{return {pitcher_id:pitcherId,era:null,whip:null,innings:null,available:false};}
}
function median(values         )            {if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);const m=Math.floor(a.length/2);return round(a.length%2?a[m]:(a[m-1]+a[m])/2,2);}
function matchingEvent(events      ,home       ,away       ,kickoff       ){return events.find(e=>e.home_team===home&&e.away_team===away&&Math.abs(Date.parse(e.commence_time)-Date.parse(kickoff))<=6*3600000);}
/** Official T-10 candidates read cached earliest complete lines only; ZERO Odds API calls here. */
async function readOpeningOdds(gameId       ,home       ,away       ,kickoff       ,asOf       ){
 const base=Deno.env.get('SUPABASE_URL')?.replace(/\/$/,'');
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key)return {status:'opening_cache_settings_missing',lines:null,quota:null};
 try{
  const u=new URL(`${base}/rest/v1/baseball_opening_lines`);
  u.searchParams.set('select','game_id,home_team,away_team,kickoff_at,observed_at,odds_event_id,origin,bookmakers_count,lines');
  u.searchParams.set('game_id',`eq.${gameId}`);
  const r=await fetch(u,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:timeout()});
  if(!r.ok)return {status:'opening_cache_http_'+r.status,lines:null,quota:null};
  const records=await r.json();
  // Deterministic earliest quote on or before T-10 analysis time; never read a future observation.
  const cutoff=Date.parse(asOf);
  const line=(Array.isArray(records)?records:[])
   .filter((x    )=>x.home_team===home&&x.away_team===away&&
     Number.isFinite(Date.parse(x.kickoff_at))&&Math.abs(Date.parse(x.kickoff_at)-Date.parse(kickoff))<=45*60000&&
     Number.isFinite(Date.parse(x.observed_at))&&Date.parse(x.observed_at)<=cutoff)
   .sort((a    ,b    )=>Date.parse(a.observed_at)-Date.parse(b.observed_at))[0];
  if(!line)return {status:'opening_cache_missing_or_future_only',lines:null,quota:null};
  return {status:'found',line_origin:'earliest_recorded_historical_or_live_not_verified_opening',
   original_observation_origin:line.origin,observed_at:line.observed_at,event_id:line.odds_event_id,
   bookmakers_count:line.bookmakers_count,lines:line.lines,quota:{used_last:'0',remaining:null},
   source:'baseball_opening_lines_earliest_saved'};
 }catch{return {status:'opening_cache_unavailable',lines:null,quota:null};}
}
/**
 * Research-only probability diagnostics. These probabilities approximate nine-inning
 * scoring with independent Poisson runs; they are NOT calibrated MLB win/cover rates.
 * Extra innings, correlated offense, overdispersion, bullpen usage and weather are not
 * accounted for. Values must NEVER change formal model.markets.*.pick by themselves.
 */
function poissonRunProbabilities(expected       )               {
 if(!Number.isFinite(expected)||expected<0.5||expected>20)return null;
 let term=Math.exp(-expected),sum=term;
 const probabilities=[term];
 for(let runs=1;runs<=90;runs++){
  term*=expected/runs;
  probabilities.push(term);
  sum+=term;
  if(runs>=expected&&1-sum<1e-12)break;
 }
 if(!Number.isFinite(sum)||sum<0.99999999)return null;
 return probabilities.map(v=>v/sum);
}
const validatedOddsPrice=(v        )            =>
 typeof v==='number'&&Number.isFinite(v)&&v>1&&v<=1000?v:null;
const probabilityRounding=(v       )=>round(v,6);
function projectedProbabilityResearch(projection    ,odds    ,asOf       )          {
 const h=poissonRunProbabilities(projection?.home_runs),a=poissonRunProbabilities(projection?.away_runs);
 if(!h||!a)return null;
 const sourceTime=Date.parse(odds?.observed_at||'');
 const readTime=Date.parse(asOf);
 const trustedMarket=odds?.status==='found'&&typeof odds?.bookmakers_count==='number'&&
  odds.bookmakers_count>0&&Number.isFinite(sourceTime)&&Number.isFinite(readTime)&&sourceTime<=readTime;
 const lines=trustedMarket?odds?.lines||{}:{};
 const totalLine=typeof lines.total==='number'&&Number.isFinite(lines.total)&&lines.total>0&&lines.total<40?lines.total:null;
 const spreadLine=typeof lines.home_spread==='number'&&Number.isFinite(lines.home_spread)&&Math.abs(lines.home_spread)<=30?lines.home_spread:null;
 let homeWin=0,awayWin=0,tie=0,over=0,under=0,totalPush=0,spreadHome=0,spreadAway=0,spreadPush=0;
 for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++){
  const weight=h[i]*a[j];
  if(i>j)homeWin+=weight;
  else if(i<j)awayWin+=weight;
  else tie+=weight;
  if(totalLine!==null){
   const diff=i+j-totalLine;
   if(diff>1e-9)over+=weight;else if(diff< -1e-9)under+=weight;else totalPush+=weight;
  }
  if(spreadLine!==null){
   const diff=i-j+spreadLine;
   if(diff>1e-9)spreadHome+=weight;else if(diff< -1e-9)spreadAway+=weight;else spreadPush+=weight;
  }
 }
 // Tie probability is reported separately; renormalization is a proxy ONLY,
 // not an actual extra-inning forecast.
 const nonTie=homeWin+awayWin;
 const homeProxy=nonTie>0?homeWin/nonTie:null;
 const awayProxy=nonTie>0?awayWin/nonTie:null;
 const homePrice=trustedMarket?validatedOddsPrice(lines.home_moneyline_decimal):null;
 const awayPrice=trustedMarket?validatedOddsPrice(lines.away_moneyline_decimal):null;
 const fullMLPrice=homePrice!==null&&awayPrice!==null;
 const marketSum=fullMLPrice?1/homePrice +1/awayPrice :null;
 const overPrice=trustedMarket?validatedOddsPrice(lines.over_decimal):null;
 const underPrice=trustedMarket?validatedOddsPrice(lines.under_decimal):null;
 const spreadHomePrice=trustedMarket?validatedOddsPrice(lines.home_spread_decimal):null;
 const spreadAwayPrice=trustedMarket?validatedOddsPrice(lines.away_spread_decimal):null;
 const unitEv=(win       ,loss       ,price            )=>
  price===null?null:probabilityRounding(win*(price-1)-loss);
 const result    ={
  version:'habao-mlb-probability-research-v1',research_only:true,
  affects_official_pick:false,
  model:'independent_poisson_nine_inning_proxy_uncalibrated',
  limitations:['unvalidated_probability_calibration','no_extra_inning_model','no_bullpen_weather_adjustment','no_score_overdispersion'],
  source:{bookmaker_observation_usable:trustedMarket,observed_at:odds?.observed_at||null,
   bookmaker_opening_verified:false},
  score:{expected_home_runs:projection.home_runs,expected_away_runs:projection.away_runs,
   nine_inning_home_outscores:probabilityRounding(homeWin),nine_inning_away_outscores:probabilityRounding(awayWin),
   nine_inning_tie:probabilityRounding(tie)},
  moneyline:{home_win_proxy:homeProxy===null?null:probabilityRounding(homeProxy),
   away_win_proxy:awayProxy===null?null:probabilityRounding(awayProxy),
   market_home_no_vig:marketSum===null?null:probabilityRounding((1/homePrice )/marketSum),
   market_away_no_vig:marketSum===null?null:probabilityRounding((1/awayPrice )/marketSum),
   market_overround:marketSum===null?null:probabilityRounding(marketSum),
   home_ev_proxy:!fullMLPrice||homeProxy===null?null:unitEv(homeProxy,1-homeProxy,homePrice),
   away_ev_proxy:!fullMLPrice||awayProxy===null?null:unitEv(awayProxy,1-awayProxy,awayPrice)},
  totals:{line:totalLine,over_probability:totalLine===null?null:probabilityRounding(over),
   under_probability:totalLine===null?null:probabilityRounding(under),
   push_probability:totalLine===null?null:probabilityRounding(totalPush),
   over_ev_proxy:totalLine===null?null:unitEv(over,under,overPrice),
   under_ev_proxy:totalLine===null?null:unitEv(under,over,underPrice)},
  spread:{home_line:spreadLine,home_cover_probability:spreadLine===null?null:probabilityRounding(spreadHome),
   away_cover_probability:spreadLine===null?null:probabilityRounding(spreadAway),
   push_probability:spreadLine===null?null:probabilityRounding(spreadPush),
   home_ev_proxy:spreadLine===null?null:unitEv(spreadHome,spreadAway,spreadHomePrice),
   away_ev_proxy:spreadLine===null?null:unitEv(spreadAway,spreadHome,spreadAwayPrice)}
 };
 return result;
}
