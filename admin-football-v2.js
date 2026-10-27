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
// Passive refresh while this admin-only page is open; no official AI jobs are triggered.
window.setInterval(()=>{
const page=document.getElementById("footballV2ComparePage");
if(page?.classList.contains("active")&&adminSessionToken&&!footballV2Loading)loadFootballV2Compare(true);
},300000);
});