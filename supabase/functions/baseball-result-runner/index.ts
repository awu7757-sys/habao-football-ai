/** HABAO MLB official result runner — first-write-only, T-10 snapshot unchanged.
 * Writes ONLY when HABAO_MLB_RESULT_WRITE_ENABLED === 'true'.
 * GET is retained for admin-baseball; authenticated POST is also accepted for existing Cron jobs.
 */
import {createClient} from 'npm:@supabase/supabase-js@2';
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:H});
const base=Deno.env.get('SUPABASE_URL')||'',secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const token=Deno.env.get('HABAO_MLB_TEST_TOKEN')||'';
const enabled=Deno.env.get('HABAO_MLB_RESULT_WRITE_ENABLED')==='true';
const sb=base&&secret?createClient(base,secret,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const val=(v:unknown)=>{
 if(v===undefined||v===null||typeof v==='boolean'||String(v).trim()==='')return null;
 const n=Number(v);return Number.isFinite(n)?n:null;
};
const decide=(diff:number,pick:string|null,homeIsWin:boolean)=>!pick?'no_pick':pick==='home'||pick==='away'?
 ((pick==='home')===homeIsWin?'win':'loss'):'no_pick';
const grade=(diff:number,pick:string|null)=>!pick?'no_pick':diff===0?'push':((pick==='home'||pick==='over')=== (diff>0) ?'win':'loss');
Deno.serve(async req=>{
 if(req.method!=='GET'&&req.method!=='POST')return out(405,{success:false,error:'GET_or_POST_only'});
 if(!token||token.length<32||req.headers.get('x-habao-mlb-token')!==token)return out(403,{success:false,error:'not_authorized'});
 if(!sb)return out(503,{success:false,error:'backend_not_configured'});
 const url=new URL(req.url);
 // Existing admin uses GET ?game_id= ; scheduled jobs may POST an empty JSON body.
 const post=req.method==='POST'?await req.json().catch(()=>({})):{};
 const rawGameId=url.searchParams.get('game_id')??(post?.game_id??null);
 const gameId=rawGameId!==null&&rawGameId!==''?Number(rawGameId):null;
 const explicitDryRun=url.searchParams.get('dry_run')==='1'||post?.dry_run===true;
 const writeNow=enabled&&!explicitDryRun;
 if(rawGameId!==null&&rawGameId!==''&&(!Number.isSafeInteger(gameId)||gameId!<=0))return out(400,{success:false,error:'invalid_game_id'});
 // Explicit manual game ID is bound to one immutable saved snapshot, not an external game ID alone.
 // Automatic batch remains the existing rolling 7-day window; manual lookback up to 30 days.
 const from=new Date(Date.now()-(gameId?30:7)*86400000).toISOString();
 let query=sb.from('baseball_t10_snapshots').select('id,game_id,kickoff_at,home_team,away_team,analysis')
   .lte('kickoff_at',new Date(Date.now()-3*3600000).toISOString()).gte('kickoff_at',from)
   .order('kickoff_at',{ascending:true}).limit(gameId?1:150);
 if(gameId)query=query.eq('game_id',gameId);
 const {data:snaps,error:se}=await query;
 if(se)return out(502,{success:false,error:'snapshot_read_failed'});
 const ids=(snaps||[]).map(x=>x.game_id);
 const {data:existing,error:ee}=ids.length?await sb.from('baseball_verified_results').select('game_id').in('game_id',ids)
  :{data:[],error:null};
 if(ee)return out(502,{success:false,error:'result_read_failed'});
 const have=new Set((existing||[]).map(x=>x.game_id));
 const plans:any[]=[];
 for(const snap of (snaps||[]).filter(x=>!have.has(x.game_id)).slice(0,12)){
  let g:any;
  try{
   const r=await fetch('https://statsapi.mlb.com/api/v1/schedule?gamePk='+snap.game_id,
    {signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('mlb_stats_http_'+r.status);
   const b=await r.json();g=(b.dates||[]).flatMap((d:any)=>d.games||[]).find((x:any)=>x.gamePk===snap.game_id);
  }catch{plans.push({game_id:snap.game_id,status:'provider_unavailable'});continue;}
  if(!g){plans.push({game_id:snap.game_id,status:'game_not_found'});continue;}
  // Avoid shortened/suspended/future game; only official final status after scores exist.
  const status=String(g.status?.detailedState||'');
  if(!/^final$/i.test(status)){plans.push({game_id:snap.game_id,status:'not_final',game_status:status});continue;}
  const hs=val(g.teams?.home?.score),as=val(g.teams?.away?.score);
  if(hs===null||as===null||!Number.isInteger(hs)||!Number.isInteger(as)||hs===as){plans.push({game_id:snap.game_id,status:'score_invalid'});continue;}
  if(Number(g.teams?.home?.team?.id)!==Number(snap.analysis?.fixture?.home?.id)||
    Number(g.teams?.away?.team?.id)!==Number(snap.analysis?.fixture?.away?.id)){
    plans.push({game_id:snap.game_id,status:'team_mismatch'});continue;
  }
  const m=snap.analysis?.model?.markets||{};
  const total=val(m.totals?.market_line),sp=val(m.spread?.market_home_spread);
  const payload={game_id:snap.game_id,snapshot_id:snap.id,kickoff_at:snap.kickoff_at,
   home_team:snap.home_team,away_team:snap.away_team,home_score:hs,away_score:as,
   moneyline_result:decide(hs-as,m.moneyline?.pick||null,hs>as),
   totals_result:total===null?'no_pick':grade(hs+as-total,m.totals?.pick||null),
   handicap_result:sp===null?'no_pick':grade(hs-as+sp,m.spread?.pick||null),final_status:status};
  if(!writeNow){plans.push({game_id:snap.game_id,status:'would_insert',result:payload});continue;}
  const {data:insert,error:ie}=await sb.from('baseball_verified_results').upsert(payload,{onConflict:'game_id',ignoreDuplicates:true}).select('id').limit(1);
  plans.push({game_id:snap.game_id,status:ie?'insert_failed':insert?.length?'inserted':'already_exists_race',
   ...(ie?{error_code:String(ie.code||'db_write_failed')}:{})});
 }
 const failures=plans.filter(x=>x.status==='insert_failed').length;
 const inserted=plans.filter(x=>x.status==='inserted').length;
 const result={success:writeNow&&failures===0||explicitDryRun,
  version:'mlb-result-v1.2-safe-persist',requested_game_id:gameId,
  mode:writeNow?'write_enabled':'dry_run_only',write_gate_enabled:enabled,
  examined:(snaps||[]).length,existing:have.size,inserted,failed:failures,
  planned:plans,...(!enabled&&!explicitDryRun?{error:'mlb_result_write_disabled',
    message:'Set HABAO_MLB_RESULT_WRITE_ENABLED=true in Supabase Edge Function Secrets.'}:{})};
 // Never report a dry-run as a successful production settlement.
 return out(!enabled&&!explicitDryRun?503:failures?502:200,result);
});
