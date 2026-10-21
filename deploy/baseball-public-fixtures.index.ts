// HABAO MLB public schedule proxy v0.1 — fixtures only, no membership or secrets exposed.
// Deploy as Edge Function "baseball-public-fixtures" with Verify JWT OFF.
// This endpoint returns publicly available MLB schedule information, never analyses.
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"apikey, authorization, content-type","Cache-Control":"public, max-age=120"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors}});
const localDate=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
const plus=(date:string,offset:number)=>{const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
const team=(obj:any)=>({id:obj?.team?.id??null,name:String(obj?.team?.name||""),score:obj?.score??null,probable_pitcher:obj?.probablePitcher?.fullName||null});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="GET")return json({success:false,error:"GET_only"},405);
 const url=new URL(req.url),now=new Date(),today=localDate(now),tomorrow=plus(today,1),date=url.searchParams.get("date")||today;
 if(date!==today&&date!==tomorrow)return json({success:false,error:"only_today_tomorrow",today,tomorrow},400);
 const api=new URL("https://statsapi.mlb.com/api/v1/schedule");
 api.searchParams.set("sportId","1");api.searchParams.set("startDate",plus(date,-1));api.searchParams.set("endDate",plus(date,1));api.searchParams.set("hydrate","probablePitcher");
 try{
  const r=await fetch(api,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
  if(!r.ok)return json({success:false,error:"mlb_provider_failed",status:r.status},502);
  const body=await r.json();
  const seen=new Set<number>();
  const fixtures=(body?.dates||[]).flatMap((x:any)=>x?.games||[]).filter((g:any)=>{
   const id=Number(g.gamePk),t=Date.parse(g.gameDate||"");
   if(!Number.isInteger(id)||seen.has(id)||!Number.isFinite(t)||localDate(new Date(t))!==date||!["R","F","D","L","W"].includes(g.gameType))return false;
   seen.add(id);return true;
  }).map((g:any)=>({
    sport:"baseball",competition_key:"mlb",competition_name:"MLB",fixture_id:Number(g.gamePk),
    game_pk:Number(g.gamePk),kickoff_at:g.gameDate,
    status:{short:g.status?.codedGameState||"",long:g.status?.detailedState||""},
    home:team(g.teams?.home),away:team(g.teams?.away),venue:g.venue?.name||""
  }));
  return json({success:true,date,timezone:"Asia/Taipei",fixtures,counts:{mlb:fixtures.length,total:fixtures.length}});
 }catch{return json({success:false,error:"mlb_provider_unavailable"},502)}
});