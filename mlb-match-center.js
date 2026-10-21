/* HABAO MLB match center staging — no analysis, credits, or private token. */
(function(){
"use strict";
const API="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/baseball-public-fixtures";
const names={"Milwaukee Brewers":"密爾瓦基釀酒人","Tampa Bay Rays":"坦帕灣光芒","Los Angeles Dodgers":"洛杉磯道奇","New York Mets":"紐約大都會","New York Yankees":"紐約洋基","Boston Red Sox":"波士頓紅襪","Chicago Cubs":"芝加哥小熊","St. Louis Cardinals":"聖路易紅雀","Cleveland Guardians":"克里夫蘭守護者","Toronto Blue Jays":"多倫多藍鳥","Seattle Mariners":"西雅圖水手","San Diego Padres":"聖地牙哥教士","Philadelphia Phillies":"費城費城人","Houston Astros":"休士頓太空人","Detroit Tigers":"底特律老虎","Atlanta Braves":"亞特蘭大勇士","Texas Rangers":"德州遊騎兵","Baltimore Orioles":"巴爾的摩金鶯","Kansas City Royals":"堪薩斯市皇家","Arizona Diamondbacks":"亞利桑那響尾蛇","San Francisco Giants":"舊金山巨人","Minnesota Twins":"明尼蘇達雙城","Los Angeles Angels":"洛杉磯天使","Pittsburgh Pirates":"匹茲堡海盜","Cincinnati Reds":"辛辛那提紅人","Washington Nationals":"華盛頓國民","Miami Marlins":"邁阿密馬林魚","Colorado Rockies":"科羅拉多落磯","Chicago White Sox":"芝加哥白襪","Athletics":"運動家"};
const esc=(s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const lang=()=>window.HabaoI18n?.getLanguage?.()||"zh-Hant";
const t=(v)=>lang()==="en"?String(v||""):lang()==="zh-Hans"&&window.HabaoI18n?.toSimplified?window.HabaoI18n.toSimplified(names[v]||v||""):names[v]||v||"";
const taiwanDate=(offset)=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const d=new Date(p+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
const getWindow=(kickoff)=>{const diff=Date.parse(kickoff)-Date.now();return{started:!Number.isFinite(diff)||diff<=0,open:diff>0&&diff<=36000000};};
// Internal MLB UI preview: only the existing test account and explicit query value.
const mlbPreviewDate=(()=>{try{const member=JSON.parse(sessionStorage.getItem("habao_member")||"null");const requested=new URLSearchParams(location.search).get("mlb_test_date");return member?.account==="google_2d3cef6b6e2d"&&requested==="2026-10-24"?requested:null;}catch{return null;}})();
const badge=(id)=>Number.isInteger(Number(id))&&Number(id)>0?"https://www.mlbstatic.com/team-logos/"+Number(id)+".svg":"";
let filter="all", cache=new Map(), saved=null, memberEnabled=false;
const CONFIG="https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/baseball-feature-config";
async function syncMlbGate(){try{const r=await fetch(CONFIG,{cache:"no-store"});const j=await r.json();memberEnabled=r.ok&&j.success===true&&j.member_analysis_enabled===true;}catch{memberEnabled=false;}}
async function runMlbMember(gameId,button){if(!memberEnabled)return;const session=(await supabaseAuth.auth.getSession()).data?.session;if(!session?.access_token){alert("請先使用會員登入");return;}button.disabled=true;button.textContent="讀取正式分析中…";try{const r=await fetch("https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/baseball-member-analysis",{method:"POST",headers:{"Content-Type":"application/json",apikey:FIXTURES_PUBLISHABLE_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify({game_id:gameId,action:"view"})});const j=await r.json();if(!r.ok||j.success!==true)throw Error(j.error||"mlb_analysis_failed");sessionStorage.setItem("matchAnalysis",JSON.stringify(j));location.href="mlb-analysis.html";}catch(e){alert("MLB 分析尚未完成："+String(e.message||e));}finally{button.disabled=false;button.textContent="開始分析";}}
window.runMlbMember=runMlbMember;
function setup(){
 if(currentHabaoSport!=="baseball")return;
 const input=document.getElementById("fixtureSearchInput"),clear=document.getElementById("fixtureSearchClear"),filters=document.getElementById("fixtureLeagueFilter"),groups=document.getElementById("fixtureLeagueGroups"),caption=document.getElementById("leagueFilterCaption");
 if(!saved)saved={input:input?.oninput,clear:clear?.onclick,filters:filters?.onclick,groups:groups?.onclick,groupsHTML:groups?.innerHTML,caption:caption?.textContent};
 if(groups){groups.innerHTML='<button type="button" class="v3-league-group-btn active" data-category="popular">熱門</button>';groups.onclick=()=>apply();}
 if(caption)caption.textContent="MLB LEAGUE";
 if(filters){filters.innerHTML='<button type="button" class="league-filter-btn active" data-mlb-league="all">全部</button><button type="button" class="league-filter-btn" data-mlb-league="mlb">MLB</button>';filters.onclick=e=>{const btn=e.target.closest("[data-mlb-league]");if(!btn)return;filter=btn.dataset.mlbLeague;filters.querySelectorAll("[data-mlb-league]").forEach(b=>b.classList.toggle("active",b===btn));apply();};}
 if(input){input.oninput=()=>{clear?.classList.toggle("show",!!input.value.trim());apply();};}
 if(clear)clear.onclick=()=>{if(input){input.value="";input.focus();}clear.classList.remove("show");apply();};
}
function apply(){
 if(currentHabaoSport!=="baseball")return;
 const c=document.getElementById("matchesContainer");if(!c)return;
 const q=String(document.getElementById("fixtureSearchInput")?.value||"").trim().toLowerCase();
 let shown=0;const cards=c.querySelectorAll("[data-mlb-game-id]");cards.forEach(card=>{const yes=(!q||String(card.dataset.search).toLowerCase().includes(q))&&(filter==="all"||filter==="mlb");card.hidden=!yes;card.style.display=yes?"":"none";if(yes)shown++});
 c.querySelector(".fixture-search-empty")?.remove();
 if(cards.length&&!shown)c.insertAdjacentHTML("beforeend",'<div class="ai-note fixture-search-empty">找不到符合搜尋條件的 MLB 賽事。</div>');
}
function card(g){
 const w=getWindow(g.kickoff_at),status=String(g?.status?.long||"").toLowerCase(),finished=/final|completed|game over/.test(status),live=!finished&&w.started,ready=w.open&&!live&&!finished;
 const home=t(g.home?.name),away=t(g.away?.name),time=new Date(g.kickoff_at).toLocaleTimeString("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false});
 const logo=(team)=>{const src=badge(team?.id);return src?'<img class="team-logo" loading="lazy" src="'+src+'" alt="" onerror="this.replaceWith(document.createTextNode(\'⚾\'))">':'⚾';};
 return '<article class="match-card v2-match-card" data-mlb-game-id="'+esc(g.fixture_id)+'" data-search="'+esc([g.home?.name,g.away?.name,home,away,"MLB"].join(" "))+'">'+
 '<div class="v2-match-card-top"><div class="v2-match-league"><span class="v2-league-dot"></span>⚾ MLB 美國職棒大聯盟</div><div class="v2-match-time">'+esc(time)+'</div></div>'+
 '<div class="v2-match-teams"><div class="v2-match-team"><div class="v2-team-logo-box">'+logo(g.home)+'</div><div class="team-name">'+esc(home)+'</div><div class="v2-team-side">主隊</div></div><div class="v2-match-vs-center"><div class="v2-vs-ring">VS</div><div class="v2-match-line"></div></div><div class="v2-match-team"><div class="v2-team-logo-box">'+logo(g.away)+'</div><div class="team-name">'+esc(away)+'</div><div class="v2-team-side">客隊</div></div></div>'+
 '<div class="analysis v2-match-action"><div class="ai-status v2-status '+(live||finished?"finished":ready?"ready":"locked")+'"><span></span>'+(finished?"MATCH FINISHED":live?"MATCH LIVE":ready?"T-10 已開放 · MLB 測試中":"AI ANALYSIS LOCKED")+'</div><button type="button" class="analyze-btn" ' +(ready&&memberEnabled?'onclick="runMlbMember('+Number(g.fixture_id)+',this)"':'disabled')+'>'+(finished?"✓ 已完賽":live?"比賽進行中":ready&&memberEnabled?"開始分析":ready?"分析功能驗收中":"賽前 10 小時開放分析")+'</button></div></article>';
}
async function load(offset=0){
 if(currentHabaoSport!=="baseball")return;
 const title=document.getElementById("fixtureSectionTitle"),c=document.getElementById("matchesContainer");if(!c)return;
 if(title)title.textContent=mlbPreviewDate?"⚾ MLB 測試賽事｜"+mlbPreviewDate:(offset===0?"⚾ 今日 MLB 賽事":"⚾ 明日 MLB 賽事");
 const date=mlbPreviewDate||taiwanDate(offset);c.innerHTML='<div class="ai-note">正在取得 MLB 賽事…</div>';setup();
 let data=cache.get(date);
 try{
  if(!data||Date.now()-data.at>120000){
    const res=await fetch(API+"?date="+encodeURIComponent(date),{method:"GET",headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
    const body=await res.json();if(!res.ok||body.success!==true)throw new Error(body.error||"MLB 賽程讀取失敗");
    data={at:Date.now(),fixtures:Array.isArray(body.fixtures)?body.fixtures:[]};cache.set(date,data);
  }
  if(currentHabaoSport!=="baseball"||(mlbPreviewDate||taiwanDate(offset))!==date)return;
  c.innerHTML=data.fixtures.length?data.fixtures.map(card).join(""):'<div class="ai-note">當日沒有 MLB 賽事。</div>';apply();
 }catch(e){if(currentHabaoSport==="baseball")c.innerHTML='<div class="ai-note">MLB 賽程資料尚未開放，請稍後再試。<small style="display:block">'+esc(e?.message||"")+'</small></div>';}
}
const originalSelect=window.selectHabaoSport,originalSwitch=window.switchDate;
window.selectHabaoSport=function(sport,button){
 if(sport!=="baseball"){if(saved&&currentHabaoSport==="baseball"){const input=document.getElementById("fixtureSearchInput"),clear=document.getElementById("fixtureSearchClear"),filters=document.getElementById("fixtureLeagueFilter"),groups=document.getElementById("fixtureLeagueGroups"),caption=document.getElementById("leagueFilterCaption");if(input)input.oninput=saved.input;if(clear)clear.onclick=saved.clear;if(filters)filters.onclick=saved.filters;if(groups){groups.onclick=saved.groups;groups.innerHTML=saved.groupsHTML;}if(caption)caption.textContent=saved.caption; saved=null;}return originalSelect(sport,button);}
 currentHabaoSport="baseball";currentFixtureOffset=0;
 document.querySelectorAll(".v3-sport-tab").forEach(b=>b.classList.toggle("active",b.dataset.sport==="baseball"));
 document.querySelectorAll(".date").forEach((b,i)=>b.classList.toggle("active",i===0));
 document.getElementById("fixtureTools")?.classList.remove("is-hidden");
 if(typeof resetBatchAnalysisUI==="function")resetBatchAnalysisUI();
 setup();syncMlbGate().then(()=>load(0));
};
// Preserve normal production behavior; only an explicitly authorized preview opens automatically.
if(mlbPreviewDate){
 const start=()=>window.selectHabaoSport("baseball",document.querySelector('.v3-sport-tab[data-sport="baseball"]'));
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
}
window.switchDate=function(element,offset){
 if(currentHabaoSport!=="baseball")return originalSwitch(element,offset);
 document.querySelectorAll(".date").forEach(b=>b.classList.remove("active"));element.classList.add("active");currentFixtureOffset=offset;load(offset);
};
})();