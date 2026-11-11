// HABAO NBA unified V2 shadow model: Bayesian-shrunk possession efficiency with a scoring fallback.
// Reads immutable V1 T-10 snapshots and only historical completed games before snapshot time.
// Writes only basketball_v2_unified_snapshots and isolated basketball_v2_box_cache; never modifies V1/member data.
const URL_BASE = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const ROLE = String(Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || (()=>{try{return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||''}catch{return ''}})());
const NBA_KEY = String(Deno.env.get('API_NBA_KEY') || Deno.env.get('API_FOOTBALL_KEY') || '');
const CRON_KEY = String(Deno.env.get('BASKETBALL_T10_CRON_KEY') || '');
const NBA_ENDPOINT = 'https://v2.nba.api-sports.io';
const VERSION = 'nba-v2-unified-efficiency-shrinkage-v0.2';
const RUNNER_REVISION='nba-v2-runner-audit-20261111';
const HEADERS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-habao-cron-key,authorization,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','X-Habao-Version':RUNNER_REVISION};
const response = (status,data) => new Response(JSON.stringify(data),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'}});
const asNumber = (value) => value===null || value===undefined || typeof value==='boolean' || String(value).trim()==='' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const round=(x,n=3)=>Number(x.toFixed(n));
const parseMs=(x)=>{const n=Date.parse(String(x||''));return Number.isFinite(n)?n:null};
const nbaSeasonStart=(year)=>Date.parse(`${year}-10-20T00:00:00.000Z`); // same safety boundary as NBA V1, not stage-based
function validLeagueGame(g, teamId, season, cutoff){
  if(!g || String(g.league||'').toLowerCase()!=='standard'||!Number.isSafeInteger(Number(g.id))||Number(g.id)<=0)return null;
  const start=parseMs(g?.date?.start);
  if(start===null || start >= cutoff - 4*3600000 || start < nbaSeasonStart(season))return null;
  if(Number(g?.status?.short)!==3)return null;
  const home=Number(g?.teams?.home?.id),away=Number(g?.teams?.visitors?.id);
  if(home!==teamId && away!==teamId)return null;
  const h=asNumber(g?.scores?.home?.points),a=asNumber(g?.scores?.visitors?.points);
  if(h===null||a===null || h<50 || a<50 || h>200 || a>200)return null;
  return {id:Number(g.id),team_id:teamId,start,season,for:home===teamId?h:a,against:home===teamId?a:h,venue:home===teamId?'home':'away'};
}
function historicalGames(current,previous,teamId,season,cutoff){
  const seen=new Set();const all=[];
  for(const [games,y] of [[current,season],[previous,season-1]]){
    for(const g of games){const x=validLeagueGame(g,teamId,y,cutoff);if(!x||seen.has(x.id))continue;seen.add(x.id);all.push(x)}
  }
  return all.sort((a,b)=>b.start-a.start).slice(0,24);
}
function posteriorGames(games, cutoff, desiredVenue,targetSeason){
  const prior=113.5,priorGames=5.5;
  let w=0,attack=0,defense=0,venueW=0,venuePoints=0;
  let margins=[];let totals=[];let currentCount=0;
  for(const [i,g] of games.entries()){
    const age=(cutoff-g.start)/86400000;
    const weight=(g.season===targetSeason?1:0.62)*Math.pow(0.5,age/110)*Math.pow(0.98,i);
    if(!(weight>0))continue;
    w+=weight;attack+=weight*g.for;defense+=weight*g.against;
    margins.push({v:g.for-g.against,w:weight}); totals.push({v:g.for+g.against,w:weight});
    if(g.venue===desiredVenue){venueW+=weight;venuePoints+=weight*g.for;}
    if(g.season===targetSeason)currentCount++;
  }
  const of=(prior*priorGames+attack)/(priorGames+w);
  const against=(prior*priorGames+defense)/(priorGames+w);
  const venueAdj=venueW>=1.5?clamp((venuePoints/venueW-of)*0.22*(venueW/(venueW+5)),-2,2):0;
  const variance=(parts,average,priorVar,priorWeight)=>{
    const sum=parts.reduce((a,x)=>a+x.w*(x.v-average)**2,0);
    return (priorVar*priorWeight+sum)/(priorWeight+parts.reduce((a,x)=>a+x.w,0));
  };
  const empiricalMargin=w?margins.reduce((a,x)=>a+x.v*x.w,0)/w:0;
  const empiricalTotal=w?totals.reduce((a,x)=>a+x.v*x.w,0)/w:227;
  return {games:games.length,effective_sample:round(w,2),offense:of,defense:against,venue_adjustment:venueAdj,
    var_margin:variance(margins,empiricalMargin,185,7),var_total:variance(totals,empiricalTotal,300,7)};
}
// Abramowitz & Stegun normal CDF approximation. Research-only, not a sportsbook pricing engine.
function normalCdf(x){
  const z=Math.abs(x),t=1/(1+0.2316419*z);
  const d=0.3989422804014327*Math.exp(-z*z/2);
  const r=1-d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?r:1-r;
}

// Unified V2 uses real box scores when valid, otherwise its scoring fallback.
const boxNumber=asNumber;
function teamBox(record, expectedScore) {
 const x=record?.statistics?.[0]||{};
 const fga=boxNumber(x.fga),fta=boxNumber(x.fta),oreb=boxNumber(x.offReb),tov=boxNumber(x.turnovers);
 if([fga,fta,oreb,tov].some(v=>v===null)||fga<30||fga>150||fta<0||fta>90||oreb<0||oreb>45||tov<0||tov>50) return null;
 const poss=.976*(fga+.44*fta-oreb+tov);
 const points=boxNumber(expectedScore),reported=boxNumber(x.points);
 if(points===null||points<50||points>200||(reported!==null&&Math.abs(points-reported)>1)||poss<70||poss>155) return null;
 return {pace:poss,ortg:100*points/poss};
}
function completedBox(game,apiResponse) {
 if(!Array.isArray(apiResponse)||apiResponse.length!==2)return null;
 const homeId=Number(game?.teams?.home?.id),awayId=Number(game?.teams?.visitors?.id);
 const home=apiResponse.find(v=>Number(v?.team?.id)===homeId),away=apiResponse.find(v=>Number(v?.team?.id)===awayId);
 const h=teamBox(home,game?.scores?.home?.points),a=teamBox(away,game?.scores?.visitors?.points);
 if(!h||!a||Math.abs(h.pace-a.pace)>22)return null;
 return {home_id:homeId,away_id:awayId,pace:(h.pace+a.pace)/2,home_ortg:h.ortg,away_ortg:a.ortg};
}
function efficiencyResearch(homeGames,awayGames,boxes,cutoff,market,season,scorePrior) {
 function teamStats(games){let sumW=0,p=0,of=0,df=0,count=0;
   for(const g of games){const box=boxes.get(g.id);if(!box)continue;
    const isHome=g.venue==='home', teamId=Number(g.team_id);
    if((isHome?box.home_id:box.away_id)!==teamId)continue;
    const days=(cutoff-g.start)/86400000;
    const w=(g.season===season?1:.6)*Math.pow(.5,days/110);
    p+=w*box.pace;of+=w*(isHome?box.home_ortg:box.away_ortg);
    df+=w*(isHome?box.away_ortg:box.home_ortg);sumW+=w;count++;
   }
   return {count,w:sumW,pace:(6*99+p)/(6+sumW),ortg:(6*114+of)/(6+sumW),drtg:(6*114+df)/(6+sumW)};
 }
 const h=teamStats(homeGames),a=teamStats(awayGames);
 if(h.count<3||a.count<3)return null;
 const possessions=clamp((h.pace+a.pace)/2,90,108);
 const homePoints=clamp(possessions*(h.ortg+a.drtg)/200+1.8,85,143);
 const awayPoints=clamp(possessions*(a.ortg+h.drtg)/200,85,143);
 const margin=homePoints-awayPoints,total=homePoints+awayPoints;
 const sigmaMargin=clamp(Number(scorePrior?.margin_sigma)||16.3,10.5,22);
 const sigmaTotal=clamp(Number(scorePrior?.total_sigma)||20,13,27);
 const hWin=normalCdf(margin/sigmaMargin),hCover=market.home_spread===null?null:normalCdf((margin+market.home_spread)/sigmaMargin);
 const over=market.total===null?null:normalCdf((total-market.total)/sigmaTotal);
 const direction=p=>p===null?null:p>=.55?'home':p<=.45?'away':null;
 return {version:VERSION,model_family:'possession_efficiency_with_bayesian_shrinkage',research_only:true,formal_recommendation:false,uncalibrated:true,
   expected_home_points:round(homePoints,2),expected_away_points:round(awayPoints,2),expected_margin:round(margin,2),expected_total:round(total,2),
   home_win_probability:round(hWin,5),home_cover_probability:hCover===null?null:round(hCover,5),over_probability:over===null?null:round(over,5),
   margin_sigma:round(sigmaMargin,2),total_sigma:round(sigmaTotal,2),
   shadow_directions:{moneyline:direction(hWin),handicap:direction(hCover),over_under:over===null?null:over>=.55?'over':over<=.45?'under':null},
   market,pace_metrics:{expected_possessions:round(possessions,2),home_ortg:round(h.ortg,2),home_drtg:round(h.drtg,2),away_ortg:round(a.ortg,2),away_drtg:round(a.drtg,2)},
   sample:{home_box_games:h.count,away_box_games:a.count,score_games_home:scorePrior?.sample?.home||0,score_games_away:scorePrior?.sample?.away||0},
   component_models:{efficiency:'possession-adjusted offense/defense with Bayesian league priors',uncertainty:'Bayesian-shrunk historical scoring variance'},
   note:'Unified research model; uncalibrated and not an official recommendation.'};
}
// Cache is isolated from official V1/V2 snapshots. A failed cache write is reported,
// not silently hidden; the caller can still inspect the in-memory computation.
async function boxCacheGet(ids){
 if(!ids.length)return [];
 return dbGet('basketball_v2_box_cache',new URLSearchParams({select:'game_id,status,box_data,reason',game_id:`in.(${ids.join(',')})`,limit:'50'}));
}
async function boxCachePut(gameId,record){
 const res=await fetch(URL_BASE+'/rest/v1/basketball_v2_box_cache?on_conflict=game_id',{
  method:'POST',headers:{apikey:ROLE,Authorization:`Bearer ${ROLE}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
  body:JSON.stringify({game_id:gameId,status:record.box?'valid':'invalid',box_data:record.box||null,reason:record.reason||null,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(15000)
 });
 if(!res.ok)throw new Error('BOX_CACHE_WRITE_'+res.status+':'+(await res.text()).slice(0,100));
}
async function probeEfficiency(snapshot){
 const id=Number(snapshot?.game_id),d=snapshot.prediction_data||{},fx=d.fixture||{};
 const season=Number(fx.season),home=Number(fx?.home?.id),away=Number(fx?.away?.id),cutoff=parseMs(snapshot.generated_at),kickoff=parseMs(snapshot.fixture_time);
 if(!id||!home||!away||!season||cutoff===null||kickoff===null||kickoff<=cutoff||kickoff-cutoff>10.5*3600000)return {status:'invalid_snapshot'};
 // Same history request budget: 4. A maximum of 6 *missing* game statistics per probe.
 const [hc,hp,ac,ap]=await Promise.all([nbaApiGames(home,season),nbaApiGames(home,season-1),nbaApiGames(away,season),nbaApiGames(away,season-1)]);
 const hg=historicalGames(hc,hp,home,season,cutoff),ag=historicalGames(ac,ap,away,season,cutoff);
 const all=new Map([...hc,...hp,...ac,...ap].map(g=>[Number(g.id),g]));
 // Balance coverage between both teams: revisit all 24 candidate games, newest first.
 const choices=[];for(let i=0;i<24;i++){if(hg[i])choices.push(hg[i]);if(ag[i])choices.push(ag[i]);}
 const candidates=[...new Set(choices.map(g=>g.id))].filter(x=>Number.isSafeInteger(x)&&x>0);
 const cached=await boxCacheGet(candidates);
 const known=new Map();
 const boxes=new Map();let validCache=0,invalidCache=0,requests=0,writes=0;
 const invalidReasons={};
 for(const c of cached){
  const game=all.get(Number(c.game_id)),box=c.box_data;
  const valid=c.status==='valid'&&box&&box.home_id===Number(game?.teams?.home?.id)&&box.away_id===Number(game?.teams?.visitors?.id)&&
    ['pace','home_ortg','away_ortg'].every(k=>typeof box[k]==='number'&&Number.isFinite(box[k]))&&box.pace>=70&&box.pace<=155&&box.home_ortg>=30&&box.home_ortg<=300&&box.away_ortg>=30&&box.away_ortg<=300;
  if(valid){boxes.set(Number(c.game_id),box);known.set(Number(c.game_id),c);validCache++;}
  else if(c.status==='invalid'){known.set(Number(c.game_id),c);invalidCache++;invalidReasons[c.reason||'invalid']=(invalidReasons[c.reason||'invalid']||0)+1;}
 }
 // Use 6 API requests, prioritizing the team with fewer already valid Box Scores.
 const validCount=(games)=>games.filter(g=>boxes.has(g.id)).length;
 const queue=[];const seen=new Set();
 for(let i=0;i<24;i++){
  const ordered=validCount(hg)<=validCount(ag)?[hg[i],ag[i]]:[ag[i],hg[i]];
  for(const g of ordered){if(g&&!seen.has(g.id)&&!known.has(g.id)){queue.push(g);seen.add(g.id);}}
 }
 const diagnostics=[];
 for(const g of queue){
  if(requests>=6 || (validCount(hg)>=3&&validCount(ag)>=3))break;
  requests++;
  let record={box:null,reason:'invalid_statistics'};
  try{
   const r=await fetch(`${NBA_ENDPOINT}/games/statistics?id=${g.id}`,{headers:{'x-apisports-key':NBA_KEY},signal:AbortSignal.timeout(14000)});
   const data=await r.json().catch(()=>null);
   if(!r.ok||!data||!Array.isArray(data.response)||Object.keys(data.errors||{}).length)record.reason='nba_api_error';
   else{
    const box=completedBox(all.get(g.id),data.response);
    record=box?{box}:{box:null,reason:'invalid_statistics'};
   }
  }catch(e){record.reason='network_error';console.warn('BOX_PROBE',String(e).slice(0,100));}
  if(record.box){boxes.set(g.id,record.box);}else{invalidReasons[record.reason]=(invalidReasons[record.reason]||0)+1;}
  diagnostics.push({game_id:g.id,valid:!!record.box,reason:record.reason||null});
  // Never persist transient error as permanently invalid; allow retry next probe.
  if(record.box||record.reason==='invalid_statistics'){
   await boxCachePut(g.id,record);writes++;
  }
 }
 const homeCount=validCount(hg),awayCount=validCount(ag);
 const fallback=researchModel(hg,ag,cutoff,marketInfo(snapshot),season);
 const efficiency=efficiencyResearch(hg,ag,boxes,cutoff,marketInfo(snapshot),season,fallback.model);
 const model=efficiency || (fallback.model?{...fallback.model,version:VERSION,model_family:'bayesian_score_fallback',
   component_models:{efficiency:'not used: fewer than 3 valid box-score games per team',uncertainty:'Bayesian-shrunk historical scoring variance'},
   note:'Unified research model used its conservative scoring fallback because possession data was insufficient.'}:null);
 const transientFailure=!efficiency&&((invalidReasons.nba_api_error||0)+(invalidReasons.network_error||0)>0);
 return {status:transientFailure?'source_error':model?'ready':'insufficient_data',model:transientFailure?null:model,reason:transientFailure?'temporary_box_source_failure':fallback.reason||null,api_requests:4+requests,
  history_counts:{home:hg.length,away:ag.length},box_games:boxes.size,
  valid_box_by_team:{home:homeCount,away:awayCount},required_box_by_team:3,
  missing_box_by_team:{home:Math.max(0,3-homeCount),away:Math.max(0,3-awayCount)},
  cache:{valid_hits:validCache,invalid_skipped:invalidCache,writes},
  source_failures:invalidReasons,fetched:diagnostics,read_only_formal:true,research_cache_written:writes>0};
}

function marketInfo(snapshot){
  const m=snapshot?.prediction_data?.market_data?.market||{};
  const p=m?.primary||{},c=m?.consensus||{};
  const first=(list,lower,upper)=>list.map(asNumber).find(x=>x!==null&&x>=lower&&x<=upper)??null;
  const h=first([p.home_spread,c.home_spread],-60,60);
  const away=first([p.away_spread,c.away_spread],-60,60);
  const spread=(h!==null && (away===null || Math.abs(h+away)<=.1))?h:(away!==null && h===null?-away:null);
  const total=first([p.total,c.total],120,350);
  return {market_available:m?.available===true,home_spread:spread,total,origin:spread!==null||total!==null?'saved_v1_t10_market':null};
}
function researchModel(home,away,cutoff,market,targetSeason){
  if(home.length<3||away.length<3)return {status:'insufficient_data',reason:'min_3_completed_games_per_team',counts:{home:home.length,away:away.length},model:null};
  const hs=posteriorGames(home,cutoff,'home',targetSeason),as=posteriorGames(away,cutoff,'away',targetSeason);
  const homePts=clamp((hs.offense+as.defense)/2+2.2+hs.venue_adjustment,88,138);
  const awayPts=clamp((as.offense+hs.defense)/2+as.venue_adjustment,88,138);
  const expectedMargin=homePts-awayPts,expectedTotal=homePts+awayPts;
  const sigmaMargin=clamp(Math.sqrt((hs.var_margin+as.var_margin)/2+12),10.5,22);
  const sigmaTotal=clamp(Math.sqrt((hs.var_total+as.var_total)/2+20),13,27);
  const homeWin=normalCdf(expectedMargin/sigmaMargin);
  const cover=market.home_spread===null?null:normalCdf((expectedMargin+market.home_spread)/sigmaMargin);
  const over=market.total===null?null:normalCdf((expectedTotal-market.total)/sigmaTotal);
  const choose=(p)=>p===null?null:p>=.55?'home':p<=.45?'away':null;
  const totalPick=over===null?null:over>=.55?'over':over<=.45?'under':null;
  const moneyline=choose(homeWin);
  const spread=choose(cover);
  return {status:'ready',reason:null,counts:{home:home.length,away:away.length},model:{
    version:VERSION,research_only:true,uncalibrated:true,formal_recommendation:false,
    expected_home_points:round(homePts,2),expected_away_points:round(awayPts,2),
    expected_margin:round(expectedMargin,2),expected_total:round(expectedTotal,2),
    margin_sigma:round(sigmaMargin,2),total_sigma:round(sigmaTotal,2),
    home_win_probability:round(homeWin,5),
    home_cover_probability:cover===null?null:round(cover,5),
    over_probability:over===null?null:round(over,5),
    market:{...market},
    shadow_directions:{moneyline,handicap:spread,over_under:totalPick},
    sample:{home:hs.games,away:as.games,home_effective:hs.effective_sample,away_effective:as.effective_sample},
    methodology:'Bayesian shrinkage of historical scoring and opponent points, season-aware recency, venue adjustment; Gaussian margin and total distributions. Not possession-based or calibrated.'
  }};
}
async function dbGet(table, params){
  const url=URL_BASE+'/rest/v1/'+table+'?'+params.toString();
  const res=await fetch(url,{headers:{apikey:ROLE,Authorization:`Bearer ${ROLE}`},signal:AbortSignal.timeout(25000)});
  if(!res.ok)throw new Error(`DB_SELECT_${table}_${res.status}:`+(await res.text()).slice(0,160));return res.json();
}

async function nbaApiGames(team,season){
  const endpoint=`${NBA_ENDPOINT}/games?league=standard&season=${season}&team=${team}`;
  const res=await fetch(endpoint,{headers:{'x-apisports-key':NBA_KEY},signal:AbortSignal.timeout(18000)});
  const body=await res.json().catch(()=>null);
  if(!res.ok || !body || (Array.isArray(body.errors)?body.errors.length:Object.keys(body.errors||{}).length))
    throw new Error('NBA_SOURCE_ERROR_'+res.status+':'+JSON.stringify(body?.errors||{}).slice(0,110));
  if(!Array.isArray(body.response))throw Error('NBA_SOURCE_INVALID_RESPONSE');
  return body.response;
}


const UNIFIED_VERSION=VERSION;
const MAX_UNIFIED_PER_RUN=1;
function unifiedMeta(s){
 const d=s?.prediction_data||{},f=d.fixture||{};
 const gameId=Number(s.game_id),home=Number(f?.home?.id),away=Number(f?.away?.id),season=Number(f?.season);
 const kickoff=parseMs(s.fixture_time),cutoff=parseMs(s.generated_at);
 if(!Number.isSafeInteger(gameId)||gameId<=0||!Number.isSafeInteger(home)||!Number.isSafeInteger(away)||!Number.isSafeInteger(season)||!kickoff||!cutoff||home<=0||away<=0||home===away||season<2020)return null;
 if(kickoff<=cutoff||kickoff-cutoff>10.5*3600000||kickoff-cutoff<8.0*3600000)return null;
 // Explicitly reject snapshots created after tipoff. No research row is created from retrospective V1 data.
 return{game_id:gameId,fixture_time:new Date(kickoff).toISOString(),source_snapshot_at:new Date(cutoff).toISOString(),home_team:String(s.home_team||f.home?.name||''),away_team:String(s.away_team||f.away?.name||'')};
}
async function claimUnified(s){
 const meta=unifiedMeta(s);if(!meta)throw Error('invalid_t10_snapshot');
 const claimedAt=new Date().toISOString();
 const res=await fetch(URL_BASE+'/rest/v1/basketball_v2_unified_snapshots?on_conflict=game_id',{
  method:'POST',headers:{apikey:ROLE,Authorization:'Bearer '+ROLE,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},
  body:JSON.stringify({...meta,updated_at:claimedAt,model_version:UNIFIED_VERSION,status:'processing',source_meta:{source:'official_v1_t10_snapshot',model:'unified_possession_efficiency_with_bayesian_shrinkage',max_api_requests:10}}),signal:AbortSignal.timeout(15000)
 });
 if(!res.ok)throw Error('UNIFIED_INSERT_'+res.status+':'+(await res.text()).slice(0,170));
 const inserted=await res.json();
 if(inserted.length===1)return {updated_at:inserted[0].updated_at||claimedAt};
 const existing=await dbGet('basketball_v2_unified_snapshots',new URLSearchParams({select:'status,updated_at',game_id:'eq.'+meta.game_id,limit:'1'}));
 const row=existing[0];if(!row)return false;
 const now=Date.now(),staleBefore=new Date(now-30*60000).toISOString();
 const canRetry=row.status==='source_error'||(row.status==='processing'&&parseMs(row.updated_at)!==null&&parseMs(row.updated_at)<now-30*60000);
 if(!canRetry)return false;
 const params=new URLSearchParams({game_id:'eq.'+meta.game_id,status:'eq.'+row.status});
 if(row.status==='processing')params.set('updated_at','lt.'+staleBefore);
 const claim=await fetch(URL_BASE+'/rest/v1/basketball_v2_unified_snapshots?'+params.toString(),{
  method:'PATCH',headers:{apikey:ROLE,Authorization:'Bearer '+ROLE,'Content-Type':'application/json',Prefer:'return=representation'},
  body:JSON.stringify({status:'processing',model_version:UNIFIED_VERSION,model_output:null,source_meta:{source:'official_v1_t10_snapshot',model:'unified_possession_efficiency_with_bayesian_shrinkage',retry_of:row.status,retry_started_at:new Date(now).toISOString()},updated_at:new Date(now).toISOString()}),signal:AbortSignal.timeout(15000)
 });
 if(!claim.ok)throw Error('UNIFIED_RETRY_CLAIM_'+claim.status+':'+(await claim.text()).slice(0,170));
 const claimed=await claim.json();
 return claimed.length===1?{updated_at:claimed[0].updated_at}:false;
}
async function unifiedPatch(id,patch,lease){
 const params=new URLSearchParams({game_id:'eq.'+id,status:'eq.processing',updated_at:'eq.'+lease.updated_at});
 const res=await fetch(URL_BASE+'/rest/v1/basketball_v2_unified_snapshots?'+params,{
  method:'PATCH',headers:{apikey:ROLE,Authorization:'Bearer '+ROLE,'Content-Type':'application/json',Prefer:'return=representation'},
  body:JSON.stringify({...patch,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(15000)
 });if(!res.ok)throw Error('UNIFIED_PATCH_'+res.status+':'+(await res.text()).slice(0,160));
 if((await res.json()).length!==1)throw Error('UNIFIED_LEASE_LOST');
}
async function unifiedCalculate(s,persist){
 const meta=unifiedMeta(s);if(!meta)return{game_id:s?.game_id,status:'skipped_invalid_t10'};
 let lease=null;
 if(persist){
  if(Date.now()>=Date.parse(meta.fixture_time))return{game_id:s.game_id,status:'skipped_after_kickoff'};
  lease=await claimUnified(s);
  if(!lease)return{game_id:s.game_id,status:'already_processed_or_running'};
 }
 try{
  const result=await probeEfficiency(s); // Up to 10 historical API calls; writes ONLY isolated box cache.
  if(persist){
    const model=result.model?{...result.model,version:UNIFIED_VERSION,formal_recommendation:false}:null;
    if(Date.now()>=Date.parse(meta.fixture_time))throw Error('kickoff_passed_during_capture');
    await unifiedPatch(meta.game_id,{status:result.status,model_output:model,
      source_meta:{...meta,api_requests:result.api_requests,history_counts:result.history_counts,box_games:result.box_games,
        cache:result.cache,valid_box_by_team:result.valid_box_by_team,missing_box_by_team:result.missing_box_by_team,
        source_failures:result.source_failures,reason:result.reason,runner_revision:RUNNER_REVISION,model_uncalibrated:true}},lease);
  }
  return{game_id:meta.game_id,...result,model:result.model?{...result.model,version:UNIFIED_VERSION}:null};
 }catch(e){
  const detail=String(e?.message||e).slice(0,200);
  if(persist&&detail!=='UNIFIED_LEASE_LOST')await unifiedPatch(meta.game_id,{status:'source_error',source_meta:{...meta,error:detail,runner_revision:RUNNER_REVISION}},lease).catch(console.error);
  return{game_id:meta.game_id,status:'source_error',detail};
 }
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=='POST')return response(405,{success:false,error:'method_not_allowed'});
 if(!CRON_KEY||req.headers.get('x-habao-cron-key')!==CRON_KEY)return response(401,{success:false,error:'unauthorized'});
 if(!URL_BASE||!ROLE||!NBA_KEY)return response(503,{success:false,error:'missing_backend_configuration'});
 try{
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return response(400,{success:false,error:'invalid_json'});
  const action=String(body.action||'dry_run');
  if(action==='probe'){
   const id=Number(body.game_id);if(!Number.isSafeInteger(id)||id<=0)return response(400,{success:false,error:'invalid_game_id'});
   const rows=await dbGet('basketball_prediction_snapshots',new URLSearchParams({select:'game_id,fixture_time,home_team,away_team,generated_at,prediction_data',game_id:'eq.'+id,limit:'1'}));
   if(!rows.length)return response(404,{success:false,error:'snapshot_not_found'});
   // Probe does not create a persistent unified research snapshot. Historical source and cache are shared.
   return response(200,{success:true,research_only:true,mode:'probe',writes_unified_snapshot:false,result:await unifiedCalculate(rows[0],false)});
  }
  if(action!=='dry_run'&&action!=='run')return response(400,{success:false,error:'invalid_action'});
  const now=Date.now();
  const rows=await dbGet('basketball_prediction_snapshots',new URLSearchParams({select:'game_id,fixture_time,home_team,away_team,generated_at,prediction_data',fixture_time:'gt.'+new Date(now).toISOString(),generated_at:'gte.'+new Date(now-12*3600000).toISOString(),order:'fixture_time.asc',limit:'35'}));
  const eligible=rows.filter(s=>unifiedMeta(s)&&Date.parse(s.fixture_time)>now);
  const ids=eligible.map(x=>Number(x.game_id));
  const old=ids.length?await dbGet('basketball_v2_unified_snapshots',new URLSearchParams({select:'game_id,status,updated_at',game_id:'in.('+ids.join(',')+')',limit:'100'})):[];
  const byId=new Map(old.map(x=>[Number(x.game_id),x]));
  const nowMs=Date.now(),staleBeforeMs=nowMs-30*60000;
  const candidates=eligible.filter(s=>{const row=byId.get(Number(s.game_id));if(!row)return true;
    return row.status==='source_error'||(row.status==='processing'&&parseMs(row.updated_at)!==null&&parseMs(row.updated_at)<staleBeforeMs);
  }).sort((a,b)=>{
    const aRetry=byId.has(Number(a.game_id))?1:0,bRetry=byId.has(Number(b.game_id))?1:0;
    return aRetry-bRetry||Date.parse(a.fixture_time)-Date.parse(b.fixture_time);
  }).slice(0,MAX_UNIFIED_PER_RUN);
  const alreadyProcessed=old.filter(x=>x.status==='ready'||x.status==='insufficient_data').length;
  if(action==='dry_run')return response(200,{success:true,read_only:true,research_only:true,version:UNIFIED_VERSION,eligible:eligible.length,existing_rows:old.length,already_processed:alreadyProcessed,retryable:candidates.filter(x=>byId.has(Number(x.game_id))).length,candidates:candidates.map(x=>({game_id:x.game_id,fixture_time:x.fixture_time,existing_status:byId.get(Number(x.game_id))?.status||null})),max_games_per_run:MAX_UNIFIED_PER_RUN,max_api_requests_per_game:10,stale_processing_retry_minutes:30});
  const items=[];for(const s of candidates)items.push(await unifiedCalculate(s,true));
  return response(200,{success:true,research_only:true,version:UNIFIED_VERSION,processed:items.length,existing_rows:old.length,already_processed:alreadyProcessed,retryable:candidates.filter(x=>byId.has(Number(x.game_id))).length,items});
 }catch(e){console.error('NBA_V2_UNIFIED',String(e));return response(500,{success:false,error:'nba_v2_unified_runner_failed',detail:String(e?.message||e).slice(0,240)});}
});
