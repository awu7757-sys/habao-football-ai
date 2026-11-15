/** HABAO MLB PUBLIC verification: official T-10 snapshots only + independently stored final results.
 * No public member data. Moneyline, Handicap (Spread), and Totals are all public for MLB.
 */
import {createClient} from 'npm:@supabase/supabase-js@2';
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public,max-age=120',
 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS',
 'Access-Control-Allow-Headers':'apikey,authorization,content-type'};
const out=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:H});
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const sb=base&&key?createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const pct=(w:number,l:number)=>w+l?Number((w/(w+l)*100).toFixed(1)):null;
function stats(rows:any[],key:'moneyline_result'|'totals_result'|'handicap_result'){
 const win=rows.filter(x=>x[key]==='win').length,loss=rows.filter(x=>x[key]==='loss').length;
 const push=rows.filter(x=>x[key]==='push').length;
 return {win,loss,push,decided:win+loss,effective_wins:win,effective_losses:loss,hit_rate:pct(win,loss)};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:H});
 if(req.method!=='GET')return out(405,{success:false,error:'GET_only'});
 if(!sb)return out(503,{success:false,error:'backend_not_configured'});
 const daysStr=new URL(req.url).searchParams.get('days');
 const days=daysStr===null?null:Number(daysStr);
 if(daysStr!==null&&(![7,30].includes(days!)))return out(400,{success:false,error:'invalid_days'});
 let q=sb.from('baseball_verified_results').select('game_id,snapshot_id,kickoff_at,home_team,away_team,home_score,away_score,moneyline_result,totals_result,handicap_result,verified_at')
   .order('kickoff_at',{ascending:false}).limit(1000);
 if(days)q=q.gte('kickoff_at',new Date(Date.now()-days*86400000).toISOString());
 const {data,error}=await q;
 if(error)return out(502,{success:false,error:'results_unavailable'});
 const rows=data||[];
 const markets={moneyline:stats(rows,'moneyline_result'),handicap:stats(rows,'handicap_result'),over_under:stats(rows,'totals_result')};
 const matches=rows.map(r=>({game_id:r.game_id,league:'MLB',kickoff_at:r.kickoff_at,
   home:r.home_team,away:r.away_team,final_score:r.home_score+'-'+r.away_score,
   moneyline_result:r.moneyline_result,handicap_result:r.handicap_result,over_under_result:r.totals_result}));
 const range=rows.length?{start:rows.at(-1)!.kickoff_at,end:rows[0].kickoff_at}:{};
 return out(200,{success:true,sport:'baseball',summary:{verified_matches:rows.length,
   range_start:range.start||null,range_end:range.end||null,source:'official_immutable_t10_only'},
   markets,matches,notes:{handicap:'public_for_MLB',odds_origin:'t10_snapshot_source_as_recorded'}});
});
