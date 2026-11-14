const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(__dirname+'/basketball-fixtures.index.ts','utf8'));
async function check(name,env,date,expected){let handle;const calls=[];const c=vm.createContext({Deno:{env:{get:k=>env[k]},serve:fn=>handle=fn},Date,Intl,URL,Map,Set,Number,Response,console,fetch:async(url,init)=>{calls.push({url,key:init.headers['x-apisports-key']});return new Response(JSON.stringify({response:[],errors:[]}),{status:200})}});vm.runInContext(source,c);const r=await handle({method:'POST',json:async()=>({date})});const p=await r.json();assert.equal(r.status,expected.status||200);if(expected.nba){assert.equal(calls.filter(x=>x.url.includes('v2.nba')).length,2);assert.ok(calls.filter(x=>x.url.includes('v2.nba')).every(x=>x.key===expected.nba))}if(expected.worldcup){assert.ok(calls.some(x=>x.url.includes('v1.basketball')&&x.key===expected.worldcup))}if(expected.none)assert.equal(calls.length,0);if(r.status===200)assert.equal(p.success,true);console.log('PASS '+name)}
(async()=>{
await check('NBA dedicated key takes precedence',{API_NBA_KEY:'nba',API_FOOTBALL_KEY:'football'},'2026-11-15',{nba:'nba'});
await check('NBA works without football credential',{API_NBA_KEY:'nba'},'2026-11-15',{nba:'nba'});
await check('legacy shared-key setup remains supported',{API_FOOTBALL_KEY:'legacy'},'2026-11-15',{nba:'legacy'});
await check('World Cup retains basketball/football credential',{API_NBA_KEY:'nba',API_FOOTBALL_KEY:'football'},'2027-08-28',{worldcup:'football'});
await check('missing configuration fails without provider requests',{},'2026-11-15',{status:500,none:true});
console.log('RESULT 5 passed')
})().catch(e=>{console.error(e);process.exitCode=1});
