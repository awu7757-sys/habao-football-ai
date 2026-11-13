// HABAO NBA unified V2 shadow model: Bayesian-shrunk possession efficiency with a scoring fallback.
// Uses immutable V1 fixture metadata and completed history known before current capture.
// Writes isolated stage snapshots and box cache; never modifies official T-10 snapshots.
const URL_BASE = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const ROLE = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || (()=>{try{return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||''}catch{return ''}})());
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
