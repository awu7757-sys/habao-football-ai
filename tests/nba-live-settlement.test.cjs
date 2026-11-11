const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/admin-nba-v2-compare/index.ts'),'utf8');
const c=vm.createContext({Response,Date,URLSearchParams,AbortSignal,Deno:{env:{get:()=>''},serve(){}}});vm.runInContext(code,c);
const live=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../live-basketball-performance-api.json'),'utf8'));
const counts={moneyline:0,handicap:0,over_under:0},issues=[];
for(const g of live.matches){
 const score=String(g.final_score).split('-').map(Number);assert.equal(score.length,2);
 const snap={game_id:g.game_id,final_home:score[0],final_away:score[1],status:'verified',prediction_data:{analysis:g.prediction,model:g.model}};
 const out=c.compare(snap,null);
 for(const key of Object.keys(counts)){
  const saved=g.settlement?.[key];if(!saved?.decided)continue;
  counts[key]++;
  if(saved.result!==out.markets[key].v1_result)issues.push({game_id:g.game_id,key,saved:saved.result,recalculated:out.markets[key].v1_result,line:out.markets[key].v1_line,pick:out.markets[key].v1_pick});
 }
}
console.log(JSON.stringify({suite:'Live public NBA settled market arithmetic',matches:live.matches.length,decided_markets:counts,mismatches:issues},null,2));assert.equal(issues.length,0,'live settlement must match original frozen recommendations');
for(const key of Object.keys(counts))assert.equal(counts[key],live.markets[key].decided);
