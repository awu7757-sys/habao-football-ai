// HABAO NBA V1 vs unified V2 comparison. Read-only; admin session required.
const URL_BASE=String(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
let SERVICE=String(Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'');
if(!SERVICE){try{SERVICE=String(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'')}catch{}}
const API_VERSION='nba-v2-compare-audit-20261111';
const HEAD={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-admin-session,authorization,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','X-Habao-Version':API_VERSION};
const reply=(status,x)=>new Response(JSON.stringify(x),{status,headers:{...HEAD,'Content-Type':'application/json; charset=utf-8'}});
const num=x=>x===undefined||x===null||typeof x==='boolean'||String(x).trim()===''?null:Number.isFinite(Number(x))?Number(x):null;
const resultValue=x=>x==='win'?1:x==='half_win'?.5:x==='loss'||x==='half_loss'?0:null;
const dec=(x)=>{const z=String(x||'').trim().toLowerCase();if(!z||/暫不推薦|暂不推荐|不推|no.pick|none|unknown/.test(z))return null;
  if(/^(主隊|主队|主|home)/.test(z))return 'home';if(/^(客隊|客队|客|away)/.test(z))return 'away';return null;};
const overDir=(x)=>{const s=String(x||'').trim().toLowerCase();return /^(大|over)/.test(s)?'over':/^(小|under)/.test(s)?'under':null;};
const lineParts=(line)=>{
  if(line===null)return null;
  if(Math.abs(line*4-Math.round(line*4))>.0001)return null;
  return [Math.floor(line*2)/2,Math.ceil(line*2)/2];
};
function settleSpread(direction,line,home,away){
  if(!direction||line===null||!lineParts(line))return null;
  const pts=direction==='home'?home-away:away-home;
  const score=lineParts(line).map(l=>pts+l>1e-8?1:pts+l< -1e-8?-1:0).reduce((a,b)=>a+b,0);
  return score===2?'win':score===1?'half_win':score===0?'push':score===-1?'half_loss':'loss';
}
function settleTotal(direction,line,home,away){
  if(!direction||line===null||!lineParts(line))return null;
  const total=home+away,sign=direction==='over'?1:-1;
  const score=lineParts(line).map(l=>sign*(total-l)>1e-8?1:sign*(total-l)< -1e-8?-1:0).reduce((a,b)=>a+b,0);
  return score===2?'win':score===1?'half_win':score===0?'push':score===-1?'half_loss':'loss';
}
function v1Market(snapshot,key){
  const d=snapshot?.prediction_data||{},a=d?.analysis||d;
  const primary=a?.recommendations||d?.recommendations||{};
  const modelMarkets=d?.model?.markets||a?.model?.markets||{};
  const spread=modelMarkets?.spread||null,totals=modelMarkets?.totals||null;
  const homeSpread=num(spread?.market_home_spread);
  const modeled={moneyline:modelMarkets?.moneyline||null,
    handicap:spread?{...spread,line:homeSpread===null?null:String(spread.pick||'').toLowerCase()==='away'?-homeSpread:homeSpread}:null,
    over_under:totals?{...totals,line:totals.market_line}:null};
  const rec={...modeled,...primary}[key]||{};
  const choice=rec?.pick??rec?.selection??rec?.value??rec?.prediction;
  const rawPick=choice&&typeof choice==='object'?(choice.pick??choice.selection??choice.value??choice.prediction):choice;
  const pick=key==='over_under'?overDir(rawPick):dec(rawPick);
  const line=num(rec?.line ?? rec?.display_line);
  return {pick,line,raw_pick:rawPick??null};
}
function v1PredictedScore(snapshot){
  const d=snapshot?.prediction_data||{},a=d?.analysis||{};
  const score=d?.model?.predicted_score||a?.predicted_score||d?.predicted_score||{};
  return {home:num(score?.home),away:num(score?.away)};
}
function normalizeStatus(s){return String(s||'').toLowerCase();}
function compare(snapshot,shadow){
  const v1=snapshot?.prediction_data||{};
  const v2=shadow?.status==='ready'?shadow?.model_output:null;
  const h=num(snapshot?.home_score),a=num(snapshot?.away_score);
  const verified=normalizeStatus(snapshot?.status)==='verified'&&Number.isInteger(h)&&Number.isInteger(a)&&h>0&&a>0&&h!==a&&snapshot?.excluded_from_public!==true;
  const markets={};
  for(const key of ['moneyline','handicap','over_under']){
    const base=v1Market(snapshot,key),p2=v2?.shadow_directions?.[key]??null;
    const v2line=key==='handicap'?num(v2?.market?.home_spread):key==='over_under'?num(v2?.market?.total):null;
    const v1line=base.line;
    const selectedV2Line=key==='handicap'&&p2==='away'&&v2line!==null?-v2line:v2line;
    // Compare the underlying home handicap, even when the two models pick opposite sides.
    const v1HomeLine=key==='handicap'&&base.pick==='away'&&v1line!==null?-v1line:v1line;
    const sameLine=key==='moneyline'||(v1HomeLine!==null&&v2line!==null&&Math.abs(v1HomeLine-v2line)<.00001);
    let r1=null,r2=null;
    if(verified){
      if(key==='moneyline'){r1=base.pick?((base.pick==='home'?h>a:a>h)?'win':'loss'):null;
        r2=p2?((p2==='home'?h>a:a>h)?'win':'loss'):null;}
      if(key==='handicap'){r1=settleSpread(base.pick,v1line,h,a);r2=settleSpread(p2,selectedV2Line,h,a);}
      if(key==='over_under'){r1=settleTotal(base.pick,v1line,h,a);r2=settleTotal(p2,v2line,h,a);}
    }
    markets[key]={v1_pick:base.pick,v1_raw_pick:base.raw_pick,v1_line:v1line,v1_result:r1,
      v2_pick:p2,v2_line:v2line,v2_result:r2,same_line:sameLine,
      comparable:Boolean(verified&&base.pick&&p2&&sameLine&&resultValue(r1)!==null&&resultValue(r2)!==null)};
  }
  return {game_id:Number(snapshot.game_id),kickoff_at:snapshot.fixture_time,home:snapshot.home_team,away:snapshot.away_team,
    home_score:h,away_score:a,official_status:snapshot.status||'pending',verified,
    v1_predicted_score:v1PredictedScore(snapshot),
    v1_version:v1.version||snapshot.model_version||null,
    v2_status:shadow?.status||'not_collected',v2_reason:shadow?.source_meta?.reason||shadow?.source_meta?.error||null,
    v2_version:shadow?.model_version||null,v2_model:v2,markets};
}
function rate(rows){
  const stats={};for(const key of ['moneyline','handicap','over_under']){
    let n1=0,n2=0,both=0,p1=0,p2=0,t1=0,t2=0,pushes=0;
    for(const row of rows){const x=row.markets[key];if(!row.verified)continue;
      if(resultValue(x.v1_result)!==null){n1++;t1+=resultValue(x.v1_result);}
      if(resultValue(x.v2_result)!==null){n2++;t2+=resultValue(x.v2_result);}
      if(x.v1_result==='push'||x.v2_result==='push')pushes++;
      if(x.comparable){both++;p1+=resultValue(x.v1_result);p2+=resultValue(x.v2_result);}}
    const pct=(x,n)=>n?Math.round(x/n*10000)/100:null;
    stats[key]={v1_count:n1,v1_rate:pct(t1,n1),v2_count:n2,v2_rate:pct(t2,n2),paired_count:both,
      paired_v1_rate:pct(p1,both),paired_v2_rate:pct(p2,both),push_excluded:pushes};}
  return stats;
}
async function get(table,params){const r=await fetch(`${URL_BASE}/rest/v1/${table}?${params}`,{headers:{apikey:SERVICE,Authorization:`Bearer ${SERVICE}`},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('db_'+table+'_'+r.status+':'+(await r.text()).slice(0,140));return r.json();}
async function adminCheck(session){if(!session||session.length>400)return false;
  const r=await fetch(`${URL_BASE}/functions/v1/admin-center`,{method:'POST',headers:{'Content-Type':'application/json','x-admin-session':session},
    body:JSON.stringify({action:'auth_me'}),signal:AbortSignal.timeout(14000)});
  if(r.status>=500)throw Error('admin_auth_service_unavailable_'+r.status);
  if(!r.ok)return false;const b=await r.json().catch(()=>null);
  if(!b||typeof b.success!=='boolean')throw Error('invalid_admin_auth_response');
  return b?.success===true&&Boolean(b?.admin&&(b.admin.is_super_admin===true||b.admin.permissions?.includes('performance')));
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:HEAD});
  if(req.method!=='POST')return reply(405,{success:false,error:'POST_only'});
  if(!URL_BASE||!SERVICE)return reply(503,{success:false,error:'backend_not_configured'});
  try{
    if(!(await adminCheck(req.headers.get('x-admin-session')||'')))return reply(401,{success:false,error:'admin_unauthorized'});
    const body=await req.json().catch(()=>({}));if(body?.action!=='compare')return reply(400,{success:false,error:'invalid_action'});
    const days=[0,7,30,90].includes(Number(body?.days))?Number(body.days):30;
    const now=Date.now(),dayStr=new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
    const since=days===0?new Date(`${dayStr}T00:00:00+08:00`).toISOString():new Date(now-days*86400000).toISOString();
    const until=days===0?new Date(`${dayStr}T23:59:59+08:00`).toISOString():new Date(now+14*86400000).toISOString();
    const qs=new URLSearchParams({select:'game_id,fixture_time,home_team,away_team,generated_at,source,model_version,prediction_data,status,home_score,away_score,excluded_from_public',
      fixture_time:`gte.${since}`,and:`(fixture_time.lte.${until})`,order:'fixture_time.desc',limit:'200'});
    const original=await get('basketball_prediction_snapshots',qs.toString());
    const ids=original.map(x=>Number(x.game_id)).filter(Number.isSafeInteger);
    const shadows=[];
    for(let j=0;j<ids.length;j+=40){const sub=ids.slice(j,j+40);
      const matches=await get('basketball_v2_unified_snapshots',new URLSearchParams({select:'game_id,model_version,status,source_meta,model_output,source_snapshot_at',game_id:`in.(${sub.join(',')})`,limit:'40'}));
      shadows.push(...matches);}
    const index=new Map(shadows.map(x=>[Number(x.game_id),x]));
    const rows=original.map(s=>compare(s,index.get(Number(s.game_id))||null));
    return reply(200,{success:true,api_version:API_VERSION,research_only:true,read_only:true,uncalibrated:true,days,count:rows.length,
      captured:rows.filter(x=>x.v2_status==='ready').length,not_collected:rows.filter(x=>x.v2_status==='not_collected').length,
      insufficient:rows.filter(x=>x.v2_status==='insufficient_data').length,
      verified:rows.filter(x=>x.verified).length,
      note:'Unified V2 research only; not calibrated or used for official picks. Paired rates require identical original line and valid settled match; no wager profitability implied.',
      markets:rate(rows),rows});
  }catch(e){console.error('NBA_V2_COMPARE',String(e));return reply(500,{success:false,error:'compare_failed',detail:String(e?.message||e).slice(0,200)});}
});
