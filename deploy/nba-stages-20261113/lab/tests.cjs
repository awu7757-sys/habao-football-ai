const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,html=fs.readFileSync(root+'/nba-stages.html','utf8'),payload=JSON.parse(html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1]),source=fs.readFileSync(root+'/lab.js','utf8').split("$('scenario').innerHTML=")[0];
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(){const c=vm.createContext({document:{getElementById:id=>({textContent:JSON.stringify(payload)})},addEventListener(){},console,Map,Date,URL,JSON,Object,Array,Number,Set,String});vm.runInContext(source,c);return c;}
const tests=[];function test(name,fn){tests.push([name,fn]);}
test('all generated parent and child scripts parse with actual production template code',()=>{
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/application\/json/.test(m[1]))new vm.Script(m[2]);
 const c=setup();for(const view of ['fixtures','history','result']){const child=vm.runInContext(`resetScenario(scenarios[3]); childDoc(seedFor('${view}'))`,c);for(const m of child.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))new vm.Script(m[2]);assert.ok(child.includes("connect-src 'none'"));}
});
test('opaque sandbox and connect/form restrictions accompany every renderer',()=>{assert.ok(html.includes('sandbox="allow-scripts"'));assert.ok(!html.includes('sandbox="allow-scripts allow-same-origin"'));assert.ok(html.includes("connect-src 'none'"));assert.ok(html.includes("form-action 'none'"));});
test('virtual storage replaces inaccessible native storage without reading real account',async()=>{
 const parent=setup(),boot=vm.runInContext('bootstrap.toString()',parent),messages=[];let realStorageReads=0,nativeFetchCalls=0;
 const c=vm.createContext({Date,Map,Set,JSON,Object,Array,Number,String,URL,Response,console,document:{addEventListener(){},querySelectorAll:()=>[]},addEventListener(){},parent:{postMessage:p=>messages.push(p)},setTimeout:fn=>{fn();},fetch:()=>{nativeFetchCalls++;throw Error('native fetch must never run');}});c.window=c;
 Object.defineProperty(c,'sessionStorage',{get(){realStorageReads++;throw Error('real storage forbidden')},configurable:true});
 Object.defineProperty(c,'localStorage',{get(){realStorageReads++;throw Error('real storage forbidden')},configurable:true});
 const seed={token:1,now:Date.now(),credits:10,ledger:[],claims:{},storage:{habao_member:'{"account":"qa_isolated_member"}'},games:clone(payload.demo.games),logos:{}};
 vm.runInContext('('+boot+')('+JSON.stringify(seed)+')',c);assert.equal(realStorageReads,0);
 const id=seed.games[0].game_id;await c.fetch('https://example.com',{method:'POST',body:'{}'});assert.equal(nativeFetchCalls,0);
 const req={method:'POST',body:JSON.stringify({action:'claim',game_id:id,stage:'t2'})};let r=await(await c.fetch('https://qa.invalid/nba-v2-stage-member',req)).json();assert.equal(r.member_access.paid_remaining,9);r=await(await c.fetch('https://qa.invalid/nba-v2-stage-member',req)).json();assert.equal(r.already_claimed,true);assert.equal(messages.filter(p=>p.kind==='state').at(-1).credits,9);assert.equal(nativeFetchCalls,0);
});
test('synthetic examples are explicitly labeled and no T-10 model recalculation is claimed',()=>{const c=setup(),rows=c.auditBundle(payload.demo);assert.ok(payload.demo.description.includes('非正式'));assert.ok(rows.some(r=>r.stage==='t10'&&r.status==='待驗證'));assert.equal(rows.filter(r=>r.status==='CHECK').length,0);});
test('changing saved line, confidence or model arithmetic produces CHECK',()=>{for(const change of [b=>b.games[0].results.t2.analysis.recommendations.handicap.line=99,b=>b.games[0].results.t2.analysis.recommendations.moneyline.confidence=100,b=>b.games[0].models.t2.expected_margin+=5]){const c=setup(),bundle=clone(payload.demo);change(bundle);assert.ok(c.auditBundle(bundle).some(r=>r.status==='CHECK'));}});
test('import supports Supabase array export and rejects empty or unsupported data',()=>{const c=setup(),b=clone(payload.demo);b.origin='supabase_saved_snapshots';const result=c.normalizeImport([{item:'nba_replay_bundle',detail:b}]);assert.equal(result.origin,'supabase_saved_snapshots');assert.throws(()=>c.normalizeImport({schema:'habao-nba-replay-v1',games:[]}));});
test('display escaping prevents imported text becoming executable markup without altering saved values',()=>{const c=setup(),v={name:'<script>alert(1)</script>'},copy=c.displaySafe(v);assert.ok(!copy.name.includes('<'));assert.equal(v.name,'<script>alert(1)</script>');});
test('all eight boundary scenarios and zero-credit case are available',()=>{const c=setup();assert.equal(vm.runInContext('scenarios.length',c),9);assert.equal(vm.runInContext('scenarios.find(s=>s.id==="empty").credits',c),0);assert.ok(payload.hashes['analysis.html']);});
(async()=>{let failed=0;for(const [name,fn]of tests){try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}console.log(JSON.stringify({suite:'NBA isolated replay safety and data audit',passed:tests.length-failed,failed}));process.exitCode=failed?1:0;})();
