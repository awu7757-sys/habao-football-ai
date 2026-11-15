// 用 03_football_stage_export_readonly.sql 匯出的 CSV 重算推薦並與「跟莊家熱門」比較。執行：node deploy/analysis-20261115/03_baseline_compare.cjs <csv路徑>
const fs=require('fs'),vm=require('vm');const {stripTypeScriptTypes:st}=require('node:module');
const src=fs.readFileSync('require("path").resolve(__dirname,"../..")+"/"supabase/functions/football-v2-stage-member/index.ts','utf8');
const code=src.slice(src.indexOf('function scoreGrid('),src.indexOf('\nDeno.serve('));
const ctx={VERSION:'x',Math,Number,Array,String,Date,Object,JSON};vm.createContext(ctx);vm.runInContext(st(code,{mode:'strip'})+';this.toAnalysis=toAnalysis;this.splitLine=splitLine;this.legResult=legResult;this.scoreGrid=scoreGrid;this.expectedReturn=expectedReturn',ctx);
// csv parse
function parse(t){const rows=[];let row=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){row.push(f);f=''}else if(c=='\n'){row.push(f);rows.push(row);row=[];f=''}else if(c!='\r')f+=c}if(f||row.length){row.push(f);rows.push(row)}return rows}
const R=parse(fs.readFileSync('process.argv[2]','utf8'));const H=R[0];const data=R.slice(1).filter(r=>r.length===H.length).map(r=>Object.fromEntries(H.map((h,i)=>[h,r[i]])));
function settle(value,line,side){const parts=ctx.splitLine(line);let s=0;for(const p of parts)s+=ctx.legResult(value,p,side);s/=parts.length;return s>0.75?'win':s>0?'half_win':s===0?'push':s>-0.75?'half_loss':'loss';}
const pts={win:1,half_win:.5,half_loss:0,loss:0};
const agg={};function add(k,res){if(!res||res==='push')return;const a=agg[k]||(agg[k]={n:0,p:0});a.n++;a.p+=pts[res];}
for(const r of data){
  if(r.capture_mode!=='scheduled')continue;
  const snap={fixture_id:+r.fixture_id,kickoff_at:'',captured_at:'',home_xg:+r.home_xg,away_xg:+r.away_xg,probabilities:JSON.parse(r.probabilities),market_context:JSON.parse(r.market_context),model_version:r.model_version};
  const hs=+r.home_score,as=+r.away_score;let A;try{A=ctx.toAnalysis(snap,{},r.stage==='t10'?'t2':r.stage)}catch(e){continue}
  const rec=A.analysis.recommendations;const tag=r.stage;
  // moneyline
  const ml=rec.moneyline.pick;const mlRes=(ml==='主勝'&&hs>as)||(ml==='客勝'&&as>hs)||(ml==='和局'&&hs===as)?'win':'loss';
  add(tag+'|獨贏|模型',mlRes);add('ALL|獨贏|模型',mlRes);
  const ctxm=snap.market_context;const main=ctxm.handicap;
  if(main&&Number(main.home_line)!==0){const favHome=Number(main.home_line)<0;const res=(favHome?hs>as:as>hs)?'win':'loss';add(tag+'|獨贏|跟莊家熱門',res);add('ALL|獨贏|跟莊家熱門',res);
    const mres=mlRes;const agreeML=(ml==='主勝'&&favHome)||(ml==='客勝'&&!favHome);add('ALL|獨贏|模型與熱門同向',agreeML?mlRes:null);add('ALL|獨贏|模型與熱門反向',agreeML?null:mlRes);add('ALL|獨贏|反向時改跟熱門',agreeML?null:res);add(tag+'|獨贏|模型(同批)',mres);add('ALL|獨贏|模型(同批)',mres);}
  // btts
  const by=hs>0&&as>0;add('ALL|BTTS|模型',(rec.btts.pick==='是')===by?'win':'loss');add('ALL|BTTS|永遠是',by?'win':'loss');
  // totals model (EV across lines)
  if(rec.over_under.line!=null){const side=rec.over_under.pick==='大'?'over':'under';const res=settle(hs+as,rec.over_under.line,side);add(tag+'|大小|模型(最高EV)',res);add('ALL|大小|模型(最高EV)',res);}
  const mt=ctxm.total;
  if(mt&&mt.over_odds>1&&mt.under_odds>1){const L=+mt.line;const grid=ctx.scoreGrid(snap.home_xg,snap.away_xg);
    const pO=grid.filter(x=>x.h+x.a>L).reduce((s,x)=>s+x.p,0),pU=grid.filter(x=>x.h+x.a<L).reduce((s,x)=>s+x.p,0);
    const r1=settle(hs+as,L,pO>=pU?'over':'under');add(tag+'|大小|模型(主盤,機率)',r1);add('ALL|大小|模型(主盤,機率)',r1);
    const r2=settle(hs+as,L,mt.over_odds<=mt.under_odds?'over':'under');add(tag+'|大小|跟莊家熱門(主盤)',r2);add('ALL|大小|跟莊家熱門(主盤)',r2);
    const agree=(pO>=pU)===(mt.over_odds<=mt.under_odds);if(agree){add('ALL|大小|模型與莊家同向(主盤)',r1)}else add('ALL|大小|模型與莊家反向(主盤)',r1);}
  if(rec.handicap.line!=null){const side=rec.handicap.pick==='主隊'?'home':'away';const v=side==='home'?hs-as:as-hs;const res=settle(v,rec.handicap.line,side);add(tag+'|讓分|模型(最高EV)',res);add('ALL|讓分|模型(最高EV)',res);}
  if(main&&main.home_odds>1&&main.away_odds>1){const L=+main.home_line;const grid=ctx.scoreGrid(snap.home_xg,snap.away_xg);
    const pH=grid.filter(x=>x.h-x.a+L>0).reduce((s,x)=>s+x.p,0),pA=grid.filter(x=>x.a-x.h-L>0).reduce((s,x)=>s+x.p,0);
    const mside=pH>=pA?'home':'away';const r1=settle(mside==='home'?hs-as:as-hs,mside==='home'?L:-L,mside);add(tag+'|讓分|模型(主盤,機率)',r1);add('ALL|讓分|模型(主盤,機率)',r1);
    const fside=main.home_odds<=main.away_odds?'home':'away';const r2=settle(fside==='home'?hs-as:as-hs,fside==='home'?L:-L,fside);add(tag+'|讓分|跟莊家熱門(主盤)',r2);add('ALL|讓分|跟莊家熱門(主盤)',r2);}
}
for(const k of Object.keys(agg).sort())console.log(k.padEnd(34),String(agg[k].n).padStart(4),(100*agg[k].p/agg[k].n).toFixed(1)+'%');
// coverage
const cov={};for(const r of data){if(r.capture_mode!=='scheduled')continue;const m=JSON.parse(r.market_context);const k=m.status||'?';cov[k]=(cov[k]||0)+1}console.log(cov);
