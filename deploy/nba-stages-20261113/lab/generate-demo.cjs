// Fixed, explicitly synthetic team baseline + recorded public player-context fixture.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),f=JSON.parse(fs.readFileSync(root+'/fixtures/player-context-pregame-20261113.json'));
const clock=Date.parse(f.as_of);class Clock extends Date{constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}}
const c=vm.createContext({Date:Clock,Intl,Math,Number,String,JSON,Object,Array,Map,Set,URL,URLSearchParams,TextDecoder,Uint8Array,Response,AbortSignal,crypto:require('node:crypto').webcrypto,console,Deno:{env:{get:()=>''},serve(){}},fetch:async raw=>{
 const u=new URL(raw);const data=u.hostname==='stats.nba.com'?f.lineups:u.pathname.endsWith('/scoreboard')?f.scoreboard:u.searchParams.get('event')==='401909979'?f.summary:f.history[u.searchParams.get('event')];return new Response(JSON.stringify(data));
}});vm.runInContext(fs.readFileSync(root+'/nba-v2-stage-runner.index.txt','utf8'),c);
(async()=>{
 const e=await c.collectPlayerContext({game_id:90001,fixture_time:f.kickoff,prediction_data:{fixture:{season:2026,home:{name:'Phoenix Suns'},away:{name:'Charlotte Hornets'}}}},{});
 const market={available:true,home_spread:-6.5,total:214.5},base={version:'synthetic-display-baseline',expected_home_points:114,expected_away_points:110,expected_margin:4,expected_total:224,margin_sigma:16,total_sigma:20,market};
 base.home_win_probability=c.normalCdf(4/16);base.home_cover_probability=c.normalCdf((4-6.5)/16);base.over_probability=c.normalCdf((224-214.5)/20);
 const games=[];
 for(const [id,home,away]of [[90001,'Phoenix Suns','Charlotte Hornets'],[90002,'Minnesota Timberwolves','Dallas Mavericks']]){
  const s={game_id:id,fixture_time:f.kickoff,prediction_data:{fixture:{id,date:f.kickoff,season:2026,home:{name:home},away:{name:away},league:{name:'NBA'}}}};
  const evidence=id===90001?e:{availability:{status:'not_available',items:[],teams:[]},lineups:{status:'not_available',teams:[]},history:{home:[],away:[]},warnings:[]};
  const results={},models={},metas={};
  const teamBase=id===90001?base:{...base,expected_home_points:112,expected_away_points:112,expected_margin:0,expected_total:224,home_win_probability:.5,home_cover_probability:null,over_probability:null,market:{available:false,home_spread:null,total:null}};
  for(const stage of ['t10','t2','t15']){
   const model=stage==='t10'?teamBase:c.applyPlayerContext(teamBase,evidence),meta={captured_at:stage==='t10'?'2026-11-12T16:00:00Z':stage==='t2'?f.as_of:'2026-11-13T01:45:00Z',capture_mode:'scheduled',player_evidence:stage==='t10'?undefined:evidence};
   const r=c.stageResult(s,stage==='t10'?'t2':stage,model,meta);if(stage==='t10'){delete r.v2_stage;delete r.v2_stage_label;delete r.analysis.v2_stage_evidence;}
   r.qa_data_origin='合成球隊基準；僅供模板及計算一致性測試，非正式預測';results[stage]=r;models[stage]=model;metas[stage]=meta;
  }
  const variants={};
  if(id===90001){const confirmed=JSON.parse(JSON.stringify(evidence));confirmed.lineups.status='data_returned';for(const t of confirmed.lineups.teams){t.status='confirmed';t.active=t.starters.map(p=>p.name);t.starters.forEach(p=>p.confirmed=true);}const model=c.applyPlayerContext(teamBase,confirmed),meta={captured_at:'2026-11-13T01:45:00Z',capture_mode:'scheduled',player_evidence:confirmed};const result=c.stageResult(s,'t15',model,meta);result.qa_data_origin='合成確認先發分支，並非原賽事已確認名單';variants.confirmed={result,model,meta};}
  games.push({game_id:id,fixture_time:f.kickoff,home_team:home,away_team:away,results,models,metas,variants});
 }
 fs.writeFileSync(__dirname+'/demo.json',JSON.stringify({schema:'habao-nba-replay-v1',origin:'synthetic_display_examples',description:'模板範例，非正式預測：球隊基準為合成資料；球員名單重播歷史來源。不能用來驗證正式賽前資料或預測準確率。',games}));
 console.log('Generated explicit display examples');
})().catch(e=>{console.error(e);process.exitCode=1});
