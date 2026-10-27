/* HABAO NBA unified research dashboard v4: display only, read-only admin APIs */
const NR_COMPARE_URL="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-nba-v2-compare";
const NR_BACKTEST_URL="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-model-backtest";
const NR_V3_URL="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/admin-nba-v3-read";
let nrCompare=null,nrBacktest=null,nrV3=null,nrErrors={},nrLoading=false;
const nrNames={v2:"V2 貝氏模型",v3:"V3 回合效率模型",market_anchored:"市場校正",rolling_corrected:"滾動誤差修正",hybrid:"混合模型"};
const nrMarkets={moneyline:"獨贏",handicap:"讓分",over_under:"大小分"};
function nrEsc(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function nrNum(v,d=1){if(v===null||v===undefined||v==="")return"—";const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"—";}
function nrPct(v){if(v===null||v===undefined||v==="")return"—";const n=Number(v);return Number.isFinite(n)?(n*100).toFixed(1)+"%":"—";}
function nrHit(v){if(v===null||v===undefined||v==="")return"—";const n=Number(v);return Number.isFinite(n)?n.toFixed(1)+"%":"—";}
function nrTeam(n){return typeof zhTeam==="function"?zhTeam(n):String(n??"—");}
function nrOutcome(t){return ({win:"命中",loss:"未命中",half_win:"半贏",half_loss:"半輸",push:"走盤"})[t]||"待驗證";}
function nrStatus(v){return ({ready:"已建模",not_collected:"尚未收集",insufficient_data:"資料不足",processing:"分析中",pending:"等待執行",failed:"分析失敗"})[String(v??"not_collected").toLowerCase()]||String(v||"尚未收集");}
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
async function nrFetch(url,payload){
 const req={...payload};
 if(!adminSessionToken&&adminPassword)req.admin_password=adminPassword;
 const response=await fetch(url,{method:"POST",headers:adminAuthHeaders(),body:JSON.stringify(req),cache:"no-store"});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.success===false){
  if(response.status===401&&adminSessionToken)clearAdminSession();
  throw Error([data.error||("HTTP "+response.status),data.detail].filter(Boolean).join("："));
 }
 return data;
}
async function loadNbaResearch(){
 const msg=document.getElementById("nrStatus");if(!msg||nrLoading)return;
 nrLoading=true;msg.textContent="正在取得 V1、V2 與歷史回測資料…";
 const refresh=document.getElementById("nrRefresh");if(refresh)refresh.disabled=true;
 const days=Number(document.getElementById("nrDays")?.value||30);
 const result=await Promise.allSettled([
  nrFetch(NR_COMPARE_URL,{action:"compare",days}),
  nrFetch(NR_BACKTEST_URL,{action:"backtest"}),
  nrFetch(NR_V3_URL,{action:"list",days})
 ]);
 nrErrors={};
 if(result[2]?.status==="fulfilled")nrV3=result[2].value;
 else{nrV3=null;nrErrors.v3=String(result[2]?.reason?.message||result[2]?.reason||"尚未部署");}
 if(result[0].status==="fulfilled")nrCompare=result[0].value;
 else{nrCompare=null;nrErrors.compare=String(result[0].reason?.message||result[0].reason);}
 if(result[1].status==="fulfilled")nrBacktest=result[1].value;
 else{nrBacktest=null;nrErrors.backtest=String(result[1].reason?.message||result[1].reason);}
 nrLoading=false;if(refresh)refresh.disabled=false;
 renderNbaResearch();
}
function nrRows(){
 const cmp=Array.isArray(nrCompare?.rows)?nrCompare.rows:[];
 const bt=Array.isArray(nrBacktest?.rows)?nrBacktest.rows:[];
 const map=new Map;
 for(const c of cmp){const id=Number(c.game_id);if(Number.isFinite(id)&&id>0)map.set(id,{id,compare:c,backtest:null,v3:null});}
 for(const b of bt){const id=Number(b.game_id);if(!Number.isFinite(id)||id<=0)continue;
 if(map.has(id))map.get(id).backtest=b;
 else if(!nrCompare)map.set(id,{id,compare:null,backtest:b,v3:null});}
 for(const v of nrV3?.rows||[]){const id=Number(v.game_id);if(map.has(id))map.get(id).v3=v;}
 return [...map.values()].sort((a,b)=>Date.parse(b.compare?.kickoff_at||b.backtest?.kickoff_at||0)-Date.parse(a.compare?.kickoff_at||a.backtest?.kickoff_at||0)||b.id-a.id);
}
function nrVariantAvailability(row,key){
 const c=row.compare, b=row.backtest;
 if(key==="v3")return row.v3?.status==="ready"?"已建模":row.v3?nrStatus(row.v3.status):"尚未收集";
 if(key==="v2"){
  const status=String(c?.v2_status||"not_collected").toLowerCase();
  if(!c||status!=="ready")return nrStatus(status);
  if(!c.v2_model||c.v2_model.expected_total==null)return"尚無有效 V2 模型";
  return"已建模";
 }
 const v=b?.variants?.[key];return v&&v.score?"已完成歷史回測":"尚無研究結果";
}
function nrResearchMarket(row,key,market){
 const c=row.compare,b=row.backtest;
 if(key==="v3"){
  const record=row.v3,m=record?.model_output;
  if(record?.status!=="ready"||!m)return{pick:record?nrStatus(record.status):"尚未收集",result:"—"};
  const side=m.raw_directions?.[market],line=market==="handicap"?(side==="home"?m.market?.home_spread:side==="away"&&m.market?.home_spread!=null?-Number(m.market.home_spread):null):market==="over_under"?m.market?.total:null;
  if(!side)return{pick:market==="handicap"?"缺少讓分盤口":market==="over_under"?"缺少大小分盤口":"無研究方向",result:"—"};
  return{pick:nrPick(market,side,line),result:"研究方向（未校準）"};
 }
 if(key==="v2"){
  const status=String(c?.v2_status||"not_collected").toLowerCase();
  if(status!=="ready")return{pick:nrStatus(status),result:"—"};
  const t=c?.markets?.[market]||{};
  if(!t.v2_pick){
   const m=c.v2_model?.market||{};
   if(market==="handicap"&&m.home_spread==null)return{pick:"缺少讓分盤口",result:"—"};
   if(market==="over_under"&&m.total==null)return{pick:"缺少大小分盤口",result:"—"};
   const raw=c.v2_model?.raw_directions||{};
   const side=market==="moneyline"?raw.moneyline:market==="handicap"?raw.handicap:raw.over_under;
   if(side)return{pick:"傾向 "+nrPick(market,side,
     market==="handicap"?(side==="home"?m.home_spread:-Number(m.home_spread)):market==="over_under"?m.total:null),
     result:"未達研究門檻"};
   return{pick:"未產生研究方向",result:"—"};
  }
  const line=market==="handicap"&&t.v2_pick==="away"&&t.v2_line!=null?-Number(t.v2_line):t.v2_line;
  return{pick:nrPick(market,t.v2_pick,line),result:nrOutcome(t.v2_result),mismatch:t.same_line===false&&!!t.v1_pick};
 }
 const v=b?.variants?.[key];
 if(!v||!v.score)return{pick:"尚無研究結果",result:"—"};
 if(market==="moneyline")return{pick:v.directions?.winner==="home"?"主勝方向":v.directions?.winner==="away"?"客勝方向":"未產生研究方向",result:"研究方向"};
 if(market==="handicap"){
  if(b?.market?.home_spread==null)return{pick:"缺少讓分盤口",result:"—"};
  const side=v.signals?.handicap;
  return{pick:side==="home"?"主隊讓分方向":side==="away"?"客隊受讓方向":"無足夠市場差距",result:"研究方向"};
 }
 if(b?.market?.total==null)return{pick:"缺少大小分盤口",result:"—"};
 const side=v.signals?.over_under;
 return{pick:side==="over"?"大分方向":side==="under"?"小分方向":"無足夠市場差距",result:"研究方向"};
}
function nrScoreInfo(row,key){
 if(key==="v3"){
  const m=row.v3?.model_output||{};
  return{score:nrScore(m.expected_home_points,m.expected_away_points),total:nrNum(m.expected_total),prob:nrPct(m.home_win_probability)};
 }
 if(key==="v2"){
  const m=row.compare?.v2_model||{};
  return{score:nrScore(m.expected_home_points,m.expected_away_points),total:nrNum(m.expected_total),prob:nrPct(m.home_win_probability)};
 }
 const v=row.backtest?.variants?.[key]||{};
 return{score:nrScore(v.score?.home,v.score?.away),total:nrNum(v.total),prob:"—"};
}
function nrCards(row,key){
 const c=row.compare||{},b=row.backtest||{};
 const v1=b.variants?.v1_original||{};
 const score=nrScoreInfo(row,key), v1Score=nrScore(v1.score?.home,v1.score?.away);
 const modelName=nrNames[key]||"V2 貝氏模型";
 const title=nrEsc(nrTeam(c.home||b.home))+' <span>對戰</span> '+nrEsc(nrTeam(c.away||b.away));
 const done=c.verified===true||b.verified===true;
 const final=c.home_score!=null&&c.away_score!=null?nrScore(c.home_score,c.away_score):"";
 const status=key==="v2"?nrStatus(c.v2_status||"not_collected"):nrVariantAvailability(row,key);
 const marketMarkup=Object.entries(nrMarkets).map(([market,name])=>{
  const t=c.markets?.[market]||{};
  const official=c.home||c.away?(t.v1_pick?nrPick(market,t.v1_pick,t.v1_line):"暫不推薦"):"正式資料未載入";
  const research=nrResearchMarket(row,key,market);
  const compareRes=done?nrOutcome(t.v1_result):"待驗證";
  return '<div class="nr-market"><div class="nr-market-name">'+name+'</div><div class="nr-pick-row"><span class="nr-tag nr-v1">V1 正式</span><strong>'+nrEsc(official)+'</strong><span class="nr-result">'+(c.markets&&done?compareRes:"—")+'</span></div>'+
  '<div class="nr-pick-row"><span class="nr-tag nr-v2">'+nrEsc(key==="v2"?"V2 影子":key==="v3"?"V3 影子":"研究")+'</span><strong>'+nrEsc(research.pick)+'</strong><span class="nr-result">'+nrEsc(research.result)+'</span></div>'+
  (research.mismatch?'<div class="nr-note">盤口不同，不列入相同盤口的比較</div>':"")+'</div>';
 }).join("");
 return '<article class="nr-game"><div class="nr-game-top"><div><div class="nr-meta"><span>'+nrDate(c.kickoff_at||b.kickoff_at)+'</span><span>NBA #'+nrEsc(row.id)+'</span><span>'+nrEsc(modelName)+'：'+nrEsc(status)+'</span></div><div class="fvc-game-title">'+title+'</div></div><div class="nr-verified">'+(done?(final?'完賽 '+final:"已驗證"):"待驗證")+'</div></div>'+
 '<div class="nr-score-grid"><div class="nr-scorebox"><div><span class="nr-tag nr-v1">V1 正式</span> 賽前預測比分</div><strong>'+v1Score+'</strong><small>預估總分 '+nrNum(v1.total)+'</small></div>'+
 '<div class="nr-scorebox nr-scorebox-alt"><div><span class="nr-tag nr-v2">'+nrEsc(key==="v2"?"V2 影子":key==="v3"?"V3 影子":"研究")+'</span> '+nrEsc(modelName)+' 預測比分</div><strong>'+score.score+'</strong><small>預估總分 '+score.total+(key==="v2"||key==="v3"?"｜主勝機率 "+score.prob:"")+'</small></div></div>'+
 '<div class="nr-market-grid">'+marketMarkup+'</div>'+
 (key==="v2"&&String(c.v2_status||"")!=="ready"?'<div class="nr-explain">V2 尚未完成此場獨立研究分析；沒有 V2 方向不代表模型判定「暫不推薦」。</div>':"")+
 (key==="v2"&&c.v2_model?.pace_metrics?'<div class="nr-explain">回合效率模型｜預估回合 '+nrNum(c.v2_model.pace_metrics.expected_possessions)+'｜主隊 ORtg '+nrNum(c.v2_model.pace_metrics.home_ortg)+'／DRtg '+nrNum(c.v2_model.pace_metrics.home_drtg)+'｜客隊 ORtg '+nrNum(c.v2_model.pace_metrics.away_ortg)+'／DRtg '+nrNum(c.v2_model.pace_metrics.away_drtg)+'｜有效歷史 Box '+nrEsc(c.v2_model.sample?.home_box_games??"—")+'/'+nrEsc(c.v2_model.sample?.away_box_games??"—")+'</div>':"")+
 (key==="v2"&&c.v2_model?.model_family==="bayesian_score_fallback"?'<div class="nr-explain">得失分備援模型：真實回合統計不足，未使用臆測的 Pace／攻守效率。</div>':"")+'</article>';
}
function nrSummary(){
 const el=document.getElementById("nrSummary");if(!el)return;
 const cmp=nrCompare||{},bt=nrBacktest||{};
 const vals=[
 ["V1 正式快照",cmp.count??bt.total??"—","已保存的賽前預測"],
 ["V2 已建模",cmp.captured??"—","獨立貝氏模型"],
 ["V3 已建模",(nrV3?.rows||[]).filter(x=>x.status==="ready").length,"效率影子模型"],
 ["已驗證可回測",bt.verified??cmp.verified??"—","只計入有效完賽比分"]
 ];
 el.innerHTML=vals.map(v=>'<div class="nr-summary-tile"><div>'+v[0]+'</div><strong>'+nrEsc(v[1])+'</strong><small>'+v[2]+'</small></div>').join("");
}
function nrStats(model){
 const box=document.getElementById("nrStats");if(!box)return;
 if(model==="v3"){
   const v=nrV3?.rows||[],ready=v.filter(x=>x.status==="ready");
   box.innerHTML='<div class="nr-stat"><b>V3 建模狀態</b><div><span>已保存 '+v.length+' 場</span><span>有效 '+ready.length+' 場</span></div><small>只顯示獨立賽前快照；正式命中需同場賽果驗證</small></div>';
   return;
 }
 if(model==="v2"){
  if(!nrCompare){box.innerHTML='<div class="nr-empty">V2 比較資料目前不可用</div>';return;}
  box.innerHTML=Object.entries(nrMarkets).map(([key,name])=>{const v=nrCompare.markets?.[key]||{};
    return '<div class="nr-stat"><b>'+name+'｜同場命中</b><div><span>V1 '+nrHit(v.paired_v1_rate)+'</span><span>V2 '+nrHit(v.paired_v2_rate)+'</span></div><small>同場有效 '+(v.paired_count||0)+' 場｜盤口相同且已驗證才納入</small></div>';
  }).join("");
  return;
 }
 if(!nrBacktest){box.innerHTML='<div class="nr-empty">歷史回測資料目前不可用</div>';return;}
 const b=nrBacktest.stats||{},a=b.v1_original||{},v=b[model]||{};
 const categories=[["總分平均誤差",a.total_mae,v.total_mae," 分"],["分差平均誤差",a.margin_mae,v.margin_mae," 分"],["獨贏方向命中",a.moneyline?.hit_rate,v.moneyline?.hit_rate,"%"]];
 box.innerHTML=categories.map(([name,x,y,unit])=>'<div class="nr-stat"><b>'+name+'</b><div><span>V1 '+nrNum(x)+unit+'</span><span>'+nrEsc(nrNames[model])+' '+nrNum(y)+unit+'</span></div><small>研究用回測，尚未通過跨期獨立驗證</small></div>').join("");
}
function nrHistorical(){
 const el=document.getElementById("nrHistory");if(!el)return;
 const data=nrBacktest?.stats||{};
 const names={v1_original:"V1 原始",market_anchored:"市場校正",rolling_corrected:"歷史誤差修正",hybrid:"混合模型"};
 el.innerHTML=nrBacktest?'<div class="nr-hist-table"><div class="nr-hist-head"><span>方法</span><span>總分誤差</span><span>分差誤差</span><span>獨贏命中</span><span>大小分研究</span></div>'+Object.entries(names).map(([key,title])=>{
 const d=data[key]||{};return '<div class="nr-hist-row"><span>'+title+'</span><span>'+nrNum(d.total_mae)+' 分</span><span>'+nrNum(d.margin_mae)+' 分</span><span>'+nrHit(d.moneyline?.hit_rate)+'（'+(d.moneyline?.n||0)+' 場）</span><span>'+nrHit(d.total?.hit_rate)+'（'+(d.total?.n||0)+' 場）</span></div>';
 }).join("")+'</div>':'<div class="nr-empty">尚無歷史回測資料</div>';
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
 const hours=nrSimpleWindowHours(),now=Date.now(),start=now-hours*3600*1000;
 // Only unique official fixture IDs, and no future games, for comparable opportunities.
 const games=nrRows().filter(row=>{
  const t=Date.parse(row.compare?.kickoff_at||row.backtest?.kickoff_at||"");
  return Number.isFinite(t)&&t>=start&&t<=now;
 });
 const modes=[["v1","V1 正式"],["v2","V2 貝氏"],["v3","V3 效率"]];
 const out=modes.map(([mode,name])=>{
  let gamesWithModel=0,notModeled=0,missing=0,picks=0,graded=0,wins=0,draws=0,half=0;
  for(const row of games){
   const c=row.compare||{},v3=row.v3,m=c.markets||{};
   const modelReady=mode==="v1"?!!row.compare:mode==="v2"?(c.v2_status==="ready"&&!!c.v2_model):v3?.status==="ready"&&!!v3.model_output;
   if(!modelReady){notModeled++;continue;}
   gamesWithModel++;
   for(const market of ["moneyline","handicap","over_under"]){
    const rec=m[market]||{};
    const pick=mode==="v1"?rec.v1_pick:mode==="v2"?rec.v2_pick:v3.model_output?.raw_directions?.[market];
    if(!["home","away","over","under"].includes(pick)){missing++;continue;}
    picks++;
    // A V2/V3 raw research direction is NOT an official recommendation.
    let result=mode==="v1"?nrSimpleResult(rec.v1_result):mode==="v2"?nrSimpleResult(rec.v2_result):null;
    if(mode==="v3"){
     const marketData=v3.model_output?.market||{};
     const line=market==="handicap"?marketData.home_spread:market==="over_under"?marketData.total:null;
     if(c.verified===true&&c.home_score!=null&&c.away_score!=null){
      result=nrSimpleGrading(market,pick,line,c.home_score,c.away_score);
     }
    }
    if(result==="win"){graded++;wins++;}
    else if(result==="loss")graded++;
    else if(result==="half_win"){graded++;wins+=0.5;half++;}
    else if(result==="half_loss"){graded++;half++;}
    else if(result==="push")draws++;
   }
  }
  const totalPotential=games.length*3;
  // Missing model and explicit no-pick are separated, not conflated.
  const coverage=totalPotential?Math.round(100*picks/totalPotential):null;
  return {mode,name,gamesWithModel,notModeled,missing,picks,graded,wins,draws,half,coverage,rate:graded?100*wins/graded:null};
 });
 if(meta)meta.textContent="近 "+hours+" 小時內已開賽 "+games.length+" 場；只用已驗證且可結算的方向計算命中率。V2／V3 為研究傾向，非正式推薦。";
 const maxVerified=Math.max(...out.map(x=>x.graded),0);
 const leader=maxVerified>=15?out.filter(x=>x.graded>=15).sort((a,b)=>(b.rate??-1)-(a.rate??-1))[0]:null;
 const head='<div class="nr-simple-head"><span>模型</span><span>命中率</span><span>已結算</span><span>有方向</span><span>未給方向</span><span>未建模</span></div>';
 el.innerHTML=head+out.map(x=>'<div class="nr-simple-row"><strong>'+x.name+(leader&&leader.mode===x.mode?'　★ 目前最高':'')+'</strong><strong>'+(x.rate==null?'—':x.rate.toFixed(1)+'%')+'</strong><span>'+x.graded+' 項</span><span>'+x.picks+' 項</span><span>'+x.missing+' 項</span><span>'+x.notModeled+' 場</span></div>').join("");
 const note=document.getElementById("nrSimpleConclusion");
 if(note)note.textContent=!games.length?"這段時間沒有可比較的已開賽快照。":!leader?"目前可結算樣本不足 15 項，無法可靠判定哪個模型比較準。可先比較有方向數、未給方向數與未建模場數。":"目前命中率最高："+leader.name+"（"+leader.rate.toFixed(1)+"%，"+leader.graded+" 項已結算）。樣本仍少，需持續追蹤。";
}

