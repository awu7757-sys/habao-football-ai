import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    // OAuth member histories must be bound to the authenticated account.
    const requestedAccount=req.method==='GET'?new URL(req.url).searchParams.get('account'):String((await req.clone().json().catch(()=>({})))?.account||'');
    if (/^(google|line)_/i.test(String(requestedAccount||''))) {
      const bearer=req.headers.get('authorization');
      if (!bearer) return json({success:false,error:'member_authentication_required'},401);
      const identityResponse=await fetch(supabaseUrl+'/functions/v1/oauth-member-login?mode=refresh',{
        method:'POST',headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')||serviceRoleKey,Authorization:bearer,'Content-Type':'application/json'},body:JSON.stringify({action:'refresh'}),signal:AbortSignal.timeout(12000)});
      const identity=await identityResponse.json().catch(()=>null);
      if(!identityResponse.ok||identity?.success!==true||identity.member?.account!==requestedAccount)return json({success:false,error:'member_authentication_required'},401);
    }


    // =========================
    // GET：讀取會員已分析賽事
    // =========================
    if (req.method === "GET") {
      const url = new URL(req.url);
      const account = url.searchParams.get("account");

      if (!account) {
        return json({ error: "account is required" }, 400);
      }

      const { data, error } = await supabase
        .from("member_analysis_history")
        .select("*")
        .eq("account", account)
        .order("fixture_time", { ascending: true });

      if (error) throw error;

      const now = Date.now();

      // 開賽時間 + 8 小時後，不再顯示於「我的分析紀錄」
// 只隱藏前台紀錄，不刪除資料庫資料
let visibleMatches = (data ?? []).filter((item) => {
  if (!item.fixture_time) return true;

  const fixtureTime = new Date(item.fixture_time).getTime();
  const hideAfter = fixtureTime + 8 * 60 * 60 * 1000;

  return now < hideAfter;
});

      // Surface the latest successfully claimed V2 stage for the same fixture
      // in My Analyses, without overwriting the original T-10 history row.
      try {
        const { data: stageClaims, error: stageClaimError } = await supabase
          .from("football_v2_stage_member_claims")
          .select("fixture_id,stage,claimed_at,fixture_data,result_data")
          .eq("account", account)
          .eq("claim_state", "claimed")
          .order("claimed_at", { ascending: true });
        if (!stageClaimError && Array.isArray(stageClaims) && stageClaims.length) {
          const legacy = new Map<number, any>(visibleMatches.map((item:any)=>[Number(item.fixture_id),item]));
          for (const claim of stageClaims) {
            if (!claim.result_data || !['t2','t15'].includes(claim.stage)) continue;
            const f=claim.result_data.fixture||{}, fixture=claim.fixture_data||{}, id=Number(claim.fixture_id), current=legacy.get(id)||{};
            const fixtureTime=f.date||current.fixture_time;
            if (!fixtureTime || now>=Date.parse(fixtureTime)+8*3600000) continue;
            visibleMatches.push({...current,id:'football-stage:'+id+':'+claim.stage,fixture_id:id,
              history_key:'football:'+id+':'+claim.stage,fixture_time:fixtureTime,
              home_team:current.home_team||f.home?.name||fixture.home?.name||null,
              away_team:current.away_team||f.away?.name||fixture.away?.name||null,
              league_name:current.league_name||f.league?.name||fixture.league?.name||null,
              result_data:claim.result_data,v2_stage:claim.stage,v2_stage_claimed_at:claim.claimed_at,updated_at:claim.claimed_at});
          }

        }
      } catch (stageClaimReadError) {
        console.warn("V2 stage claims are not available yet", stageClaimReadError);
      }

      return json({
        success: true,
        matches: visibleMatches,
      });
    }

    // =========================
    // POST：新增 / 更新已分析賽事
    // =========================
    if (req.method === "POST") {
      const body = await req.json();

      const {
        account,
        fixture_id,
        analysis_id,
        fixture_time,
        home_team,
        away_team,
        home_logo,
        away_logo,
        league_name,
        league_logo,
        match_status,
        result_data,
      } = body;

      if (!account || !fixture_id) {
        return json(
          { error: "account and fixture_id are required" },
          400,
        );
      }

      const payload = {
        account,
        fixture_id,
        analysis_id: analysis_id ?? null,
        fixture_time: fixture_time ?? null,
        updated_at: new Date().toISOString(),
        home_team: home_team ?? null,
        away_team: away_team ?? null,
        home_logo: home_logo ?? null,
        away_logo: away_logo ?? null,
        league_name: league_name ?? null,
        league_logo: league_logo ?? null,
        match_status: match_status ?? null,
        result_data: result_data ?? null,
      };

      const { data, error } = await supabase
        .from("member_analysis_history")
        .upsert(payload, {
          onConflict: "account,fixture_id",
        })
        .select()
        .single();

      if (error) throw error;

      return json({
        success: true,
        match: data,
      });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
