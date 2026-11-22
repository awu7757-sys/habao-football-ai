/* HABAO NBA 推薦規則比較（舊規則／新規則 V3／挑戰規則）— 2026-11-22 取代 V1／V2 比較。只讀。 */
const NR_COMPARE_URL="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-nba-v2-compare";
let nrDetailLimit=30,nrCompare=null,nrErrors={},nrLoading=false,nrRequestSerial=0,nrRequestController=null;
const nrMarkets={handicap:"讓分",over_under:"大小分",moneyline:"獨贏"};
const nrStages={t10:"T-10",t2:"T-2",t15:"T-15"};
const nrCodeLabels={underdog_pick:"冷門方向",favorite_unknown:"無法判斷熱門",conflict_with_t10:"與 T-10 相反",t10_not_qualified:"T-10 未推薦",edge_too_large:"差距過大",gap_unknown:"缺少總分",low_confidence:"信心不足",challenger_gap:"差距 ≥3"};
function nrEsc(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function nrTeam(n){return typeof zhTeam==="function"?zhTeam(n):String(n??"—");}
function nrDate(d){const x=Date.parse(String(d||""));return Number.isFinite(x)?new Date(x).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):"—";}
function nrIsPick(p){const x=String(p??"").trim();return x!==""&&x!=="暫不推薦";}
async function nrFetch(url,payload,signal){
 const req={...payload};
 if(!adminSessionToken&&adminPassword)req.admin_password=adminPassword;
 const response=await fetch(url,{method:"POST",headers:adminAuthHeaders(),body:JSON.stringify(req),cache:"no-store",signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok||data?.success!==true||!Array.isArray(data?.rows)||!data?.stats||typeof data.stats!=="object"){
  if(response.status===401&&adminSessionToken)clearAdminSession();
  throw Error([data?.error||(response.ok?"比較 API 回傳格式不完整":"HTTP "+response.status),data?.detail].filter(Boolean).join("："));
 }
 return data;
}
async function loadNbaResearch(){
 const msg=document.getElementById("nrStatus");if(!msg)return;
 const serial=++nrRequestSerial;
 nrRequestController?.abort();
 const controller=new AbortController();nrRequestController=controller;
 const timeout=setTimeout(()=>controller.abort(),60000);
 nrLoading=true;msg.textContent="正在取得 NBA 規則比較資料…";
 const refresh=document.getElementById("nrRefresh");if(refresh)refresh.disabled=true;
 const days=Number(document.getElementById("nrDays")?.value||30);
 let result;
 try{result=await nrFetch(NR_COMPARE_URL,{action:"compare",days},controller.signal);}
 catch(error){if(serial!==nrRequestSerial)return;nrCompare=null;nrErrors={compare:controller.signal.aborted?"讀取逾時，請重試":String(error?.message||error)};nrLoading=false;if(refresh)refresh.disabled=false;renderNbaResearch();return;}
 finally{clearTimeout(timeout);}
 if(serial!==nrRequestSerial)return;
 nrErrors={};nrCompare=result;nrLoading=false;if(refresh)refresh.disabled=false;
 renderNbaResearch();
}
function nrSel(id){return document.getElementById(id)?.value||(id==="nrFilter"?"blocked":"all");}
function nrCell(s,na){
 if(na||!s)return '<div class="nr3-cell nr3-na"><strong>—</strong><small>不適用</small></div>';
 const rate=s.rate==null?"—":Number(s.rate).toFixed(1)+"%";
 const w=(s.win||0)+(s.half_win||0),l=(s.loss||0)+(s.half_loss||0);
 return '<div class="nr3-cell"><strong>'+rate+'</strong><small>'+w+' 勝 '+l+' 負'+(s.push?' '+s.push+' 走':'')+'（'+(s.picks||0)+' 筆）</small></div>';
}
function nrBlocked(s){return s?'<span>'+((s.blocked_win||0)+(s.blocked_loss||0))+' 筆<br><small class="nr3-dim">原本 '+(s.blocked_win||0)+' 贏 '+(s.blocked_loss||0)+' 輸</small></span>':'—';}
function nrTable(phase){
 const st=nrCompare?.stats?.[phase];if(!st)return '<div class="nr-empty">無法統計</div>';
 const fs=nrSel("nrStage"),fm=nrSel("nrMarket");
 const head='<div class="nr3-head"><span>階段</span><span>玩法</span><span>舊規則</span><span>新規則</span><span>挑戰規則</span><span>被新規則擋下</span></div>';
 const rows=[];
 for(const s of Object.keys(nrStages))for(const m of Object.keys(nrMarkets)){
  if((fs!=="all"&&fs!==s)||(fm!=="all"&&fm!==m))continue;
  const b=st[s]?.[m];if(!b)continue;
  rows.push('<div class="nr3-row"><strong>'+nrStages[s]+'</strong><span>'+nrMarkets[m]+'</span>'+nrCell(b.old)+nrCell(b.new)+nrCell(b.challenger,!b.challenger)+nrBlocked(b.new)+'</div>');
 }
 const total=Object.values(st).reduce((n,x)=>n+Object.values(x).reduce((k,y)=>k+(y?.old?.picks||0),0),0);
 if(!total)return head+'<div class="nr-empty">'+(phase==="live"?"新規則上線後還沒有已完賽的比賽":"這段期間沒有可回測的已完賽推薦")+'</div>';
 return head+rows.join("");
}
function nrSummary(){
 const el=document.getElementById("nrSummary");if(!el)return;
 const c=nrCompare?.counts||{},from=nrCompare?.rules?.from;
 const vals=[
  ["T-10 快照",c.t10_snapshots??"—","已完賽 "+(c.verified_games??"—")+" 場（公開戰績來源）"],
  ["T-2／T-15 快照",c.stage_scheduled??"—","準時封存；補抓 "+(c.stage_late??"—")+" 筆另計、不列入"],
  ["新規則啟用",from?nrDate(from):"—","之後開賽的比賽才套用；無法回算 "+(c.not_comparable??0)+" 筆"]
 ];
 el.innerHTML=vals.map(v=>'<div class="nr-summary-tile"><div>'+v[0]+'</div><strong>'+nrEsc(v[1])+'</strong><small>'+nrEsc(v[2])+'</small></div>').join("");
}
function nrPickText(r,market){
 if(!r||!nrIsPick(r.pick))return '<span class="nr3-dim">暫不推薦</span>';
 const ln=r.line==null||market==="moneyline"?"":" "+(market==="handicap"&&Number(r.line)>0?"+":"")+r.line;
 return nrEsc(r.pick+ln);
}
function nrResult(r){return ({win:'<b class="nr3-win">贏</b>',half_win:'<b class="nr3-win">贏半</b>',loss:'<b class="nr3-loss">輸</b>',half_loss:'<b class="nr3-loss">輸半</b>',push:'<b class="nr3-push">走水</b>'})[r?.result]||"";}
function nrRuleCell(r,market,oldPick){
 if(!r)return '<span class="nr3-dim">—</span>';
 if(nrIsPick(oldPick)&&!nrIsPick(r.pick))return '<span class="nr3-block">擋下｜'+nrEsc(nrCodeLabels[r.code]||r.code||"暫不推薦")+'</span>';
 return nrPickText(r,market)+' '+nrResult(r);
}
function nrDetail(){
 const fs=nrSel("nrStage"),fm=nrSel("nrMarket"),ff=nrSel("nrFilter");
 const search=String(document.getElementById("nrSearch")?.value||"").trim().toLowerCase();
 const out=[];
 for(const g of (nrCompare?.rows||[])){
  if(search&&![g.game_id,g.home,g.away,nrTeam(g.home),nrTeam(g.away)].some(x=>String(x??"").toLowerCase().includes(search)))continue;
  if(ff==="verified"&&!g.verified)continue;
  for(const it of (g.items||[])){
   if((fs!=="all"&&fs!==it.stage)||(fm!=="all"&&fm!==it.market))continue;
   if(!nrIsPick(it.old?.pick))continue;
   const blocked=!nrIsPick(it.new?.pick)||(it.challenger&&!nrIsPick(it.challenger.pick));
   if(ff==="blocked"&&!blocked)continue;
   const tags=[g.phase==="live"?"上線後":"回測",it.capture_mode&&it.capture_mode!=="scheduled"?"補抓":null,it.comparable===false?"無法回算":null].filter(Boolean).join("｜");
   out.push('<div class="nr3-item"><span>'+nrDate(g.kickoff_at)+'<br><small class="nr3-dim">'+nrEsc(tags)+'</small></span><span>'+nrEsc(nrTeam(g.home))+' vs '+nrEsc(nrTeam(g.away))+(g.verified?'<br><small class="nr3-dim">'+g.home_score+'－'+g.away_score+'</small>':'')+'</span><span>'+nrStages[it.stage]+'</span><span>'+nrMarkets[it.market]+'</span><span>'+nrPickText(it.old,it.market)+' '+nrResult(it.old)+'</span><span>'+nrRuleCell(it.new,it.market,it.old?.pick)+'</span><span>'+nrRuleCell(it.challenger,it.market,it.old?.pick)+'</span></div>');
  }
 }
 return out;
}
function renderNbaResearch(){
 const msg=document.getElementById("nrStatus"),c=nrCompare||{};
 if(msg)msg.textContent=nrErrors.compare?"比較資料異常："+nrErrors.compare:(nrCompare?"已更新｜T-10 "+(c.counts?.t10_snapshots??c.count??"—")+" 場｜規則 "+(c.rules?.version||"—"):"尚未載入");
 nrSummary();
 const live=document.getElementById("nrLiveTable"),back=document.getElementById("nrSimpleTable");
 if(nrErrors.compare){
  const fail='<div class="nr-empty">比較資料讀取失敗，暫時無法統計。</div>';
  if(live)live.innerHTML=fail;if(back)back.innerHTML=fail;
  const rows=document.getElementById("nrRows");if(rows)rows.innerHTML='<div class="nr-empty">比較資料讀取失敗，請按「更新」重試。</div>';
  const vis=document.getElementById("nrVisible");if(vis)vis.textContent="";
  return;
 }
 if(live)live.innerHTML=nrTable("live");
 if(back)back.innerHTML=nrTable("backtest");
 const list=nrDetail(),rowsEl=document.getElementById("nrRows");
 const vis=document.getElementById("nrVisible");if(vis)vis.textContent="共 "+list.length+" 筆，點開查看（只列舊規則有推薦的項目）";
 // 2026-11-22：明細太長，預設收合、預設只看被擋下，一次顯示 30 筆。
 const shown=list.slice(0,nrDetailLimit),more=list.length-shown.length;
 if(rowsEl)rowsEl.innerHTML=list.length?'<div class="nr3-item nr3-headrow"><span>開賽</span><span>對戰</span><span>階段</span><span>玩法</span><span>舊規則</span><span>新規則</span><span>挑戰規則</span></div>'+shown.join("")+(more>0?'<button class="ghost-btn nr3-more" onclick="nrDetailLimit+=30;renderNbaResearch()">再顯示 30 筆（還有 '+more+' 筆）</button>':''):'<div class="nr-empty">目前沒有符合條件的資料</div>';
}
