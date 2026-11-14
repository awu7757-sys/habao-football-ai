const a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),H=require(root+'/home-sports-stats.js'),C=require(root+'/sports-stage-core.js');
const now=Date.now(),iso=h=>new Date(now+h*3600000).toISOString();
let passed=0;function ok(name){console.log('PASS',name);passed++;}
(async()=>{
 for(const file of ['home-v2.html','performance.html'])for(const m of fs.readFileSync(root+'/'+file,'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);ok('both HTML pages parse');
 a.equal(H.countHistory([{sport:'football',matches:[{fixture_id:1},{fixture_id:1,v2_stage:'t15'}]},{sport:'basketball',matches:[{game_id:1},{game_id:1,v2_stage:'t2'}]},{sport:'baseball',matches:[{game_id:1},{game_id:2,fixture_time:iso(-9)}]}],now),3);ok('three sports, duplicate stages and expired rows');
 a.throws(()=>H.countHistory([{sport:'football',matches:[{id:'database-row-id'}]}]));ok('missing game identity does not create false total');
 a.equal(H.taipeiDate(0,Date.parse('2026-11-14T17:00:00Z')),'2026-11-15');a.equal(H.taipeiDate(1,Date.parse('2026-11-14T17:00:00Z')),'2026-11-16');ok('Taipei date boundary');
 const rows=H.candidates([{fixtureId:1,time:iso(3),league:{id:39}},{fixtureId:1,time:iso(3),league:{id:39}},{fixtureId:2,time:iso(11),league:{id:39}},{fixtureId:3,time:iso(1),league:{id:39},status:'PST'},{fixtureId:4,time:iso(1),league:{id:39},status:'FT'}],'football',C,now);
 a.equal(rows.length,1);a.equal(H.availableCount(rows,{enabled:true,stages:{1:{claimed:{}}}},'football',C,now),1);a.equal(H.availableCount(rows,{enabled:true,stages:{1:{claimed:{t10:true}}}},'football',C,now),0);ok('same stage rules: window, finished, postponed, duplicate, claimed');
 const calls=[];let fail='',owner='member',missing=false;
 const mock=async(url,options)=>{
   const endpoint=new URL(url).pathname.split('/').pop();const body=options.body?JSON.parse(options.body):null;calls.push({endpoint,body,options});
   a.ok(!body||['status','history'].includes(body.action)||'offset' in body,'no write/claim/capture request');
   if(endpoint===fail)return {ok:false,json:async()=>({success:false})};
   let p={success:true};
   if(endpoint.includes('performance'))p.summary=missing?{}:{verified_matches:endpoint==='ai-performance'?10:endpoint.startsWith('basketball')?20:30};
   else if(endpoint.includes('history'))p.matches=[{fixture_id:1,fixture_time:iso(3)}];
   else if(endpoint.endsWith('stage-member'))p=body.action==='history'?{...p,matches:[{game_id:1,v2_stage:'t2'}]}:{...p,enabled:true,stages:{1:{claimed:{}}}};
   else p.fixtures=[{fixture_id:1,fixtureId:1,time:iso(3),kickoff_at:iso(3),league:{id:39},competition_key:'nba'}];
   return {ok:true,json:async()=>p};
 };
 const api=H.create({base:'https://test.invalid/functions/v1/',key:'public-key',auth:{auth:{getSession:async()=>({data:{session:{access_token:'member-jwt'}}})}},member:()=>({account:owner}),core:C,fetcher:mock});
 a.equal(await api.verified(),60);a.equal((await api.history()).count,3);a.equal((await api.fixtures()).count,3);ok('API integration sums all sports and deduplicates today/tomorrow');
 a.ok(calls.filter(x=>x.endpoint.includes('history')||x.endpoint.includes('stage-member')).every(x=>x.options.headers.Authorization==='Bearer member-jwt'));ok('private history/status uses member JWT');
 fail='basketball-performance-api';await a.rejects(api.verified());fail='';missing=true;await a.rejects(api.verified());missing=false;ok('failed or missing sport summary never becomes zero');
 fail='nba-v2-stage-member';await a.rejects(api.history());await a.rejects(api.fixtures());ok('stage service failure does not report partial totals');
 console.log('RESULT',passed,'passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
