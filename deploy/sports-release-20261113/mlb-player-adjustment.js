// Shared by T-10, T-2 and T-15. Conservative, uncalibrated run-rate heuristics.
// Never reconstruct historical availability from a current roster or change saved results.
const MLB_PLAYER_MODEL='mlb-player-context-v1';
const mlbClamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function mlbStatRows(payload,teamId,season,group){
 const blocks=(payload?.stats||[]).filter(x=>String(x.group?.displayName||'').toLowerCase()===group);
 const rows=blocks.flatMap(x=>x.splits||[]).filter(x=>Number(x.team?.id)===Number(teamId)&&Number(x.season)===Number(season)&&Number(x.player?.id)>0);
 // Duplicate player splits are ambiguous; do not double-count or choose arbitrarily.
 const counts=new Map();for(const r of rows)counts.set(r.player.id,(counts.get(r.player.id)||0)+1);
 return rows.filter(r=>counts.get(r.player.id)===1).map(r=>({id:Number(r.player.id),name:r.player.fullName,stat:r.stat||{}}));
}
async function mlbPlayerStats(teamId,season,asOf){
 // This loader is current-time only. Past date replay must supply frozen inputs.
 if(Math.abs(Date.now()-Date.parse(asOf))>5*60000)throw Error('player_stats_current_time_only');
 const url='https://statsapi.mlb.com/api/v1/stats?'+new URLSearchParams({stats:'season',group:'hitting,pitching',season:String(season),sportIds:'1',teamId:String(teamId),playerPool:'ALL',limit:'1000'});
 try{const p=await fetchJson(url);return {status:'data_returned',team_id:teamId,season,requested_at:asOf,fetched_at:new Date().toISOString(),source:'mlb_official_team_player_season_stats',hitters:mlbStatRows(p,teamId,season,'hitting'),pitchers:mlbStatRows(p,teamId,season,'pitching')};}
 catch(e){return {status:'source_unavailable',team_id:teamId,season,requested_at:asOf,reason:String(e?.message||e).slice(0,100),hitters:[],pitchers:[]};}
}
function mlbSideAdjustment(context,side,stats,team){
 const out={side,mode:'not_applied',batting_fraction:0,bullpen_opponent_runs:0,lineup_applied:false,injury_applied:false,used:[],skipped:[]};
 const lineup=context.lineups?.teams?.find(t=>t.side===side),injuries=(context.availability?.items||[]).filter(p=>p.side===side&&p.status==='out');
 const injured=new Set(injuries.map(p=>Number(p.id)));
 if(stats?.status!=='data_returned'){out.skipped.push('player_stats_unavailable');return out;}
 const batters=stats.hitters.filter(p=>n(p.stat.plateAppearances)>0&&n(p.stat.ops)!==null&&n(p.stat.ops)>=0&&n(p.stat.ops)<=3);
 const totalPa=batters.reduce((s,p)=>s+Number(p.stat.plateAppearances),0);
 const baseline=totalPa?batters.reduce((s,p)=>s+Number(p.stat.plateAppearances)*Number(p.stat.ops),0)/totalPa:0;
 const shrunk=p=>baseline+(Number(p.stat.ops)-baseline)*Number(p.stat.plateAppearances)/(Number(p.stat.plateAppearances)+100);
 const active=new Set((lineup?.active_roster_ids||[]).map(Number));
 if(totalPa>=500&&baseline>0){
  if(lineup?.status==='confirmed'){
   const ids=(lineup.batting_order||[]).map(p=>Number(p.id)),unique=new Set(ids);
   const players=ids.map(id=>batters.find(p=>p.id===id));
   if(ids.length!==9||unique.size!==9||players.some(p=>!p))out.skipped.push('confirmed_lineup_missing_player_stats');
   else if(ids.some(id=>injured.has(id)))out.skipped.push('lineup_injury_conflict');
   else{
    // Equal batting slots: no invented PA advantage for batting-order position.
    const lineupOps=players.reduce((s,p)=>s+shrunk(p),0)/9;
    out.batting_fraction=mlbClamp(lineupOps/baseline-1,-.20,.20);
    out.lineup_applied=true;out.mode='confirmed_lineup';
    out.used=players.map(p=>({id:p.id,plate_appearances:Number(p.stat.plateAppearances),ops:Number(p.stat.ops),shrunk_ops:round(shrunk(p),4)}));
    out.skipped.push('hitter_injuries_already_represented_by_lineup');
   }
  }else if(lineup?.roster_status==='data_returned'){
   const available=batters.filter(p=>active.has(p.id)&&!injured.has(p.id));
   // Backup pool is the lower-PA active hitters, not an invented replacement value.
   const regulars=[...available].sort((a,b)=>Number(b.stat.plateAppearances)-Number(a.stat.plateAppearances)).slice(0,9);
   const regularIds=new Set(regulars.map(p=>p.id));
   const bench=available.filter(p=>!regularIds.has(p.id)),benchPa=bench.reduce((s,p)=>s+Number(p.stat.plateAppearances),0);
   const missing=batters.filter(p=>injured.has(p.id)&&Number(p.stat.plateAppearances)>=30);
   if(missing.length&&benchPa>=30){
    const replacement=bench.reduce((s,p)=>s+shrunk(p)*Number(p.stat.plateAppearances),0)/benchPa;
    out.batting_fraction=mlbClamp(missing.reduce((s,p)=>s+(replacement-shrunk(p))/baseline*Number(p.stat.plateAppearances)/totalPa,0),-.20,.20);
    out.injury_applied=true;out.mode='injury_replacement';
    out.used=missing.map(p=>({id:p.id,plate_appearances:Number(p.stat.plateAppearances),shrunk_ops:round(shrunk(p),4),replacement_ops:round(replacement,4),historical_pa_share:round(Number(p.stat.plateAppearances)/totalPa,4)}));
   }else out.skipped.push(missing.length?'replacement_sample_insufficient':'no_qualified_injured_hitter');
  }else out.skipped.push('roster_unavailable');
 }else out.skipped.push('team_batting_sample_insufficient');
 // Relief injuries affect opponent scoring independently of the batting lineup.
 const relievers=stats.pitchers.filter(p=>innings(p.stat.inningsPitched)>=10&&n(p.stat.era)!==null&&n(p.stat.era)>=0&&Number(p.stat.gamesStarted||0)/Math.max(1,Number(p.stat.gamesPitched||0))<.2);
 const ready=relievers.filter(p=>active.has(p.id)&&!injured.has(p.id));
 const readyIp=ready.reduce((s,p)=>s+innings(p.stat.inningsPitched),0);
 if(lineup?.roster_status==='data_returned'&&readyIp>=20&&Number(team.games_played)>=5&&n(team.era)!==null){
  const era=p=>(Number(p.stat.era)*innings(p.stat.inningsPitched)+Number(team.era)*20)/(innings(p.stat.inningsPitched)+20);
  const replacement=ready.reduce((s,p)=>s+era(p)*innings(p.stat.inningsPitched),0)/readyIp;
  const missing=relievers.filter(p=>injured.has(p.id));
  if(missing.length){
   out.bullpen_opponent_runs=mlbClamp(missing.reduce((s,p)=>s+(replacement-era(p))*Math.min(1,innings(p.stat.inningsPitched)/Number(team.games_played))/9,0),-.35,.35);
   out.injury_applied=true;
   out.bullpen_used=missing.map(p=>({id:p.id,innings:innings(p.stat.inningsPitched),shrunk_era:round(era(p),4),replacement_era:round(replacement,4)}));
  }
 }
 out.batting_fraction=round(out.batting_fraction,6);out.bullpen_opponent_runs=round(out.bullpen_opponent_runs,6);
 return out;
}
function applyMlbPlayers(projection,context,homeStats,awayStats,hs,as){
 const home=mlbSideAdjustment(context,'home',homeStats,hs),away=mlbSideAdjustment(context,'away',awayStats,as);
 // Base projection mixes team attack and opponent defense 50/50. Change attack share only.
 const hd=Number(hs.runs_per_game)*.5*home.batting_fraction+away.bullpen_opponent_runs;
 const ad=Number(as.runs_per_game)*.5*away.batting_fraction+home.bullpen_opponent_runs;
 const h=Math.max(.5,projection.home_runs+hd),a=Math.max(.5,projection.away_runs+ad);
 const adjustment={version:MLB_PLAYER_MODEL,status:[home,away].some(x=>x.lineup_applied||x.injury_applied)?'applied':'not_applied',lineup_adjustment_applied:home.lineup_applied||away.lineup_applied,injury_adjustment_applied:home.injury_applied||away.injury_applied,home,away,home_run_delta:round(h-projection.home_runs,4),away_run_delta:round(a-projection.away_runs,4),baseline_projection:projection,limitations:'OPS run-rate proxy and relief replacement heuristics; not backtest-calibrated. Missing inputs are skipped, not zero-filled. Confirmed batting lineups replace hitter injury adjustments.'};
 return {projection:{...projection,home_runs:round(h),away_runs:round(a),total_runs:round(h+a),home_run_margin:round(h-a),winner:h>=a?'home':'away',method:'season_recent_starters_plus_players_v0.4'},adjustment};
}
async function mlbContextOrUnavailable(gameId,fixture,now){
 try{return await mlbPlayerContext(gameId,fixture,now);}catch(e){if(String(e?.message||e).includes('fixture_mismatch'))throw e;return {availability:{status:'source_unavailable',items:[]},lineups:{status:'source_unavailable',teams:[],probable_pitchers:{}},reason:String(e?.message||e).slice(0,100)};}
}
