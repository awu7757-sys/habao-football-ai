const fs=require('fs'),vm=require('vm'),a=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../../performance.html','utf8');
const nodes=new Map(),make=()=>({innerHTML:'',textContent:'',style:{},dataset:{},classList:{toggle(){},remove(){},add(){}},addEventListener(){},querySelectorAll(){return []}});
const document={documentElement:{lang:"zh-Hant"},querySelectorAll:()=>[],querySelector:()=>null,getElementById:id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)}};
const requests=[];let fail=false;
const c=vm.createContext({document,console,localStorage:{getItem:()=>null},URLSearchParams,Date,AbortSignal,Intl,setTimeout,clearTimeout,location:{search:'',pathname:'/performance.html'},history:{replaceState(){}},window:{addEventListener(){}},fetch:async url=>{
 requests.push(url);const sport=url.includes('basketball')?'basketball':url.includes('baseball')?'baseball':'football';
 return {ok:!fail,status:fail?503:200,json:async()=>({success:!fail,rows:[],summary:{verified_matches:3},markets:{},recent_form:{},trend:[],leagues:[],matches:[2,20,40].map(days=>({game_id:days,fixture_id:days,kickoff_at:new Date(Date.now()-days*86400000).toISOString(),home:'HOME-'+sport+'-'+days,away:'AWAY',league:'NBA',final_score:'2-1',prediction:{},settlement:{moneyline:'win',over_under:'loss',btts:'win',handicap:'win'}}))})};
}});
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('async function switchSport'));
vm.runInContext(script.replace(/\ninit\(\);/,'\n'),c);
// Retain the actual records renderer and all data/sport/period logic.
vm.runInContext('applyLang=()=>{};applySportLabels=()=>{};renderTop=()=>{};renderRecent=()=>{};renderTrend=()=>{};renderLeagues=()=>{};',c);
(async()=>{
 for(const sport of ['football','basketball','baseball']){
   await c.switchSport(sport);
   a.equal(vm.runInContext('lowerDays',c),30);a.equal(vm.runInContext('topDays',c),'30');
   for(const id of ['recordsBody','mobileRecords']){a.ok(nodes.get(id).innerHTML.includes('HOME-'+sport+'-20'));a.ok(!nodes.get(id).innerHTML.includes('HOME-'+sport+'-40'));}
   vm.runInContext('lowerDays=7;',c);await c.loadLowerView();
   a.ok(nodes.get('recordsBody').innerHTML.includes('HOME-'+sport+'-20'));
   vm.runInContext('showAll=true;renderRecords();',c);a.ok(!nodes.get('recordsBody').innerHTML.includes('HOME-'+sport+'-40'));
   console.log('PASS',sport,': initial 30D, independent records, desktop/mobile markup, expand cap');
 }
 // A failed 7-day chart fetch must not remove successful 30-day verification records.
 fail=true;await c.loadLowerView();a.ok(nodes.get('recordsBody').innerHTML.includes('HOME-baseball-20'));
 console.log('PASS chart failure preserves independently loaded verification records');
 a.ok(requests.filter(x=>x.includes('performance')).every(x=>/days=(7|30)/.test(x)));
 console.log('RESULT 4 passed (DOM logic; not browser visual validation)');
})().catch(e=>{console.error(e);process.exitCode=1});
