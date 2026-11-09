// MLB V1 vs V2 shadow comparison. Read-only; requires an admin performance session.
const BASE=String(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"");
let SERVICE=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
if(!SERVICE){try{SERVICE=String(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default||"")}catch{}}
const HEAD={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-admin-session,authorization,apikey","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
const reply=(status:number,x:unknown)=>new Response(JSON.stringify(x),{status,headers:{...HEAD,"Content-Type":"application/json; charset=utf-8"}});
const num=(x:unknown):number|null=>x===null||x===undefined||x===""||typeof x==="boolean"||!Number.isFinite(Number(x))?null:Number(x);
const outcomeValue=(x:string|null)=>x==="win"?1:x==="loss"?0:null;
const normPick=(x:unknown):string|null=>{const s=String(x??"").trim().toLowerCase();if(["home","away","over","under"].includes(s))return s;if(/暫不推薦|暂不推荐|no.?pick/.test(s))return null;return null;};
const atPath=(o:any,path:string[])=>path.reduce((v,k)=>v&&typeof v==="object"?v[k]:null,o);
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
   home:v1?.home_team??v2?.home_team??null,away:v1?.away_team??v2?.away_team??null,
   home_score:homeScore,away_score:awayScore,verified,
   v1_version:v1?.model_version??null,v1_status:v1?"available":"not_found",
   v2_version:v2?.model_version??null,v2_status:v2?.status??"not_collected",
   v2_expected_home_runs:num(prediction?.expected_home_runs),v2_expected_away_runs:num(prediction?.expected_away_runs),
   v2_expected_total_runs:num(prediction?.expected_total_runs),v2_as_of:v2?.as_of??null,markets};
}
function rate(rows:any[]){
 const stats:any={};for(const key of ["moneyline","spread","totals"]){let v1n=0,v2n=0,pn=0,v1w=0,v2w=0,p1w=0,p2w=0,push=0,brierSum=0,brierN=0;
   for(const r of rows){const m=r.markets[key];if(m.v1_result==="push"||m.v2_result==="push")push++;
     if(outcomeValue(m.v1_result)!==null){v1n++;v1w+=outcomeValue(m.v1_result)!;}
     if(outcomeValue(m.v2_result)!==null){v2n++;v2w+=outcomeValue(m.v2_result)!;}
     if(m.comparable){pn++;p1w+=outcomeValue(m.v1_result)!;p2w+=outcomeValue(m.v2_result)!;}
     if(key==="moneyline"&&r.verified&&m.v2_probability!==null){const y=r.home_score>r.away_score?(m.v2_pick==="home"?1:0):(m.v2_pick==="away"?1:0);brierSum+=(m.v2_probability-y)**2;brierN++;}
   }
   const pct=(w:number,n:number)=>n?Math.round(w/n*10000)/100:null;
   stats[key]={v1_count:v1n,v1_hit_pct:pct(v1w,v1n),v2_count:v2n,v2_hit_pct:pct(v2w,v2n),paired_count:pn,paired_v1_hit_pct:pct(p1w,pn),paired_v2_hit_pct:pct(p2w,pn),push_count:push,v2_brier:key==="moneyline"&&brierN?Math.round(brierSum/brierN*10000)/10000:null};
 }
 return stats;
}
async function get(table:string,params:URLSearchParams){const r=await fetch(`${BASE}/rest/v1/${table}?${params}`,{headers:{apikey:SERVICE,Authorization:`Bearer ${SERVICE}`},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`db_${table}_${r.status}: ${(await r.text()).slice(0,160)}`);return await r.json();}
async function isAdmin(session:string){if(!session||session.length>400)return false;const r=await fetch(`${BASE}/functions/v1/admin-center`,{method:"POST",headers:{"Content-Type":"application/json","x-admin-session":session},body:JSON.stringify({action:"auth_me"}),signal:AbortSignal.timeout(12000)});if(!r.ok)return false;const x=await r.json().catch(()=>null);return x?.success===true&&Boolean(x?.admin&&(x.admin.is_super_admin===true||x.admin.permissions?.includes("performance")));}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("",{status:204,headers:HEAD});if(req.method!=="POST")return reply(405,{success:false,error:"POST_only"});if(!BASE||!SERVICE)return reply(503,{success:false,error:"backend_not_configured"});
 try{if(!(await isAdmin(req.headers.get("x-admin-session")||"")))return reply(401,{success:false,error:"admin_unauthorized"});const body=await req.json().catch(()=>({}));if(body?.action!=="compare")return reply(400,{success:false,error:"invalid_action"});
   const days=[0,30,90,365].includes(Number(body.days))?Number(body.days):365;const now=Date.now(),tw=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});const since=days===0?new Date(`${tw}T00:00:00+08:00`).toISOString():new Date(now-days*86400000).toISOString();const until=days===0?new Date(`${tw}T23:59:59+08:00`).toISOString():new Date(now+14*86400000).toISOString();
   const baseParams=new URLSearchParams({select:"game_id,kickoff_at,home_team,away_team,model_version,analysis",kickoff_at:`gte.${since}`,and:`(kickoff_at.lte.${until})`,order:"kickoff_at.desc",limit:"500"});
   const v1=await get("baseball_t10_snapshots",baseParams);const v2=await get("baseball_v2_shadow_snapshots",new URLSearchParams({select:"game_id,kickoff_at,model_version,status,as_of,home_team,away_team,inputs,prediction",kickoff_at:`gte.${since}`,and:`(kickoff_at.lte.${until})`,order:"kickoff_at.desc",limit:"500"}));
   const ids=[...new Set([...v1,...v2].map((x:any)=>Number(x.game_id)).filter(Number.isSafeInteger))];const results:any[]=[];
   for(let i=0;i<ids.length;i+=80){const part=ids.slice(i,i+80);results.push(...await get("baseball_verified_results",new URLSearchParams({select:"game_id,home_score,away_score",game_id:`in.(${part.join(",")})`,limit:String(part.length)})));}
   const ix2=new Map(v2.map((x:any)=>[Number(x.game_id),x])),ixr=new Map(results.map((x:any)=>[Number(x.game_id),x]));const ix1=new Map(v1.map((x:any)=>[Number(x.game_id),x]));
   const rows=ids.map(id=>compare(ix1.get(id)||null,ix2.get(id)||null,ixr.get(id)||null)).sort((a,b)=>Date.parse(b.kickoff_at||"")-Date.parse(a.kickoff_at||""));
   return reply(200,{success:true,research_only:true,read_only:true,uncalibrated:true,days,count:rows.length,v1_count:v1.length,v2_count:v2.length,verified:rows.filter(x=>x.verified).length,markets:rate(rows),note:"MLB V2 shadow comparison only. Reads baseball_t10_snapshots, baseball_v2_shadow_snapshots, and baseball_verified_results; writes no rows and does not alter V1, member quotas, or public records.",rows});
 }catch(e){console.error("MLB_V2_COMPARE",String(e));return reply(500,{success:false,error:"compare_failed",detail:String(e instanceof Error?e.message:e).slice(0,220)});}
});
