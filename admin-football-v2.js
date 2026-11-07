/* HABAO Football V1/V2 research-only admin compare. Requires admin.html session/auth helpers. */
const FOOTBALL_V2_ADMIN_API="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-football-v2-compare";
let footballV2CompareData=null;
let footballV2Loading=false;
const v2esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const v2num=(n,d=1)=>n==null||!Number.isFinite(Number(n))?"—":Number(n).toFixed(d);
const v2pct=(n)=>n==null||!Number.isFinite(Number(n))?"—":v2num(n,2)+"%";
const v2time=(v)=>{if(!v)return "—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})};
const v2marketNames={moneyline:"獨贏",over_under:"大小球",btts:"BTTS"};
const v2pickLabel=(market,pick,line)=>{if(!pick)return "未推薦";if(market==="moneyline")return ({home:"主勝",draw:"平局",away:"客勝"})[pick]||"—";
if(market==="btts")return pick==="yes"?"雙方進球：是":"雙方進球：否";
return (pick==="over"?"大 ":"小 ")+(line==null?"（未知線）":v2num(line,2).replace(/0+$/,"").replace(/\.$/,""));};
const v2resultLabel=(r)=>({win:"中",loss:"失",push:"走",half_win:"半贏",half_loss:"半輸"})[r]||"—";
function v2statCard(market,info){
const rate=info?.paired_v1_rate,rate2=info?.paired_v2_rate,n=info?.paired_count||0;
return '<div class="fvc-stat"><div class="fvc-stat-title">'+v2marketNames[market]+'</div>'+
 '<div class="fvc-paired">同場可比 <strong>'+n+'</strong> 筆</div>'+
 '<div class="fvc-compare"><span>V1 <b>'+v2pct(rate)+'</b></span><span>V2 <b>'+v2pct(rate2)+'</b></span></div>'+
 '<div class="fvc-sub">各自有效：V1 '+(info?.v1_count||0)+'筆／'+v2pct(info?.v1_rate)+' ｜ V2 '+(info?.v2_count||0)+'筆／'+v2pct(info?.v2_rate)+'</div>'+
 (market==="over_under"?'<div class="fvc-sub">盤口不同 '+(info?.different_line_count||0)+' 筆（不混算）</div>':'')+
 (info?.settlement_mismatch_count?'<div class="fvc-alert">結算不一致 '+info.settlement_mismatch_count+' 筆，已排除</div>':'')+
 '</div>'; }
async function loadFootballV2Compare(force=false){
if(footballV2Loading)return;
const status=document.getElementById("footballV2CompareStatus");
const days=Number(document.getElementById("footballV2Days")?.value??0);
const btn=document.getElementById("footballV2Reload");
footballV2Loading=true;if(btn)btn.disabled=true;
if(status)status.textContent="讀取研究數據中…";
try{
if(!adminSessionToken)throw Error("請先登入管理後台");
if(!canAccessAdminPage("footballV2ComparePage"))throw Error("沒有公開戰績查閱權限");
const response=await fetch(FOOTBALL_V2_ADMIN_API,{method:"POST",headers:adminAuthHeaders(),
body:JSON.stringify({action:"compare",days}),cache:"no-store",signal:AbortSignal.timeout(70000)});
const packet=await response.json().catch(()=>({}));
if(!response.ok||packet?.success!==true){
throw Error(response.status===404?"V2 比較後端尚未部署":(packet?.error||"HTTP "+response.status));
}
footballV2CompareData=packet;
renderFootballV2Compare();
if(status)status.textContent="已更新｜V1 "+(packet.count||0)+" 場、V2已收集 "+(packet.collected||0)+" 場、未收集 "+(packet.missing||0)+" 場（資料不足 "+(packet.insufficient||0)+" 場）、已驗證 "+(packet.verified||0)+" 場｜"+new Date().toLocaleTimeString("zh-TW",{hour12:false});
}catch(e){
if(status)status.textContent="無法載入："+(e?.message||String(e));
if(!footballV2CompareData){
const holder=document.getElementById("footballV2Rows");
if(holder)holder.innerHTML='<div class="fvc-empty">'+v2esc(e?.message||"尚未有影子數據")+'</div>';
}
}finally{footballV2Loading=false;if(btn)btn.disabled=false;}
}
function renderFootballV2Compare(){
  const packet=footballV2CompareData;if(!packet)return;
  const stats=document.getElementById("footballV2Stats");
  if(stats)stats.innerHTML=["moneyline","over_under","btts"].map(k=>v2statCard(k,packet.markets?.[k])).join("");
  const filter=String(document.getElementById("footballV2Search")?.value||"").trim().toLowerCase();
  const rows=(packet.rows||[]).filter(r=>!filter||[r.fixture_id,r.league_name,r.home,r.away].some(x=>String(x||"").toLowerCase().includes(filter)));
  const count=document.getElementById("footballV2Visible");
  if(count)count.textContent="符合 "+rows.length+"／"+(packet.count||0)+" 場（最多顯示120場）｜只計正式已驗證樣本";
  const holder=document.getElementById("footballV2Rows");if(!holder)return;
  if(!rows.length){
    holder.innerHTML='<div class="fvc-empty">目前沒有符合條件的影子比較紀錄</div>';
    return;
  }
  const probability=n=>n==null?"—":v2pct(Number(n)*100);
  const ratio=n=>n==null?"—":v2pct(Number(n)*100);
  holder.innerHTML=rows.slice(0,120).map(r=>{
    const score=r.resolved?v2esc(r.home_score+" : "+r.away_score):"待驗證";const v2Missing=r.v2_status!=="collected";const missingBadge=v2Missing?'<div class="fvc-no-data"><strong>'+v2esc(r.v2_status_label||"V2未收集")+'</strong> · '+v2esc(r.v2_status_detail||"")+'</div>':'';
    const renderMarket=k=>{
      const m=r.markets?.[k]||{};
      const flag=m.settlement_mismatch?'<p class="fvc-alert">原始推薦與結算不一致</p>':'';
      const diff=k==="over_under"&&!m.same_line&&m.v1_pick&&m.v2_pick?'<p class="fvc-alert fvc-info">盤口不同，不列同場比較</p>':'';
      const row=(label,pick,line,result)=>'<div class="fvc-market-line"><span class="fvc-model-tag '+(label==="V2"?"fvc-model-v2":"")+'">'+label+'</span>'+
        '<strong>'+v2esc(v2pickLabel(k,pick,line))+'</strong>'+
        '<span class="fvc-outcome '+(result==="win"||result==="half_win"?"fvc-outcome-good":result==="loss"||result==="half_loss"?"fvc-outcome-bad":"")+'">'+v2esc(v2resultLabel(result))+'</span></div>';
      return '<div class="fvc-market-card"><div class="fvc-market-title">'+v2esc(v2marketNames[k])+'</div>'+
        row("V1",m.v1_pick,m.v1_line,m.v1_result)+(v2Missing?'<div class="fvc-market-line"><span class="fvc-model-tag fvc-model-v2">V2</span><span class="fvc-unavailable">無賽前資料</span></div>':row("V2",m.v2_pick,m.v2_line,m.v2_result))+flag+diff+'</div>';
    };
    const metric=(label,value)=>'<div class="fvc-metric"><span>'+label+'</span><strong>'+v2esc(value)+'</strong></div>';
    return '<article class="fvc-game-card">'+
      '<div class="fvc-game-top"><div class="fvc-game-detail">'+
        '<div class="fvc-game-metadata"><span>'+v2esc(v2time(r.kickoff_at))+'</span><span>'+v2esc(r.league_name||"足球")+'</span><span>賽事 #'+v2esc(r.fixture_id)+'</span></div>'+
        '<div class="fvc-game-title">'+v2esc(r.home||"主隊")+' <span>vs</span> '+v2esc(r.away||"客隊")+'</div>'+missingBadge+'</div>'+
        '<div class="fvc-score '+(r.resolved?"fvc-score-complete":"")+'">'+score+'</div></div>'+
      '<div class="fvc-market-grid">'+["moneyline","over_under","btts"].map(renderMarket).join("")+'</div>'+
      '<div class="fvc-research"><div class="fvc-research-title">V2 數學研究指標 <span>未校準模型</span></div>'+
        '<div class="fvc-metric-grid">'+
          metric("主隊預估進球",v2num(r.expected_home_goals,2))+
          metric("客隊預估進球",v2num(r.expected_away_goals,2))+
          metric("主勝機率",probability(r.home_win_probability))+
          metric("平局機率",probability(r.draw_probability))+
          metric("大球預期報酬",ratio(r.over_ev))+
        '</div></div>'+
      '</article>';
  }).join("");
}
function resetFootballV2Compare(){footballV2CompareData=null;const s=document.getElementById("footballV2CompareStatus");if(s)s.textContent="尚未載入";}
window.addEventListener("DOMContentLoaded",()=>{
const originalSwitchPage=window.switchPage;if(typeof originalSwitchPage==="function")window.switchPage=function(pageId,...args){const result=originalSwitchPage.call(this,pageId,...args);if(pageId==="footballV2ComparePage"){ensureFootballV2StagePanel();loadFootballV2StageCompare(false);}return result;};
// Passive refresh while this admin-only page is open; no official AI jobs are triggered.
window.setInterval(()=>{
const page=document.getElementById("footballV2ComparePage");
if(page?.classList.contains("active")&&adminSessionToken){if(!footballV2Loading)loadFootballV2Compare(true);if(!footballV2StageLoading)loadFootballV2StageCompare(true);}
},300000);
});
function ensureFootballV2StagePanel(){
 const page=document.getElementById("footballV2ComparePage");if(!page)return null;
 let panel=document.getElementById("footballV2StagePanel");if(panel)return panel;
 panel=document.createElement("div");panel.className="panel";panel.id="footballV2StagePanel";panel.style.marginTop="16px";
 panel.innerHTML='<div class="panel-head"><div><div class="panel-title">V2 三階段影子比對</div><div class="panel-desc">同一批已完賽賽事，直接比較 T-10、T-2、T-15 分鐘的獨贏、大小球、讓分、BTTS。正式分析與公開戰績仍採 T-10。</div></div><select id="footballV2StageDays" class="input"><option value="30">近 30 天</option><option value="90" selected>近 90 天</option><option value="365">近 365 天</option><option value="0">全部</option></select><button class="ghost-btn" id="footballV2StageReload" type="button">更新比較</button></div><div id="footballV2StageStatus" class="page-desc" aria-live="polite">切換到本頁後自動載入</div><div id="footballV2StageMetrics" style="margin-top:12px"><div class="fvc-empty">尚未載入三階段研究結果</div></div><div id="footballV2StageCoverage" style="margin-top:14px"></div><div class="panel-head" style="margin-top:18px"><div><div class="panel-title">逐場結果</div><div class="panel-desc">查看每場在各階段選了哪一邊，以及賽後結果。</div></div></div><div id="footballV2StageRows"><div class="fvc-empty">尚未載入</div></div>';
 page.appendChild(panel);
 document.getElementById("footballV2StageDays")?.addEventListener("change",()=>loadFootballV2StageCompare(true));
 document.getElementById("footballV2StageReload")?.addEventListener("click",()=>loadFootballV2StageCompare(true));
 document.getElementById("footballV2Reload")?.addEventListener("click",()=>loadFootballV2StageCompare(true));
 return panel;
}
const FOOTBALL_V2_STAGE_API="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-football-v2-stage-compare";
let footballV2StageData=null,footballV2StageLoading=false;
const v2StageLabels={t10:"T-10 小時",t2:"T-2 小時",t15:"T-15 分鐘"};
function v2StageRate(x,unit="場"){return !x||!x.total?"尚無可計算資料":(Number(x.accuracy)*100).toFixed(1)+"%（命中 "+(x.correct||0)+"／有效 "+(x.total)+" "+unit+"）";}
async function loadFootballV2StageCompare(force=false){
 ensureFootballV2StagePanel();if(footballV2StageLoading)return;
 const status=document.getElementById("footballV2StageStatus"),days=Number(document.getElementById("footballV2StageDays")?.value??90);
 footballV2StageLoading=true;if(status)status.textContent="讀取三階段已驗證賽事…";
 try{
  if(!adminSessionToken)throw Error("請先登入管理後台");
  if(!canAccessAdminPage("footballV2ComparePage"))throw Error("沒有公開戰績查閱權限");
  const res=await fetch(FOOTBALL_V2_STAGE_API,{method:"POST",headers:adminAuthHeaders(),body:JSON.stringify({action:"compare",days}),cache:"no-store",signal:AbortSignal.timeout(70000)});
  const packet=await res.json().catch(()=>({}));if(!res.ok||packet?.success!==true)throw Error(packet?.error||"HTTP "+res.status);
  footballV2StageData=packet;renderFootballV2StageCompare();
  if(status)status.textContent="更新完成｜三階段配對賽事 "+(packet.paired_fixture_count||0)+" 場｜模型 "+(packet.model_version||"");
 }catch(e){if(status)status.textContent="無法載入："+(e?.message||String(e));if(!footballV2StageData){const el=document.getElementById("footballV2StageMetrics");if(el)el.innerHTML='<div class="fvc-empty">'+v2esc(e?.message||"尚未有比較資料")+'</div>';}}
 finally{footballV2StageLoading=false;}
}
function renderFootballV2StageCompare(){
 const p=footballV2StageData;if(!p)return;
 const stages=["t10","t2","t15"];
 const metricRows=[
  ["moneyline","獨贏","預測主勝／和局／客勝","場"],
  ["totals_market_line","大小球","按每場實際大小盤線逐條計算","盤線"],
  ["handicap_market_line","讓分","按每場實際讓分盤線逐條計算","盤線"],
  ["btts","BTTS","預測雙方是否都有進球","場"]
 ];
 const rows=metricRows.map(([key,label,desc,unit])=>{
  const info=p.metrics?.[key]||{};
  return '<tr><th>'+label+'<br><small>'+desc+(info.paired_fixture_count!=null?'｜三階段都有盤口 '+Number(info.paired_fixture_count)+' 場':'')+'</small></th>'+
   stages.map(s=>{const x=key==="totals_market_line"||key==="handicap_market_line"?info.by_stage?.[s]:info[s];return '<td>'+v2esc(v2StageRate(x,unit))+'</td>';}).join("")+'</tr>';
 });
 const m=document.getElementById("footballV2StageMetrics");
 if(m)m.innerHTML='<div style="overflow-x:auto"><table class="data-table" style="min-width:760px;width:100%"><thead><tr><th>比較項目</th><th>T-10 小時</th><th>T-2 小時</th><th>T-15 分鐘</th></tr></thead><tbody>'+rows.join("")+'</tbody></table></div><p class="page-desc" style="margin-top:10px">看法：百分比是命中率；獨贏、BTTS 括號內是「命中場數／有效場數」，大小球、讓分則是「命中盤線／有效盤線」。大小球與讓分依每場當時實際盤口逐條結算，不同賽事的盤線可以不同。缺少盤口或走盤不算命中，也不算失誤。'+v2esc(p.note||"")+'</p>';
 const c=document.getElementById("footballV2StageCoverage");
 if(c)c.innerHTML='<details><summary style="cursor:pointer">展開快照與資料狀況</summary><div style="overflow-x:auto;margin-top:10px"><table class="data-table" style="min-width:660px;width:100%"><thead><tr><th>階段</th><th>快照筆數</th><th>排程檢查</th><th>平均擷取時間</th><th>配對且已驗證</th></tr></thead><tbody>'+
  stages.map(s=>{const x=p.stages?.[s]||{},lead=x.average_minutes_before_kickoff==null?"—":Number(x.average_minutes_before_kickoff).toFixed(1)+" 分鐘前",statusLabel={ready:"資料就緒",already_ready:"已完成",failed:"失敗",pending:"等待中",skipped:"略過"},states=Object.entries(x.audit_statuses||{}).map(([k,v])=>(statusLabel[k]||k)+" "+v+" 筆").join("、")||"—";return '<tr><th>'+v2StageLabels[s]+'</th><td>'+Number(x.snapshots||0)+'</td><td>'+Number(x.audit_rows||0)+'<br><small>'+v2esc(states)+'</small></td><td>'+v2esc(lead)+'</td><td>'+Number(x.paired_verified||0)+'</td></tr>';}).join("")+
  '</tbody></table></div><p class="page-desc" style="margin-top:10px">期間內已驗證賽果 '+Number(p.verified_result_fixtures||0)+(p.truncated?"｜資料超過讀取上限，請縮小期間。":"")+'｜這個比對只讀資料，不會呼叫足球 API。</p></details>';
 const host=document.getElementById("footballV2StageRows");if(!host)return;
 const list=Array.isArray(p.paired_rows)?p.paired_rows:[];
 if(!list.length){host.innerHTML='<div class="fvc-empty">目前沒有同時具備三階段快照及已驗證賽果的賽事。</div>';return;}
 const pickLabel=(pick,kind)=>kind==="moneyline"?({home:"主勝",draw:"和局",away:"客勝"})[pick]||"—":kind==="btts"?(pick==="yes"?"雙方都有進球":"只有一方或都沒進球"):kind==="total"?(pick==="over"?"大":"小"):kind==="handicap"?(pick==="home"?"主隊":"客隊"):"—";
 const outcomeLabel=(hit,result)=>result==="win"?"命中":result==="loss"?"未中":result==="half_win"?"半贏":result==="half_loss"?"半輸":result==="push"?"走盤":hit===true?"命中":hit===false?"未中":"資料不足";
 const numLabel=n=>Number(n).toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
 const lineItems=(items,kind)=>{
  if(!Array.isArray(items)||!items.length)return "該階段無盤口";
  return items.map(y=>{
   let line,pick;
   if(kind==="total"){line=(y.pick==="over"?"大 ":"小 ")+numLabel(y.line);pick=line;}
   else{const chosenLine=y.pick==="home"?y.home_line:y.away_line,side=y.pick==="home"?"主隊":"客隊";pick=side+" "+(Number(chosenLine)>0?"+":"")+numLabel(chosenLine);}
   return v2esc(pick)+"："+outcomeLabel(y.hit,y.result);
  }).join("<br>");
 };
 const stageSummary=x=>{
  const totalRows=x.market?.totals||[],handicapRows=x.market?.handicaps||[];
  const cells=[
   ["獨贏",pickLabel(x.moneyline_pick,"moneyline"),outcomeLabel(x.moneyline_hit,null)],
   ["大小球",lineItems(totalRows,"total"),""],
   ["讓分",lineItems(handicapRows,"handicap"),""],
   ["BTTS",pickLabel(x.btts_pick,"btts"),outcomeLabel(x.btts_hit,null)]
  ];
  return '<div style="min-width:245px;line-height:1.9">'+cells.map(a=>'<div><strong>'+v2esc(a[0])+'：</strong>'+a[1]+(a[2]?'｜'+a[2]:"")+'</div>').join("")+'</div>';
 };
 host.innerHTML='<div style="overflow-x:auto"><table class="data-table" style="min-width:1020px;width:100%"><thead><tr><th>賽事 ID</th><th>實際比分</th>'+stages.map(s=>'<th>'+v2StageLabels[s]+'</th>').join("")+'</tr></thead><tbody>'+
  list.slice(0,150).map(r=>'<tr><td>'+v2esc(r.fixture_id)+'</td><td>'+v2esc(r.home_score+" : "+r.away_score)+'</td>'+stages.map(s=>'<td>'+stageSummary(r.predictions?.[s]||{})+'</td>').join("")+'</tr>').join("")+
  '</tbody></table></div><p class="page-desc" style="margin-top:8px">最多列出 150 場。每階段使用該場當時保存的市場線；缺盤會明確顯示，走盤不列入命中率。</p>';
}
