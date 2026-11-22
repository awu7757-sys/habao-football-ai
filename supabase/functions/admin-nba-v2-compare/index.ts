// HABAO NBA 推薦規則比較（舊規則／新規則 V3／挑戰規則）。只讀；需要管理員 session。
// 2026-11-22 改版：取代原本的 V1／unified V2 比較。規格：deploy/nba-rules-20261122/NBA_RULES_CHANGE_SPEC.md 第 5 節。
// - 舊規則：快照的 pre_rule（V3 上線後）或快照原本的正式推薦（V3 上線前）。
// - 新規則：V3 上線後讀正式輸出；上線前用同一份規則正本即時回算（回測，會偏樂觀）。
// - 挑戰規則：只有 T-2／T-15 大小分改成差距 < 3，其餘同新規則；只在後台。
// - T-2／T-15 只統計 capture_mode=scheduled；補抓另計。各階段只用自己封存的盤口，不補後續資料。
// - 回算缺少必要盤口／模型總分 → 標示不可比較，三套規則都不納入統計。
const URL_BASE=String(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
let SERVICE=String(Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'');
if(!SERVICE){try{SERVICE=String(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'')}catch{}}
const API_VERSION='nba-rules-v3-compare-20261122';
const HEAD={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-admin-session,authorization,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','X-Habao-Version':API_VERSION};
const reply=(status,x)=>new Response(JSON.stringify(x),{status,headers:{...HEAD,'Content-Type':'application/json; charset=utf-8'}});

// === NBA_RULES_V3 BEGIN ===
// NBA 推薦規則 V3（2026-11-22）。正本：supabase/functions/_shared/nba-rules-v3.js
// 這一段會原封不動複製到 basketball-analysis、nba-v2-stage-runner、admin-nba-v2-compare（Supabase 網站貼上部署，無法跨函式 import）。
// 修改請只改正本，再執行 node scripts/sync-nba-rules-v3.cjs；tests/nba-rules-v3.test.cjs 會檢查三份是否一致。
// 純函式：不讀資料庫、不呼叫 API、不讀賽果。只會把既有推薦改成暫不推薦，不會產生新方向。
// 規格：deploy/nba-rules-20261122/NBA_RULES_CHANGE_SPEC.md
const NBA_RULES_V3 = { version: 'nba-rules-v3-20261122', from: '2026-11-24T00:00:00+08:00', totalGapMax: 6, challengerGapMax: 3, stageSpreadConfMin: 70 };
const NBA_RULES_V3_REASONS = {
  underdog_pick: '模型看好的一方是盤口冷門，冷門推薦歷史命中率偏低，暫不列入正式推薦。',
  favorite_unknown: '目前沒有可判斷熱門方的讓分盤口，暫不列入正式獨贏推薦。',
  conflict_with_t10: '與 T-10 賽前分析方向相反，訊號不一致，暫不推薦。',
  t10_not_qualified: 'T-10 賽前分析未列入正式獨贏推薦，本階段不單獨推薦。',
  edge_too_large: '模型與盤口總分差距過大（6 分以上），這類情況歷史上多半是模型誤判，暫不推薦。',
  gap_unknown: '缺少模型總分或盤口總分，暫不推薦。',
  low_confidence: '本階段讓分模型機率低於 70%，暫不列入正式推薦。',
  challenger_gap: '挑戰規則：模型與盤口總分差距 3 分以上（僅後台比較用）。',
};
// 是否為被 V3 規則擋下的推薦（固定原因不得被 AI 文案覆蓋）。
function nbaRulesV3Blocked(rec) {
  return !!(rec && rec.rule_version && String(rec.pick || '').trim() === '暫不推薦' &&
    Object.prototype.hasOwnProperty.call(NBA_RULES_V3_REASONS, String(rec.decision_code || '')));
}
// 合併 AI 解說：被 V3 擋下的保留固定規則原因（AI 文案不採用）；其餘維持原設計（AI 文案優先，空白時用原因）。
function nbaRulesV3MergeNarrative(rec, aiReason) {
  if (nbaRulesV3Blocked(rec)) return { ...rec };
  return { ...rec, reason: String(aiReason || (rec && rec.reason) || '') };
}
function nbaRulesV3Num(v) {
  if (v === null || v === undefined || typeof v === 'boolean' || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// 開賽時間 >= 啟用時間才套用；時間無法解析時保守套用。
function nbaRulesV3Active(fixtureTime) {
  const t = Date.parse(String(fixtureTime || ''));
  return !Number.isFinite(t) || t >= Date.parse(NBA_RULES_V3.from);
}
// 讓分盤熱門：同場同階段的主隊讓分，負＝主隊、正＝客隊；0、缺值、無效值不判定。
function nbaRulesV3Favorite(homeSpread) {
  const n = nbaRulesV3Num(homeSpread);
  if (n === null || n === 0 || Math.abs(n) > 60) return null;
  return n < 0 ? '主隊' : '客隊';
}
function nbaRulesV3Side(pick) {
  const p = String(pick || '').trim();
  return p === '主隊' ? '主隊' : p === '客隊' ? '客隊' : null;
}
function nbaRulesV3IsPick(pick) {
  const p = String(pick || '').trim();
  return p !== '' && p !== '暫不推薦';
}
// input: { stage:'t10'|'t2'|'t15', market:'moneyline'|'handicap'|'over_under', rec:{pick,confidence,...},
//          homeSpread, modelTotal, marketTotal, t10MoneylinePick, t10Policy:'lenient'|'strict', variant:'official'|'challenger' }
// 回傳 decision_code（被擋下）或 null（保留）。原本就暫不推薦的一律回傳 null。
function nbaRulesV3Decide(input) {
  const i = input || {}, rec = i.rec || {};
  if (!nbaRulesV3IsPick(rec.pick)) return null;
  const stage = i.stage === 't2' || i.stage === 't15' ? i.stage : 't10';
  if (i.market === 'moneyline') {
    const fav = nbaRulesV3Favorite(i.homeSpread), side = nbaRulesV3Side(rec.pick);
    if (!fav) return 'favorite_unknown';
    if (side !== fav) return 'underdog_pick';
    if (stage !== 't10') {
      const t10 = nbaRulesV3Side(i.t10MoneylinePick);
      if (t10 && t10 !== side) return 'conflict_with_t10';
      if (!t10 && i.t10Policy === 'strict') return 't10_not_qualified';
    }
    return null;
  }
  if (i.market === 'handicap') {
    if (stage === 't10') return null;
    const c = nbaRulesV3Num(rec.confidence);
    return c === null || c < NBA_RULES_V3.stageSpreadConfMin ? 'low_confidence' : null;
  }
  if (i.market === 'over_under') {
    const m = nbaRulesV3Num(i.modelTotal), t = nbaRulesV3Num(i.marketTotal);
    if (m === null || t === null) return 'gap_unknown';
    const gap = Math.abs(m - t), challenger = i.variant === 'challenger' && stage !== 't10';
    if (challenger && gap >= NBA_RULES_V3.challengerGapMax) return 'challenger_gap';
    return gap >= NBA_RULES_V3.totalGapMax ? 'edge_too_large' : null;
  }
  return null;
}
// 套用到一筆正式推薦物件：保留套用前的完整推薦（pre_rule），被擋下則改成暫不推薦。
// blockedSignalLevel：T-10 被擋下時要顯示的 signal_level（參考等級）；階段推薦沒有此欄位可不傳。
function nbaRulesV3Wrap(rec, input) {
  const r = rec || {};
  const pre_rule = {
    pick: r.pick ?? null, line: r.line ?? null, confidence: r.confidence ?? null, reason: r.reason ?? null,
    official_pick_is_qualified: r.official_pick_is_qualified ?? nbaRulesV3IsPick(r.pick), decision_code: r.decision_code ?? null,
  };
  const code = nbaRulesV3Decide({ ...(input || {}), rec: r });
  if (!code) return { ...r, pre_rule, rule_version: NBA_RULES_V3.version };
  const out = { ...r, pick: '暫不推薦', line: null, confidence: 0, reason: NBA_RULES_V3_REASONS[code], decision_code: code,
    official_pick_is_qualified: false, pre_rule, rule_version: NBA_RULES_V3.version };
  if ('signal_level' in r && input && input.blockedSignalLevel) out.signal_level = input.blockedSignalLevel;
  return out;
}
// === NBA_RULES_V3 END ===

const MARKETS=['moneyline','handicap','over_under'],STAGES=['t10','t2','t15'];
const num=nbaRulesV3Num;
const isPick=nbaRulesV3IsPick;
const lineParts=line=>line===null||Math.abs(line*4-Math.round(line*4))>.0001?null:[Math.floor(line*2)/2,Math.ceil(line*2)/2];
const grade=score=>score===2?'win':score===1?'half_win':score===0?'push':score===-1?'half_loss':'loss';
// 結算一筆推薦（pick 為 主隊／客隊／大／小）。賽果只在這裡使用。
function settle(market,rec,h,a){
  if(!rec||!isPick(rec.pick)||h===null||a===null)return null;
  const p=String(rec.pick).trim();
  if(market==='moneyline'){const side=nbaRulesV3Side(p);return side?((side==='主隊'?h>a:a>h)?'win':'loss'):null;}
  const line=num(rec.line),parts=lineParts(line);if(!parts)return null;
  if(market==='handicap'){const side=nbaRulesV3Side(p);if(!side)return null;const pts=side==='主隊'?h-a:a-h;
    return grade(parts.map(l=>pts+l>1e-8?1:pts+l<-1e-8?-1:0).reduce((x,y)=>x+y,0));}
  const sign=p==='大'?1:p==='小'?-1:0;if(!sign)return null;
  return grade(parts.map(l=>sign*(h+a-l)>1e-8?1:sign*(h+a-l)<-1e-8?-1:0).reduce((x,y)=>x+y,0));
}
const recsOf=d=>d?.analysis?.recommendations||d?.recommendations||d?.prediction?.analysis?.recommendations||{};
const slim=r=>r?{pick:r.pick??null,line:r.line??null,confidence:r.confidence??null}:null;
// T-10 自己的盤口：同 basketball-analysis（|讓分|<=60、主客一致、primary 優先；總分 120～350）。
function t10Market(pd){
  const m=pd?.market_data?.market||pd?.prediction?.market_data?.market||{},p=m.primary||{},c=m.consensus||{};
  const sp=v=>{const n=num(v);return n!==null&&Math.abs(n)<=60?n:null;},tt=v=>{const n=num(v);return n!==null&&n>=120&&n<=350?n:null;};
  const pair=(h,a)=>(h!==null||a!==null)&&(h===null||a===null||Math.abs(h+a)<=.01)?(h??-a):null;
  const ph=pair(sp(p.home_spread),sp(p.away_spread));
  return {homeSpread:ph!==null?ph:pair(sp(c.home_spread),sp(c.away_spread)),total:tt(p.total)??tt(c.total)};
}
// 一筆（階段×玩法）三套規則。live＝快照已由 V3 產生（有 rule_version）。
function evaluate(stage,market,rec,ctx){
  const live=!!rec?.rule_version;
  const old=live?(rec.pre_rule||null):rec;
  const input={stage,market,rec:old||{},homeSpread:ctx.homeSpread,modelTotal:ctx.modelTotal,marketTotal:ctx.marketTotal,t10MoneylinePick:ctx.t10Pick,t10Policy:'lenient'};
  let comparable=true;
  if(!live&&isPick(old?.pick)){
    if(market==='moneyline'&&ctx.homeSpreadMissing)comparable=false;
    if(market==='over_under'&&(num(ctx.modelTotal)===null||num(ctx.marketTotal)===null))comparable=false;
    if(stage!=='t10'&&market==='moneyline'&&!ctx.t10Known)comparable=false;
  }
  const code=live?(nbaRulesV3Blocked(rec)?String(rec.decision_code):null):nbaRulesV3Decide(input);
  const neu=live?rec:(code?{pick:'暫不推薦',line:null,confidence:0}:old);
  let challenger=null;
  if(stage!=='t10'&&market==='over_under'){
    const c=nbaRulesV3Decide({...input,variant:'challenger'});
    challenger={rec:c?{pick:'暫不推薦',line:null,confidence:0}:old,code:c};
  }
  return {live,comparable,old,neu,code,challenger};
}
function emptyStat(){return {picks:0,win:0,half_win:0,loss:0,half_loss:0,push:0,points:0,graded:0,blocked_win:0,blocked_loss:0};}
function addStat(s,result,oldResult,kept){
  if(kept){s.picks++;if(result==='push')s.push++;else if(result){s[result]++;s.graded++;s.points+=result==='win'?1:result==='half_win'?.5:0;}}
  else if(oldResult==='win'||oldResult==='half_win')s.blocked_win++;
  else if(oldResult==='loss'||oldResult==='half_loss')s.blocked_loss++;
}
const finish=s=>({...s,rate:s.graded?Math.round(s.points/s.graded*1000)/10:null});
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
// 主要計算（純函式，方便離線測試）：snapshots＝T-10 快照，stages＝T-2／T-15 快照。
function buildComparison(snapshots,stages){
  const byGame=new Map();for(const s of stages){const id=Number(s.game_id);if(!byGame.has(id))byGame.set(id,[]);byGame.get(id).push(s);}
  const stats={live:{},backtest:{}};
  for(const ph of ['live','backtest'])for(const st of STAGES){stats[ph][st]={};for(const mk of MARKETS)stats[ph][st][mk]={old:emptyStat(),new:emptyStat(),challenger:st!=='t10'&&mk==='over_under'?emptyStat():null};}
  const counts={t10_snapshots:snapshots.length,verified_games:0,stage_scheduled:0,stage_late:0,not_comparable:0};
  const rows=[];
  for(const snap of snapshots){
    const pd=snap.prediction_data||{},h=num(snap.final_home),a=num(snap.final_away);
    const verified=String(snap.status||'').toLowerCase()==='verified'&&Number.isInteger(h)&&Number.isInteger(a)&&h!==a&&snap.excluded_from_public!==true;
    if(verified)counts.verified_games++;
    const phase=nbaRulesV3Active(snap.fixture_time)&&Number.isFinite(Date.parse(String(snap.fixture_time||'')))?'live':'backtest';
    const tm=t10Market(pd),t10recs=recsOf(pd);
    const fair=num(pd?.model?.fair_total)??num(pd?.prediction?.model?.fair_total);
    const items=[];
    const t10ml=evaluate('t10','moneyline',t10recs.moneyline||{},{homeSpread:tm.homeSpread,homeSpreadMissing:tm.homeSpread===null,modelTotal:fair,marketTotal:tm.total});
    const t10Pick=t10ml.neu?.pick??null;
    const push=(stage,market,ev,capture)=>{
      const R=x=>verified?settle(market,x,h,a):null;
      const oldRes=R(ev.old),newRes=R(ev.neu),chRes=ev.challenger?R(ev.challenger.rec):null;
      const scheduled=stage==='t10'||capture==='scheduled';
      items.push({stage,market,capture_mode:stage==='t10'?null:capture,comparable:ev.comparable,live:ev.live,
        old:{...slim(ev.old),result:oldRes},new:{...slim(ev.neu),result:newRes,code:ev.code},
        challenger:ev.challenger?{...slim(ev.challenger.rec),result:chRes,code:ev.challenger.code}:null});
      if(!isPick(ev.old?.pick))return;
      if(!ev.comparable){counts.not_comparable++;return;}
      if(!verified||!scheduled||!oldRes)return;
      const box=stats[phase][stage][market];
      addStat(box.old,oldRes,oldRes,true);
      addStat(box.new,newRes,oldRes,isPick(ev.neu?.pick));
      if(box.challenger)addStat(box.challenger,chRes,oldRes,isPick(ev.challenger.rec?.pick));
    };
    push('t10','moneyline',t10ml,null);
    for(const mk of ['handicap','over_under'])push('t10',mk,evaluate('t10',mk,t10recs[mk]||{},{homeSpread:tm.homeSpread,homeSpreadMissing:tm.homeSpread===null,modelTotal:fair,marketTotal:tm.total}),null);
    for(const s of (byGame.get(Number(snap.game_id))||[]).sort((x,y)=>String(x.stage).localeCompare(String(y.stage)))){
      const rd=s.result_data||{},mkt=rd?.market_data?.market?.consensus||{},recs=rd?.analysis?.recommendations||{};
      const capture=String(s.source_meta?.capture_mode||rd?.stage_capture?.capture_mode||rd?.analysis?.v2_stage_evidence?.capture_mode||'unknown');
      if(capture==='scheduled')counts.stage_scheduled++;else counts.stage_late++;
      const ctx={homeSpread:mkt.home_spread,homeSpreadMissing:num(mkt.home_spread)===null,modelTotal:rd?.model?.expected_total,marketTotal:mkt.total,t10Pick,t10Known:true};
      for(const mk of MARKETS)push(s.stage,mk,evaluate(s.stage,mk,recs[mk]||{},ctx),capture);
    }
    rows.push({game_id:Number(snap.game_id),kickoff_at:snap.fixture_time,home:snap.home_team,away:snap.away_team,
      verified,home_score:h,away_score:a,phase,items});
  }
  for(const ph of ['live','backtest'])for(const st of STAGES)for(const mk of MARKETS){const b=stats[ph][st][mk];b.old=finish(b.old);b.new=finish(b.new);if(b.challenger)b.challenger=finish(b.challenger);}
  return {stats,counts,rows};
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:HEAD});
  if(req.method!=='POST')return reply(405,{success:false,error:'POST_only'});
  if(!URL_BASE||!SERVICE)return reply(503,{success:false,error:'backend_not_configured'});
  try{
    if(!(await adminCheck(req.headers.get('x-admin-session')||'')))return reply(401,{success:false,error:'admin_unauthorized'});
    const body=await req.json().catch(()=>({}));if(body?.action!=='compare')return reply(400,{success:false,error:'invalid_action'});
    const days=[0,7,14,30,90].includes(Number(body?.days))?Number(body.days):30;
    const now=Date.now(),floor=Date.parse('2026-11-13T00:00:00+08:00');
    const since=new Date(days===0?floor:Math.max(floor,now-days*86400000)).toISOString(),until=new Date(now+2*86400000).toISOString();
    const snapshots=[];
    for(let page=0;page<6;page++){
      const qs=new URLSearchParams({select:'game_id,fixture_time,home_team,away_team,prediction_data,status,final_home,final_away,excluded_from_public',
        fixture_time:`gte.${since}`,and:`(fixture_time.lte.${until})`,order:'fixture_time.desc',limit:'500',offset:String(page*500)});
      const part=await get('basketball_prediction_snapshots',qs.toString());snapshots.push(...part);if(part.length<500)break;
    }
    const ids=snapshots.map(x=>Number(x.game_id)).filter(Number.isSafeInteger),stages=[];
    for(let j=0;j<ids.length;j+=40){const sub=ids.slice(j,j+40);
      stages.push(...await get('basketball_v2_stage_snapshots',new URLSearchParams({select:'game_id,stage,status,result_data,source_meta',
        game_id:`in.(${sub.join(',')})`,stage:'in.(t2,t15)',status:'eq.ready',limit:'200'}).toString()));}
    const out=buildComparison(snapshots,stages);
    return reply(200,{success:true,api_version:API_VERSION,read_only:true,rules:{version:NBA_RULES_V3.version,from:NBA_RULES_V3.from},days,since,
      note:'回測＝規則上線前用同一份規則回算，規則是看同一批資料選的，數字偏樂觀；上線後才是真正驗證。命中率：贏 1、贏半 0.5、走水不計。',
      count:out.rows.length,...out});
  }catch(e){console.error('NBA_RULES_COMPARE',String(e));return reply(500,{success:false,error:'compare_failed',detail:String(e?.message||e).slice(0,200)});}
});
