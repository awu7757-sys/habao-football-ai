// 賠率隊名配對測試（2026-11-15）
// football-v2-shadow-stage-runner 與 match-analysis 各有一份相同的配對規則（habaoPickOddsEvent），
// 本測試檢查兩份一字不差，並驗證常見譯名差異能配對、主客顛倒與不同比賽不會誤配。
// 執行：node tests/team-matching.test.cjs
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
const block=(file,end)=>{const s=fs.readFileSync(path.join(root,file),'utf8');const i=s.indexOf('// ===== 隊名配對');const j=s.indexOf(end,i);assert.ok(i>=0&&j>i,file+'：找不到隊名配對區塊');return s.slice(i,j).trim();};
const a=block('supabase/functions/football-v2-shadow-stage-runner/index.ts','function consensusAll<');
const b=block('supabase/functions/match-analysis/index.ts','async function habaoLoadOddsV4(');
assert.equal(a,b,'兩支程式的隊名配對規則不一致，請同步');
const ctx={Date,Number,String,Array,Set,Math};vm.createContext(ctx);
vm.runInContext(stripTypeScriptTypes(a,{mode:'strip'})+';this.pick=habaoPickOddsEvent;',ctx);
const k=Date.parse('2026-11-15T12:00:00Z');const ev=(h,w,min=0)=>({home_team:h,away_team:w,commence_time:new Date(k+min*60000).toISOString()});
const cases=[
 ['Bayern München','Borussia Dortmund',[ev('Bayern Munich','Borussia Dortmund')],0],
 ['Wolves','Nottingham Forest',[ev('Wolverhampton Wanderers','Nottingham Forest'),ev('Arsenal','Chelsea')],0],
 ['Ulsan Hyundai FC','Jeonbuk Motors',[ev('Ulsan HD','Jeonbuk Hyundai Motors')],0],
 ['Atletico-MG','Flamengo',[ev('Atletico Mineiro','Flamengo')],0],
 ['Inter','AC Milan',[ev('Inter Milan','AC Milan')],0],
 ['Athletic Club','Real Madrid',[ev('Athletic Bilbao','Real Madrid')],0],
 ['Shanghai Port','Beijing Guoan',[ev('Shanghai SIPG','Beijing Guoan')],0],
 ['Kashima','Urawa',[ev('Kashima Antlers','Urawa Red Diamonds')],0],
 ['Vasco DA Gama','Chapecoense-sc',[ev('Vasco da Gama','Chapecoense')],0],
 ['Paris Saint Germain','Lyon',[ev('Paris Saint-Germain','Lyon')],0],
 ['Manchester United','Manchester City',[ev('Manchester City','Manchester United')],null],
 ['Arsenal','Chelsea',[ev('Liverpool','Everton')],null],
 ['Real Madrid','Getafe',[ev('Real Betis','Sevilla')],null],
 ['Borussia Monchengladbach','Union Berlin',[ev('Borussia Dortmund','Union Berlin',600)],null],
];
for(const [h,w,es,want] of cases){const g=ctx.pick(es,k,h,w);assert.equal(g?es.indexOf(g):null,want,`${h} vs ${w}`);}
console.log(`PASS 隊名配對 ${cases.length} 例，兩支程式規則一致`);
