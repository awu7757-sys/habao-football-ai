/* HABAO NBA V1 vs single unified V2 research dashboard */
const NR_COMPARE_URL="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-nba-v2-compare";
let nrCompare=null,nrErrors={},nrLoading=false,nrRequestSerial=0,nrRequestController=null;
const nrNames={v2:"V2 統合測試模型"};
const nrMarkets={moneyline:"獨贏",handicap:"讓分",over_under:"大小分"};
function nrEsc(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function nrNum(v,d=1){if(v===null||v===undefined||v==="")return"—";const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—";}
function nrPct(v){if(v===null||v===undefined||v==="")return"—";const n=Number(v);return Number.isFinite(n)?(n*100).toFixed(1)+"%":"—";}
function nrHit(v){if(v===null||v===undefined||v==="")return"—";const n=Number(v);return Number.isFinite(n)?n.toFixed(1)+"%":"—";}
function nrTeam(n){return typeof zhTeam==="function"?zhTeam(n):String(n??"—");}
function nrOutcome(t){return ({win:"命中",loss:"未命中",half_win:"半贏",half_loss:"半輸",push:"走盤"})[t]||"待驗證";}
function nrStatus(v){return ({ready:"已建模",not_collected:"尚未收集",insufficient_data:"資料不足",processing:"分析中",pending:"等待執行",failed:"分析失敗",source_error:"資料來源錯誤"})[String(v??"not_collected").toLowerCase()]||String(v||"尚未收集");}
function nrDate(d){const x=Date.parse(String(d||""));return Number.isFinite(x)?new Date(x).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):"—";}
function nrScore(h,a){const n=nrNum(h),m=nrNum(a);return n==="—"||m==="—"?"—":n+"－"+m;}
function nrPick(k,p,line){
 if(!p)return"暫不推薦";
 const name=k==="moneyline"?(p==="home"?"主勝":p==="away"?"客勝":"—"):k==="handicap"?(p==="home"?"主隊":p==="away"?"客隊":"—"):(p==="over"?"大":p==="under"?"小":"—");
 if(name==="—")return"暫無方向";
 if(k==="moneyline"||line===null||line===undefined||line==="")return name;
 const n=Number(line);
 return name+" "+(Number.isFinite(n)?(k==="handicap"&&n>0?"+":"")+n:String(line));
}
async function nrFetch(url,payload,signal){
 const req={...payload};
 if(!adminSessionToken&&adminPassword)req.admin_password=adminPassword;
 const response=await fetch(url,{method:"POST",headers:adminAuthHeaders(),body:JSON.stringify(req),cache:"no-store",signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok||data?.success!==true||!Array.isArray(data?.rows)){
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
 nrLoading=true;msg.textContent="正在取得 V1 正式版與 V2 統合測試資料…";
 const refresh=document.getElementById("nrRefresh");if(refresh)refresh.disabled=true;
 const days=Number(document.getElementById("nrDays")?.value||30);
 let result;
 try{result=await nrFetch(NR_COMPARE_URL,{action:"compare",days},controller.signal);}
 catch(error){if(serial!==nrRequestSerial)return;nrCompare=null;nrErrors={compare:controller.signal.aborted?"讀取逾時，請重試":String(error?.message||error)};nrLoading=false;if(refresh)refresh.disabled=false;renderNbaResearch();return;}
 finally{clearTimeout(timeout);}
 if(serial!==nrRequestSerial)return;
 nrErrors={};
 nrCompare=result;
 nrLoading=false;if(refresh)refresh.disabled=false;
 renderNbaResearch();
}
function nrRows(){
 const cmp=Array.isArray(nrCompare?.rows)?nrCompare.rows:[];
 return cmp.map(c=>({id:Number(c.game_id),compare:c})).filter(x=>Number.isFinite(x.id)&&x.id>0)
  .sort((a,b)=>Date.parse(b.compare?.kickoff_at||0)-Date.parse(a.compare?.kickoff_at||0)||b.id-a.id);
}
function nrVariantAvailability(row,key){
 const c=row.compare;
 const status=String(c?.v2_status||"not_collected").toLowerCase();
 if(!c||status!=="ready")return nrStatus(status);
 if(!c.v2_model||c.v2_model.expected_total==null)return"尚無有效 V2 模型";
 return"已建模";
}
function nrResearchMarket(row,key,market){
 const c=row.compare;
  const status=String(c?.v2_status||"not_collected").toLowerCase();
  if(status!=="ready")return{pick:nrStatus(status),result:"—"};
  const t=c?.markets?.[market]||{};
  if(!t.v2_pick){
   const m=c.v2_model?.market||{};
   if(market==="handicap"&&m.home_spread==null)return{pick:"缺少讓分盤口",result:"—"};
   if(market==="over_under"&&m.total==null)return{pick:"缺少大小分盤口",result:"—"};
   const raw=c.v2_model?.shadow_directions||{};
   const side=market==="moneyline"?raw.moneyline:market==="handicap"?raw.handicap:raw.over_under;
   if(side)return{pick:"傾向 "+nrPick(market,side,
     market==="handicap"?(side==="home"?m.home_spread:-Number(m.home_spread)):market==="over_under"?m.total:null),
     result:"未達研究門檻"};
   return{pick:"未產生研究方向",result:"—"};
  }
  const line=market==="handicap"&&t.v2_pick==="away"&&t.v2_line!=null?-Number(t.v2_line):t.v2_line;
  return{pick:nrPick(market,t.v2_pick,line),result:nrOutcome(t.v2_result),mismatch:t.same_line===false&&!!t.v1_pick};
}
function nrScoreInfo(row,key){
 const m=row.compare?.v2_model||{};
 return{score:nrScore(m.expected_home_points,m.expected_away_points),total:nrNum(m.expected_total),prob:nrPct(m.home_win_probability)};
}
function nrCards(row,key){
 const c=row.compare||{};
 const score=nrScoreInfo(row,key),v1Score=nrScore(c.v1_predicted_score?.home,c.v1_predicted_score?.away);
 const v1Total=c.v1_predicted_score?.home!=null&&c.v1_predicted_score?.away!=null?Number(c.v1_predicted_score.home)+Number(c.v1_predicted_score.away):null;
 const modelName=nrNames[key]||"V2 貝氏模型";
 const title=nrEsc(nrTeam(c.home))+' <span>對戰</span> '+nrEsc(nrTeam(c.away));
 const done=c.verified===true;
 const final=c.home_score!=null&&c.away_score!=null?nrScore(c.home_score,c.away_score):"";
 const status=key==="v2"?nrStatus(c.v2_status||"not_collected"):nrVariantAvailability(row,key);
 const marketMarkup=Object.entries(nrMarkets).map(([market,name])=>{
  const t=c.markets?.[market]||{};
  const official=c.home||c.away?(t.v1_pick?nrPick(market,t.v1_pick,t.v1_line):"暫不推薦"):"正式資料未載入";
  const research=nrResearchMarket(row,key,market);
  const compareRes=done?nrOutcome(t.v1_result):"待驗證";
  return '<div class="nr-market"><div class="nr-market-name">'+name+'</div><div class="nr-pick-row"><span class="nr-tag nr-v1">V1 正式</span><strong>'+nrEsc(official)+'</strong><span class="nr-result">'+(c.markets&&done?compareRes:"—")+'</span></div>'+
  '<div class="nr-pick-row"><span class="nr-tag nr-v2">'+nrEsc(key==="v2"?"V2 統合":"研究")+'</span><strong>'+nrEsc(research.pick)+'</strong><span class="nr-result">'+nrEsc(research.result)+'</span></div>'+
  (research.mismatch?'<div class="nr-note">盤口不同，不列入相同盤口的比較</div>':"")+'</div>';
 }).join("");
 return '<article class="nr-game"><div class="nr-game-top"><div><div class="nr-meta"><span>'+nrDate(c.kickoff_at)+'</span><span>NBA #'+nrEsc(row.id)+'</span><span>'+nrEsc(modelName)+'：'+nrEsc(status)+'</span></div><div class="fvc-game-title">'+title+'</div></div><div class="nr-verified">'+(done?(final?'完賽 '+final:"已驗證"):"待驗證")+'</div></div>'+
 '<div class="nr-score-grid"><div class="nr-scorebox"><div><span class="nr-tag nr-v1">V1 正式</span> 賽前預測比分</div><strong>'+v1Score+'</strong><small>預估總分 '+nrNum(v1Total)+'</small></div>'+
 '<div class="nr-scorebox nr-scorebox-alt"><div><span class="nr-tag nr-v2">'+nrEsc(key==="v2"?"V2 統合":"研究")+'</span> '+nrEsc(modelName)+' 預測比分</div><strong>'+score.score+'</strong><small>預估總分 '+score.total+(key==="v2"?"｜主勝機率 "+score.prob:"")+'</small></div></div>'+
 '<div class="nr-market-grid">'+marketMarkup+'</div>'+
 (key==="v2"&&String(c.v2_status||"")!=="ready"?'<div class="nr-explain">V2 尚未完成此場獨立研究分析；沒有 V2 方向不代表模型判定「暫不推薦」。</div>':"")+
 (key==="v2"&&c.v2_model?.pace_metrics?'<div class="nr-explain">V2 統合模型｜貝氏收縮＋回合效率；預估回合 '+nrNum(c.v2_model.pace_metrics.expected_possessions)+'｜主隊 ORtg '+nrNum(c.v2_model.pace_metrics.home_ortg)+'／DRtg '+nrNum(c.v2_model.pace_metrics.home_drtg)+'｜客隊 ORtg '+nrNum(c.v2_model.pace_metrics.away_ortg)+'／DRtg '+nrNum(c.v2_model.pace_metrics.away_drtg)+'｜有效歷史 Box '+nrEsc(c.v2_model.sample?.home_box_games??"—")+'/'+nrEsc(c.v2_model.sample?.away_box_games??"—")+'</div>':"")+
 (key==="v2"&&c.v2_model?.model_family==="bayesian_score_fallback"?'<div class="nr-explain">得失分備援模型：真實回合統計不足，未使用臆測的 Pace／攻守效率。</div>':"")+'</article>';
}
function nrSummary(){
 const el=document.getElementById("nrSummary");if(!el)return;
 const cmp=nrCompare||{};
 const vals=[
  ["V1 正式快照",cmp.count??"—","正式預測，不會被研究模型改寫"],
  ["V2 統合模型",cmp.captured??"—","效率＋貝氏收縮；資料不足時使用得失分備援"],
  ["已驗證賽果",cmp.verified??"—","只計入已驗證的完賽比分"]
 ];
 el.innerHTML=vals.map(v=>'<div class="nr-summary-tile"><div>'+v[0]+'</div><strong>'+nrEsc(v[1])+'</strong><small>'+v[2]+'</small></div>').join("");
}
function nrStats(model){
 const box=document.getElementById("nrStats");if(!box)return;
 if(!nrCompare){box.innerHTML='<div class="nr-empty">V1／V2 比較資料目前不可用</div>';return;}
 box.innerHTML=Object.entries(nrMarkets).map(([key,name])=>{const v=nrCompare.markets?.[key]||{};
    return '<div class="nr-stat"><b>'+name+'｜同場命中</b><div><span>V1 '+nrHit(v.paired_v1_rate)+'</span><span>V2 '+nrHit(v.paired_v2_rate)+'</span></div><small>同場有效 '+(v.paired_count||0)+' 場｜盤口相同且已驗證才納入</small></div>';
  }).join("");
  return;
}
/* 48/72-hour simple scoreboard; historical, settled picks only. */
function nrSimpleWindowHours(){return Number(document.getElementById("nrSimpleWindow")?.value||72);}
function nrSimpleGrading(market,side,line,home,away){
 const h=Number(home),a=Number(away),p=Number(line);
 if(!Number.isFinite(h)||!Number.isFinite(a))return null;
 let d;
 if(market==="moneyline")d=h-a;
 else if(market==="handicap"){if(line===null||line===undefined||line==="")return null;d=h-a+p;}
 else {if(line===null||line===undefined||line==="")return null;d=h+a-p;}
 if(Math.abs(d)<1e-8)return "push";
 const target=market==="moneyline"||market==="handicap"?(side==="home"?1:side==="away"?-1:0):(side==="over"?1:side==="under"?-1:0);
 return target===0?null:(d*target>0?"win":"loss");
}
function nrSimpleResult(result){
 const v=String(result??"").toLowerCase();
 if(["win","won","hit"].includes(v))return "win";
 if(["loss","lose","lost","miss"].includes(v))return "loss";
 if(["push","void","draw","tie"].includes(v))return "push";
 if(v==="half_win")return "half_win";
 if(v==="half_loss")return "half_loss";
 return null;
}
function nrSimpleScoreboard(){
 const el=document.getElementById("nrSimpleTable"),meta=document.getElementById("nrSimpleMeta");
 if(!el)return;
 if(nrErrors.compare){el.innerHTML='<div class="nr-empty">比較資料讀取失敗，暫時無法統計。</div>';if(meta)meta.textContent="";const note=document.getElementById("nrSimpleConclusion");if(note)note.textContent="請重新讀取比較資料。";return;}
 const hours=nrSimpleWindowHours(),now=Date.now(),start=now-hours*3600*1000;
 const games=nrRows().filter(row=>{
  const t=Date.parse(row.compare?.kickoff_at||"");
  return Number.isFinite(t)&&t>=start&&t<=now;
 });
 const modes=[["v1","V1 正式"],["v2","V2 統合"]];
 const out=modes.map(([mode,name])=>{
  let notModeled=0,missing=0,picks=0,graded=0,wins=0,draws=0,half=0;
  for(const row of games){
   const c=row.compare||{},m=c.markets||{};
   const ready=mode==="v1"?!!row.compare:(c.v2_status==="ready"&&!!c.v2_model);
   if(!ready){notModeled++;continue;}
   for(const market of ["moneyline","handicap","over_under"]){
    const rec=m[market]||{},pick=mode==="v1"?rec.v1_pick:rec.v2_pick;
    if(!["home","away","over","under"].includes(pick)){missing++;continue;}
    picks++;
    const result=nrSimpleResult(mode==="v1"?rec.v1_result:rec.v2_result);
    if(result==="win"){graded++;wins++;}
    else if(result==="loss")graded++;
    else if(result==="half_win"){graded++;wins+=0.5;half++;}
    else if(result==="half_loss"){graded++;half++;}
    else if(result==="push")draws++;
   }
  }
  const totalPotential=games.length*3;
  const coverage=totalPotential?Math.round(100*picks/totalPotential):null;
  return {mode,name,notModeled,missing,picks,graded,wins,draws,half,coverage,rate:graded?100*wins/graded:null};
 });
 if(meta)meta.textContent="近 "+hours+" 小時內已開賽 "+games.length+" 場；只比較正式 V1 與單一統合 V2。命中率只計入已驗證賽果。";
 const head='<div class="nr-simple-head"><span>模型</span><span>命中率</span><span>已結算</span><span>有方向</span><span>未給方向</span><span>未建模</span></div>';
 el.innerHTML=head+out.map(x=>'<div class="nr-simple-row"><strong>'+x.name+'</strong><strong>'+(x.rate==null?'—':x.rate.toFixed(1)+'%')+'</strong><span>'+x.graded+' 項</span><span>'+x.picks+' 項</span><span>'+x.missing+' 項</span><span>'+x.notModeled+' 場</span></div>').join("");
 const note=document.getElementById("nrSimpleConclusion");
 if(note)note.textContent=!games.length?"這段時間沒有可比較的已開賽快照。":out.every(x=>x.graded<15)?"目前已結算樣本不足 15 項，先持續累積 V1／V2 同場資料。":"命中率只作研究參考，需再累積更多同場已結算資料。";
}

function renderNbaResearch(){
 const model=document.getElementById("nrModel")?.value||"v2";
 const msg=document.getElementById("nrStatus");
 const warnings=[];
 if(nrErrors.compare)warnings.push("V1／V2 比較 API："+nrErrors.compare);
 const c=nrCompare||{};
 if(msg)msg.textContent=[warnings.length?"比較資料異常："+warnings.join("；"):"已更新",nrCompare?"V1 "+(c.count??"—")+" 場、V2 已建模 "+(c.captured??"—")+" 場":null].filter(Boolean).join("｜");
 nrSummary();nrStats(model);nrSimpleScoreboard();
 const search=String(document.getElementById("nrSearch")?.value||"").trim().toLowerCase();
 const filter=document.getElementById("nrFilter")?.value||"all";
 const rows=nrRows().filter(r=>{
  const c=r.compare||{},status=String(c.v2_status||"not_collected");
  if(filter==="ready"&&status!=="ready")return false;
  if(filter==="missing"&&status==="ready")return false;
  if(filter==="verified"&&c.verified!==true)return false;
  if(search&&![(r.id),c.home,c.away,nrTeam(c.home),nrTeam(c.away)].some(x=>String(x??"").toLowerCase().includes(search)))return false;
  return true;
 });
 const summary=document.getElementById("nrVisible");if(summary)summary.textContent="顯示 "+rows.length+" 場｜左 V1 正式、右 "+(nrNames[model]||"V2")+"｜研究結果不影響會員推薦";
 const cards=document.getElementById("nrRows");if(!cards)return;
 cards.innerHTML=rows.length?rows.map(r=>nrCards(r,model)).join(""):nrErrors.compare?'<div class="nr-empty">比較資料讀取失敗，請按「更新比對」重試。</div>':'<div class="nr-empty">目前沒有符合條件的賽事資料</div>';
}

