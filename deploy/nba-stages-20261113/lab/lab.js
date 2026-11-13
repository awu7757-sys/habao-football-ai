'use strict';
const LAB=JSON.parse(document.getElementById('payload').textContent),clone=x=>JSON.parse(JSON.stringify(x));
const $=id=>document.getElementById(id),esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const scenarios=[
 {id:'before',label:'T-10 前：尚未開放',minutes:601,owned:[],button:'賽前 10 小時開放',disabled:true},
 {id:'t10',label:'T-10：開始分析',minutes:590,owned:[],button:'開始分析',disabled:false},
 {id:'wait2',label:'已領 T-10：等待 T-2',minutes:121,owned:['t10'],button:'深度分析・',disabled:true},
 {id:'t2',label:'T-2：深度分析',minutes:60,owned:['t10'],button:'深度分析',disabled:false},
 {id:'wait15',label:'已領 T-2：等待 T-15',minutes:16,owned:['t10','t2'],button:'最終分析・',disabled:true},
 {id:'t15',label:'T-15：最終分析',minutes:14,owned:['t10','t2'],button:'最終分析',disabled:false},
 {id:'done',label:'三階段已領取：免費重看',minutes:10,owned:['t10','t2','t15'],button:'已領取最終分析',disabled:true},
 {id:'started',label:'開賽後：分析截止',minutes:-1,owned:['t10','t2','t15'],button:'分析已截止',disabled:true},
 {id:'empty',label:'T-2：額度不足',minutes:60,owned:['t10'],button:'深度分析',disabled:false,credits:0},
 {id:'confirmed',label:'T-15：確認先發分支（合成範例）',minutes:14,owned:['t10','t2'],button:'最終分析',disabled:false,confirmed:true}
];
const state={bundle:clone(LAB.demo),scenario:scenarios[3],claims:{},credits:50,ledger:[],storage:{},view:'fixtures',search:'',token:0,waiting:null};
function currentBundle(){const b=clone(state.bundle);if(state.scenario.confirmed&&b.origin==='synthetic_display_examples')for(const g of b.games){const v=g.variants?.confirmed;if(v){g.results.t15=v.result;g.models.t15=v.model;g.metas.t15=v.meta;}}return b;}
function displaySafe(v){if(typeof v==='string')return v.replaceAll('<','＜').replaceAll('>','＞');if(Array.isArray(v))return v.map(displaySafe);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,displaySafe(x)]));return v;}
function bootstrap(seed){
 const NativeDate=Date,wait=window.setTimeout.bind(window),storage=new Map(Object.entries(seed.storage||{}));
 const claims=seed.claims;let credits=seed.credits;const ledger=seed.ledger;
 function send(kind,extra={}){parent.postMessage({qa:true,token:seed.token,kind,...extra},'*');}
 class ReplayDate extends NativeDate{constructor(...a){super(...(a.length?a:[seed.now]));}static now(){return seed.now;}}
 window.Date=ReplayDate;window.__qaSearch=seed.search;
 const memory={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),clear:()=>storage.clear(),key:i=>[...storage.keys()][i]??null,get length(){return storage.size;}};
 Object.defineProperty(window,'sessionStorage',{value:memory});Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem(){},removeItem(){}}});
 window.HabaoI18n={t:(k,f)=>f,getLanguage:()=> 'zh-Hant',toSimplified:x=>x,registerTranslations(){}};
 window.setInterval=()=>0;window.open=()=>null;
 window.alert=x=>send('alert',{message:String(x)});
 window.footballV2StageHeaders=async()=>({'Content-Type':'application/json'});
 const dump=()=>({claims,credits,ledger,storage:Object.fromEntries(storage)});
 window.__qaNavigate=url=>send('navigate',{url:String(url),...dump()});
 window.__qaSync=()=>send('state',dump());
 window.showQuotaLimitModal=()=>alert('隔離測試：額度不足，沒有新增虛擬扣點。');
 window.resetBatchAnalysisUI=()=>{document.querySelectorAll('.batch-analysis-checkbox').forEach(x=>{x.checked=false;x.disabled=false;});};
 window.habaoSetupNbaFixtureTools=()=>{};window.habaoApplyNbaFixtureFilters=()=>{};
 window.localizeBasketballLocation=()=>'';window.getBasketballRequestDate=()=>'';window.isHabaoNbaPreviewTester=()=>false;
 window.escapeBasketballHTML=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const names={'Phoenix Suns':'鳳凰城太陽','Charlotte Hornets':'夏洛特黃蜂','Minnesota Timberwolves':'明尼蘇達灰狼','Dallas Mavericks':'達拉斯獨行俠'};
 window.getBasketballTeamName=name=>names[name]||name;
 const fallback='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#1a3548"/><text x="50" y="66" text-anchor="middle" font-size="48">🏀</text></svg>');
 window.getBasketballTeamLogoData=name=>({src:seed.logos[name]||fallback,fallback:'',backup:''});window.handleBasketballLogoError=img=>{img.onerror=null;img.src=fallback;};
 window.setAnalysisHistorySport=sport=>{if(sport!=='basketball')alert('這個隔離頁只重播 NBA。');};
 window.fetch=async(url,options={})=>{
  const body=JSON.parse(options.body||'{}');
  if(!String(url).includes('nba-v2-stage-member')&&!String(url).includes('qa.invalid/legacy-member'))return new Response(JSON.stringify({success:false,error:'isolated_network_blocked'}),{status:403});
  if(body.action==='status')return new Response(JSON.stringify({success:true,enabled:true,stages:Object.fromEntries(seed.games.map(g=>[g.game_id,{claimed:claims[g.game_id]||{},ready:{t2:!!g.results.t2,t15:!!g.results.t15}}]))}));
  if(body.action==='history')return new Response(JSON.stringify({success:true,enabled:true,matches:[]}));
  await new Promise(r=>wait(r,450));
  const id=Number(body.game_id),stage=body.stage||'t10',game=seed.games.find(g=>g.game_id===id),result=game?.results?.[stage];
  const respond=(b,status=200)=>new Response(JSON.stringify(b),{status});
  if(!result)return respond({success:false,error:'stage_snapshot_not_ready'},409);
  const old=claims[id]?.[stage]===true;
  if(!old){if(credits<=0)return respond({success:false,error:'analysis_credits_empty'},402);credits--;claims[id]={...claims[id],[stage]:true};ledger.push({game_id:id,stage,delta:-1});}
  const access={analysis_unlimited:false,paid_remaining:credits,daily_free_remaining:0,remaining_paid_credits:credits,remaining_daily_credits:0};
  window.__qaSync();
  return stage==='t10'?respond({...result,member_access:access}):respond({success:true,already_claimed:old,result,...(old?{}:{member_access:access})});
 };
 addEventListener('error',e=>send('error',{message:e.message}));
 document.addEventListener('click',e=>{const a=e.target.closest('a');if(a){e.preventDefault();window.__qaNavigate('football.html');}},true);
 window.__qaReady=async()=>{
  if(document.querySelector('[data-basketball-fixture-id]'))await window.habaoNbaStages?.refresh(seed.fixtures);
  await new Promise(r=>wait(r,25));
  send('ready',{...dump(),cards:[...document.querySelectorAll('[data-basketball-fixture-id]')].map(c=>({id:Number(c.dataset.basketballFixtureId),label:c.querySelector('.analysis-btn')?.textContent?.trim(),disabled:c.querySelector('.analysis-btn')?.disabled,stage:c.querySelector('.analysis-btn')?.dataset.nbaStage,status:c.querySelector('.ai-status')?.textContent?.trim()})),
   heading:document.querySelector('#app h1')?.textContent?.trim(),history_cards:document.querySelectorAll('.history-match-card').length,
   width:innerWidth,scrollWidth:document.documentElement.scrollWidth});
 };
}
function resetScenario(s){state.scenario=s;state.claims=Object.fromEntries(state.bundle.games.map(g=>[g.game_id,Object.fromEntries(s.owned.filter(k=>g.results[k]).map(k=>[k,true]))]));state.credits=s.credits??50;state.ledger=[];state.storage={};state.search='';state.view='fixtures';}
function frameBoot(seed){return '('+bootstrap.toString()+')('+JSON.stringify(seed).replaceAll('<','\\u003c')+');';}
function seedFor(view){
 const games=displaySafe(currentBundle().games);
 for(const g of games)for(const r of Object.values(g.results)){if(r?.fixture){r.fixture.home.logo=LAB.logos[g.home_team]||'';r.fixture.away.logo=LAB.logos[g.away_team]||'';}if(r.game_id==null)r.game_id=g.game_id;if(r.success==null)r.success=true;if(r.sport==null)r.sport='basketball';}
 const kickoff=Date.parse(games[0].fixture_time),now=kickoff-state.scenario.minutes*60000;
 const fixtures=games.map(g=>({fixture_id:g.game_id,kickoff_at:g.fixture_time,competition_name:'NBA',home:{name:g.home_team},away:{name:g.away_team},status:{short:1}}));
 const storage={...state.storage,habao_member:JSON.stringify({account:'qa_isolated_member',analysis_credits:state.credits,daily_free_credits:0,member_level:'vip'})};
 return {token:++state.token,games,fixtures,now,claims:clone(state.claims),credits:state.credits,ledger:clone(state.ledger),storage,search:state.search,logos:LAB.logos,view};
}
const frameCsp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;connect-src 'none';form-action 'none';base-uri 'none';object-src 'none';frame-src 'none';worker-src 'none'">`;
function childDoc(seed){
 const boot=frameBoot(seed),script=code=>'<script>'+code.replaceAll('</script','<\\/script')+'</script>';
 if(seed.view==='result'){
  let html=LAB.analysis.replace('<head>','<head>'+frameCsp+script(boot));
  html=html.replace('</body>',script('window.__qaReady();')+'</body>');return html;
 }
 const globals=`const HABAO_ANALYSIS_OPEN_MS=600*60000,NBA_ARENA_ZH={},NBA_CITY_ZH={};let currentFixtureOffset=0,currentHabaoSport='basketball',habaoSportBatchRunning=false,habaoSportBatchFinished=false;const habaoNbaPendingGames=new Set(),BASKETBALL_MEMBER_ANALYSIS_URL='https://qa.invalid/legacy-member',BASKETBALL_ANALYSIS_PREVIEW_URL='',FIXTURES_PUBLISHABLE_KEY='qa-placeholder';`;
 const rows=[];for(const g of seed.games)for(const [stage,owned]of Object.entries(seed.claims[g.game_id]||{})){if(!owned||!g.results[stage])continue;rows.push({id:g.game_id+':'+stage,history_key:'basketball:qa:'+g.game_id+':'+stage,sport:'basketball',game_id:g.game_id,fixture_time:g.fixture_time,home_team:g.home_team,away_team:g.away_team,v2_stage:stage==='t10'?undefined:stage,result_data:g.results[stage]});}
 const init=seed.view==='history'?'renderAnalysisHistory('+JSON.stringify(rows).replaceAll('<','\\u003c')+',"basketball");':'renderBasketballFixtureData({fixtures:'+JSON.stringify(seed.fixtures)+'},0,document.getElementById("matchesContainer"));';
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+frameCsp+'<style>'+LAB.css+'body{margin:0!important;display:block!important;min-height:0!important}#qaWrap{max-width:1100px;margin:0 auto;padding:14px}#matchesContainer{width:100%;margin:0}#fixtureSectionTitle{font-size:18px;color:#d4e8f7;margin:4px 0 12px}</style>'+script(boot)+'</head><body><div id="qaWrap"><h2 id="fixtureSectionTitle">'+(seed.view==='history'?'我的分析':'賽事中心')+'</h2><div id="matchesContainer"></div></div><div id="batchAnalysisBar"><span id="batchAnalysisCount"></span><span id="batchAnalysisSub"></span><button id="batchAnalysisStart" onclick="startHabaoSportBatchAnalysis()">開始批次分析</button></div>'+script(globals+LAB.window+LAB.member+LAB.fixtures+LAB.selection+LAB.batch+LAB.history)+script(LAB.stages)+script(init+'window.__qaReady();')+'</body></html>';
}
async function render(view=state.view){
 state.view=view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 $('viewTitle').textContent=view==='fixtures'?'賽事中心':view==='history'?'我的分析':'分析結果（可從上方返回賽事中心／我的分析）';
 const seed=seedFor(view);$('origin').textContent=state.bundle.origin==='synthetic_display_examples'?'顯示範例（非正式預測）':'匯入的正式快照副本';
 $('clock').textContent=new Date(seed.now).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});$('credits').textContent=state.credits;$('charged').textContent=state.ledger.length;
 $('description').textContent=(state.scenario.confirmed?'此情境的確認名單是合成分支，不代表原賽事曾在該時間確認先發。':'')+(state.bundle.description||'僅讀取保存結果；不代表重新產生預測。');$('raw').textContent=JSON.stringify(currentBundle().games,null,2);drawAudit();
 return await new Promise(resolve=>{state.waiting={token:seed.token,resolve};$('view').srcdoc=childDoc(seed);setTimeout(()=>{if(state.waiting?.token===seed.token){state.waiting=null;toast('模板初始化逾時，請重設此情境。');resolve({error:true});}},10000);});
}
function toast(message){$('toast').textContent=message;}
addEventListener('message',event=>{
 const p=event.data;if(event.source!==$('view').contentWindow||!p?.qa||p.token!==state.token)return;
 if(p.claims){state.claims=p.claims;state.credits=p.credits;state.ledger=p.ledger;state.storage=p.storage;$('credits').textContent=p.credits;$('charged').textContent=p.ledger.length;}
 if(p.kind==='alert'||p.kind==='error')toast(p.message);
 if(p.kind==='ready'&&state.waiting?.token===p.token){const resolve=state.waiting.resolve;state.waiting=null;resolve(p);}
 if(p.kind==='navigate'){
  if(p.url.includes('analysis.html')){state.search=new URL(p.url,'https://qa.invalid/').search;render('result');}
  else render('fixtures');
 }
});
function normalCdf(x){const z=Math.abs(x),t=1/(1+.2316419*z),d=.3989422804014327*Math.exp(-z*z/2),r=1-d*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?r:1-r;}
function auditBundle(bundle){
 const rows=[],add=(game,stage,name,status,detail)=>rows.push({game,stage,name,status,detail});
 for(const g of bundle.games)for(const [stage,r]of Object.entries(g.results)){
  const m=g.models?.[stage],game=g.home_team+' vs '+g.away_team;
  add(game,stage,'推薦資料可供正式模板讀取',r?.analysis?.recommendations?'PASS':'CHECK',r?.analysis?.recommendations?'已保存的獨贏／讓分／大小分資料':'未取得支援的推薦結構');
  if(stage==='t10'){add(game,stage,'T-10 模型重算','待驗證','此頁呈現保存值，不將其他模型冒充原 T-10 算法。');continue;}
  if(!m){add(game,stage,'模型輸出','待驗證','沒有 model_output。');continue;}
  for(const [name,a,b]of [['分差',Number(m.expected_home_points)-Number(m.expected_away_points),Number(m.expected_margin)],['總分',Number(m.expected_home_points)+Number(m.expected_away_points),Number(m.expected_total)]])add(game,stage,name,Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.021?'PASS':'CHECK',a.toFixed(3)+' / '+b.toFixed(3));
  for(const [field,mean,sigma]of [['home_win_probability',m.expected_margin,m.margin_sigma],['home_cover_probability',m.market?.home_spread==null?null:m.expected_margin+m.market.home_spread,m.margin_sigma],['over_probability',m.market?.total==null?null:m.expected_total-m.market.total,m.total_sigma]]){
   const expected=mean===null?null:Number.isFinite(mean)&&Number.isFinite(sigma)&&sigma>0?normalCdf(mean/sigma):undefined,actual=m[field];
   add(game,stage,field,expected===undefined?'待驗證':expected===null&&actual===null||Number.isFinite(actual)&&Math.abs(actual-expected)<=.0006?'PASS':'CHECK',expected===undefined?'缺少有效平均／標準差':JSON.stringify({saved:actual,recomputed:expected}));
  }
  const probs=[['moneyline',m.home_win_probability,'主隊','客隊',null],['handicap',m.home_cover_probability,'主隊','客隊',m.home_cover_probability>=.5?m.market?.home_spread:-m.market?.home_spread],['over_under',m.over_probability,'大','小',m.market?.total]];
  for(const [key,p,home,away,line]of probs){const actual=r.analysis?.recommendations?.[key],skip=p===null||p>.45&&p<.55,expected=skip?'暫不推薦':p>=.5?home:away,confidence=p===null?0:Math.round(100*Math.max(p,1-p));const ok=actual&&actual.pick===expected&&Number(actual.confidence)===confidence&&(skip?actual.line==null:line==null?actual.line==null:Number(actual.line)===Number(line));add(game,stage,key+' 推薦／盤線／信心',ok?'PASS':'CHECK',JSON.stringify({saved:actual,expected:{pick:expected,line:skip?null:line,confidence}}));}
  if(g.claim_checks?.[stage])for(const check of g.claim_checks[stage])add(game,stage,'會員領取與系統快照',check.result_matches_snapshot===true?'PASS':'CHECK',JSON.stringify(check));
 }
 return rows;
}
function drawAudit(){const rows=auditBundle(currentBundle());$('audit').innerHTML='<table><thead><tr><th>賽事／階段</th><th>檢查</th><th>狀態</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.game)+'<br>'+esc(r.stage.toUpperCase())+'</td><td>'+esc(r.name)+'<details><summary>數值</summary><pre>'+esc(r.detail)+'</pre></details></td><td class="'+(r.status==='PASS'?'pass':r.status==='CHECK'?'fail':'wait')+'">'+esc(r.status)+'</td></tr>').join('')+'</tbody></table>';}
async function matrix(){
 $('auto').disabled=true;const old=state.scenario,out=[];
 for(const s of scenarios.slice(0,8)){resetScenario(s);$('scenario').value=s.id;const p=await render('fixtures'),card=p.cards?.[0],pass=card&&card.label.includes(s.button)&&card.disabled===s.disabled;out.push({label:s.label,pass,actual:card?.label||'無結果',fits:p.scrollWidth<=p.width+1});$('matrix').innerHTML=out.map(r=>'<p class="'+(r.pass&&r.fits?'pass':'fail')+'">'+(r.pass&&r.fits?'PASS':'CHECK')+' · '+esc(r.label)+' · '+esc(r.actual)+(r.fits?'':'（寬度溢出）')+'</p>').join('');}
 resetScenario(old);$('scenario').value=old.id;await render();$('auto').disabled=false;toast('八種狀態檢查完成。虛擬領取／批次與免費重看可直接在下方模板點擊。');
}
function normalizeImport(raw){
 let b=Array.isArray(raw)?raw.find(x=>x.item==='nba_replay_bundle')?.detail:raw;if(typeof b==='string')b=JSON.parse(b);
 if(b?.schema!=='habao-nba-replay-v1'||!Array.isArray(b.games)||!b.games.length||b.games.length>20)throw Error('請匯入 11_export_saved_replay.sql 的完整 JSON；沒有資料時不能產生正式範例。');
 for(const g of b.games){if(!Number.isSafeInteger(Number(g.game_id))||!Number.isFinite(Date.parse(g.fixture_time)))throw Error('賽事識別或時間不完整');g.game_id=Number(g.game_id);g.results=g.results||{};for(const r of Object.values(g.results)){if(!r?.analysis||!r.fixture?.home||!r.fixture?.away)throw Error('快照不是支援的 NBA 結果格式；請提供完整匯出給助手核對。');}}
 return b;
}
$('scenario').innerHTML=scenarios.map(s=>'<option value="'+s.id+'">'+s.label+'</option>').join('');$('scenario').value='t2';
$('scenario').onchange=()=>{const s=scenarios.find(s=>s.id===$('scenario').value);if(s.confirmed&&state.bundle.origin!=='synthetic_display_examples'){$('scenario').value=state.scenario.id;toast('確認先發的合成分支只適用範例；不會修改匯入的正式名單。');return;}resetScenario(s);toast('');render();};$('reset').onclick=()=>{resetScenario(state.scenario);toast('');render();};$('auto').onclick=matrix;
$('mobile').onclick=()=>{$('frameBox').classList.toggle('mobile');$('mobile').textContent=$('frameBox').classList.contains('mobile')?'桌面寬度':'手機寬度';};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>render(b.dataset.view));$('latest').onclick=()=>{if(!state.storage.matchAnalysis)return toast('請先在模板內點擊分析，或到「我的分析」重看已領取階段。');state.search='?sport=basketball';render('result');};
$('sample').onclick=()=>{state.bundle=clone(LAB.demo);resetScenario(scenarios[3]);$('scenario').value='t2';drawAudit();render();};
$('import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>8*1024*1024)throw Error('檔案超過 8 MB');state.bundle=normalizeImport(JSON.parse(await file.text()));resetScenario(scenarios[3]);drawAudit();render();toast('已在本機記憶體載入正式快照副本，沒有上傳資料。');}catch(error){toast(error.message);}finally{e.target.value='';}};
$('hashes').textContent=JSON.stringify(LAB.hashes,null,2);resetScenario(scenarios[3]);drawAudit();render();
