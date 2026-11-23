/* 投注資金工具回歸測試（GPT 審核 2026-11-22 的重現案例）。執行：node tests/bet-plan-regression.cjs */
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','bet-plan.html'),'utf8');
const js=[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];
global.window={};eval(fs.readFileSync(path.join(__dirname,'..','habao-bankroll-summary.js'),'utf8'));global.sessionStorage={getItem:()=>JSON.stringify({account:'t'})};global.localStorage={getItem:()=>null,setItem:()=>{}};
eval(js);const B=window.HabaoBetPlan;let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;},eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);n++;};
// 損益
eq(B.profit(100,1.9,'win'),90);eq(B.profit(100,1.9,'half_win'),45);eq(B.profit(100,1.9,'push'),0);eq(B.profit(100,1.9,'void'),0);eq(B.profit(100,1.9,'half_loss'),-50);eq(B.profit(100,1.9,'loss'),-100);
// 盤口
eq(B.parseLine('-0.5/1'),-0.75);eq(B.parseLine('2.5/3'),2.75);ok(isNaN(B.parseLine('0.5/1.5')));eq(B.parseLine(''),null);
// 結算
const t=(m,p,l,h,a,e)=>eq(B.settleFromScore({market:m,rec_pick:p,line:l},h,a),e,m+p+l+' '+h+'-'+a);
t('moneyline','主勝',null,2,1,'win');t('moneyline','和局',null,1,1,'win');t('moneyline','客隊',null,1,1,'loss');
t('btts','是',null,1,1,'win');t('btts','否',null,1,0,'win');
t('over_under','大',2.75,2,1,'half_win');t('over_under','小',2.25,1,1,'half_win');t('over_under','大',3,2,1,'push');
t('handicap','主隊',-0.75,1,0,'half_win');t('handicap','主隊',-0.25,1,1,'half_loss');t('handicap','客隊',0.25,1,1,'half_win');t('handicap','主隊',-1,1,0,'push');t('handicap','主隊',null,1,0,null);
// B1 比分驗證
eq(B.parseScore({home_score:null,away_score:null}),null,'null 不可變 0:0');
eq(B.parseScore({home_score:'',away_score:''}),null,'空字串不可變 0:0');
eq(B.parseScore({home_score:1.5,away_score:2}),null,'非整數拒絕');
eq(B.parseScore({home_score:true,away_score:false}),null,'布林拒絕');
eq(B.parseScore({final_score:null}),null);
eq(B.parseScore({final_score:'1-1（點球 4-3）'}),null,'含點球文字拒絕');
eq(B.parseScore({final_score:'2-1'}),[2,1]);eq(B.parseScore({home_score:3,away_score:0}),[3,0]);eq(B.parseScore({home_score:'3',away_score:'0'}),[3,0]);
eq(B.parseScore({home_score:2,away_score:null,final_score:'2-1'}),null,'欄位不完整不改讀 final_score');
// 週界
eq(B.weekStart(Date.parse('2026-11-22T15:00:00Z')),'2026-11-16');eq(B.weekStart(Date.parse('2026-11-22T16:30:00Z')),'2026-11-23');
// 額度
const now=Date.parse('2026-11-22T04:00:00Z');
const st=B.stats({weekly_budget:7000,bets:[{week_start:'2026-11-16',placed_date:'2026-11-22',stake:300,result:null},{week_start:'2026-11-16',placed_date:'2026-11-22',stake:200,result:'void'},{week_start:'2026-11-16',placed_date:'2026-11-20',stake:1000,result:'win'}]},now);
eq([st.dayCap,st.dayUsed,st.dayLeft,st.used],[1000,300,700,1300]);
const pool=B.stats({weekly_budget:2500,pool_mode:'week',bets:[]},now);eq(pool.dayLeft,2500);eq(B.maxPicks(357),3);
// B3 跨週：下注日決定歸日，不 clamp
eq(B.dayIndex({placed_date:'2026-11-22'},'2026-11-16'),6);eq(B.dayIndex({placed_date:'2026-11-23'},'2026-11-16'),null);
// B5 恢復取消退款
const d={weekly_budget:700,bets:[{id:'a',sport:'f',fixture_id:'1',stage:'t10',market:'btts',week_start:'2026-11-16',placed_date:'2026-11-22',stake:100,result:'void'},{id:'b',sport:'f',fixture_id:'2',stage:'t10',market:'btts',week_start:'2026-11-16',placed_date:'2026-11-22',stake:100,result:null}]};
ok(!B.canRestore(d,d.bets[0]).ok,'恢復後超過每日上限 100 要擋');
d.pool_mode='week';ok(B.canRestore(d,d.bets[0]).ok,'週池內可恢復');
d.weekly_budget=150;ok(!B.canRestore(d,d.bets[0]).ok,'超過週上限要擋');
// 7 天一期
eq(B.periodStart({cycle_start:'2026-11-22'},Date.parse('2026-11-22T04:00:00Z')),'2026-11-22');
eq(B.periodStart({cycle_start:'2026-11-22'},Date.parse('2026-11-28T15:59:00Z')),'2026-11-22','第 7 天 23:59 仍在第一期');
eq(B.periodStart({cycle_start:'2026-11-22'},Date.parse('2026-11-28T16:00:00Z')),'2026-11-29','第 8 天進下一期');
eq(B.periodStart({cycle_start:'2026-11-22'},Date.parse('2026-12-10T04:00:00Z')),'2026-12-06');
eq(B.periodStart({},Date.parse('2026-11-25T04:00:00Z')),'2026-11-25','未設定前以今天暫代');
eq(B.periodStart({weekly_budget:2500,bets:[]},Date.parse('2026-11-25T04:00:00Z')),'2026-11-23','舊資料沿用週一');
eq(B.stats({cycle_start:'2026-11-20',weekly_budget:700,bets:[{week_start:'2026-11-20',placed_date:'2026-11-22',stake:100,result:null}]},Date.parse('2026-11-22T04:00:00Z')).dayLeft,0);
// M3 同鍵恢復
const k={sport:'football',fixture_id:'9',stage:'t10',market:'handicap',week_start:'2026-11-16',placed_date:'2026-11-22',stake:100};
const dk={weekly_budget:7000,bets:[Object.assign({id:'A',result:'void'},k),Object.assign({id:'B',result:null},k)]};
ok(!B.canRestore(dk,dk.bets[0]).ok,'同鍵已有有效紀錄時不可恢復');
dk.bets[1].result='void';ok(B.canRestore(dk,dk.bets[0]).ok,'另一筆也取消時可恢復');
// M4 歷史期別依該期設定
const hist={weekly_budget:7000,pool_mode:'daily',periods:{'2026-11-09':{budget:700,pool_mode:'daily'}},bets:[{id:'h1',sport:'f',fixture_id:'1',stage:'t10',market:'btts',week_start:'2026-11-09',placed_date:'2026-11-10',stake:100,result:'void'},{id:'h2',sport:'f',fixture_id:'2',stage:'t10',market:'btts',week_start:'2026-11-09',placed_date:'2026-11-10',stake:100,result:null}]};
ok(!B.canRestore(hist,hist.bets[0]).ok,'舊期依該期上限 700（每日 100）判斷，不受目前 7000 影響');
eq(B.periodPolicy(hist,'2026-11-09').budget,700);eq(B.periodPolicy(hist,'2026-11-16').budget,7000);
// 修改金額不做同鍵檢查但檢查上限
ok(!B.canRestore(hist,hist.bets[1],200,'修改').ok,'舊期調高金額超過該期每日上限要擋');
// NBA 比分契約（basketball-performance-api v1.3 實際回應格式）
const nba=(fs,h,a)=>({game_id:17188,final_score:fs,settlement:{score_projection:{final_home:h,final_away:a}}});
ok(B.scoreUsable('basketball',nba('88-87',88,87)),'NBA 有 final_score＋settlement 才採用');
ok(!B.scoreUsable('basketball',{game_id:1,final_score:'88-87'}),'NBA 沒有 settlement 不採用');
eq(B.sportScore('basketball',nba('88-87',88,87)),[88,87]);
eq(B.sportScore('basketball',nba('145-151',145,151)),[145,151]);
eq(B.sportScore('basketball',nba('88-87',87,88)),null,'final_score 與 score_projection 不一致要拒絕');
eq(B.sportScore('basketball',nba('100-100',100,100)),null,'NBA 平手要拒絕');
eq(B.sportScore('basketball',{final_score:'88-87',settlement:{}}),[88,87],'沒有 score_projection 時只用 final_score');
// 依實際資料結算：主隊 +8.5，88-87 → 全贏；大 210.5、總分 175 → 全輸；客隊獨贏、主勝 → 全輸
eq(B.settleFromScore({market:'handicap',rec_pick:'主隊',line:8.5},88,87),'win');
eq(B.settleFromScore({market:'over_under',rec_pick:'大',line:210.5},88,87),'loss');
eq(B.settleFromScore({market:'moneyline',rec_pick:'客隊',line:null},116,96),'loss');
ok(B.scoreUsable('baseball',{game_id:776001,final_score:'5-3'}),'MLB 有 game_id＋final_score 採用');
eq(B.sportScore('baseball',{game_id:1,final_score:'5-3'}),[5,3]);
eq(B.sportScore('baseball',{game_id:1,final_score:'4-4'}),null,'MLB 平手拒絕');
eq(B.sportScore('baseball',{game_id:1,final_score:'null-null'}),null,'MLB 缺比分（後端字串化 null）拒絕');
eq(B.settleFromScore({market:'handicap',rec_pick:'客隊',line:1.5},5,4),'win');
console.log('bet-plan regression: '+n+' checks passed');
