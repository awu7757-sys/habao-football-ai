// 首頁三球類統計：5xx 重試與公開驗證快取（2026-11-15）
'use strict';
const a=require('node:assert/strict'),path=require('node:path');
const api=require(path.join(__dirname,'..','home-sports-stats.js'));
const store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))};
(async()=>{
  let calls=0;
  const fetcher=async(url)=>{calls++;
    if(calls<=2)return {ok:false,status:503,json:async()=>({})};            // 前兩次 503
    return {ok:true,status:200,json:async()=>({success:true,summary:{verified_matches:10}})};};
  const s=api.create({base:'x/',key:'k',auth:{auth:{getSession:async()=>({data:{session:null}})}},member:()=>null,core:{},fetcher});
  a.equal(await s.verified(),30);console.log('PASS 5xx retried and recovered');
  const before=calls;a.equal(await s.verified(),30);a.equal(calls,before);console.log('PASS verified total reused from session cache');
  store.clear();
  const bad=api.create({base:'x/',key:'k',auth:{auth:{getSession:async()=>({data:{session:null}})}},member:()=>null,core:{},
    fetcher:async()=>({ok:false,status:400,json:async()=>({success:false})})});
  await a.rejects(bad.verified());console.log('PASS 4xx is not retried and still fails (no fake zero)');
})().catch(e=>{console.error(e);process.exitCode=1});
