/* Read-only home counters. No claim, analysis, capture, or credit mutation calls. */
(function(root){
  'use strict';
  const SPORTS=['football','basketball','baseball'];
  const PERFORMANCE=['ai-performance','basketball-performance-api','baseball-performance-api'];
  const HISTORY=['member-analysis-history','basketball-member-analysis-history','baseball-member-analysis-history'];
  const STAGES=['football-v2-stage-member','nba-v2-stage-member','baseball-v2-stage-member'];
  const FOOTBALL_LEAGUES=new Set([2,3,39,140,78,135,61,98,292,88,169,71]);
  function gameId(row){
    const f=row?.result_data?.fixture||{};
    const value=row?.game_id??row?.fixture_id??row?.fixtureId??row?.game?.id??f.game_id??f.fixture_id??f.id??row?.snapshot?.game_id;
    const n=Number(String(value??'').replace(/^(nba|mlb):/,''));
    return Number.isSafeInteger(n)&&n>0?n:null;
  }
  function countHistory(packets,now=Date.now()){
    const keys=new Set();
    for(const {sport,matches} of packets){
      if(!Array.isArray(matches))throw Error('history_shape_invalid');
      for(const row of matches){
        const at=Date.parse(row.fixture_time??row.kickoff_at??row.result_data?.fixture?.date??'');
        if(Number.isFinite(at)&&now>=at+8*3600000)continue;
        const id=gameId(row);
        if(id===null)throw Error('history_game_id_missing');
        keys.add(sport+':'+id);
      }
    }
    return keys.size;
  }
  function taipeiDate(offset,now=Date.now()){
    const d=new Date(now+8*3600000);d.setUTCDate(d.getUTCDate()+offset);
    return d.toISOString().slice(0,10);
  }
  function candidates(rows,sport,core,now=Date.now()){
    const unique=new Map();
    for(const row of rows){
      const id=gameId(row),kickoff=row.kickoff_at??row.time??row.fixture?.date??row.date;
      const status=row.status,raw=typeof status==='object'?[status?.short,status?.long].join(' '):String(status||'');
      if(id===null||!core.phase(kickoff,now)||/canc|postpon|suspend|abandon|delayed|\b(pst|abd|canc|susp)\b/i.test(raw))continue;
      if(core.lifecycle(status,sport)!=='scheduled')continue;
      if(sport==='football'&&!FOOTBALL_LEAGUES.has(Number(row.league?.id??row.league_id??row.leagueId)))continue;
      if(sport==='basketball'&&row.competition_key!=='nba')continue;
      unique.set(id,{id,kickoff,status,row});
    }
    return [...unique.values()];
  }
  function availableCount(rows,packet,sport,core,now=Date.now()){
    if(typeof packet.enabled!=='boolean')throw Error('stage_access_missing');
    return rows.filter(x=>{
      const phase=core.phase(x.kickoff,now),state=packet.stages?.[x.id];
      if(packet.enabled&&!state)throw Error('stage_status_missing');
      if(!packet.enabled&&phase!=='t10')return false;
      return !core.decision(x.kickoff,state?.claimed||{},now,x.status,sport).disabled;
    }).length;
  }
  function create({base,key,auth,member,core,fetcher=root.fetch.bind(root)}){
    async function headers(privateAccess=false){
      let bearer=key;
      if(privateAccess){const s=(await auth.auth.getSession()).data?.session;if(!s?.access_token)throw Error('member_session_required');bearer=s.access_token;}
      return {apikey:key,Authorization:'Bearer '+bearer,'Content-Type':'application/json'};
    }
    async function request(path,{body,privateAccess=false}={}){
      const r=await fetcher(base+path,{method:body?'POST':'GET',headers:await headers(privateAccess),...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
      const p=await r.json();if(!r.ok||p?.success!==true)throw Error(path.split('?')[0]+'_unavailable');return p;
    }
    function account(){const a=member()?.account;if(!a)throw Error('member_account_required');return a;}
    async function verified(){
      const ps=await Promise.all(PERFORMANCE.map(path=>request(path)));
      return ps.reduce((sum,p)=>{const v=p.summary?.verified_matches;if(v==null||!Number.isSafeInteger(Number(v))||Number(v)<0)throw Error('verified_count_missing');return sum+Number(v);},0);
    }
    async function history(){
      const owner=account(),q='?account='+encodeURIComponent(owner);
      const requests=SPORTS.map(async(sport,i)=>({sport,matches:(await request(HISTORY[i]+q,{privateAccess:true})).matches}));
      // Football's history endpoint already includes all claimed stages.
      for(const i of [1,2])requests.push((async()=>({sport:SPORTS[i],matches:(await request(STAGES[i],{privateAccess:true,body:{action:'history',account:owner}})).matches}))());
      const packets=await Promise.all(requests);if(account()!==owner)throw Error('member_changed');
      return {count:countHistory(packets),matches:packets.flatMap(p=>p.matches.map(r=>({...r,sport:p.sport})))};
    }
    async function fixtures(){
      const owner=account(),now=Date.now();
      const loads=SPORTS.map(async(sport,i)=>{
        const packets=await Promise.all([0,1].map(offset=>sport==='baseball'
          ?request('baseball-public-fixtures?date='+taipeiDate(offset,now))
          :request(sport==='football'?'tomorrow-fixtures':'basketball-fixtures',{body:{offset}})));
        if(packets.some(p=>!Array.isArray(p.fixtures)))throw Error('fixtures_shape_invalid');
        const rows=candidates(packets.flatMap(p=>p.fixtures),sport,core,now);
        if(!rows.length)return {count:0,today:packets[0].fixtures};
        // Same stage access and primary-button decision as the match center.
        const counts=[];
        for(let start=0;start<rows.length;start+=50){
          const group=rows.slice(start,start+50);
          const p=await request(STAGES[i],{privateAccess:true,body:{action:'status',account:owner,[i===0?'fixture_ids':'game_ids']:group.map(x=>x.id)}});
          counts.push(availableCount(group,p,sport,core,now));
        }
        return {count:counts.reduce((a,b)=>a+b,0),today:packets[0].fixtures};
      });
      const results=await Promise.allSettled(loads);if(account()!==owner)throw Error('member_changed');
      if(results.some(x=>x.status==='rejected')){
        const error=Error('sports_fixtures_incomplete');
        if(results[0].status==='fulfilled')error.footballToday=results[0].value.today;
        throw error;
      }
      return {count:results.reduce((a,b)=>a+b.value.count,0),footballToday:results[0].value.today};
    }
    return {verified,history,fixtures};
  }
  const api={create,gameId,countHistory,taipeiDate,candidates,availableCount};
  root.HabaoHomeSportsStats=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
