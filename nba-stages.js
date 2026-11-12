/* NBA pilot T-10/T-2/T-15: fixed stage snapshots, server-side atomic claims. */
(() => {
  'use strict';
  const PILOT='google_2d3cef6b6e2d';
  const ENDPOINT='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-v2-stage-member';
  const matches=new Map(),pending=new Set();
  let states={},owner='',serial=0,enabled=false,unavailable=false;
  const member=()=>{try{return JSON.parse(sessionStorage.getItem('habao_member')||'null');}catch{return null;}};
  const account=()=>String(member()?.account||'');
  const pilot=()=>account()===PILOT;
  async function headers(){return footballV2StageHeaders();}
  async function request(body,timeout=20000){
    const response=await fetch(ENDPOINT,{method:'POST',headers:await headers(),body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(timeout)});
    const packet=await response.json().catch(()=>null);
    if(!response.ok||packet?.success!==true){const e=new Error(packet?.error||'stage_service_unavailable');e.code=packet?.error;throw e;}
    return packet;
  }
  function decision(kickoff,claimed={},now=Date.now()){
    const minutes=(Date.parse(kickoff)-now)/60000;
    if(!Number.isFinite(minutes))return {stage:null,label:'賽事時間未確認',disabled:true,status:'尚未開放分析'};
    if(minutes<=0)return {stage:null,label:'分析已截止',disabled:true,status:'比賽已開賽'};
    if(minutes>600)return {stage:'t10',label:'賽前 10 小時開放',disabled:true,status:'尚未開放分析'};
    if(minutes>120)return claimed.t10?{stage:'t2',label:'深度分析（T-2 開放）',disabled:true,status:'已領取 T-10・等待 T-2'}:{stage:'t10',label:'開始分析',disabled:false,status:'可分析'};
    if(minutes>15)return claimed.t2?{stage:'t15',label:'最終分析（T-15 開放）',disabled:true,status:'已領取 T-2・等待 T-15'}:{stage:'t2',label:'深度分析',disabled:false,status:'T-2 可分析'};
    return claimed.t15?{stage:'t15',label:'已領取最終分析',disabled:true,status:'已領取 T-15'}:{stage:'t15',label:'最終分析',disabled:false,status:'T-15 可分析'};
  }
  function render(id){
    if(!pilot()||owner!==account())return;
    const card=document.querySelector(`[data-basketball-fixture-id="${id}"]`),match=matches.get(Number(id));
    if(!card||!match)return;
    const button=card.querySelector('.analysis-btn.v2-analysis-btn'),status=card.querySelector('.ai-status');
    if(!button||pending.has(Number(id))||button.classList.contains('loading'))return;
    // Respect the existing renderer's final/live status. The local clock also closes at tipoff.
    if(card.dataset.nbaStatus!=='upcoming')return;
    let host=card.querySelector('[data-nba-stage-actions]');
    if(!host){host=document.createElement('div');host.dataset.nbaStageActions=String(id);host.className='nba-stage-actions';button.parentElement.appendChild(host);}
    host.replaceChildren();
    if(unavailable){button.disabled=true;button.textContent='階段服務尚未就緒';button.onclick=null;if(status)status.textContent='請稍後重新整理';return;}
    if(!enabled)return;
    const state=states[String(id)]||{},d=decision(match.kickoff_at,state.claimed);
    button.dataset.nbaStage=d.stage||'';
    button.classList.remove('stage-t2','stage-t15','locked','finished');
    if(d.stage==='t2'||d.stage==='t15')button.classList.add('football-v2-stage-btn','stage-'+d.stage);
    if(d.disabled)button.classList.add('locked');
    button.disabled=d.disabled;button.textContent=d.label;button.setAttribute('aria-label',d.label);
    button.onclick=d.disabled?null:()=>d.stage==='t10'?openBasketballMatch(Number(id),button):claim(Number(id),d.stage,button);
    if(status){status.textContent=d.status;status.classList.toggle('ready',!d.disabled);status.classList.toggle('locked',d.disabled);}
    const minutes=(Date.parse(match.kickoff_at)-Date.now())/60000;
    // Batch remains the existing official T-10 flow; label it explicitly when viewing a later stage.
    const batch=card.querySelector('.v2-batch-select span');if(batch)batch.textContent=minutes<=120?'加入 T-10 批次分析':'加入批次分析';
    if(minutes<=0)return;
    const extra=(stage,label,canClaim)=>{
      const b=document.createElement('button');b.type='button';b.className='v2-analysis-btn nba-stage-catchup'+(stage==='t2'?' football-v2-stage-btn stage-t2':'');b.textContent=label;b.disabled=!canClaim;
      b.onclick=()=>stage==='t10'?openBasketballMatch(Number(id),b):claim(Number(id),stage,b);host.appendChild(b);
    };
    if(minutes<=120&&state.claimed?.t10!==true)extra('t10','補領 T-10 分析',true);
    if(minutes<=15&&state.claimed?.t2!==true)extra('t2',state.ready?.t2===true?'補領 T-2 深度分析':'T-2 尚無封存快照',state.ready?.t2===true);
  }
  async function refresh(fixtures){
    if(Array.isArray(fixtures)){matches.clear();for(const x of fixtures){const id=Number(x.fixture_id);if(Number.isSafeInteger(id)&&id>0)matches.set(id,x);}}
    if(!matches.size)document.querySelectorAll?.('[data-basketball-fixture-id][data-nba-kickoff]').forEach(card=>{const id=Number(card.dataset.basketballFixtureId);if(Number.isSafeInteger(id)&&id>0)matches.set(id,{fixture_id:id,kickoff_at:card.dataset.nbaKickoff});});
    if(!pilot()){enabled=false;states={};owner='';return;}
    const active=account(),token=++serial;owner=active;
    if(!matches.size)return;
    try{
      const p=await request({action:'status',account:active,game_ids:[...matches.keys()]});
      if(serial!==token||account()!==active)return;
      if(p.enabled!==true)throw Error('stage_access_disabled');
      states=p.stages||{};enabled=true;unavailable=false;
    }catch(e){if(serial!==token||account()!==active)return;enabled=false;unavailable=true;}
    matches.forEach((_,id)=>render(id));
  }
  async function claim(id,stage,button){
    if(!pilot()||!['t2','t15'].includes(stage)||pending.has(id))return;
    if(typeof habaoSportBatchRunning!=='undefined'&&habaoSportBatchRunning){alert('批次分析執行中，請等完成後再領取階段分析。');return;}
    const active=account(),m=member(),old=button?.textContent||'';
    if(typeof habaoNbaPendingGames!=='undefined'&&habaoNbaPendingGames.has(id))return;
    pending.add(id);if(typeof habaoNbaPendingGames!=='undefined')habaoNbaPendingGames.add(id);
    if(button){button.disabled=true;button.textContent='階段資料準備中…';button.classList.add('loading');}
    try{
      const p=await request({action:'claim',account:active,game_id:id,stage},90000),result=p.result;
      if(account()!==active)throw Error('帳號已變更，請重新讀取');
      if(!result||result.success!==true||Number(result.game_id)!==id||result.v2_stage!==stage||result.sport!=='basketball'||!result.analysis)throw Error('階段分析回傳不完整');
      const access=p.member_access;
      if(access&&access.analysis_unlimited!==true){for(const [key,field]of [['paid_remaining','analysis_credits'],['daily_free_remaining','daily_free_credits']]){const value=access[key];if(value!=null&&typeof value!=='boolean'&&String(value).trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=0)m[field]=Number(value);}sessionStorage.setItem('habao_member',JSON.stringify(m));}
      states[String(id)]={...states[String(id)],claimed:{...states[String(id)]?.claimed,[stage]:true}};
      sessionStorage.setItem('matchAnalysis',JSON.stringify(result));sessionStorage.setItem('habao_analysis_sport','basketball');
      window.location.href='analysis.html?sport=basketball&v2stage='+stage;
    }catch(e){
      const messages={stage_snapshot_not_ready:'此階段快照尚未準備完成，請稍後再試；這次不扣點。',stage_not_open:'此階段尚未開放。',match_already_started:'比賽已開賽，不能新增領取。',member_authentication_required:'請重新登入會員後再試。',stage_claim_failed:'領取未完成，請稍後再試。'};
      if(e.code==='analysis_credits_empty')showQuotaLimitModal('credits_empty');else alert(messages[e.code]||e.message||'階段分析失敗，請稍後再試');
      if(button){button.textContent=old;button.disabled=false;}
    }finally{pending.delete(id);if(typeof habaoNbaPendingGames!=='undefined')habaoNbaPendingGames.delete(id);button?.classList.remove('loading');render(id);}
  }
  async function history(){
    if(!pilot())return [];
    const p=await request({action:'history',account:account()});
    if(p.enabled!==true||!Array.isArray(p.matches))return [];
    return p.matches;
  }
  window.habaoNbaStages={refresh,claim,history,decision};
  window.setInterval(()=>{if(pilot()&&enabled)matches.forEach((_,id)=>render(id));},10000);
  window.setInterval(()=>{if(pilot()&&document.querySelector('[data-basketball-fixture-id]')&&document.visibilityState==='visible')void refresh();},60000);
  window.addEventListener('pageshow',()=>{if(pilot())void refresh();});
  const style=document.createElement('style');style.textContent='.nba-stage-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%}.nba-stage-actions:empty{display:none}.nba-stage-catchup{font-size:12px!important;min-width:0!important;padding:10px 14px!important}.nba-stage-history-label{color:#a6cbff;font-size:12px;margin-top:6px}.v2-match-card[data-sport=basketball] .v2-analysis-btn.stage-t15{background:linear-gradient(135deg,#d9c8ff,#9874ed)!important;color:#180c32!important;border-color:#c0a5ff!important;box-shadow:0 7px 18px rgba(132,91,223,.24)!important}.v2-match-card[data-sport=basketball] .v2-analysis-btn.stage-t2{background:linear-gradient(135deg,#c5e9ff,#52b7ed)!important;color:#062238!important}';document.head.appendChild(style);
  if(pilot())void refresh();
})();
