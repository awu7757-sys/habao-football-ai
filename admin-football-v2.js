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
const days=Number(document.getElementById("footballV2Days")?.value||30);
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
if(status)status.textContent="已更新｜"+(packet.count||0)+" 場影子紀錄、"+(packet.verified||0)+" 場已驗證｜"+new Date().toLocaleTimeString("zh-TW",{hour12:false});
}catch(e){
if(status)status.textContent="無法載入："+(e?.message||String(e));
if(!footballV2CompareData){
const holder=document.getElementById("footballV2Rows");
if(holder)holder.innerHTML='<tr><td colspan="7" class="empty">'+v2esc(e?.message||"尚未有影子數據")+'</td></tr>';
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
if(count)count.textContent="顯示 "+rows.length+"／"+(packet.count||0)+" 場｜有效統計僅限正式完賽與原始快照";
const body=document.getElementById("footballV2Rows");if(!body)return;
if(!rows.length){body.innerHTML='<tr><td colspan="7" class="empty">目前沒有符合條件的影子比較紀錄</td></tr>';return;}
body.innerHTML=rows.map(r=>{
 const score=r.resolved?v2esc(r.home_score+" : "+r.away_score):"待驗證";
 const renderMarket=k=>{
  const m=r.markets?.[k]||{};
  return '<div class="fvc-market"><div><small>V1</small> '+v2esc(v2pickLabel(k,m.v1_pick,m.v1_line))+
     ' <b>'+v2esc(v2resultLabel(m.v1_result))+'</b></div>'+
    '<div><small>V2</small> '+v2esc(v2pickLabel(k,m.v2_pick,m.v2_line))+
     ' <b>'+v2esc(v2resultLabel(m.v2_result))+'</b></div>'+
    (m.settlement_mismatch?'<div class="fvc-alert">原始推薦與正式結算不一致</div>':'')+
    (k==="over_under"&&!m.same_line&&m.v1_pick&&m.v2_pick?'<div class="fvc-sub">盤口不同，不列同場比較</div>':'')+
    '</div>';
 };
 return '<tr><td>'+v2esc(v2time(r.kickoff_at))+'</td>'+
 '<td><div class="fvc-league">'+v2esc(r.league_name)+'</div><strong>'+v2esc(r.home)+' vs '+v2esc(r.away)+'</strong><div class="fvc-sub">#'+v2esc(r.fixture_id)+'</div></td>'+
 '<td>'+score+'</td><td>'+renderMarket("moneyline")+'</td><td>'+renderMarket("over_under")+'</td><td>'+renderMarket("btts")+'</td>'+
 '<td><div>主 '+v2num(r.expected_home_goals,2)+'／客 '+v2num(r.expected_away_goals,2)+'</div>'+
 '<div class="fvc-sub">主勝 '+(r.home_win_probability==null?"—":v2pct(r.home_win_probability*100))+'，平 '+(r.draw_probability==null?"—":v2pct(r.draw_probability*100))+'</div>'+
 '<div class="fvc-sub">大球模型 EV '+(r.over_ev==null?"—":v2pct(r.over_ev*100))+'</div></td></tr>';
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