/* Shared production contract: used unchanged by pages, replay and contract tests. */
(function(root){
 'use strict';
 const sequence=['t10','t2','t15'];
 const labels={t10:'T-10 賽前分析',t2:'T-2 深度分析',t15:'T-15 最終分析'};
 const sportNames={football:'足球',basketball:'NBA',baseball:'MLB'};
 const nbaCodes={'Atlanta Hawks':'atl','Boston Celtics':'bos','Brooklyn Nets':'bkn','Charlotte Hornets':'cha','Chicago Bulls':'chi','Cleveland Cavaliers':'cle','Dallas Mavericks':'dal','Denver Nuggets':'den','Detroit Pistons':'det','Golden State Warriors':'gs','Houston Rockets':'hou','Indiana Pacers':'ind','Los Angeles Clippers':'lac','LA Clippers':'lac','Los Angeles Lakers':'lal','Memphis Grizzlies':'mem','Miami Heat':'mia','Milwaukee Bucks':'mil','Minnesota Timberwolves':'min','New Orleans Pelicans':'no','New York Knicks':'ny','Oklahoma City Thunder':'okc','Orlando Magic':'orl','Philadelphia 76ers':'phi','Phoenix Suns':'phx','Portland Trail Blazers':'por','Sacramento Kings':'sac','San Antonio Spurs':'sa','Toronto Raptors':'tor','Utah Jazz':'utah','Washington Wizards':'wsh'};
 const mlbNames={'Milwaukee Brewers':'密爾瓦基釀酒人','Tampa Bay Rays':'坦帕灣光芒','Los Angeles Dodgers':'洛杉磯道奇','New York Mets':'紐約大都會','New York Yankees':'紐約洋基','Boston Red Sox':'波士頓紅襪','Chicago Cubs':'芝加哥小熊','St. Louis Cardinals':'聖路易紅雀','Cleveland Guardians':'克里夫蘭守護者','Toronto Blue Jays':'多倫多藍鳥','Seattle Mariners':'西雅圖水手','San Diego Padres':'聖地牙哥教士','Philadelphia Phillies':'費城費城人','Houston Astros':'休士頓太空人','Detroit Tigers':'底特律老虎','Atlanta Braves':'亞特蘭大勇士','Texas Rangers':'德州遊騎兵','Baltimore Orioles':'巴爾的摩金鶯','Kansas City Royals':'堪薩斯市皇家','Arizona Diamondbacks':'亞利桑那響尾蛇','San Francisco Giants':'舊金山巨人','Minnesota Twins':'明尼蘇達雙城','Los Angeles Angels':'洛杉磯天使','Pittsburgh Pirates':'匹茲堡海盜','Cincinnati Reds':'辛辛那提紅人','Washington Nationals':'華盛頓國民','Miami Marlins':'邁阿密馬林魚','Colorado Rockies':'科羅拉多落磯','Chicago White Sox':'芝加哥白襪','Athletics':'運動家'};
 function teamLogo(t,sp){const name=t?.api_name||t?.name||'',id=Number(t?.id);if(sp==='basketball'&&nbaCodes[name])return 'https://a.espncdn.com/i/teamlogos/nba/500/'+nbaCodes[name]+'.png';if(sp==='baseball'&&Number.isSafeInteger(id)&&id>0)return 'https://www.mlbstatic.com/team-logos/'+id+'.svg';return String(t?.logo||'');}
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stage=r=>sequence.includes(r?.v2_stage)?r.v2_stage:'t10';
 function phase(kickoff,now=Date.now()) {const minutes=(Date.parse(kickoff)-now)/60000;return !Number.isFinite(minutes)||minutes<=0||minutes>600?null:minutes<=15?'t15':minutes<=120?'t2':'t10';}
 function lifecycle(value,sp){const v=value&&typeof value==='object'?String(value.long||value.short||''):String(value||'');const key=v.trim().toLowerCase();return /^(ft|aet|pen|awd|wo|final|finished|completed|game over|gameover|f|fr|fo)$/.test(key)||(sp==='basketball'&&key==='3')?'finished':/^(live|in progress|in play|1h|2h|ht|et|bt|p)$/.test(key)?'live':'scheduled';}
 function decision(kickoff,claimed={},now=Date.now(),fixtureStatus='',sp=''){
  const life=lifecycle(fixtureStatus,sp);if(life==='finished')return {stage:null,label:'✓ 已完賽',status:'已完賽',disabled:true};if(life==='live')return {stage:null,label:'分析已截止',status:'比賽已開賽',disabled:true};
  const minutes=(Date.parse(kickoff)-now)/60000,current=phase(kickoff,now);
  const time=s=>new Date(Date.parse(kickoff)-(s==='t2'?120:15)*60000).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});
  if(!Number.isFinite(minutes))return {stage:null,label:'賽事時間未確認',status:'尚未開放分析',disabled:true};
  if(minutes<=0)return {stage:null,label:'分析已截止',status:'比賽已開賽',disabled:true};
  if(minutes>600)return {stage:'t10',label:'賽前 10 小時開放',status:'尚未開放分析',disabled:true};
  if(current==='t10'&&claimed.t10)return {stage:'t2',label:'深度分析・'+time('t2')+' 開放',status:'已領取 T-10・等待 T-2',disabled:true};
  if(current==='t2'&&claimed.t2)return {stage:'t15',label:'最終分析・'+time('t15')+' 開放',status:'已領取 T-2・等待 T-15',disabled:true};
  return {stage:current,label:claimed[current]?'已領取最終分析':current==='t10'?'開始分析':current==='t2'?'深度分析':'最終分析',status:claimed[current]?'已領取 T-15':current.toUpperCase().replace('T','T-')+' 可分析',disabled:!!claimed[current]};
 }
 function identity(r){const f=r?.fixture||{};return Number(r?.game_id??f.game_id??f.fixture_id??f.id??r?.snapshot?.game_id);}
 function sport(r){return String(r?.sport||r?.fixture?.sport||'football').toLowerCase();}
 function valid(r,id,sportName,wantedStage){
  const f=r?.fixture||{},ids=[r?.game_id,f.game_id,f.fixture_id,f.id,r?.snapshot?.game_id].filter(x=>x!=null);
  const sameIds=ids.length>0&&ids.every(x=>Number(String(x).replace(/^(nba|mlb):/,''))===Number(id));
  const knownStage=r?.v2_stage==null||sequence.includes(r.v2_stage);
  const sameSport=[r?.sport,f.sport].filter(Boolean).every(x=>String(x).toLowerCase()===sportName);
  return !!r&&r.success===true&&!!f.home&&!!f.away&&!!r.analysis?.recommendations&&sameIds&&sameSport&&knownStage&&sport(r)===sportName&&stage(r)===wantedStage;
 }
 function pickView(r,market){
  const x=r?.analysis?.recommendations?.[market]||{},names={'主勝':'主隊','客勝':'客隊',home:'主隊',away:'客隊',draw:'和局',over:'大',under:'小'};
  const raw=x.pick,translated=names[raw]||raw;
  const hasPick=!!translated&&!['暫不推薦','暂不推荐','No Recommendation','no recommendation','暫無方向','none'].includes(translated);
  const line=x.line==null||x.line===''?null:Number(x.line),validLine=Number.isFinite(line)?line:null;
  const confidence=x.confidence==null||x.confidence===''?null:Number(x.confidence);
  return {pick:hasPick?translated:'暫不推薦',line:hasPick?validLine:null,confidence:hasPick&&Number.isFinite(confidence)&&confidence>=0&&confidence<=100?confidence:null,reason:String(x.reason||''),hasPick};
 }
 function groupHistory(rows){
  const groups=new Map();
  for(const row of rows||[]){const r=row.result_data,id=Number(row.game_id??row.fixture_id??identity(r)),sp=String(row.sport||sport(r)),s=row.v2_stage||stage(r);
   if(!Number.isSafeInteger(id)||id<=0||!sequence.includes(s))continue;
   const key=sp+':'+id;let g=groups.get(key);if(!g){g={...row,game_id:id,sport:sp,stages:{}};groups.set(key,g);}
   const old=g.stages[s],at=x=>Date.parse(x?.claimed_at||x?.v2_stage_claimed_at||x?.updated_at||'')||0;
   if(!old||at(row)>at(old))g.stages[s]=row;
  }
  return [...groups.values()].sort((a,b)=>Date.parse(a.fixture_time)-Date.parse(b.fixture_time));
 }
 const api={sequence,labels,sportNames,mlbNames,teamLogo,esc,phase,lifecycle,decision,stage,identity,sport,valid,pickView,groupHistory};root.HabaoStageCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
