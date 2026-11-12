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
  const running=()=>typeof habaoSportBatchRunning!=='undefined'&&habaoSportBatchRunning;
  const phase=(kickoff,now=Date.now())=>{
    const m=(Date.parse(kickoff)-now)/60000;
    return !Number.isFinite(m)||m<=0||m>600?null:m<=15?'t15':m<=120?'t2':'t10';
  };
  const openingTime=(kickoff,stage)=>new Date(Date.parse(kickoff)-(stage==='t2'?120:15)*60000).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});
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
    if(minutes>120)return claimed.t10?{stage:'t2',label:'深度分析・'+openingTime(kickoff,'t2')+' 開放',disabled:true,status:'已領取 T-10・等待 T-2'}:{stage:'t10',label:'開始分析',disabled:false,status:'T-10 可分析'};
    if(minutes>15)return claimed.t2?{stage:'t15',label:'最終分析・'+openingTime(kickoff,'t15')+' 開放',disabled:true,status:'已領取 T-2・等待 T-15'}:{stage:'t2',label:'深度分析',disabled:false,status:'T-2 可分析'};
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
    button.classList.toggle('nba-stage-waiting',d.disabled&&d.stage!==null);
    button.onclick=d.disabled?null:()=>d.stage==='t10'?openBasketballMatch(Number(id),button):claim(Number(id),d.stage,button);
    if(status){status.textContent=d.status;status.classList.toggle('ready',!d.disabled);status.classList.toggle('locked',d.disabled);status.classList.toggle('nba-stage-waiting-status',d.disabled&&d.stage!==null);status.dataset.nbaStage=d.stage||'';}
    const minutes=(Date.parse(match.kickoff_at)-Date.now())/60000;
    // Pin the billed stage at selection time. Crossing a boundary requires reselecting.
    const batch=card.querySelector('.v2-batch-select span'),input=card.querySelector('.batch-analysis-checkbox'),current=phase(match.kickoff_at);
    if(input&&!running()){
      if(input.checked&&input.dataset.nbaStage&&input.dataset.nbaStage!==current){input.checked=false;if(typeof updateBatchSelection==='function')updateBatchSelection();}
      input.dataset.nbaStage=current||'';input.disabled=!current;
    }
    if(batch)batch.textContent=current?(state.claimed?.[current]===true?'重看 '+current.toUpperCase().replace('T','T-')+' 分析':'加入 '+current.toUpperCase().replace('T','T-')+' 批次分析'):'分析已截止';
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
  async function loadStage(id,stage,expectedAccount){
    if(!pilot()||!Number.isSafeInteger(id)||id<=0||!['t2','t15'].includes(stage))throw Error('無效的 NBA 階段分析');
    const active=account();if(expectedAccount&&active!==expectedAccount)throw Error('帳號已變更，請重新選取分析');
    const p=await request({action:'claim',account:active,game_id:id,stage},90000),result=p.result;
    if(account()!==active)throw Error('帳號已變更，請重新讀取');
    if(!result||result.success!==true||Number(result.game_id)!==id||result.v2_stage!==stage||result.sport!=='basketball'||!result.analysis)throw Error('階段分析回傳不完整');
    const access=p.member_access,m=member();
    if(access&&access.analysis_unlimited!==true){for(const [key,field]of [['paid_remaining','analysis_credits'],['daily_free_remaining','daily_free_credits']]){const value=access[key];if(value!=null&&typeof value!=='boolean'&&String(value).trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=0)m[field]=Number(value);}sessionStorage.setItem('habao_member',JSON.stringify(m));}
    states[String(id)]={...states[String(id)],claimed:{...states[String(id)]?.claimed,[stage]:true}};
    return p;
  }
  function batchSpec(input){
    const id=Number(input.value),stage=input.dataset.nbaStage,current=phase(input.dataset.kickoffAt);
    if(!pilot()||!enabled||unavailable||owner!==account())throw Error('階段狀態尚未就緒，請重新整理賽事');
    if(!Number.isSafeInteger(id)||id<=0||!current||stage!==current)throw Error('分析階段已更新，請重新勾選賽事');
    return {game_id:id,stage,kickoff_at:input.dataset.kickoffAt,account:account()};
  }
  async function claimForBatch(spec){
    if(account()!==spec.account||phase(spec.kickoff_at)!==spec.stage)throw Error('分析階段或帳號已更新，請重新勾選賽事');
    if(!['t2','t15'].includes(spec.stage))throw Error('無效的階段批次請求');
    const id=Number(spec.game_id);if(pending.has(id)||typeof habaoNbaPendingGames!=='undefined'&&habaoNbaPendingGames.has(id))throw Error('這場分析正在處理中');
    pending.add(id);if(typeof habaoNbaPendingGames!=='undefined')habaoNbaPendingGames.add(id);
    try{return await loadStage(id,spec.stage,spec.account);}finally{pending.delete(id);if(typeof habaoNbaPendingGames!=='undefined')habaoNbaPendingGames.delete(id);}
  }
  async function claim(id,stage,button){
    if(!pilot()||!['t2','t15'].includes(stage)||pending.has(id))return;
    if(typeof habaoSportBatchRunning!=='undefined'&&habaoSportBatchRunning){alert('批次分析執行中，請等完成後再領取階段分析。');return;}
    const active=account(),old=button?.textContent||'';
    if(typeof habaoNbaPendingGames!=='undefined'&&habaoNbaPendingGames.has(id))return;
    pending.add(id);if(typeof habaoNbaPendingGames!=='undefined')habaoNbaPendingGames.add(id);
    if(button){button.disabled=true;button.textContent='讀取'+(stage==='t2'?'深度':'最終')+'分析…';button.classList.add('loading');}
    try{
      const p=await loadStage(id,stage,active),result=p.result;
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
  function historyGameId(row){
    const candidates=[row?.game_id,row?.fixture_id,row?.result_data?.game_id,row?.result_data?.fixture?.game_id,row?.result_data?.fixture?.id];
    const ids=[];for(const value of candidates){if(value==null)continue;const m=String(value).match(/^(?:nba:)?([1-9]\d*)$/);if(m&&Number.isSafeInteger(Number(m[1])))ids.push(Number(m[1]));}
    const unique=[...new Set(ids)];return unique.length===1?unique[0]:null;
  }
  function groupHistory(rows){
    if(!Array.isArray(rows)||!pilot())return rows;
    const groups=new Map(),ordered=[];
    const records=rows.flatMap(row=>row?.nba_history_stages?Object.values(row.nba_history_stages):[row]);
    for(const row of records){
      const id=String(row?.sport||'').toLowerCase()==='basketball'?historyGameId(row):null;
      const stage=row?.v2_stage||row?.result_data?.v2_stage||'t10';
      if(id===null||!['t10','t2','t15'].includes(stage)||!row?.result_data){ordered.push(row);continue;}
      if(!groups.has(id)){const group={id,stages:{},first:row};groups.set(id,group);ordered.push(group);}
      const group=groups.get(id),old=group.stages[stage];
      const date=x=>{const t=Date.parse(x?.v2_stage_claimed_at||x?.claimed_at||x?.updated_at||'');return Number.isFinite(t)?t:0;};
      if(!old||date(row)>date(old))group.stages[stage]=row;
    }
    return ordered.map(value=>{
      if(!value.stages||!value.first)return value;
      const latest=['t15','t2','t10'].find(stage=>value.stages[stage]);
      // Only group the presentation. Each original result and history key remains intact.
      return {...value.first,...value.stages[latest],game_id:value.id,nba_history_stages:{...value.stages},nba_history_latest:latest};
    });
  }
  window.habaoNbaStages={refresh,claim,history,decision,phase,batchSpec,claimForBatch,historyGameId,groupHistory,isPilot:pilot,reconcile:()=>matches.forEach((_,id)=>render(id))};
  window.setInterval(()=>{if(pilot()&&enabled)matches.forEach((_,id)=>render(id));},10000);
  window.setInterval(()=>{if(pilot()&&document.querySelector('[data-basketball-fixture-id]')&&document.visibilityState==='visible')void refresh();},60000);
  window.addEventListener('pageshow',()=>{if(pilot())void refresh();});
  const style=document.createElement('style');style.textContent='.nba-stage-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%}.nba-stage-actions:empty{display:none}.nba-stage-catchup{font-size:12px!important;min-width:0!important;padding:10px 14px!important}.nba-stage-history-label{color:#a6cbff;font-size:12px;margin-top:6px}.v2-match-card[data-sport=basketball] .v2-analysis-btn.stage-t15{background:linear-gradient(135deg,#d9c8ff,#9874ed)!important;color:#180c32!important;border-color:#c0a5ff!important;box-shadow:0 7px 18px rgba(132,91,223,.24)!important}.v2-match-card[data-sport=basketball] .v2-analysis-btn.stage-t2{background:linear-gradient(135deg,#c5e9ff,#52b7ed)!important;color:#062238!important}.v2-match-card[data-sport=basketball] .v2-analysis-btn.nba-stage-waiting{opacity:.58!important;box-shadow:none!important;cursor:not-allowed}.v2-match-card[data-sport=basketball] .ai-status.nba-stage-waiting-status{color:#a3afbc!important}.v2-match-card[data-sport=basketball] .ai-status.ready[data-nba-stage=t2]{color:#8bd4ff!important}.v2-match-card[data-sport=basketball] .ai-status.ready[data-nba-stage=t15]{color:#bea2ff!important}.v2-match-card[data-sport=basketball] .analysis-btn.loading::before{content:"";position:static;display:inline-block;width:12px;height:12px;background:transparent;box-shadow:none;transition:none;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;margin-right:7px;vertical-align:-2px;animation:nba-stage-spin .8s linear infinite}.history-match-card[data-nba-history-stage=t2] .history-league{color:#8bd4ff}.history-match-card[data-nba-history-stage=t15] .history-league{color:#bea2ff}.history-match-card[data-nba-history-stage=t2] .history-view-btn{background:linear-gradient(135deg,#c5e9ff,#52b7ed);color:#062238}.history-match-card[data-nba-history-stage=t15] .history-view-btn{background:linear-gradient(135deg,#d9c8ff,#9874ed);color:#180c32}.nba-history-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:0 16px 10px}.nba-history-stage{min-width:0;border:1px solid #65542b;border-radius:11px;padding:12px 6px;background:#edbe48;color:#1c1b15;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.nba-history-stage[data-stage=t2]{background:#8fd4fa;border-color:#6cb9df;color:#092b40}.nba-history-stage[data-stage=t15]{background:#bda0f2;border-color:#9f83d7;color:#251139}.nba-history-stage:disabled{background:#162432;color:#7d8a99;border-color:#30404e;cursor:not-allowed}.nba-history-stage small{display:block;font-size:10px;font-weight:500;margin-top:4px;opacity:.85}.nba-history-hint{padding:0 17px 14px;font-size:11px;color:#9eadbd}.history-team .nba-history-logo{width:54px;height:54px;margin:0 auto 11px}.history-team .nba-history-logo img{width:54px;height:54px;margin:0;padding:7px}.nba-history-count{font-size:10px;font-weight:500;color:#a9b9c7}@media(max-width:480px){.nba-history-stages{gap:6px;padding:0 12px 9px}.nba-history-stage{font-size:11px;padding:11px 3px}.nba-history-stage small{font-size:9px}}@keyframes nba-stage-spin{to{transform:rotate(360deg)}}';document.head.appendChild(style);
  if(pilot())void refresh();
})();
