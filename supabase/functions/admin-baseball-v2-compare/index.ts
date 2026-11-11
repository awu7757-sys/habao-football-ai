// MLB V1 vs V2 shadow comparison. Read-only; requires an admin performance session.
const BASE=String(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"");
let SERVICE=String(Deno.env.get("SUPABASE_SECRET_KEY")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
if(!SERVICE){try{const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");SERVICE=String(keys.default||Object.values(keys)[0]||"")}catch{}}
const VERSION="habao-mlb-compare-0.1.3";
const HEAD={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-admin-session,authorization,apikey,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Expose-Headers":"x-mlb-compare-version","X-MLB-Compare-Version":VERSION,"Cache-Control":"no-store"};
const reply=(status:number,x:unknown)=>new Response(JSON.stringify(x),{status,headers:{...HEAD,"Content-Type":"application/json; charset=utf-8"}});
const num=(x:unknown):number|null=>x===null||x===undefined||x===""||typeof x==="boolean"||!Number.isFinite(Number(x))?null:Number(x);
const outcomeValue=(x:string|null)=>x==="win"?1:x==="loss"?0:null;
const normPick=(x:unknown):string|null=>{const s=String(x??"").trim().toLowerCase();if(["home","away","over","under"].includes(s))return s;if(/暫不推薦|暂不推荐|no.?pick/.test(s))return null;return null;};
const atPath=(o:any,path:string[])=>path.reduce((v,k)=>v&&typeof v==="object"?v[k]:null,o);
// Frozen mathematics from baseball-v2-shadow 0.1.0. No provider calls in replay.
const round=(x:number,d=4)=>Number(x.toFixed(d));
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
function innings(v:unknown){const m=/^(\d+)(?:\.([012]))?$/.exec(String(v??""));return m?Number(m[1])+Number(m[2]||0)/3:0;}
function poisson(mean:number):number[]|null{
  if(!Number.isFinite(mean)||mean<0.5||mean>20)return null;let p=Math.exp(-mean),sum=p;const a=[p];
  for(let k=1;k<=80;k++){p*=mean/k;a.push(p);sum+=p;if(k>=mean&&1-sum<1e-12)break;}
  return sum>.999999?a.map(x=>x/sum):null;
}
function probabilities(homeRuns:number,awayRuns:number,lines:any){
  const h=poisson(homeRuns),a=poisson(awayRuns);if(!h||!a)return null;
  let hw=0,aw=0,tie=0,over=0,under=0,totalPush=0,homeCover=0,awayCover=0,spreadPush=0;
  const total=num(lines?.total),spread=num(lines?.home_spread);
  for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++){
    const p=h[i]*a[j];if(i>j)hw+=p;else if(i<j)aw+=p;else tie+=p;
    if(total!==null){const d=i+j-total;if(d>1e-9)over+=p;else if(d< -1e-9)under+=p;else totalPush+=p;}
    if(spread!==null){const d=i-j+spread;if(d>1e-9)homeCover+=p;else if(d< -1e-9)awayCover+=p;else spreadPush+=p;}
  }
  // MLB games resolve ties in extras; absent a calibrated extras model, split nine-inning ties evenly.
  return {moneyline:{home_win_proxy:round(hw+tie/2),away_win_proxy:round(aw+tie/2),nine_inning_tie:round(tie),extra_innings_tie_split_assumption:true},
    totals:{line:total,over_probability:total===null?null:round(over),under_probability:total===null?null:round(under),nine_inning_push_probability:total===null?null:round(totalPush)},
    spread:{home_line:spread,home_cover_probability:spread===null?null:round(homeCover),away_cover_probability:spread===null?null:round(awayCover),nine_inning_push_probability:spread===null?null:round(spreadPush)}};
}
function project(h:any,a:any,hr:any,ar:any,hp:any,ap:any){
  const valid=[h.runs_per_game,h.runs_allowed_per_game,a.runs_per_game,a.runs_allowed_per_game].every((x:any)=>typeof x==="number")&&h.games_played>=5&&a.games_played>=5;
  if(!valid)return {status:"insufficient_team_season_data",projection:null};
  // Matchup run environment is the transparent prior. 30-game prior shrinks noisy team rates.
  const baseline=(h.runs_per_game+a.runs_per_game+h.runs_allowed_per_game+a.runs_allowed_per_game)/4;
  const rate=(season:number,recent:number|null,recentN:number,games:number)=>{
    const recentSmoothed=recent===null?season:(recent*recentN+season*10)/(recentN+10);
    const recentWeight=recent===null?0:0.20*Math.min(recentN,10)/10;
    const form=season*(1-recentWeight)+recentSmoothed*recentWeight;
    return baseline+(form-baseline)*games/(games+30);
  };
  const ho=rate(h.runs_per_game,hr?.runs_per_game??null,hr?.games_used??0,h.games_played);
  const ao=rate(a.runs_per_game,ar?.runs_per_game??null,ar?.games_used??0,a.games_played);
  const hd=rate(h.runs_allowed_per_game,hr?.runs_allowed_per_game??null,hr?.games_used??0,h.games_played);
  const ad=rate(a.runs_allowed_per_game,ar?.runs_allowed_per_game??null,ar?.games_used??0,a.games_played);
  let home=baseline*(ho/baseline)*(ad/baseline)*1.03;
  let away=baseline*(ao/baseline)*(hd/baseline);
  const starterFactor=(p:any,teamEra:number|null)=>{
    if(p?.era===null||teamEra===null||innings(p.innings)<30)return 1;
    return Math.exp(clamp((p.era-teamEra)/4*0.12,-0.12,0.12));
  };
  home*=starterFactor(ap,a.era);away*=starterFactor(hp,h.era);
  home=clamp(home,0.5,15);away=clamp(away,0.5,15);
  return {status:"available",projection:{expected_home_runs:round(home,3),expected_away_runs:round(away,3),expected_total_runs:round(home+away,3),expected_home_run_margin:round(home-away,3),method:"v2_shrunk_matchup_rates_recent10_qualified_starters_poisson_v0.1",parameters:{prior_games:30,recent_prior_games:10,recent_weight_cap:0.20,home_multiplier:1.03,starter_log_adjustment_cap:0.12}}};
}

function grade(market:string,pick:string|null,line:number|null,h:number,a:number):string|null{
 if(!pick)return null;
 let d:number;
 if(market==="moneyline")d=h-a;
 else if(market==="spread"){if(line===null)return null;d=h-a+line;}
 else {if(line===null)return null;d=h+a-line;}
 if(Math.abs(d)<1e-8)return "push";
 const side=(market==="moneyline"||market==="spread")?(pick==="home"?1:pick==="away"?-1:0):(pick==="over"?1:pick==="under"?-1:0);
 return side?(d*side>0?"win":"loss"):null;
}
function v1market(snapshot:any,market:string){
 const m=atPath(snapshot?.analysis,["model","markets",market])||{};
 return {pick:normPick(m.pick),line:market==="spread"?num(m.market_home_spread):market==="totals"?num(m.market_line):null,raw:m.pick??null};
}
function replayV2(snapshot:any){
 const a=snapshot?.analysis,d=a?.data;
 const kickoff=Date.parse(snapshot?.kickoff_at||""),asOf=Date.parse(a?.as_of||"");
 const unavailable=(reason:string)=>({game_id:snapshot.game_id,status:"replay_unavailable",replay_reason:reason,model_version:"habao-mlb-v2-shadow-0.1.0",prediction:null});
 if(!Number.isFinite(kickoff)||!Number.isFinite(asOf)||asOf>=kickoff)return unavailable("missing_or_non_pregame_timestamp");
 if(a?.fixture?.game_id!=null&&Number(a.fixture.game_id)!==Number(snapshot.game_id))return unavailable("source_game_id_mismatch");
 const teams:any[]=[];
 for(const key of ["home_team","away_team"]){
   const t=d?.[key];if(!t)return unavailable("missing_season_inputs");
   const games=num(t.games_played),scored=num(t.runs_per_game),allowed=num(t.runs_allowed_per_game);
   if(games===null||games<5||scored===null||allowed===null||scored<0||allowed<0)return unavailable("invalid_season_inputs");
   if(t.cache_fetched_at!=null&&(!Number.isFinite(Date.parse(t.cache_fetched_at))||Date.parse(t.cache_fetched_at)>asOf))return unavailable("cache_not_available_at_capture");
   teams.push({...t,games_played:games,runs_per_game:scored,runs_allowed_per_game:allowed,era:num(t.era)});
 }
 const recent:any[]=[];let sampleDatesComplete=true;
 for(const key of ["home_recent","away_recent"]){
   const f=d?.[key];if(!f){recent.push(null);sampleDatesComplete=false;continue;}
   const count=num(f.games_used),scored=num(f.runs_per_game),allowed=num(f.runs_allowed_per_game);
   if(count===null||!Number.isInteger(count)||count<0||count>10||(count>0&&(scored===null||allowed===null||scored<0||allowed<0)))return unavailable("invalid_recent_inputs");
   const samples=Array.isArray(f.samples)?f.samples:[];
   const ids=[...(Array.isArray(f.sample_game_ids)?f.sample_game_ids:[]),...samples.map((x:any)=>x.game_id)];
   if(ids.some((id:any)=>Number(id)===Number(snapshot.game_id)))return unavailable("target_game_in_recent_samples");
   if(samples.some((x:any)=>!Number.isFinite(Date.parse(x.kickoff_at||x.date||""))||Date.parse(x.kickoff_at||x.date)>=asOf))return unavailable("recent_sample_not_before_capture");
   if(count>0&&samples.length!==count)sampleDatesComplete=false;
   recent.push({...f,games_used:count,runs_per_game:scored,runs_allowed_per_game:allowed});
 }
 const pitcher=(p:any)=>({era:num(p?.era),innings:p?.innings??null});
 const model=project(teams[0],teams[1],recent[0],recent[1],pitcher(d?.home_starter),pitcher(d?.away_starter));
 const projection=model.projection;
 if(!projection||![projection.expected_home_runs,projection.expected_away_runs,projection.expected_total_runs].every(Number.isFinite))return unavailable("insufficient_replay_inputs");
 const line={home_spread:v1market(snapshot,"spread").line,total:v1market(snapshot,"totals").line};
 const prob=probabilities(projection.expected_home_runs,projection.expected_away_runs,line);
 if(!prob)return unavailable("probabilities_unavailable");
 return {game_id:snapshot.game_id,kickoff_at:snapshot.kickoff_at,as_of:a.as_of,
   home_team:a.fixture?.home?.name??null,away_team:a.fixture?.away?.name??null,
   status:"available",model_version:"habao-mlb-v2-shadow-0.1.0",inputs:{market:{line}},
   prediction:{...projection,probabilities:prob},replay_reason:null,
   replay_quality:{source:"stored_v1_pregame_inputs",source_as_of:a.as_of,computed_at:new Date().toISOString(),
     recent_sample_dates:sampleDatesComplete?"checked":"not_fully_stored",same_v1_market_lines:true,
     limitations:["retrospective_replay_not_live_capture","stored_v1_input_precision","small_sample_not_model_validation"]}};
}
function compare(v1:any,v2:any,result:any){
 const prediction=v2?.prediction||{},prob=prediction?.probabilities||{};
 const homeScore=num(result?.home_score),awayScore=num(result?.away_score),verified=homeScore!==null&&awayScore!==null;
 const markets:any={};
 for(const key of ["moneyline","spread","totals"]){
   const one=v1?v1market(v1,key):{pick:null,line:null,raw:null};
   const twoLine=key==="spread"?num(v2?.inputs?.market?.line?.home_spread):key==="totals"?num(v2?.inputs?.market?.line?.total):null;
   let twoPick:string|null=null,twoProb:number|null=null;
   if(key==="moneyline"){
     const h=num(prob.moneyline?.home_win_proxy),a=num(prob.moneyline?.away_win_proxy);
     if(h!==null&&a!==null){twoPick=h>=a?"home":"away";twoProb=twoPick==="home"?h:a;}
   } else if(key==="spread"){
     const h=num(prob.spread?.home_cover_probability),a=num(prob.spread?.away_cover_probability);
     if(h!==null&&a!==null&&twoLine!==null){twoPick=h>=a?"home":"away";twoProb=twoPick==="home"?h:a;}
   } else {
     const over=num(prob.totals?.over_probability),under=num(prob.totals?.under_probability);
     if(over!==null&&under!==null&&twoLine!==null){twoPick=over>=under?"over":"under";twoProb=twoPick==="over"?over:under;}
   }
   const v1Result=verified?grade(key,one.pick,one.line,homeScore!,awayScore!):null;
   const v2Result=verified?grade(key,twoPick,twoLine,homeScore!,awayScore!):null;
   const sameLine=key==="moneyline"||(one.line!==null&&twoLine!==null&&Math.abs(one.line-twoLine)<1e-8);
   markets[key]={v1_pick:one.pick,v1_raw_pick:one.raw,v1_line:one.line,v1_result:v1Result,
     v2_pick:twoPick,v2_line:twoLine,v2_probability:twoProb,v2_result:v2Result,
     same_line:sameLine,comparable:verified&&sameLine&&outcomeValue(v1Result)!==null&&outcomeValue(v2Result)!==null};
 }
 return {game_id:Number(v1?.game_id??v2?.game_id),kickoff_at:v1?.kickoff_at??v2?.kickoff_at,
   home:v1?.home_team??v1?.analysis?.fixture?.home?.name??v2?.home_team??null,away:v1?.away_team??v1?.analysis?.fixture?.away?.name??v2?.away_team??null,
   home_score:homeScore,away_score:awayScore,verified,
   v1_version:v1?.model_version??null,v1_status:v1?"available":"not_found",
   v2_version:v2?.model_version??null,v2_status:v2?.status??"not_collected",
   v2_expected_home_runs:num(prediction?.expected_home_runs),v2_expected_away_runs:num(prediction?.expected_away_runs),
   v2_expected_total_runs:num(prediction?.expected_total_runs),v2_as_of:v2?.as_of??null,
   replay_reason:v2?.replay_reason??null,replay_quality:v2?.replay_quality??null,markets};
}
function rate(rows:any[]){
 const stats:any={};for(const key of ["moneyline","spread","totals"]){let v1n=0,v2n=0,pn=0,v1w=0,v2w=0,p1w=0,p2w=0,push=0,brierSum=0,brierN=0;
   for(const r of rows){const m=r.markets[key];if(m.v1_result==="push"||m.v2_result==="push")push++;
     if(outcomeValue(m.v1_result)!==null){v1n++;v1w+=outcomeValue(m.v1_result)!;}
     if(outcomeValue(m.v2_result)!==null){v2n++;v2w+=outcomeValue(m.v2_result)!;}
     if(m.comparable){pn++;p1w+=outcomeValue(m.v1_result)!;p2w+=outcomeValue(m.v2_result)!;}
     if(key==="moneyline"&&outcomeValue(m.v2_result)!==null&&m.v2_probability!==null){const y=outcomeValue(m.v2_result)!;brierSum+=(m.v2_probability-y)**2;brierN++;}
   }
   const pct=(w:number,n:number)=>n?Math.round(w/n*10000)/100:null;
   stats[key]={v1_count:v1n,v1_hit_pct:pct(v1w,v1n),v2_count:v2n,v2_hit_pct:pct(v2w,v2n),paired_count:pn,paired_v1_hit_pct:pct(p1w,pn),paired_v2_hit_pct:pct(p2w,pn),push_count:push,v2_brier:key==="moneyline"&&brierN?Math.round(brierSum/brierN*10000)/10000:null};
 }
 return stats;
}
async function get(table:string,params:URLSearchParams){const r=await fetch(`${BASE}/rest/v1/${table}?${params}`,{headers:{apikey:SERVICE,Authorization:`Bearer ${SERVICE}`},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`db_${table}_${r.status}: ${(await r.text()).slice(0,160)}`);return await r.json();}
async function isAdmin(session:string){
 if(!session||session.length>400)return false;
 const r=await fetch(`${BASE}/functions/v1/admin-center`,{method:"POST",headers:{"Content-Type":"application/json","x-admin-session":session},body:JSON.stringify({action:"auth_me"}),signal:AbortSignal.timeout(12000)});
 if(r.status>=500)throw Error(`admin_auth_unavailable_${r.status}`);
 if(!r.ok)return false;
 const x=await r.json();
 return x?.success===true&&Boolean(x?.admin&&(x.admin.is_super_admin===true||x.admin.permissions?.includes("performance")));
}
Deno.serve(async(req:Request)=>{
 // A 204 response must have a null body; even an empty string throws at runtime.
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEAD});if(req.method!=="POST")return reply(405,{success:false,error:"POST_only"});if(!BASE||!SERVICE)return reply(503,{success:false,error:"backend_not_configured"});
 try{if(!(await isAdmin(req.headers.get("x-admin-session")||"")))return reply(401,{success:false,error:"admin_unauthorized"});let body:any;try{body=await req.json()}catch{return reply(400,{success:false,error:"invalid_json"})}if(body?.action!=="compare")return reply(400,{success:false,error:"invalid_action"});
   const mode=body.comparison_mode??"shadow";if(!["shadow","historical_replay"].includes(mode))return reply(400,{success:false,error:"invalid_comparison_mode"});
   const days=[0,30,90,365].includes(Number(body.days))?Number(body.days):365;const now=Date.now(),tw=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});const since=days===0?new Date(`${tw}T00:00:00+08:00`).toISOString():new Date(now-days*86400000).toISOString();const until=days===0?new Date(`${tw}T23:59:59+08:00`).toISOString():new Date(now+14*86400000).toISOString();
   const baseParams=new URLSearchParams({select:"game_id,kickoff_at,model_version,analysis",kickoff_at:`gte.${since}`,and:`(kickoff_at.lte.${until})`,order:"kickoff_at.desc",limit:"500"});
   const v1=await get("baseball_t10_snapshots",baseParams);
   // Replay only uses sealed V1 inputs; actual scores are fetched after prediction.
   const v2=mode==="historical_replay"?v1.map(replayV2):await get("baseball_v2_shadow_snapshots",new URLSearchParams({select:"game_id,kickoff_at,model_version,status,as_of,home_team,away_team,inputs,prediction",kickoff_at:`gte.${since}`,and:`(kickoff_at.lte.${until})`,order:"kickoff_at.desc",limit:"500"}));
   const ids=[...new Set([...v1,...v2].map((x:any)=>Number(x.game_id)).filter(Number.isSafeInteger))];const results:any[]=[];
   for(let i=0;i<ids.length;i+=80){const part=ids.slice(i,i+80);results.push(...await get("baseball_verified_results",new URLSearchParams({select:"game_id,home_score,away_score",game_id:`in.(${part.join(",")})`,limit:String(part.length)})));}
   const ix2=new Map(v2.map((x:any)=>[Number(x.game_id),x])),ixr=new Map(results.map((x:any)=>[Number(x.game_id),x]));const ix1=new Map(v1.map((x:any)=>[Number(x.game_id),x]));
   const rows=ids.map(id=>compare(ix1.get(id)||null,ix2.get(id)||null,ixr.get(id)||null)).sort((a,b)=>Date.parse(b.kickoff_at||"")-Date.parse(a.kickoff_at||""));
   return reply(200,{success:true,research_only:true,read_only:true,uncalibrated:true,comparison_mode:mode,days,count:rows.length,v1_count:v1.length,
     v2_count:mode==="historical_replay"?v2.filter((x:any)=>x.status==="available").length:v2.length,
     replay_skipped:mode==="historical_replay"?v2.filter((x:any)=>x.status!=="available").length:0,
     verified:rows.filter(x=>x.verified).length,markets:rate(rows),note:mode==="historical_replay"?"Retrospective V2 replay of stored pregame V1 inputs and V1 market lines. Not a live shadow capture. No provider calls and no database writes.":"MLB V2 shadow comparison only. Reads baseball_t10_snapshots, baseball_v2_shadow_snapshots, and baseball_verified_results; writes no rows and does not alter V1, member quotas, or public records.",rows});
 }catch(e){console.error("MLB_V2_COMPARE",String(e));return reply(500,{success:false,error:"compare_failed",detail:String(e instanceof Error?e.message:e).slice(0,220)});}
});

