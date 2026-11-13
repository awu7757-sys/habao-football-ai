// Pregame evidence only. NBA confirmed lineups + game-scoped ESPN injury reports.
// Public feeds require no new secret. Historical boxes are never current-game data.
const CONTEXT_VERSION='nba-player-context-20261113-1';
const CONTEXT_CACHE=new Map();
const CONTEXT_ORIGINS=new Set(['https://site.api.espn.com','https://stats.nba.com']);
const CONTEXT_TEAM_IDS={
 atlantahawks:1610612737,bostonceltics:1610612738,brooklynnets:1610612751,charlottehornets:1610612766,
 chicagobulls:1610612741,clevelandcavaliers:1610612739,dallasmavericks:1610612742,denvernuggets:1610612743,
 detroitpistons:1610612765,goldenstatewarriors:1610612744,houstonrockets:1610612745,indianapacers:1610612754,
 laclippers:1610612746,losangeleslakers:1610612747,memphisgrizzlies:1610612763,miamiheat:1610612748,
 milwaukeebucks:1610612749,minnesotatimberwolves:1610612750,neworleanspelicans:1610612740,newyorkknicks:1610612752,
 oklahomacitythunder:1610612760,orlandomagic:1610612753,philadelphia76ers:1610612755,phoenixsuns:1610612756,
 portlandtrailblazers:1610612757,sacramentokings:1610612758,sanantoniospurs:1610612759,torontoraptors:1610612761,
 utahjazz:1610612762,washingtonwizards:1610612764
};
const contextName=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function contextDay(ms){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms)).replaceAll('-','');}
function contextLocalTime(raw){
 if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(raw))return null;
 const n=raw.match(/\d+/g).map(Number),wall=Date.UTC(n[0],n[1]-1,n[2],n[3],n[4],n[5]);let result=wall;
 for(let i=0;i<2;i++){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result)).map(p=>[p.type,p.value]));
  const local=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
  result=wall-(local-result);
 }
 return result;
}
async function contextJson(url,context,historical=false){
 const u=new URL(url);if(!CONTEXT_ORIGINS.has(u.origin))throw Error('context_origin_rejected');
 const now=Date.now(),hit=CONTEXT_CACHE.get(url),ttl=historical?24*3600000:45000;
 if(hit&&now>=hit.fetched_ms&&now-hit.fetched_ms<ttl)return {data:hit.data,fetched_at:new Date(hit.fetched_ms).toISOString()};
 if((context.context_calls||0)>=13)throw Error('context_request_limit');context.context_calls=(context.context_calls||0)+1;
 const res=await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!res.ok)throw Error('context_http_'+res.status);
 const reader=res.body?.getReader();if(!reader)throw Error('context_body_missing');
 const chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000)throw Error('context_body_too_large');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.byteLength;}
 const data=JSON.parse(new TextDecoder().decode(bytes)),fetched_ms=Date.now();
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('context_invalid_payload');
 if(CONTEXT_CACHE.size>=48)CONTEXT_CACHE.delete(CONTEXT_CACHE.keys().next().value);
 CONTEXT_CACHE.set(url,{data,fetched_ms});return {data,fetched_at:new Date(fetched_ms).toISOString()};
}
function contextCompetition(data,snapshot,allowFinished=false){
 const c=data?.header?.competitions?.[0],f=snapshot.prediction_data?.fixture||{};
 const home=(c?.competitors||[]).filter(x=>x.homeAway==='home'),away=(c?.competitors||[]).filter(x=>x.homeAway==='away');
 const kickoff=parseMs(snapshot.fixture_time),date=parseMs(c?.date),season=Number(f.season);
 if(!c||home.length!==1||away.length!==1||kickoff===null||date===null||Math.abs(date-kickoff)>60000
 ||normalizedTeam(home[0].team?.displayName)!==normalizedTeam(f.home?.api_name||f.home?.name||snapshot.home_team)
 ||normalizedTeam(away[0].team?.displayName)!==normalizedTeam(f.away?.api_name||f.away?.name||snapshot.away_team)
 ||Number(data.header?.season?.year)!==season+1)throw Error('context_fixture_mismatch');
 if(!allowFinished&&(c.status?.type?.state!=='pre'||c.status?.type?.completed===true||Date.now()>=kickoff))throw Error('context_fixture_not_pregame');
 return {competition:c,home:home[0],away:away[0]};
}
function parseContextInjuries(summary,match,fetched_at,now){
 const groups=summary.injuries,teams=[],items=[];if(!Array.isArray(groups))return {status:'not_available',reason:'injury_feed_missing',items,teams};
 for(const [side,c]of [['home',match.home],['away',match.away]]){
  const rows=groups.filter(x=>String(x.team?.id)===String(c.id));
  if(rows.length!==1||!Array.isArray(rows[0].injuries)){teams.push({side,status:'not_available'});continue;}
  let rejected=0;const seen=new Set();
  for(const row of rows[0].injuries){
   const name=String(row.athlete?.displayName||''),key=contextName(name),reported=parseMs(row.date);
   const status=String(row.status||'').toLowerCase().replace(/[^a-z]/g,'');
   if(seen.has(key)){const index=items.findIndex(x=>x.side===side&&contextName(x.name)===key);if(index>=0)items.splice(index,1);rejected++;continue;}
   if(!key||reported===null||reported>now+60000||!['out','doubtful','questionable','daytoday','probable','suspension','suspended'].includes(status)){rejected++;continue;}
   seen.add(key);items.push({side,team_id:String(c.id),player_id:String(row.athlete?.id||''),name,status,
    reason:String(row.details?.type||''),reported_at:new Date(reported).toISOString(),source:'espn_game_injuries',fetched_at});
  }
  teams.push({side,status:rejected?'partial':rows[0].injuries.length?'data_returned':'no_rows_returned',rejected_rows:rejected});
 }
 return {status:teams.every(x=>['data_returned','no_rows_returned'].includes(x.status))?'data_returned':teams.some(x=>x.status==='data_returned'||x.status==='no_rows_returned')?'partial':'not_available',source:'ESPN',fetched_at,items,teams};
}
function parseContextLineups(data,match,fetched_at,now){
 const homeId=CONTEXT_TEAM_IDS[normalizedTeam(match.home.team?.displayName)],awayId=CONTEXT_TEAM_IDS[normalizedTeam(match.away.team?.displayName)];
 const games=(Array.isArray(data.games)?data.games:[]).filter(g=>Number(g.homeTeam?.teamId)===homeId&&Number(g.awayTeam?.teamId)===awayId);
 if(!homeId||!awayId||games.length!==1)return {status:'not_available',reason:'lineup_fixture_unverified',teams:[]};
 if([2,3].includes(Number(games[0].gameStatus)))return {status:'not_available',reason:'context_fixture_not_pregame',teams:[]};
 if(Number(games[0].gameStatus)!==1)return {status:'not_available',reason:'lineup_fixture_unverified',teams:[]};
 const g=games[0],teams=[];
 for(const [side,t]of [['home',g.homeTeam],['away',g.awayTeam]]){
  const raw=Array.isArray(t.players)?t.players:[],seen=new Set(),names=new Set(),valid=[];let invalid=false;
  for(const p of raw){
   const id=Number(p.personId),name=String(p.playerName||''),updated=contextLocalTime(p.timestamp);
   if(!Number.isSafeInteger(id)||id<=0||Number(p.teamId)!==Number(t.teamId)||!contextName(name)||seen.has(id)||names.has(contextName(name))
    ||updated===null||updated>now+60000||now-updated>36*3600000){invalid=true;continue;}
   seen.add(id);names.add(contextName(name));valid.push({id,name,position:String(p.position||''),confirmed:p.lineupStatus==='Confirmed'&&Date.parse(match.competition.date)-updated<=6*3600000,active:p.rosterStatus==='Active',inactive:p.rosterStatus==='Inactive',reported_at:new Date(updated).toISOString()});
  }
  const starters=valid.filter(p=>/^(PG|SG|SF|PF|C)$/.test(p.position)&&p.active);
  const confirmed=!invalid&&starters.length===5&&new Set(starters.map(p=>p.position)).size===5&&starters.every(p=>p.confirmed);
  teams.push({side,team_id:String(t.teamId),status:confirmed?'confirmed':!invalid&&starters.length===5?'expected':'not_available',
   starters:starters.length===5?starters:[],inactive:invalid?[]:valid.filter(p=>p.confirmed&&p.inactive),
   active:invalid?[]:valid.filter(p=>p.confirmed&&p.active).map(p=>p.name),source:'NBA',fetched_at});
 }
 return {status:teams.every(t=>t.status==='confirmed')?'data_returned':teams.some(t=>t.status==='confirmed')?'partial_confirmed':teams.some(t=>t.status==='expected')?'expected':'not_available',source:'NBA',game_id:String(g.gameId),fetched_at,teams};
}
function contextHistory(summary,teamId,event,cutoff,season){
 const c=summary?.header?.competitions?.[0],date=parseMs(c?.date),group=summary.boxscore?.players?.filter(x=>String(x.team?.id)===String(teamId));
 if(String(summary.header?.id)!==String(event.id)||!c?.status?.type?.completed||c.status.type.state!=='post'
 ||Number(summary.header?.season?.year)!==season+1||![2,3].includes(Number(summary.header?.season?.type))||date===null||date>=cutoff-4*3600000||date<cutoff-60*86400000
 ||Math.abs(date-Date.parse(event.gameDate))>60000||group?.length!==1)return null;
 const stat=group[0].statistics?.find(s=>Array.isArray(s.keys)&&s.keys.includes('minutes')&&s.keys.includes('plusMinus'));
 if(!stat||!Array.isArray(stat.athletes))return null;
 const mi=stat.keys.indexOf('minutes'),pi=stat.keys.indexOf('plusMinus'),rows=[],ids=new Set();
 for(const a of stat.athletes){
  if(a.didNotPlay===true)continue;
  const raw=String(a.stats?.[mi]??''),n=raw.match(/^(\d{1,2})(?::([0-5]\d))?$/),min=n?Number(n[1])+Number(n[2]||0)/60:null;
  const rawPm=String(a.stats?.[pi]??''),pm=/^[+-]?\d{1,3}$/.test(rawPm)?Number(rawPm):null;
  const name=String(a.athlete?.displayName||''),key=contextName(name),id=String(a.athlete?.id||'');
  if(!key||!/^\d+$/.test(id)||ids.has(key)||min===null||min<0||min>65||pm===null||Math.abs(pm)>90)return null;
  ids.add(key);if(min>0)rows.push({id,name,key,minutes:min,plus_minus:pm,starter:a.starter===true});
 }
 const minutes=rows.reduce((a,p)=>a+p.minutes,0);
 if(rows.length<5||minutes<225||minutes>340)return null;
 // Normalize overtime and rounded box-score minutes to a 240-minute team baseline.
 return {event_id:String(event.id),date:new Date(date).toISOString(),rows:rows.map(p=>({...p,minutes:p.minutes*240/minutes}))};
}
async function collectPlayerContext(snapshot,context){
 const started=Date.now(),kickoff=parseMs(snapshot.fixture_time),empty={version:CONTEXT_VERSION,availability:{status:'not_available',items:[],teams:[]},lineups:{status:'not_available',teams:[]},history:{home:[],away:[]},warnings:[]};
 if(kickoff===null||started>=kickoff)return {...empty,warnings:['context_fixture_not_pregame']};
 try{
  const day=contextDay(kickoff),base='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
  const score=await contextJson(base+'scoreboard?dates='+day,context),f=snapshot.prediction_data?.fixture||{};
  const events=(score.data.events||[]).filter(e=>{
   const c=e.competitions?.[0],h=c?.competitors?.find(x=>x.homeAway==='home'),a=c?.competitors?.find(x=>x.homeAway==='away');
   return /^\d+$/.test(String(e.id))&&Math.abs(Date.parse(e.date)-kickoff)<=60000
    &&normalizedTeam(h?.team?.displayName)===normalizedTeam(f.home?.api_name||f.home?.name||snapshot.home_team)
    &&normalizedTeam(a?.team?.displayName)===normalizedTeam(f.away?.api_name||f.away?.name||snapshot.away_team);
  });
  if(events.length!==1)throw Error('context_event_not_unique');
  const live=await contextJson(base+'summary?event='+events[0].id,context),match=contextCompetition(live.data,snapshot);
  if(String(live.data.header?.id)!==String(events[0].id))throw Error('context_event_mismatch');
  const evidence={...empty,event_id:String(events[0].id),fetched_at:live.fetched_at,source_urls:{injuries:base+'summary?event='+events[0].id,lineups:'https://stats.nba.com/js/data/leaders/00_daily_lineups_'+day+'.json'}};
  evidence.availability=parseContextInjuries(live.data,match,live.fetched_at,Date.now());
  try{const lineups=await contextJson(evidence.source_urls.lineups,context);evidence.lineups=parseContextLineups(lineups.data,match,lineups.fetched_at,Date.now());}
  catch(e){evidence.lineups={status:'source_unavailable',source:'NBA',reason:/^context_[a-z0-9_]+$/.test(String(e?.message))?String(e.message):'context_source_unavailable',fetched_at:new Date().toISOString(),teams:[]};evidence.warnings.push('lineup_source_unavailable');}
  if(evidence.lineups.reason==='context_fixture_not_pregame')throw Error('context_fixture_not_pregame');
  await Promise.all([['home',match.home],['away',match.away]].map(async([side,c])=>{
   const list=(live.data.lastFiveGames||[]).filter(x=>String(x.team?.id)===String(c.id));
   const seen=new Set(),events=list.length===1?(list[0].events||[]).filter(e=>{
    const date=parseMs(e.gameDate),id=String(e.id);if(!/^\d+$/.test(id)||seen.has(id)||date===null||date>=started-4*3600000||date<started-60*86400000)return false;seen.add(id);return true;
   }).sort((a,b)=>Date.parse(b.gameDate)-Date.parse(a.gameDate)).slice(0,5):[];
   const boxes=await Promise.all(events.map(async e=>{try{const h=await contextJson(base+'summary?event='+e.id,context,true);return contextHistory(h.data,c.id,e,started,Number(f.season));}catch{return null;}}));
   evidence.history[side]=boxes.filter(Boolean);
  }));
  if(Date.now()>=kickoff)throw Error('context_window_closed_during_capture');
  return evidence;
 }catch(e){return {...empty,warnings:[/^[a-z0-9_]+$/.test(String(e?.message))?String(e.message):'context_source_unavailable']};}
}
function contextTeamImpact(side,evidence){
 const games=evidence?.history?.[side]||[],lineup=evidence?.lineups?.teams?.find(t=>t.side===side),report=evidence?.availability?.teams?.find(t=>t.side===side);
 const result={side,status:'not_applied',reason:'player_history_insufficient',history_games:games.length,net_margin_delta:0,injury_applied:false,lineup_applied:false,players:[],conflicts:[]};
 if(games.length<3)return result;
 const players=new Map();
 for(const g of games)for(const p of g.rows){const v=players.get(p.key)||{key:p.key,name:p.name,minutes:0,pm:0,starts:0,appearances:0};v.minutes+=p.minutes;v.pm+=p.plus_minus;v.starts+=p.starter?1:0;v.appearances++;players.set(p.key,v);}
 const all=[...players.values()],totalMinutes=all.reduce((a,p)=>a+p.minutes,0),teamRate=all.reduce((a,p)=>a+p.pm,0)/totalMinutes*48;
 const active=new Set((lineup?.active||[]).map(contextName)),inactive=new Set((lineup?.inactive||[]).map(p=>contextName(p.name)));
 const starters=new Set((lineup?.starters||[]).map(p=>contextName(p.name))),confirmed=lineup?.status==='confirmed';
 const out=new Set(inactive);
 for(const r of evidence?.availability?.items||[]){if(r.side!==side||!['out','suspended','suspension'].includes(r.status))continue;const key=contextName(r.name);if(active.has(key)){result.conflicts.push(r.name);continue;}out.add(key);}
 if(!confirmed&&!out.size)return {...result,reason:'no_confirmed_availability_change'};
 if(confirmed&&[...starters].some(k=>!players.has(k)))return {...result,reason:'starter_history_missing'};
 let desired=0;
 for(const p of all){
  p.baseline=p.minutes/games.length;p.target=out.has(p.key)?0:p.baseline;
  if(confirmed&&!out.has(p.key)){p.target+=starters.has(p.key)?6*(1-p.starts/games.length):-6*p.starts/games.length;p.target=clamp(p.target,0,40);}
  desired+=p.target;
 }
 if(desired<120)return {...result,reason:'remaining_rotation_insufficient'};
 let delta=0;
 for(const p of all){
  const target=p.target*240/desired;if(target>48)return {...result,reason:'projected_minutes_invalid'};
  const rate=clamp((p.pm/p.minutes*48-teamRate)*(p.minutes/(p.minutes+450)),-8,8);
  const contribution=(target-p.baseline)/48*rate/5;delta+=contribution;
  if(Math.abs(target-p.baseline)>.1)result.players.push({name:p.name,baseline_minutes:round(p.baseline,2),projected_minutes:round(target,2),history_appearances:p.appearances,regularized_net_per_48:round(rate,3),net_margin_contribution:round(contribution,4),reason:out.has(p.key)?'confirmed_absence':confirmed&&starters.has(p.key)?'confirmed_starter':'rotation_reallocation'});
 }
 return {...result,status:result.conflicts.length||(!confirmed&&!['data_returned','no_rows_returned'].includes(report?.status))?'partial':'applied',reason:null,net_margin_delta:Math.abs(delta)<.00005?0:round(clamp(delta,-1.5,1.5),4),
  injury_applied:[...out].some(k=>players.has(k)),lineup_applied:confirmed,
  availability_complete:['data_returned','no_rows_returned'].includes(report?.status)||confirmed};
}
function applyPlayerContext(model,evidence){
 const home=contextTeamImpact('home',evidence),away=contextTeamImpact('away',evidence);
 const delta=home.net_margin_delta-away.net_margin_delta,applicable=home.status!=='not_applied'||away.status!=='not_applied';
 const impact={version:CONTEXT_VERSION,status:applicable?(home.status==='not_applied'||away.status==='not_applied'||home.status==='partial'||away.status==='partial'?'partial':'applied'):'not_applied',
  injury_adjustment_applied:home.injury_applied||away.injury_applied,lineup_adjustment_applied:home.lineup_applied||away.lineup_applied,
  net_margin_delta:round(delta,4),total_delta:0,teams:[home,away],method:'regularized_recent_oncourt_margin_rotation_v1',uncalibrated:true,
  note:'以近五場實際上場時間及正負值估算輪替差異；僅採確認缺陣及確認先發，每隊分差修正上限 1.5 分。未估計總分修正。'};
 if(!applicable)return {...model,player_context_adjustment:impact};
 if(![model.expected_home_points,model.expected_away_points,model.expected_margin,model.expected_total,model.margin_sigma,model.total_sigma].every(Number.isFinite)||model.margin_sigma<=0||model.total_sigma<=0)
  return {...model,player_context_adjustment:{...impact,status:'not_applied',injury_adjustment_applied:false,lineup_adjustment_applied:false,net_margin_delta:0,reason:'base_model_invalid'}};
 if(delta===0)return {...model,player_context_adjustment:impact};
 const h=model.expected_home_points+delta/2,a=model.expected_away_points-delta/2,margin=model.expected_margin+delta,total=model.expected_total,m=model.market||{};
 const wp=normalCdf(margin/model.margin_sigma),cp=m.home_spread==null?null:normalCdf((margin+m.home_spread)/model.margin_sigma),op=model.over_probability;
 return {...model,expected_home_points:round(h,2),expected_away_points:round(a,2),expected_margin:round(margin,2),expected_total:round(total,2),
  home_win_probability:round(wp,5),home_cover_probability:cp===null?null:round(cp,5),over_probability:op===null?null:round(op,5),
  shadow_directions:{moneyline:wp>=.55?'home':wp<=.45?'away':null,handicap:cp===null?null:cp>=.55?'home':cp<=.45?'away':null,over_under:op===null?null:op>=.55?'over':op<=.45?'under':null},
  base_without_player_context:{expected_home_points:model.expected_home_points,expected_away_points:model.expected_away_points,expected_margin:model.expected_margin,expected_total:model.expected_total,home_win_probability:model.home_win_probability,home_cover_probability:model.home_cover_probability,over_probability:model.over_probability},player_context_adjustment:impact};
}
