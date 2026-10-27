/* HABAO NBA V2 read-only comparison */
const NBA_V2_URL="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-nba-v2-compare";
let nbaV2Data=null;
// Research-only helper: show backend error.detail instead of generic compare_failed.
async function requestNbaV2Research(payload){
  const body={...payload};
  if(!adminSessionToken && adminPassword)body.admin_password=adminPassword;
  const r=await fetch(NBA_V2_URL,{method:"POST",headers:adminAuthHeaders(),body:JSON.stringify(body),cache:"no-store"});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data?.success===false){
    if(r.status===401&&adminSessionToken)clearAdminSession();
    const reason=[data?.error||("HTTP "+r.status),data?.detail].filter(Boolean).join("：");
    throw new Error(reason||"NBA 研究查詢失敗");
  }
  return data;
}
// 與 HABAO 管理後台既有球隊翻譯字典共用，確保所有 NBA 頁面隊名一致。
function nvTeamZh(name){
  const nameText=String(name??"").trim();
  return typeof zhTeam==="function"?zhTeam(nameText):(nameText||"—");
}
// 僅翻譯畫面標籤；影子模型與原始狀態仍保持不變。
function nvStatusZh(status){
  const code=String(status??"").trim().toLowerCase();
  const labels={
    ready:"已完成分析",
    not_collected:"尚未收集",
    insufficient_data:"資料不足",
    pending:"待處理",
    processing:"分析中",
    failed:"分析失敗",
    error:"分析異常",
    skipped:"已略過",
    complete:"已完成分析",
    completed:"已完成分析"
  };
  return labels[code]||String(status??"—");
}
function nvReasonZh(reason){
  const code=String(reason??"").trim().toLowerCase();
  const labels={
    insufficient_data:"歷史資料不足",
    missing_market:"缺少市場盤口",
    market_unavailable:"市場盤口不可用",
    not_collected:"尚未收集",
    model_error:"模型運算失敗",
    no_snapshot:"沒有正式快照",
    missing_snapshot:"缺少正式快照"
  };
  return labels[code]||String(reason??"");
}
function nvEscape(x){return String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}
function nvFmt(x){return x==null||!Number.isFinite(Number(x))?"—":Number(x).toFixed(1)}
function nvPct(x){return x==null||!Number.isFinite(Number(x))?"—":(100*Number(x)).toFixed(1)+"%"}
function nvResult(x){return ({win:"命中",loss:"未命中",half_win:"半贏",half_loss:"半輸",push:"走盤"})[x]||"—"}
function nvPick(key,p,line){if(!p)return"暫不推薦";const z=key==="moneyline"?(p==="home"?"主勝":"客勝"):key==="handicap"?(p==="home"?"主隊":"客隊"):(p==="over"?"大":"小");return z+(key==="moneyline"||line==null?"":" "+(key==="handicap"&&Number(line)>0?"+":"")+line)}
async function loadNbaV2Compare(force=false){
 const status=document.getElementById("nbaV2Status");if(!status)return;
 status.textContent="讀取 NBA 研究資料中…";
 try{
   nbaV2Data=await requestNbaV2Research({action:"compare",days:Number(document.getElementById("nbaV2Days")?.value??30)});
   status.textContent="V1 "+nbaV2Data.count+" 場｜V2 已建模 "+nbaV2Data.captured+" 場｜資料不足 "+nbaV2Data.insufficient+" 場｜尚未收集 "+nbaV2Data.not_collected+" 場";
   renderNbaV2Compare();
 }catch(e){status.textContent="研究資料尚未就緒："+String(e?.message||e);
   const t=document.getElementById("nbaV2Rows");if(t)t.textContent="確認 SQL 與 admin-nba-v2-compare 已部署";if(force)console.warn("NBA V2 compare",e);}
}
function renderNbaV2Compare(){
 if(!nbaV2Data)return;
 const names={moneyline:"獨贏",handicap:"讓分",over_under:"大小分"};
 const stats=document.getElementById("nbaV2Stats");
 if(stats)stats.innerHTML=Object.keys(names).map(k=>{
  const v=nbaV2Data.markets?.[k]||{};
  return '<div class="nv-stat"><b>'+names[k]+'</b><div class="nv-stat-line">V1 '+(v.paired_v1_rate??"—")+'%　 V2 '+(v.paired_v2_rate??"—")+'%</div><small>同場有效 '+(v.paired_count||0)+' 場｜各自有效 V1 '+(v.v1_count||0)+'／V2 '+(v.v2_count||0)+'</small></div>';
 }).join("");
 const term=String(document.getElementById("nbaV2Search")?.value||"").trim().toLowerCase();
 const rows=(nbaV2Data.rows||[]).filter(x=>!term||[x.game_id,x.home,x.away,nvTeamZh(x.home),nvTeamZh(x.away)].some(v=>String(v??"").toLowerCase().includes(term)));
 const count=document.getElementById("nbaV2Visible");if(count)count.textContent="顯示 "+rows.length+"／"+nbaV2Data.count+" 場｜V2 未經機率校準，僅用於研究比較";
 const holder=document.getElementById("nbaV2Rows");if(!holder)return;
 holder.innerHTML=rows.length?rows.map(r=>{
  const m=r.v2_model||{};
  const src=['moneyline','handicap','over_under'].map(k=>{
    const t=r.markets?.[k]||{};
    const label=(tag,p,line,out)=>'<div class="fvc-market-line"><span class="fvc-model-tag '+(tag==="V2"?"fvc-model-v2":"")+'">'+tag+'</span><strong>'+nvEscape(nvPick(k,p,line))+'</strong><span class="fvc-outcome">'+nvResult(out)+'</span></div>';
    const v2line=k==="handicap"&&t.v2_pick==="away"&&t.v2_line!=null?-t.v2_line:t.v2_line;
    return '<div class="fvc-market-card"><div class="fvc-market-title">'+names[k]+'</div>'+label("V1",t.v1_pick,t.v1_line,t.v1_result)+label("V2",t.v2_pick,v2line,t.v2_result)+(k!=="moneyline"&&t.v1_pick&&t.v2_pick&&!t.same_line?'<div class="nv-sub">盤口不同，不列同場統計</div>':"")+'</div>';
   }).join("");
  const metrics=m.expected_total==null?'<div class="nv-sub">無有效 V2 模型結果</div>':[['主隊預估得分',nvFmt(m.expected_home_points)],['客隊預估得分',nvFmt(m.expected_away_points)],['預估總分',nvFmt(m.expected_total)],['主勝機率',nvPct(m.home_win_probability)],['大分機率',nvPct(m.over_probability)]].map(v=>'<div class="fvc-metric"><span>'+v[0]+'</span><strong>'+v[1]+'</strong></div>').join("");
  let time="—";try{time=new Date(r.kickoff_at).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}catch{}
  return '<article class="fvc-game-card"><div class="fvc-game-top"><div class="fvc-game-detail"><div class="fvc-game-metadata"><span>'+nvEscape(time)+'</span><span>NBA 賽事編號 #'+nvEscape(r.game_id)+'</span><span>V2 '+nvEscape(nvStatusZh(r.v2_status))+(r.v2_reason?"："+nvEscape(nvReasonZh(r.v2_reason)):"")+'</span></div><div class="fvc-game-title">'+nvEscape(nvTeamZh(r.home))+' <span>對戰</span> '+nvEscape(nvTeamZh(r.away))+'</div></div><div class="fvc-score">'+(r.verified?nvEscape(r.home_score)+" : "+nvEscape(r.away_score):"待驗證")+'</div></div><div class="fvc-market-grid">'+src+'</div><div class="fvc-research"><div class="fvc-research-title">V2 貝氏得分分布模型 <span>研究專用</span></div><div class="fvc-metric-grid">'+metrics+'</div></div></article>';
 }).join(""):'<div class="fvc-empty">目前沒有符合條件的 NBA 賽事</div>';
}