function renderNbaResearch(){
 const model=document.getElementById("nrModel")?.value||"v2";
 const msg=document.getElementById("nrStatus");
 const warnings=[];
 if(nrErrors.compare)warnings.push("V1／V2 比較 API："+nrErrors.compare);
 if(nrErrors.backtest)warnings.push("歷史回測 API："+nrErrors.backtest);
 if(nrErrors.v3)warnings.push("V3 研究 API："+nrErrors.v3);
 const c=nrCompare||{},b=nrBacktest||{};
 if(msg)msg.textContent=[warnings.length?"部分資料來源異常："+warnings.join("；"):"已更新",nrCompare?"V1 "+(c.count??"—")+" 場、V2 已建模 "+(c.captured??"—")+" 場":null,nrBacktest?"歷史有效回測 "+(b.verified??"—")+" 場":null,nrV3?"V3 已保存 "+(nrV3.count??"—")+" 場":null].filter(Boolean).join("｜");
 nrSummary();nrStats(model);nrHistorical();nrSimpleScoreboard();
 const search=String(document.getElementById("nrSearch")?.value||"").trim().toLowerCase();
 const filter=document.getElementById("nrFilter")?.value||"all";
 const rows=nrRows().filter(r=>{
  const c=r.compare||{},b=r.backtest||{},status=String(c.v2_status||"not_collected");
  if(filter==="ready"&&status!=="ready")return false;
  if(filter==="missing"&&status==="ready")return false;
  if(filter==="verified"&&c.verified!==true&&b.verified!==true)return false;
  if(search&&![(r.id),c.home,c.away,b.home,b.away,nrTeam(c.home||b.home),nrTeam(c.away||b.away)].some(x=>String(x??"").toLowerCase().includes(search)))return false;
  return true;
 });
 const summary=document.getElementById("nrVisible");if(summary)summary.textContent="顯示 "+rows.length+" 場｜左 V1 正式、右 "+(nrNames[model]||"V2")+"｜研究結果不影響會員推薦";
 const cards=document.getElementById("nrRows");if(!cards)return;
 cards.innerHTML=rows.length?rows.map(r=>nrCards(r,model)).join(""):'<div class="nr-empty">目前沒有符合條件的賽事資料</div>';
}
