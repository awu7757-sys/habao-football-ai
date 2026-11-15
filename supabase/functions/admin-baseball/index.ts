/** HABAO MLB admin readonly analysis logs. Uses EXISTING admin-center auth_me session. */
import { createClient } from 'npm:@supabase/supabase-js@2';
const headers = {
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,x-admin-session,apikey,authorization',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
};
const answer=(code:number,obj:unknown)=>new Response(JSON.stringify(obj),{status:code,headers});
Deno.serve(async req => {
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return answer(405,{success:false,error:'POST_only'});
  const url=Deno.env.get('SUPABASE_URL')?.replace(/\/$/,'');
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!secret)return answer(503,{success:false,error:'backend_not_configured'});
  const adminSession=req.headers.get('x-admin-session')||'';
  if(adminSession.length<24||adminSession.length>2048)return answer(401,{success:false,error:'admin_session_required'});
  // All permission checks are from admin-center, NOT the front-end's cached admin profile.
  let admin:any=null;
  try{
    const r=await fetch(url+'/functions/v1/admin-center',{
      method:'POST',headers:{'Content-Type':'application/json','x-admin-session':adminSession},
      body:JSON.stringify({action:'auth_me'}),signal:AbortSignal.timeout(9000),
    });
    const data=await r.json().catch(()=>null);
    if(!r.ok||data?.success!==true||!data?.admin)return answer(401,{success:false,error:'admin_session_invalid'});
    admin=data.admin;
  }catch{return answer(503,{success:false,error:'admin_authorization_unavailable'});}
  const payload=await req.json().catch(()=>({}));
  const action=payload?.action;
  const permissions=Array.isArray(admin.permissions)?admin.permissions:[];
  if(action==='verify_results'){
    // Never proxy the internal runner token through the client; require fresh server-side admin authentication.
    if(admin.is_super_admin!==true&&!permissions.includes('performance'))
      return answer(403,{success:false,error:'admin_performance_permission_required'});
    const rawId=payload?.game_id;
    const gameId=rawId===undefined||rawId===null||rawId===''?null:Number(rawId);
    if(gameId!==null&&(!Number.isSafeInteger(gameId)||gameId<=0))return answer(400,{success:false,error:'invalid_game_id'});
    const token=Deno.env.get('HABAO_MLB_TEST_TOKEN')||'';
    if(token.length<32)return answer(503,{success:false,error:'internal_runner_token_missing'});
    const params=gameId?'?game_id='+String(gameId):'';
    try{
      const response=await fetch(url+'/functions/v1/baseball-result-runner'+params,{
        method:'GET',headers:{'x-habao-mlb-token':token,'Authorization':'Bearer '+secret,'apikey':secret},signal:AbortSignal.timeout(90000),
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok || result?.success!==true){
        const runnerError=String(result?.error||'result_runner_unavailable');
        const status=runnerError==='mlb_result_write_disabled'?409:502;
        return answer(status,{success:false,error:runnerError,
          message:runnerError==='mlb_result_write_disabled'
            ? 'MLB 賽後驗證仍為模擬模式：請在 Supabase Edge Function Secrets 設定 HABAO_MLB_RESULT_WRITE_ENABLED=true，之後重新執行補驗證。'
            : 'MLB 結果驗證執行失敗，請檢查 baseball-result-runner Logs。',
          runner_status:response.status,runner:result});
      }
      if(result?.mode!=='write_enabled'){
        return answer(409,{success:false,error:'mlb_result_write_disabled',
          message:'目前只產生預覽結果，尚未寫入正式驗證表。請啟用 HABAO_MLB_RESULT_WRITE_ENABLED=true。',runner:result});
      }
      if((result?.planned||[]).some((item:any)=>item?.status==='insert_failed')){
        return answer(502,{success:false,error:'some_mlb_results_failed_to_save',
          message:'MLB 有驗證結果寫入失敗，請檢查 baseball-result-runner Logs。',runner:result});
      }
      return answer(200,{success:true,operation:'manual_result_verification',runner:result});
    }catch{return answer(503,{success:false,error:'result_runner_timeout_or_unavailable'});}
  }
  // 2026-11-15：MLB 公開戰績後台列表與排除／刪除（與足球／NBA 相同）。
  // 欄位見 deploy/fixes-20261115/14_mlb_performance_exclude.sql；刪除為軟刪除，避免結果 runner 自動補回。
  if(action==='performance'||action==='performance_toggle_excluded'||action==='performance_delete'){
    if(admin.is_super_admin!==true&&!permissions.includes('performance'))
      return answer(403,{success:false,error:'admin_performance_permission_required'});
    const pdb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==='performance'){
      const limit=Math.min(Math.max(Number(payload?.limit)||400,1),1000);
      const {data,error}=await pdb.from('baseball_verified_results')
        .select('game_id,kickoff_at,home_team,away_team,home_score,away_score,moneyline_result,totals_result,handicap_result,excluded_from_public,excluded_at,verified_at')
        .is('deleted_at',null).order('kickoff_at',{ascending:false}).limit(limit);
      if(error)return answer(502,{success:false,error:'mlb_performance_query_failed'});
      return answer(200,{success:true,sport:'baseball',matches:data||[]});
    }
    const gameId=Number(payload?.fixture_id??payload?.game_id);
    if(!Number.isSafeInteger(gameId)||gameId<=0)return answer(400,{success:false,error:'invalid_game_id'});
    const patch=action==='performance_delete'
      ?{deleted_at:new Date().toISOString()}
      :{excluded_from_public:payload?.excluded===true,excluded_at:payload?.excluded===true?new Date().toISOString():null};
    const {data,error}=await pdb.from('baseball_verified_results').update(patch).eq('game_id',gameId).is('deleted_at',null).select('game_id');
    if(error)return answer(502,{success:false,error:'mlb_performance_update_failed'});
    if(!data?.length)return answer(404,{success:false,error:'mlb_performance_not_found'});
    return answer(200,{success:true,game_id:gameId,...patch});
  }
  if(action==='readiness'){
    if(admin.is_super_admin!==true&&!permissions.some((p:string)=>['fixtures','performance','analysis_logs'].includes(p)))
      return answer(403,{success:false,error:'admin_readiness_permission_required'});
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const now=Date.now();
    // Read-only verified records. Missing tables are NOT treated as zero: they are marked unavailable.
    const [teamCache,snapshots,verified,memberCount]=await Promise.all([
      db.from('baseball_team_stats_cache').select('team_id,season,fetched_at').order('fetched_at',{ascending:false}).limit(100),
      db.from('baseball_t10_snapshots').select('game_id,kickoff_at,created_at,record_source,model_version').order('created_at',{ascending:false}).limit(100),
      db.from('baseball_verified_results').select('game_id').limit(100),
      db.from('member_baseball_analysis_history').select('id',{count:'exact',head:true}),
    ]);
    const statRows=teamCache.error?null:(teamCache.data||[]);
    const snapshotRows=snapshots.error?null:(snapshots.data||[]);
    const resultRows=verified.error?null:(verified.data||[]);
    const fresh=statRows===null?null:statRows.filter(x=>{const ts=Date.parse(x.fetched_at||'');return Number.isFinite(ts)&&ts<=now&&now-ts<=24*3600000;});
    const t10Upcoming=snapshotRows===null?null:snapshotRows.filter(x=>{const k=Date.parse(x.kickoff_at||'');return Number.isFinite(k)&&k>=now&&k<=now+48*3600000;});
    const freshLatest=statRows?.[0]?.fetched_at||null;
    const nextT10=snapshotRows===null?null:snapshotRows.filter(x=>x?.kickoff_at&&Date.parse(x.kickoff_at)>now).sort((a,b)=>Date.parse(a.kickoff_at)-Date.parse(b.kickoff_at))[0]||null;
    return answer(200,{
      success:true,source:'admin-baseball-readiness-v1',generated_at:new Date().toISOString(),
      team_stats_cache:{available:statRows!==null,recent_24h_count:fresh?.length??null,checked_rows:statRows?.length??null,last_fetched_at:freshLatest,error:teamCache.error?'table_unavailable':null},
      t10_snapshots:{available:snapshotRows!==null,checked_rows:snapshotRows?.length??null,upcoming_48h_count:t10Upcoming?.length??null,
        latest_snapshot_at:snapshotRows?.[0]?.created_at||null,next_game_id:nextT10?.game_id||null,next_kickoff_at:nextT10?.kickoff_at||null,error:snapshots.error?'table_unavailable':null},
      verified_results:{available:resultRows!==null,checked_rows:resultRows?.length??null,error:verified.error?'table_unavailable':null},
      member_analysis:{available:!memberCount.error,history_count:memberCount.error?null:memberCount.count,error:memberCount.error?'table_unavailable':null},
      write_gates:{t10:Deno.env.get('HABAO_MLB_T10_WRITE_ENABLED')==='true',member:Deno.env.get('HABAO_MLB_MEMBER_WRITE_ENABLED')==='true',result:Deno.env.get('HABAO_MLB_RESULT_WRITE_ENABLED')==='true'},
      push:{enabled:Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true'},
      notes:'Read-only snapshot of existing Supabase records. A count or enabled flag does not prove scheduled job execution or successful settlement.'
    });
  }
  if(action==='toggle_live_push'){
    if(admin.is_super_admin!==true&&!permissions.includes('fixtures'))
      return answer(403,{success:false,error:'admin_fixtures_permission_required'});
    if(Deno.env.get('HABAO_SPORT_PUSH_ENABLED')!=='true')
      return answer(503,{success:false,error:'sport_score_push_not_enabled'});
    const gameId=Number(payload?.game_id),enabled=payload?.enabled;
    const date=String(payload?.fixture_date||'');
    if(!Number.isSafeInteger(gameId)||gameId<=0||typeof enabled!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return answer(400,{success:false,error:'invalid_target'});
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const next=new Date(parts+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
    if(date!==parts&&date!==next.toISOString().slice(0,10))
      return answer(400,{success:false,error:'only_today_tomorrow'});
    // Verify the game ID against a fresh official fixture response, not user-supplied team labels.
    let game:any=null;
    try{
      const r=await fetch(url+'/functions/v1/baseball-public-fixtures?date='+date,
        {headers:{apikey:secret},signal:AbortSignal.timeout(15000)});
      const d=await r.json();
      if(r.ok&&d?.success===true)game=(d.fixtures||[]).find((x:any)=>Number(x.game_id||x.game_pk||x.fixture_id)===gameId);
    }catch{return answer(502,{success:false,error:'mlb_fixture_source_unavailable'});}
    if(!game)return answer(404,{success:false,error:'game_not_in_public_fixtures'});
    const kickoff=new Date(game.kickoff_at||'');
    if(Number.isNaN(kickoff.getTime()))return answer(400,{success:false,error:'invalid_kickoff'});
    const status=String(game.status?.long||'').toLowerCase();
    if(enabled&&(/final|finished|completed/.test(status)||Date.now()>kickoff.getTime()+10*3600000))
      return answer(409,{success:false,error:'game_already_finished'});
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error}=await db.from('habao_sport_push_targets').upsert({
      sport:'baseball',game_id:gameId,enabled,game_date:date,kickoff_at:kickoff.toISOString(),
      league_name:'MLB',home_team:game.home?.name||null,away_team:game.away?.name||null,
      enabled_by:String(admin.username||'habao_admin'),updated_at:new Date().toISOString()
    },{onConflict:'sport,game_id'});
    if(error)return answer(502,{success:false,error:'mlb_push_target_write_failed'});
    const reset=await db.from('habao_sport_push_state').delete().eq('sport','baseball').eq('game_id',gameId);
    if(reset.error)return answer(502,{success:false,error:'mlb_push_baseline_reset_failed'});
    return answer(200,{success:true,sport:'baseball',game_id:gameId,enabled});
  }
  // HABAO MLB fixture management: authenticated aggregate counts + push targets.
  if (action === 'fixture_meta') {
    if (admin.is_super_admin !== true && !permissions.includes('fixtures'))
      return answer(403,{success:false,error:'admin_fixtures_permission_required'});
    const rawIds=payload?.game_ids;
    if (!Array.isArray(rawIds) || rawIds.length>120)
      return answer(400,{success:false,error:'invalid_game_ids'});
    const ids=Array.from(new Set<number>(rawIds.map((x:unknown)=>Number(x))));
    if (ids.some(x=>!Number.isSafeInteger(x)||x<=0))
      return answer(400,{success:false,error:'invalid_game_ids'});
    const result:Record<string,{analysis_member_count:number|null;push_member_count:number|null;live_push_enabled:boolean;live_push_ready:boolean}>={};
    for (const gameId of ids) result[String(gameId)]={
      analysis_member_count:0,push_member_count:0,live_push_enabled:false,
      live_push_ready:Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true',
    };
    if (!ids.length) return answer(200,{success:true,fixture_meta:result,
      member_counts_available:true,push_counts_available:true,live_push_available:Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true'});
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const targets=await db.from('habao_sport_push_targets')
      .select('game_id,enabled').eq('sport','baseball').in('game_id',ids);
    const featureReady=Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true'&&!targets.error;
    for(const id of ids)result[String(id)].live_push_ready=featureReady;
    for(const row of targets.data||[]){
      const item=result[String(row.game_id)];
      if(item)item.live_push_enabled=featureReady&&row.enabled===true;
    }
    const byGame=new Map<number,Set<string>>();
    let historyOk=true;
    // Paginate to avoid Supabase's default 1,000 row query cap silently undercounting members.
    for(let start=0;start<30000;start+=1000){
      const {data,error}=await db.from('member_baseball_analysis_history')
        .select('game_id,account').in('game_id',ids)
        .order('game_id',{ascending:true}).order('account',{ascending:true})
        .range(start,start+999);
      if(error){historyOk=false;break;}
      for(const row of data||[]){
        const id=Number(row?.game_id),account=String(row?.account||'').trim();
        if(!result[String(id)]||!account)continue;
        if(!byGame.has(id))byGame.set(id,new Set());
        byGame.get(id)!.add(account);
      }
      if((data||[]).length<1000) break;
      // Fail closed rather than display wrong counts if more than 30,000 history rows exist.
      if(start===29000) historyOk=false;
    }
    if(!historyOk){
      for(const id of ids){result[String(id)].analysis_member_count=null;result[String(id)].push_member_count=null;}
      return answer(200,{success:true,fixture_meta:result,
        member_counts_available:false,push_counts_available:false,live_push_available:Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true'});
    }
    // 2026-11-15：分析會員／可推播改為三階段都算（T-10 + T-2／T-15 領取）。
    const stageClaims=await db.from('baseball_v2_stage_claims').select('game_id,account').in('game_id',ids).limit(30000);
    if(stageClaims.error){
      for(const id of ids){result[String(id)].analysis_member_count=null;result[String(id)].push_member_count=null;}
      return answer(200,{success:true,fixture_meta:result,
        member_counts_available:false,push_counts_available:false,live_push_available:Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true'});
    }
    for(const row of stageClaims.data||[]){
      const id=Number(row?.game_id),account=String(row?.account||'').trim();
      if(!result[String(id)]||!account)continue;
      if(!byGame.has(id))byGame.set(id,new Set());
      byGame.get(id)!.add(account);
    }
    const allAccounts=Array.from(new Set(Array.from(byGame.values()).flatMap(s=>Array.from(s))));
    let pushOk=true;
    const active=new Set<string>(),subscribed=new Set<string>();
    for(let i=0;i<allAccounts.length;i+=80){
      const batch=allAccounts.slice(i,i+80);
      const [members,subscriptions]=await Promise.all([
        db.from('members').select('account,is_active').in('account',batch),
        db.from('push_subscriptions').select('member_username').in('member_username',batch),
      ]);
      if(members.error||subscriptions.error){pushOk=false;break;}
      for(const m of members.data||[])if(m?.is_active===true)
        active.add(String(m?.account||'').trim());
      for(const p of subscriptions.data||[])subscribed.add(String(p?.member_username||'').trim());
    }
    for(const id of ids){
      const row=result[String(id)],members=byGame.get(id)||new Set<string>();
      row.analysis_member_count=members.size;
      row.push_member_count=pushOk?Array.from(members).filter(a=>active.has(a)&&subscribed.has(a)).length:null;
    }
    return answer(200,{success:true,fixture_meta:result,
      member_counts_available:true,push_counts_available:pushOk,live_push_available:Deno.env.get('HABAO_SPORT_PUSH_ENABLED')==='true'});
  }
  if(action!=='analysis_history')return answer(400,{success:false,error:'unsupported_action'});
  if(admin.is_super_admin!==true&&!permissions.includes('analysis_logs'))
    return answer(403,{success:false,error:'admin_analysis_logs_permission_required'});
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const [snapshots,history]=await Promise.all([
    db.from('baseball_t10_snapshots').select('id,game_id,kickoff_at,home_team,away_team,model_version,record_source,created_at,analyzed_at,analysis').order('created_at',{ascending:false}).limit(200),
    db.from('member_baseball_analysis_history').select('id,account,game_id,snapshot_id,fixture_time,home_team,away_team,league_name,match_status,status,created_at,updated_at').order('created_at',{ascending:false}).limit(200)
  ]);
  if(snapshots.error||history.error)return answer(502,{success:false,error:'mlb_logs_query_failed'});
  const auto=(snapshots.data||[]).map(s=>({
    id:'system:'+s.id,account:'SYSTEM_AUTO',sport:'baseball',record_source:'system_auto',
    game_id:s.game_id,fixture_id:s.game_id,league_name:'MLB',fixture_time:s.kickoff_at,
    home_team:s.home_team,away_team:s.away_team,created_at:s.created_at,updated_at:s.analyzed_at||s.created_at,
    match_status:'scheduled',status:'completed',model_version:s.model_version,
    // The admin list needs only market display fields; no raw game data or secrets.
    result_data:{sport:'baseball',model:{
      projection:{home_runs:s.analysis?.model?.projection?.home_runs??null,away_runs:s.analysis?.model?.projection?.away_runs??null}
    },analysis:{recommendations:{
      moneyline:{pick:s.analysis?.model?.markets?.moneyline?.pick||null},
      handicap:{pick:s.analysis?.model?.markets?.spread?.pick||null,line:(()=>{const homeLine=s.analysis?.model?.markets?.spread?.market_home_spread;const side=String(s.analysis?.model?.markets?.spread?.pick||"" ).toLowerCase();if(homeLine===null||homeLine===undefined||homeLine===""||typeof homeLine==="boolean"||!Number.isFinite(Number(homeLine)))return null;return side==="away"?-Number(homeLine):side==="home"?Number(homeLine):null;})()},
      over_under:{pick:s.analysis?.model?.markets?.totals?.pick||null,line:s.analysis?.model?.markets?.totals?.market_line??null}
    }}}
  }));
  const members=(history.data||[]).map(m=>({...m,sport:'baseball',fixture_id:m.game_id,record_source:'member',stage:'t10'}));
  // 2026-11-15：補上 T-2／T-15 系統階段快照與會員階段領取（原本只有 T-10）。
  const stageCutoff=new Date(Date.now()-7*86400000).toISOString();
  const [stageSnaps,stageClaims]=await Promise.all([
    db.from('baseball_v2_stage_snapshots').select('game_id,stage,fixture_time,captured_at,status,result_data,source_meta,model_version,updated_at').gte('fixture_time',stageCutoff).order('updated_at',{ascending:false}).limit(500),
    db.from('baseball_v2_stage_claims').select('account,game_id,stage,fixture_time,result_data,claimed_at').gte('claimed_at',stageCutoff).order('claimed_at',{ascending:false}).limit(500)
  ]);
  if(stageSnaps.error||stageClaims.error)return answer(502,{success:false,error:'mlb_stage_logs_query_failed'});
  const mlbName=(v:any)=>typeof v==='string'?v:(v?.name||v?.api_name||'—');
  const t10ById=new Map((snapshots.data||[]).map((s:any)=>[Number(s.game_id),s]));
  const stageAuto=(stageSnaps.data||[]).map((r:any)=>{const fx=r.result_data?.fixture||{},t10:any=t10ById.get(Number(r.game_id));return {
    id:'system_stage:'+r.game_id+':'+r.stage,account:'SYSTEM_AUTO',sport:'baseball',record_source:'system_auto',stage:r.stage,stage_status:r.status||null,
    capture_mode:r.source_meta?.capture_mode||null,game_id:r.game_id,fixture_id:r.game_id,league_name:'MLB',fixture_time:r.fixture_time,
    home_team:mlbName(fx.home)!=='—'?mlbName(fx.home):(t10?.home_team||'—'),away_team:mlbName(fx.away)!=='—'?mlbName(fx.away):(t10?.away_team||'—'),
    created_at:r.captured_at||r.updated_at,updated_at:r.captured_at||r.updated_at,match_status:'scheduled',status:r.status,
    result_data:r.status==='ready'?r.result_data:{v2_stage:r.stage,status:r.status}};});
  const stageMembers=(stageClaims.data||[]).map((r:any)=>{const fx=r.result_data?.fixture||{};return {
    id:'member_stage:'+r.account+':'+r.game_id+':'+r.stage,account:r.account,sport:'baseball',record_source:'member',stage:r.stage,
    game_id:r.game_id,fixture_id:r.game_id,league_name:'MLB',fixture_time:r.fixture_time,home_team:mlbName(fx.home),away_team:mlbName(fx.away),
    created_at:r.claimed_at,updated_at:r.claimed_at,match_status:'scheduled',status:'completed',result_data:r.result_data||null};});
  return answer(200,{success:true,sport:'baseball',records:[...auto.map(x=>({...x,stage:'t10'})),...members,...stageAuto,...stageMembers].sort((a,b)=>Date.parse(b.updated_at||'')-Date.parse(a.updated_at||'')).slice(0,400),
    snapshot_count:auto.length,member_history_count:members.length});
});
