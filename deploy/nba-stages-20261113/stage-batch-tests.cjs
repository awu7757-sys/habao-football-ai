const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const read=n=>fs.readFileSync(fs.existsSync(path.join(__dirname,n))?path.join(__dirname,n):path.join(__dirname,'../..',n),'utf8');
const html=read('football.html'),analysis=read('analysis.html'),pilot='google_2d3cef6b6e2d';
const helper=html.slice(html.indexOf('function habaoNbaMemberResponseValid('),html.indexOf('async function openBasketballMatch('));
const batch=html.slice(html.indexOf('async function startHabaoSportBatchAnalysis(){'),html.indexOf('window.addEventListener("beforeunload",event=>{'));
const clone=x=>JSON.parse(JSON.stringify(x)),json=x=>new Response(JSON.stringify(x));
const tests=[];function test(n,f){tests.push([n,f]);}
function element(className=''){
 const e={className,dataset:{},textContent:'',disabled:false,checked:false,value:'',children:[],style:{setProperty(){},removeProperty(){}},setAttribute(k,v){this[k]=v},appendChild(x){this.children.push(x)},replaceChildren(){this.children=[]},closest:()=>true};
 e.classList={contains:k=>e.className.split(/\s+/).includes(k),add:(...ks)=>e.className=[...new Set([...e.className.split(/\s+/),...ks])].join(' '),remove:(...ks)=>e.className=e.className.split(/\s+/).filter(x=>!ks.includes(x)).join(' '),toggle(k,b){const on=b??!this.contains(k);this[on?'add':'remove'](k);return on;}};return e;
}
function setup(options={}){
 const clock={now:Date.parse('2026-11-12T23:10:00Z')};class Clock extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
 const fixtures=options.fixtures||[{fixture_id:1,kickoff_at:new Date(clock.now+50*60000).toISOString()},{fixture_id:2,kickoff_at:new Date(clock.now+170*60000).toISOString()},{fixture_id:3,kickoff_at:new Date(clock.now+10*60000).toISOString()}];
 const cards=new Map(),stored=new Map([['habao_member',JSON.stringify({account:options.account||pilot,analysis_credits:10})]]),calls=[],alerts=[],claims=new Set(options.claimed||[]),results=new Map();
 let credits=10;const ui=element(),inputs=[];
 for(const f of fixtures){const card=element('v2-match-card'),button=element('analysis-btn v2-analysis-btn'),status=element('ai-status'),input=element(),label=element();input.value=String(f.fixture_id);input.dataset={sport:'basketball',kickoffAt:f.kickoff_at};card.dataset={nbaStatus:'upcoming',basketballFixtureId:String(f.fixture_id),nbaKickoff:f.kickoff_at};const parent=element();button.parentElement=parent;input.parentElement=label;
  card.querySelector=s=>s==='.analysis-btn.v2-analysis-btn'?button:s==='.ai-status'?status:s==='[data-nba-stage-actions]'?parent.children.find(x=>x.dataset.nbaStageActions):s==='.v2-batch-select span'?label:s==='.batch-analysis-checkbox'?input:null;
  cards.set(f.fixture_id,{card,button,status,input,label,parent});inputs.push(input);
 }
 function saved(id,stage){const key=id+':'+stage;if(!results.has(key))results.set(key,{success:true,sport:'basketball',game_id:id,...(stage==='t10'?{}:{v2_stage:stage}),fixture:{id,date:fixtures.find(f=>f.fixture_id===id).kickoff_at,home:{name:'Home'},away:{name:'Away'}},analysis:{recommendations:{moneyline:{pick:'主隊',confidence:61},handicap:{pick:'客隊',line:7.5,confidence:68},over_under:{pick:'大',line:223.5,confidence:55}}}});return clone(results.get(key));}
 const c=vm.createContext({Date:Clock,Number,Set,Map,Array,JSON,Response,AbortSignal,console:{warn(){}},habaoSportBatchRunning:false,habaoSportBatchFinished:false,currentHabaoSport:'basketball',BASKETBALL_MEMBER_ANALYSIS_URL:'legacy-member',FIXTURES_PUBLISHABLE_KEY:'public',
  window:{location:{},setInterval(){},addEventListener(){}},sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},
  document:{visibilityState:'visible',head:{appendChild(){}},createElement:()=>element(),getElementById:()=>ui,querySelector(s){const id=Number(s.match(/fixture-id="(\d+)"/)?.[1]);return cards.get(id)?.card||null;},querySelectorAll(s){if(s.includes('fixture-id'))return [...cards.values()].map(x=>x.card);return s.includes(':checked')?inputs.filter(x=>x.checked):inputs;}},
  footballV2StageHeaders:async()=>({'Content-Type':'application/json'}),updateBatchSelection(){},openBasketballMatch(){},alert:x=>alerts.push(x),showQuotaLimitModal:x=>alerts.push(x),resetBatchAnalysisUI(){},
  fetch:async(url,init)=>{const b=JSON.parse(init.body);calls.push({url,body:b});if(url==='legacy-member')return json(saved(b.game_id,'t10'));
   if(b.action==='status')return json({success:true,enabled:options.disabled!==true,stages:Object.fromEntries(fixtures.map(f=>[f.fixture_id,{claimed:{t10:true,t2:claims.has(f.fixture_id+':t2'),t15:claims.has(f.fixture_id+':t15')},ready:{t2:true,t15:true}}]))});
   if(b.action==='history')return json({success:true,enabled:true,matches:[...claims].map(key=>{const [id,stage]=key.split(':');return {id:'stage-'+key,game_id:Number(id),sport:'basketball',v2_stage:stage,fixture_time:fixtures.find(x=>x.fixture_id===Number(id)).kickoff_at,history_key:'basketball:stage:'+key,result_data:saved(Number(id),stage)};})});
   if(b.action==='claim'){
    if(options.fail?.[b.game_id])return json({success:false,error:options.fail[b.game_id]});
    if(options.deferred)await options.deferred.promise;
    const key=b.game_id+':'+b.stage,old=claims.has(key);if(!old){claims.add(key);credits--;}
    return json({success:true,result:options.wrongStage?{...saved(b.game_id,b.stage),v2_stage:'t10'}:saved(b.game_id,b.stage),already_claimed:old,...(old?{}:{member_access:{paid_remaining:credits,daily_free_remaining:0}})});
   }throw Error('unexpected route');
  }
 });
 vm.runInContext('const habaoNbaPendingGames=new Set();\n'+helper+batch,c);vm.runInContext(read('nba-stages.js'),c);
 return {c,clock,fixtures,cards,inputs,stored,calls,alerts,claims,results,saved,credits:()=>credits,ready:()=>c.window.habaoNbaStages.refresh(fixtures),api:()=>c.window.habaoNbaStages};
}
test('batch labels match actual stage and waiting buttons show the opening time',async()=>{const x=setup();await x.ready();assert.equal(x.cards.get(1).input.dataset.nbaStage,'t2');assert.equal(x.cards.get(2).input.dataset.nbaStage,'t10');assert.equal(x.cards.get(3).input.dataset.nbaStage,'t15');assert.equal(x.cards.get(2).button.disabled,true);assert.match(x.cards.get(2).button.textContent,/08:00 開放/);assert.match(x.cards.get(1).label.textContent,/加入 T-2/);assert.match(x.cards.get(3).label.textContent,/加入 T-15/);});
test('mixed-stage batch calls t2/t15 stage endpoint and t10 legacy endpoint',async()=>{const x=setup();await x.ready();x.inputs.forEach(v=>v.checked=true);await x.c.startHabaoSportBatchAnalysis();const reads=x.calls.filter(v=>v.body.action==='claim'||v.url==='legacy-member');assert.deepEqual(reads.map(v=>v.body.stage||'t10'),['t2','t10','t15']);const b=JSON.parse(x.stored.get('matchAnalysisBatch'));assert.deepEqual(b.results.map(v=>v.v2_stage||'t10'),['t2','t10','t15']);assert.equal(x.credits(),8);assert.equal(JSON.parse(x.stored.get('habao_member')).analysis_credits,8);});
test('two new T-2 games cost two points; history, status and batch replay cost none',async()=>{
 const now=Date.parse('2026-11-12T23:10:00Z'),x=setup({fixtures:[{fixture_id:11,kickoff_at:new Date(now+50*60000).toISOString()},{fixture_id:12,kickoff_at:new Date(now+110*60000).toISOString()}]});
 await x.ready();x.inputs.forEach(v=>v.checked=true);await x.c.startHabaoSportBatchAnalysis();
 const first=x.calls.filter(v=>v.body.action==='claim');assert.equal(first.length,2);assert.deepEqual(first.map(v=>[v.body.game_id,v.body.stage]),[[11,'t2'],[12,'t2']]);assert.equal(x.calls.filter(v=>v.url==='legacy-member').length,0);
 assert.equal(x.credits(),8);assert.equal(JSON.parse(x.stored.get('habao_member')).analysis_credits,8);assert.equal(x.claims.size,2);assert.equal(JSON.parse(x.stored.get('matchAnalysisBatch')).results.length,2);
 const history=await x.api().history();assert.equal(history.length,2);await x.ready();x.api().reconcile();assert.equal(x.credits(),8);
 x.inputs.forEach(v=>v.checked=true);await x.c.startHabaoSportBatchAnalysis();assert.equal(x.credits(),8);assert.equal(JSON.parse(x.stored.get('habao_member')).analysis_credits,8);assert.equal(x.claims.size,2);
});
test('single and batch return byte-equivalent frozen stage result and charge only once',async()=>{const x=setup();await x.ready();await x.api().claim(1,'t2',x.cards.get(1).button);const one=JSON.parse(x.stored.get('matchAnalysis'));assert.equal(x.credits(),9);assert.match(x.cards.get(1).button.textContent,/07:45 開放/);assert.match(x.cards.get(1).label.textContent,/重看 T-2/);x.inputs[0].checked=true;await x.c.startHabaoSportBatchAnalysis();const b=JSON.parse(x.stored.get('matchAnalysisBatch'));assert.deepEqual(b.results[0],one);assert.equal(x.credits(),9);});
test('already claimed T-15 batch rewatch remains free',async()=>{const x=setup({claimed:['3:t15']});await x.ready();assert.equal(x.cards.get(3).button.disabled,true);assert.match(x.cards.get(3).label.textContent,/重看 T-15/);x.inputs[2].checked=true;await x.c.startHabaoSportBatchAnalysis();assert.equal(x.credits(),10);assert.equal(JSON.parse(x.stored.get('matchAnalysisBatch')).results[0].v2_stage,'t15');});
test('T-2 selection cannot silently become a T-15 charge',async()=>{const x=setup();await x.ready();x.inputs[0].checked=true;x.clock.now+=36*60000;await x.c.startHabaoSportBatchAnalysis();assert.equal(x.calls.filter(v=>v.body.action==='claim').length,0);assert.equal(x.credits(),10);assert.match(x.alerts[0],/階段已更新/);});
test('clock reconciliation deselects a stale stage and updates checkbox stage',async()=>{const x=setup();await x.ready();x.inputs[0].checked=true;x.clock.now+=36*60000;x.api().reconcile();assert.equal(x.inputs[0].checked,false);assert.equal(x.inputs[0].dataset.nbaStage,'t15');});
test('stage quota error stops batch without falling back to T-10',async()=>{const x=setup({fail:{1:'analysis_credits_empty'}});await x.ready();x.inputs[0].checked=x.inputs[2].checked=true;await x.c.startHabaoSportBatchAnalysis();assert.equal(x.calls.filter(v=>v.body.action==='claim').length,1);assert.equal(x.calls.filter(v=>v.url==='legacy-member').length,0);assert.equal(x.stored.has('matchAnalysisBatch'),false);assert.equal(x.alerts[0],'credits_empty');});
test('wrong-stage success packet is never packaged as a batch result',async()=>{const x=setup({wrongStage:true});await x.ready();x.inputs[0].checked=true;await x.c.startHabaoSportBatchAnalysis();assert.equal(x.stored.has('matchAnalysisBatch'),false);assert.match(x.alerts[0],/不完整/);});
test('two simultaneous single clicks send one stage request and keep waiting spinner',async()=>{let resolve;const promise=new Promise(r=>resolve=r);const x=setup({deferred:{promise}});await x.ready();const a=x.api().claim(1,'t2',x.cards.get(1).button),b=x.api().claim(1,'t2',x.cards.get(1).button);await Promise.resolve();assert.equal(x.cards.get(1).button.disabled,true);assert.match(x.cards.get(1).button.textContent,/讀取深度分析/);x.api().reconcile();assert.equal(x.cards.get(1).button.disabled,true);resolve();await Promise.all([a,b]);assert.equal(x.calls.filter(v=>v.body.action==='claim').length,1);});
test('account change during stage response cannot replace the next account balance or result',async()=>{let resolve;const promise=new Promise(r=>resolve=r);const x=setup({deferred:{promise}});await x.ready();const task=x.api().claim(1,'t2',x.cards.get(1).button);await Promise.resolve();x.stored.set('habao_member',JSON.stringify({account:'other',analysis_credits:99}));resolve();await task;assert.equal(JSON.parse(x.stored.get('habao_member')).analysis_credits,99);assert.equal(x.stored.has('matchAnalysis'),false);});
test('presentation keeps raw stored picks unchanged and localizes status without 50-percent no-pick confidence',()=>{
 const start=analysis.indexOf('    const nbaStage=['),end=analysis.indexOf('    const resultTeamLogo=',start),body=analysis.slice(start,end);
 const render=new Function('data',`const isBasketballAnalysis=true,footballV2Evidence=data.analysis.v2_stage_evidence;const escapePartnerHtml=x=>String(x),confidenceBar=x=>Number(x),confidenceFire=()=>'',analysisT=(k,f)=>f;${body};return {badge:nbaStageBadgeHtml,evidence:nbaEvidenceHtml,label:recommendationConfidenceHtml(data.analysis.recommendations.moneyline),bar:recommendationBar(data.analysis.recommendations.moneyline)};`);
 const data={v2_stage:'t2',analysis:{recommendations:{moneyline:{pick:'暫不推薦',confidence:50,reason:'模型優勢未達門檻'}},v2_stage_evidence:{captured_at:'2026-11-12T22:53:00Z',availability:{status:'not_available'},lineups:{status:'not_available'}}}};
 const before=JSON.stringify(data),a=render(data);assert.match(a.badge,/data-stage="t2"/);assert.match(a.badge,/06:53/);assert.equal(a.evidence.includes('not_available'),false);assert.equal(a.label,'模型優勢不足');assert.equal(a.bar,0);assert.equal(JSON.stringify(data),before);
 const b=render({...data,v2_stage:'t15'});assert.match(b.badge,/data-stage="t15"/);
});
test('same NBA fixture is grouped into one card with independent immutable stage records',()=>{
 const x=setup(),a={id:'v1',sport:'basketball',game_id:1,result_data:x.saved(1,'t10')},b={id:'v2',sport:'basketball',fixture_id:'nba:1',v2_stage:'t2',result_data:x.saved(1,'t2')},football={id:1,sport:'football',fixture_id:1,result_data:{success:true}};
 const original=JSON.stringify([a,b,football]),groups=x.api().groupHistory([a,b,football]);assert.equal(groups.length,2);assert.equal(groups[0].nba_history_latest,'t2');assert.deepEqual(Object.keys(groups[0].nba_history_stages),['t10','t2']);assert.equal(groups[0].nba_history_stages.t10,a);assert.equal(groups[0].nba_history_stages.t2,b);assert.equal(groups[1],football);assert.equal(JSON.stringify([a,b,football]),original);
});
test('latest claimed stage is T-15 even when T-2 catch-up was claimed later',()=>{
 const x=setup(),a={id:'t15',game_id:1,sport:'basketball',v2_stage:'t15',updated_at:'2026-11-12T23:50:00Z',result_data:x.saved(1,'t15')},b={id:'t2',game_id:1,sport:'basketball',v2_stage:'t2',updated_at:'2026-11-12T23:55:00Z',result_data:x.saved(1,'t2')};assert.equal(x.api().groupHistory([a,b])[0].nba_history_latest,'t15');
});
test('ambiguous fixture IDs are not merged and ordinary members receive the same grouped history',()=>{
 const x=setup(),a={id:'a',sport:'basketball',game_id:1,result_data:x.saved(2,'t10')},b={id:'b',sport:'basketball',game_id:1,result_data:x.saved(1,'t2')};assert.equal(x.api().groupHistory([a,b]).length,2);x.stored.set('habao_member',JSON.stringify({account:'ordinary'}));const rows=[a,b],groups=x.api().groupHistory(rows);assert.equal(groups.length,2);assert.ok(groups.some(row=>row.nba_history_stages));
});
test('batch stage claim is returned by history and immediately advances fixture button',async()=>{
 const x=setup();await x.ready();x.inputs[0].checked=true;await x.c.startHabaoSportBatchAnalysis();const history=await x.api().history();assert.equal(history.length,1);assert.equal(history[0].v2_stage,'t2');assert.equal(x.cards.get(1).button.disabled,true);assert.match(x.cards.get(1).button.textContent,/07:45 開放/);assert.match(x.cards.get(1).label.textContent,/重看 T-2/);
});
test('grouped history keeps both stage keys viewable without new API calls or points',async()=>{
 const x=setup();await x.ready();const start=html.indexOf('function renderAnalysisHistory('),end=html.indexOf('\n</script>',html.indexOf('function viewAnalysisHistory(',start));
 x.c.getBasketballTeamLogoData=()=>({src:'https://example.test/logo.svg',fallback:'',backup:''});x.c.escapeBasketballHTML=s=>String(s).replaceAll('"','&quot;');x.c.getBasketballTeamName=s=>s;
 vm.runInContext(html.slice(start,end),x.c);
 const a={id:'v1',history_key:'basketball:v1',sport:'basketball',game_id:1,fixture_time:x.fixtures[0].kickoff_at,result_data:x.saved(1,'t10')},b={id:'v2',history_key:'basketball:v2',sport:'basketball',game_id:1,v2_stage:'t2',fixture_time:x.fixtures[0].kickoff_at,result_data:x.saved(1,'t2')};
 const before=x.calls.length;x.c.renderAnalysisHistory([a,b],'basketball');const container=x.c.document.getElementById('matchesContainer');assert.equal((container.innerHTML.match(/class="history-match-card"/g)||[]).length,1);assert.equal((container.innerHTML.match(/class="nba-history-stage"/g)||[]).length,3);assert.match(container.innerHTML,/已領取 2\/3/);assert.match(container.innerHTML,/data-stage="t15" disabled/);
 x.c.viewAnalysisHistory('basketball:v1');assert.deepEqual(JSON.parse(x.stored.get('matchAnalysis')),a.result_data);x.c.viewAnalysisHistory('basketball:v2');assert.deepEqual(JSON.parse(x.stored.get('matchAnalysis')),b.result_data);assert.equal(x.calls.length,before);assert.equal(x.credits(),10);
 // Language changes rerender the current, already-grouped cards.
 x.c.renderAnalysisHistory(x.c.window.habaoCurrentHistoryMatches,'basketball');assert.match(container.innerHTML,/已領取 2\/3/);x.c.viewAnalysisHistory('basketball:v1');assert.deepEqual(JSON.parse(x.stored.get('matchAnalysis')),a.result_data);x.c.viewAnalysisHistory('basketball:v2');assert.deepEqual(JSON.parse(x.stored.get('matchAnalysis')),b.result_data);
});
test('stage client loads before automatic My Analyses and deep-link startup',()=>{
 const asset=html.indexOf('src="./nba-stages.js?v=20261113-5"');assert.ok(asset>0);assert.ok(asset<html.indexOf('const habaoViewParams'));assert.equal(html.match(/src="\.\/nba-stages.js/g).length,1);
});
test('Phoenix history logo resolves from Chinese name and has NBA fallback',()=>{
 const c=vm.createContext({NBA_TEAM_NAME_ZH:{'Phoenix Suns':'鳳凰城太陽'},NBA_OFFICIAL_TEAM_ID:{'phoenix suns':'1610612756'},safeBasketballImageURL:x=>x||''});const start=html.indexOf('function normalizeBasketballTeamKey('),end=html.indexOf('function handleBasketballLogoError(',start);vm.runInContext(html.slice(start,end),c);const data=c.getBasketballTeamLogoData('鳳凰城太陽','https://example.test/old-logo.svg');assert.match(data.src,/espncdn.*phx\.png/);assert.match(data.fallback,/1610612756/);
});
test('regular Google and LINE members receive all three stages without an account allowlist',async()=>{
 for(const account of ['google_regular_member','line_regular_member']){const x=setup({account});await x.ready();assert.equal(x.api().accessState(),'enabled');assert.equal(x.cards.get(1).input.dataset.nbaStage,'t2');x.inputs[0].checked=true;await x.c.startHabaoSportBatchAnalysis();assert.equal(x.credits(),9);assert.equal(x.calls.filter(v=>v.body.action==='claim')[0].body.account,account);assert.equal(JSON.parse(x.stored.get('matchAnalysisBatch')).results[0].v2_stage,'t2');}
});
test('server release switch stays authoritative before activation',async()=>{
 const x=setup({account:'google_regular_member',disabled:true});await x.ready();assert.equal(x.api().accessState(),'disabled');assert.equal(x.cards.get(1).button.dataset.nbaStage,undefined);x.inputs[0].checked=true;await x.c.startHabaoSportBatchAnalysis();assert.equal(x.calls.filter(v=>v.body.action==='claim').length,0);assert.equal(x.calls.filter(v=>v.url==='legacy-member').length,1);
});
test('production pages remove NBA test labels and ignore historical preview mode',()=>{
 const code=html.slice(html.indexOf('const HABAO_NBA_TEST_MODE ='),html.indexOf('function addHabaoDateDays('));const c=vm.createContext({window:{location:{search:'?nba_test=1'}}});vm.runInContext(code+';globalThis.mode=HABAO_NBA_TEST_MODE;',c);assert.equal(c.mode,false);assert.equal(analysis.includes('研究版'),false);assert.equal(html.includes('NBA 測試'),false);assert.equal(read('nba-stages.js').includes('google_2d3cef6b6e2d'),false);
});
test('inline scripts and updated stage asset parse',()=>{for(const s of [html,analysis])for(const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/src\s*=|application\/ld\+json|application\/json/.test(m[1])||!m[2].trim())continue;new vm.Script(m[2]);}new vm.Script(read('nba-stages.js'));});
(async()=>{let failed=0;for(const[n,f]of tests){try{await f();console.log('PASS '+n)}catch(e){failed++;console.error('FAIL '+n+'\n'+e.stack);}}console.log(JSON.stringify({suite:'NBA stage-aware batch and presentation regression',passed:tests.length-failed,failed}));process.exitCode=failed?1:0;})();
