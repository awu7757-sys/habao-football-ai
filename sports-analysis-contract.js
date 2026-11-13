/* Display adapter only: saved JSON and recommendation policy are never rewritten. */
(()=>{'use strict';const C=window.HabaoStageCore,e=C.esc;
 const status={not_available:'資料未取得',not_collected_at_this_stage:'本階段未取得資料',source_unavailable:'來源暫不可用',collection_failed:'來源擷取失敗',no_rows_returned:'來源未列出資料',data_returned:'已取得資料',partial:'部分資料已取得',expected:'預估名單，尚未確認',confirmed:'已確認',partial_confirmed:'部分球隊已確認',not_published:'來源尚未公布',available:'已取得資料'};
 const time=x=>Number.isFinite(Date.parse(x||''))?new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'時間未提供';
 const label=x=>status[String(x)]||'資料待確認';
 function display(raw){const r=JSON.parse(JSON.stringify(raw)),f=r.fixture||{};r.fixture={...f,home:{...f.home,logo:C.teamLogo(f.home,C.sport(raw)),name_zh:f.home?.name_zh||(C.sport(raw)==='baseball'?C.mlbNames[f.home?.name]:undefined)},away:{...f.away,logo:C.teamLogo(f.away,C.sport(raw)),name_zh:f.away?.name_zh||(C.sport(raw)==='baseball'?C.mlbNames[f.away?.name]:undefined)},date:f.date||f.kickoff_at,league:f.league||(C.sport(r)==='baseball'?'MLB':'')};for(const key of ['moneyline','handicap','over_under']){const v=C.pickView(raw,key);r.analysis.recommendations[key]={...r.analysis.recommendations[key],pick:v.pick,line:v.line,confidence:v.confidence};}return r;}
 function evidence(raw){
  const sp=C.sport(raw),s=C.stage(raw),v=raw.analysis?.v2_stage_evidence||raw.player_evidence||null;
  let injury=v?.availability,lineups=v?.lineups,adjust=v?.player_adjustment||raw.model?.player_context_adjustment;
  if(!v&&sp==='basketball'&&raw.market_data?.injuries){const x=raw.market_data.injuries;injury={...x,status:x.available?'data_returned':'not_available',items:['home','away'].flatMap(side=>(x[side]?.players||[]).map(p=>({side,name:p.player||p.name,status:p.status,reason:p.comment||p.description||p.status})))};}
  if(!v&&sp==='baseball'&&raw.data?.home_starter){lineups={status:'expected',teams:[{side:'home',starters:[raw.data.home_starter]},{side:'away',starters:[raw.data.away_starter]}]};}
  const itemName=p=>p.name||p.player_name||p.player?.name||p.person?.fullName||p.fullName||'';
  const injuryItems=injury?.items||[],teams=lineups?.teams||[];
  const injuryRows=injuryItems.map(p=>{const n=itemName(p);return n?e(n)+(p.reason||p.type||p.status?'（'+e(p.reason||p.type||p.status)+'）':''):'';}).filter(Boolean);
  const teamRows=teams.map(t=>{const players=t.starters||t.startXI||t.batting_order||[];return e(t.side==='home'?'主隊':t.side==='away'?'客隊':t.team?.name||t.team_name||'球隊')+'：'+e(label(t.status||lineups.status))+(players.length?'｜'+players.map(p=>e(itemName(p))).filter(Boolean).join('、'):'');});
  const applied=adjust?.status==='applied'||adjust?.status==='partial'||adjust?.model_adjustment_applied===true||injury?.model_adjustment_applied===true||lineups?.model_adjustment_applied===true;
  const adjustmentText=applied?'本階段已依可驗證的球員資料評估修正；實際影響依封存模型記錄。':'本階段未記錄可確認的球員分數修正，依封存的模型結果顯示。';
  const lineStatus=lineups?.status==='data_returned'?(sp==='baseball'?'雙方打線已公布':'雙方先發已確認'):label(lineups?.status||'not_available');
  const probable=lineups?.probable_pitchers;const pitcherRows=probable?['home','away'].map(side=>probable[side]?'<p>'+e(side==='home'?'主隊預估先發投手：':'客隊預估先發投手：')+e(probable[side].name)+'（尚未確認）</p>':'').join(''):'';
  const sourceName=x=>({'api_football_injuries':'API-Football 傷停名單','api_football_fixtures':'API-Football 先發名單','nba-official':'NBA 官方傷停報告','NBA':'NBA 官方先發名單','ESPN':'ESPN 賽事情報','mlb_official_dated_full_roster':'MLB 官方傷兵名單','mlb_official_game_feed':'MLB 官方賽事名單'}[x]||x);
  const source=[injury?.source?'傷停來源：'+sourceName(injury.source):'',lineups?.source?'先發來源：'+sourceName(lineups.source):'',injury?.fetched_at||injury?.captured_at?'傷停讀取 '+time(injury.fetched_at||injury.captured_at):'',lineups?.fetched_at||lineups?.captured_at?'先發讀取 '+time(lineups.fetched_at||lineups.captured_at):''].filter(Boolean).join('｜');
  return '<section class="habao-stage-evidence" data-stage="'+s+'"><strong>本階段資料狀態</strong><p>傷停：'+e(label(injury?.status))+'；先發：'+e(lineStatus)+'。</p><p>'+adjustmentText+(adjust?.reason?' '+e(adjust.reason):'')+'</p>'+pitcherRows+(injuryRows.length||teamRows.length?'<details><summary>查看傷停與先發名單</summary><p>'+injuryRows.join('、')+'</p>'+teamRows.map(t=>'<p>'+t+'</p>').join('')+'</details>':'')+(source?'<p class="source">'+e(source)+'（台灣時間）</p>':'')+'</section>';
 }
 function heading(raw){return C.sportNames[C.sport(raw)]+' '+C.labels[C.stage(raw)];}
 function badge(raw){const s=C.stage(raw),at=raw.stage_capture?.captured_at||raw.analysis?.v2_stage_evidence?.captured_at||raw.snapshot?.captured_at||raw.generated_at||raw.as_of;const late=raw.stage_capture?.capture_mode==='late_pre_match_recovery';return '<div class="habao-stage-badge" data-stage="'+s+'">階段快照 · '+e(time(at))+' 封存'+(late?' · 賽前補抓':'')+'</div>';}
 window.HabaoAnalysisContract={display,evidence,heading,badge};
})();
