const fs=require('fs'),vm=require('vm');const {stripTypeScriptTypes:st}=require('node:module');
const src=fs.readFileSync(require('path').resolve(__dirname,'../../supabase')+'/functions/football-v2-stage-member/index.ts','utf8');
const ctx={VERSION:'x',Math,Number,Array,String,Date,Object,JSON};vm.createContext(ctx);
vm.runInContext(st(src.slice(src.indexOf('function scoreGrid('),src.indexOf('\nDeno.serve(')),{mode:'strip'})+';this.ta=toAnalysis;this.sl=splitLine;this.lr=legResult',ctx);
function parse(t){const rows=[];let row=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){row.push(f);f=''}else if(c=='\n'){row.push(f);rows.push(row);row=[];f=''}else if(c!='\r')f+=c}if(f||row.length){row.push(f);rows.push(row)}return rows}
const R=parse(fs.readFileSync(process.argv[2],'utf8'));const H=R[0];const data=R.slice(1).filter(r=>r.length===H.length).map(r=>Object.fromEntries(H.map((h,i)=>[h,r[i]])));
const settle=(v,l,s)=>{const ps=ctx.sl(l);let t=0;for(const p of ps)t+=ctx.lr(v,p,s);t/=ps.length;return t>0.75?1:t>0?.5:t===0?null:0};
const agg={};const add=(k,pts,state)=>{const a=agg[k]||(agg[k]={n:0,p:0,push:0,nopick:0});if(state==='nopick')a.nopick++;else if(pts===null)a.push++;else{a.n++;a.p+=pts}};
for(const r of data){if(r.kickoff_tw<'2026-11-16'||r.capture_mode!=='scheduled'||!['t2','t15'].includes(r.stage))continue;
 const kick=new Date(r.kickoff_tw.replace(' ','T')+':00+08:00').toISOString();
 const snap={fixture_id:+r.fixture_id,kickoff_at:kick,captured_at:kick,home_xg:+r.home_xg,away_xg:+r.away_xg,probabilities:JSON.parse(r.probabilities),market_context:JSON.parse(r.market_context)};
 const hs=+r.home_score,as=+r.away_score,rec=ctx.ta(snap,{},r.stage).analysis.recommendations,S=r.stage==='t2'?'T-2':'T-15';
 const np=p=>!p||p==='暫不推薦';
 const ml=rec.moneyline;if(np(ml.pick))add(S+'|獨贏',0,'nopick');else add(S+'|獨贏',(ml.pick==='主勝'&&hs>as)||(ml.pick==='客勝'&&as>hs)||(ml.pick==='和局'&&hs===as)?1:0);
 const h=rec.handicap;if(np(h.pick)||h.line==null)add(S+'|讓分',0,'nopick');else{const home=h.pick==='主隊';add(S+'|讓分',settle(home?hs-as:as-hs,h.line,home?'home':'away'));}
 const o=rec.over_under;if(np(o.pick)||o.line==null)add(S+'|大小分',0,'nopick');else add(S+'|大小分',settle(hs+as,o.line,o.pick==='大'?'over':'under'));
 const b=rec.btts;if(np(b.pick))add(S+'|BTTS',0,'nopick');else add(S+'|BTTS',(b.pick==='是')===(hs>0&&as>0)?1:0);
}
for(const k of Object.keys(agg))console.log(k,JSON.stringify(agg[k]),agg[k].n?(100*agg[k].p/agg[k].n).toFixed(1):'-');
