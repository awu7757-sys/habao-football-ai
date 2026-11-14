const fs=require('fs'),vm=require('vm'),a=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
const now=Date.now(),kickoff=new Date(now+9*60000).toISOString();
const team={games_played:100,runs_per_game:4.5,runs_allowed_per_game:4.2,era:4};
const stats={status:'data_returned',hitters:Array.from({length:12},(_,i)=>({id:i+1,stat:{ops:i===0?1.2:.7,plateAppearances:i<9?300:80}})),pitchers:[]};
const evidence={availability:{status:'data_returned',items:[{side:'away',id:1,status:'out'}]},lineups:{probable_pitchers:{},teams:['home','away'].map(side=>({side,status:side==='home'?'confirmed':'not_published',roster_status:'data_returned',active_roster_ids:Array.from({length:12},(_,i)=>i+1),batting_order:Array.from({length:9},(_,i)=>({id:i+1}))}))}};
let t10Handler;
function make(file){const c=vm.createContext({Deno:{env:{get:k=>k==='HABAO_MLB_TEST_TOKEN'?'t'.repeat(32):''},serve:fn=>t10Handler=fn},Date,URL,URLSearchParams,AbortSignal,Math,Map,Set,Number,Response,console});vm.runInContext(stripTypeScriptTypes(fs.readFileSync(__dirname+'/'+file,'utf8')),c);c.teamSummaryWithCache=async()=>({...team});c.pitcherSummary=async()=>({era:null,innings:null});c.recentTeamForm=async()=>null;c.mlbContextOrUnavailable=async()=>structuredClone(evidence);c.mlbPlayerStats=async()=>structuredClone(stats);return c;}
(async()=>{
 const t=make('baseball-analysis.index.txt'),handle=t10Handler;
 t.fetchJson=async()=>({dates:[{games:[{gamePk:1,gameType:'R',gameDate:kickoff,season:2026,teams:{home:{team:{id:147,name:'Home'}},away:{team:{id:111,name:'Away'}}}}]}]});
 t.readOpeningOdds=async()=>({status:'found',lines:{home_spread:-1.5,total:8.5}});
 const r=await handle({method:'GET',headers:new Headers({'x-habao-mlb-token':'t'.repeat(32)}),url:'https://example.invalid?game_id=1&include_odds=1'});a.equal(r.status,200);const ten=await r.json();
 const s=make('baseball-v2-stage-runner.index.txt');s.currentMlbOdds=async()=>({available:true,home_spread:-1.5,total:8.5});
 const source={game_id:1,fixture_time:kickoff,prediction_data:{fixture:{season:2026,home:{id:147,name:'Home'},away:{id:111,name:'Away'}}}};
 const final=await s.buildMlbStage(source,'t15');
 for(const k of ['home_runs','away_runs','total_runs','home_run_margin','winner'])a.equal(ten.model.projection[k],final.model.projection[k],k);
 a.ok(ten.model.player_context_adjustment.lineup_adjustment_applied);a.ok(ten.model.player_context_adjustment.injury_adjustment_applied);
 a.equal(ten.model.markets.moneyline.pick,final.result.analysis.recommendations.moneyline.pick);
 a.equal(ten.model.markets.spread.pick,final.result.analysis.recommendations.handicap.pick);
 a.equal(ten.model.markets.totals.pick,final.result.analysis.recommendations.over_under.pick);
 console.log('PASS T10 and T15 execute same player adjustments and market directions');
 const t2=await s.buildMlbStage({...source,fixture_time:new Date(now+60*60000).toISOString()},'t2');
 a.deepEqual(t2.model.projection,final.model.projection);console.log('PASS T2 and T15 use identical calculation for identical inputs');
 await a.rejects(s.buildMlbStage(source,'t2'),/window_closed/);console.log('PASS T2 cannot be generated during T15 window');
 s.mlbContextOrUnavailable=async()=>({...evidence,raw_started:true});await a.rejects(s.buildMlbStage(source,'t15'),/match_started/);console.log('PASS started match refuses new snapshot');
 const shared=fs.readFileSync(__dirname+'/mlb-player-adjustment.js','utf8');for(const f of ['baseball-analysis.index.txt','baseball-v2-stage-runner.index.txt'])a.ok(fs.readFileSync(__dirname+'/'+f,'utf8').includes(shared));console.log('PASS deployed entrypoints embed exact shared player source');console.log('RESULT 5 passed');
})().catch(e=>{console.error(e);process.exitCode=1});
