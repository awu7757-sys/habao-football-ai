/* safe NBA walk-forward backtest dashboard */
const NBA_BT_API="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-model-backtest";
let nbaBtData=null;
const nbaBtf=n=>n==null||!Number.isFinite(Number(n))?"—":Number(n).toFixed(1);
const nbaBtPct=n=>n==null?"—":nbaBtf(n)+"%";
async function loadNbaBacktest(){
 const info=document.getElementById("nbaBtStatus");if(!info)return;
 info.textContent="載入歷史賽前快照及回測中…";
 try{const r=await fetch(NBA_BT_API,{method:"POST",headers:adminAuthHeaders(),body:JSON.stringify({action:"backtest"}),cache:"no-store"});
 const b=await r.json().catch(()=>({}));if(!r.ok||!b.success)throw Error([b.error||("HTTP "+r.status),b.detail].filter(Boolean).join("："));
 nbaBtData=b;info.textContent="賽前快照 "+b.total+" 場｜已驗證 "+b.verified+" 場｜研究專用，不消耗 NBA 歷史 API";renderNbaBacktest();
 }catch(e){info.textContent="回測讀取失敗："+String(e?.message||e)+"。請先部署 nba-model-backtest。";}
}
function renderNbaBacktest(){if(!nbaBtData)return;
 const names={v1_original:"V1 原始",market_anchored:"市場校正",rolling_corrected:"滾動誤差修正",hybrid:"混合模型"};
 const stats=document.getElementById("nbaBtStats");if(stats)stats.innerHTML=Object.entries(names).map(([key,title])=>{
 const d=nbaBtData.stats?.[key]||{};return '<div class="nv-stat"><b>'+title+'</b><div class="nv-stat-line">總分誤差 '+nbaBtf(d.total_mae)+' 分</div><small>讓分差誤差 '+nbaBtf(d.margin_mae)+' 分｜獨贏方向 '+nbaBtPct(d.moneyline?.hit_rate)+' ('+(d.moneyline?.n||0)+' 場)<br>讓分研究命中 '+nbaBtPct(d.spread?.hit_rate)+' ('+(d.spread?.n||0)+' 場)<br>大小分研究命中 '+nbaBtPct(d.total?.hit_rate)+' ('+(d.total?.n||0)+' 場)</small></div>';}).join("");
 const warning=document.getElementById("nbaBtWarning");if(warning)warning.textContent=nbaBtData.not_ready_for_promotion?"實際已驗證樣本未達 80 場，不能直接取代正式模型。":"達初步樣本門檻，仍須跨月份的獨立驗證才能調整正式模型。";
 const model=document.getElementById("nbaBtModel")?.value||"hybrid";const q=String(document.getElementById("nbaBtSearch")?.value||"").toLowerCase().trim();const esc=x=>typeof escapeHtml==="function"?escapeHtml(String(x??"")):String(x??"").replaceAll("<","&lt;");
 const list=(nbaBtData.rows||[]).filter(x=>!q||[x.game_id,x.home,x.away,typeof zhTeam==="function"?zhTeam(x.home):"",typeof zhTeam==="function"?zhTeam(x.away):""].some(t=>String(t??"").toLowerCase().includes(q))).slice(0,100);
 const holder=document.getElementById("nbaBtRows");if(!holder)return;holder.innerHTML=list.map(x=>{const v=x.variants?.[model]||{};const zh=n=>typeof zhTeam==="function"?zhTeam(n):n;
 const match=v.score?v.score.home+"－"+v.score.away:"—";const side=v.directions?.winner==="home"?"主勝方向":v.directions?.winner==="away"?"客勝方向":"無效分差";
 const sp=v.signals?.handicap==="home"?"主隊讓分方向":v.signals?.handicap==="away"?"客隊受讓方向":"無足夠市場差距";
 const ov=v.signals?.over_under==="over"?"大分方向":v.signals?.over_under==="under"?"小分方向":"無足夠市場差距";
 return '<div class="fvc-game-card" style="padding:16px"><div class="fvc-game-metadata">NBA #'+esc(x.game_id)+'　'+(x.verified?"已驗證":"未驗證")+'</div><div class="fvc-game-title">'+esc(zh(x.home))+' 對戰 '+esc(zh(x.away))+'</div><div class="fvc-metric-grid"><div class="fvc-metric"><span>預測比分</span><strong>'+match+'</strong></div><div class="fvc-metric"><span>獨贏</span><strong>'+side+'</strong></div><div class="fvc-metric"><span>讓分研究</span><strong>'+sp+'</strong></div><div class="fvc-metric"><span>大小分研究</span><strong>'+ov+'</strong></div><div class="fvc-metric"><span>預估總分</span><strong>'+nbaBtf(v.total)+'</strong></div><div class="fvc-metric"><span>市場大小分</span><strong>'+nbaBtf(x.market?.total)+'</strong></div></div></div>';}).join("")||'<div class="fvc-empty">沒有符合條件的場次</div>';
}
