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
          const byFixture = new Map<number, any>(visibleMatches.map((item: any) => [Number(item.fixture_id), item]));
          for (const claim of stageClaims) {
            const id = Number(claim.fixture_id);
            const current = byFixture.get(id);
            if (!current || !claim.result_data) continue;
            const fixture = claim.fixture_data || {};
            byFixture.set(id, {
              ...current,
              home_team: current.home_team || fixture.home?.name || null,
              away_team: current.away_team || fixture.away?.name || null,
              league_name: current.league_name || fixture.league?.name || null,
              result_data: claim.result_data,
              v2_stage: claim.stage,
              v2_stage_label: claim.stage === "t2" ? "深度分析" : "最終分析",
              v2_stage_claimed_at: claim.claimed_at,
              updated_at: claim.claimed_at || current.updated_at,
            });
          }
          visibleMatches = [...byFixture.values()].sort((a: any, b: any) => {
            const ta = Date.parse(a.fixture_time || a.updated_at || "");
            const tb = Date.parse(b.fixture_time || b.updated_at || "");
            return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
          });
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
