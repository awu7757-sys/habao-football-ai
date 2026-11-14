import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";



Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", {

      headers: corsHeaders,

    });

  }



  let quotaShouldRefund = false;

let quotaAccount = "";

let quotaFixtureId = 0;

let creditShouldRefund = false;

let consumedCreditType = "";

let remainingCredits: number | null = null;

let remainingDailyCredits: number | null = null;

let remainingPaidCredits: number | null = null;

let lockAcquired = false;

let lockFixtureId = 0;

let requestAccount = "";

let requestFixtureId = 0;

let supabaseUrl = "";

  let serviceRoleKey = "";



  try {

    if (req.method !== "POST") {

      return new Response(

        JSON.stringify({

          success: false,

          error: "Method not allowed",

        }),

        {

          status: 405,

          headers: {

            ...corsHeaders,

            "Content-Type": "application/json",

          },

        }

      );

    }



    const body = await req.json();

    const fixtureId = Number(body?.fixture_id);

    // ========================================
    // 公開戰績內部模式
    // 只有使用 Service Role 呼叫才允許
    // ========================================
    const requestedInternalPublic =
      body?.internal_public === true;

    const earlyServiceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const incomingAuthorization =
      String(req.headers.get("authorization") || "").trim();

    const internalPublic =
      requestedInternalPublic &&
      Boolean(earlyServiceRoleKey) &&
      incomingAuthorization ===
        `Bearer ${earlyServiceRoleKey}`;

    if (requestedInternalPublic && !internalPublic) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "internal_public_forbidden",
          message: "Internal public prediction access denied",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const account = internalPublic
      ? "__public_prediction_runner__"
      : String(body?.account || "").trim();



    const requestedLanguage =

      String(

        body?.language || "zh-Hant"

      ).trim();



    const responseLanguage =

      requestedLanguage === "en"

        ? "en"

        : requestedLanguage === "zh-Hans"

        ? "zh-Hans"

        : "zh-Hant";



    requestFixtureId = fixtureId;

    requestAccount = internalPublic ? "" : account;



    if (!fixtureId) {

      return new Response(

        JSON.stringify({

          success: false,

          error: "fixture_id 為必填",

        }),

        {

          status: 400,

          headers: {

            ...corsHeaders,

            "Content-Type": "application/json",

          },

        }

      );

    }



if (!account) {

  return new Response(

    JSON.stringify({

      success: false,

      error: "account 為必填",

      message: "無法確認會員帳號，請重新登入",

    }),

    {

      status: 400,

      headers: {

        ...corsHeaders,

        "Content-Type": "application/json",

      },

    }

  );

}




// HABAO 2026-10-21｜共用資料快取：只能由 service_role 使用，避免重複消耗 API。
async function habaoReadSharedCache(cacheKey: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/habao_api_response_cache` +
      `?cache_key=eq.${encodeURIComponent(cacheKey)}` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      `&select=response_data&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0].response_data : null;
  } catch { return null; }
}
async function habaoWriteSharedCache(cacheKey: string, payload: any, ttlSeconds: number) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/habao_api_response_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ cache_key: cacheKey, response_data: payload,
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        updated_at: new Date().toISOString() }),
    });
    if (!res.ok) console.warn("HABAO_SHARED_CACHE_WRITE_SKIPPED", res.status);
  } catch (err) { console.warn("HABAO_SHARED_CACHE_WRITE_ERROR", String(err)); }
}

// The Odds API V4：只匹配同主客隊且同開賽時間的賽事，不猜測其他盤口。
const HABAO_SOCCER_ODDS_KEYS: Record<number,string> = {
  39: "soccer_epl", 140: "soccer_spain_la_liga", 78: "soccer_germany_bundesliga",
  135: "soccer_italy_serie_a", 61: "soccer_france_ligue_one",
  2: "soccer_uefa_champs_league", 3: "soccer_uefa_europa_league",
  88: "soccer_netherlands_eredivisie", 40: "soccer_efl_champ",
  253: "soccer_usa_mls", 262: "soccer_mexico_ligamx",
  848: "soccer_uefa_europa_conference_league", // API-Football UEFA Conference League
  // 2026-11-15：補上正式支援的日職、韓職、中超、巴甲
  98: "soccer_japan_j_league", 292: "soccer_korea_kleague1",
  169: "soccer_china_superleague", 71: "soccer_brazil_campeonato",
};
function habaoNormalizeTeam(name: string): string {
  return String(name || "").toLowerCase()
    .replace(/\b(football club|futbol club|fc|afc|cf|sc|ac)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function habaoTeamMatches(left: string, right: string): boolean {
  const a = habaoNormalizeTeam(left), b = habaoNormalizeTeam(right);
  return Boolean(a && b && (a === b || (Math.min(a.length,b.length) >= 7 &&
    (a.includes(b) || b.includes(a)))));
}
async function habaoLoadOddsV4(leagueId: number, kickoff: string, home: string, away: string): Promise<any|null> {
  const sport = HABAO_SOCCER_ODDS_KEYS[Number(leagueId)];
  const key = Deno.env.get("THE_ODDS_API_KEY") || Deno.env.get("ODDS_API_KEY") || "";
  if (!sport || !key) { console.warn("HABAO_SOCCER_ODDS_UNAVAILABLE", {leagueId, sport: Boolean(sport), key: Boolean(key)}); return null; }
  const cacheKey = `odds:soccer:v4:${sport}:eu:h2h-spreads-totals`;
  let events = await habaoReadSharedCache(cacheKey);
  if (!Array.isArray(events)) {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds/`);
    url.searchParams.set("apiKey", key);
    url.searchParams.set("regions", "eu");
    url.searchParams.set("markets", "h2h,spreads,totals");
    url.searchParams.set("oddsFormat", "decimal");
    url.searchParams.set("dateFormat", "iso");
    try {
      const res = await fetch(url.toString());
      if (!res.ok) { console.warn("HABAO_SOCCER_ODDS_HTTP", sport, res.status); return null; }
      events = await res.json();
      if (!Array.isArray(events)) return null;
      // 同一聯賽連續賽事共用 10 分鐘快取，不會讓每位會員重抓。
      await habaoWriteSharedCache(cacheKey, events, 600);
      console.log("HABAO_SOCCER_ODDS_USAGE", {
        sport, last: res.headers.get("x-requests-last"),
        remaining: res.headers.get("x-requests-remaining"),
      });
    } catch(err) { console.warn("HABAO_SOCCER_ODDS_FETCH_ERROR", String(err)); return null; }
  }
  const ms = new Date(kickoff).getTime();
  const matched = (events as any[]).filter(event => {
    const ems = new Date(event?.commence_time || "").getTime();
    return Number.isFinite(ms) && Number.isFinite(ems) &&
      Math.abs(ems - ms) <= 90 * 60 * 1000 &&
      habaoTeamMatches(home, event?.home_team) &&
      habaoTeamMatches(away, event?.away_team);
  }).sort((a,b) => Math.abs(new Date(a.commence_time).getTime()-ms)-Math.abs(new Date(b.commence_time).getTime()-ms))[0];
  if (!matched) { console.log("HABAO_SOCCER_ODDS_EVENT_NOT_MATCHED", leagueId, home, away); return null; }
  const normalized = {ok:true,source:"the_odds_api",event_id:matched.id,
    oneXtwo:[] as any[], handicap:[] as any[], totals:[] as any[], btts:[] as any[], bookmakers:[] as any[]};
  for(const book of matched.bookmakers || []) {
    const item = { name:book.title || book.key, bets:[] as any[] };
    for(const market of book.markets || []) {
      const marketName = market.key === "h2h" ? "Match Winner" :
        market.key === "totals" ? "Goals Over/Under" :
        market.key === "spreads" ? "Asian Handicap" : "";
      if (!marketName) continue;
      const bet = {name:marketName, values:[] as any[]};
      for(const out of market.outcomes || []) {
        const price = Number(out.price);
        if(!Number.isFinite(price) || price <= 1) continue;
        const p = out.point === undefined || out.point === null ? null : Number(out.point);
        const isHome = habaoTeamMatches(home,String(out.name || ""));
        const isAway = habaoTeamMatches(away,String(out.name || ""));
        if (market.key === "h2h") {
          const side = isHome ? "home" : isAway ? "away" : String(out.name).toLowerCase()==="draw"?"draw":"";
          if (!side) continue;
          normalized.oneXtwo.push({side,name:out.name,odds:price,bookmaker:book.key});
          bet.values.push({value:out.name,odd:price});
        }
        if (market.key === "spreads" && Number.isFinite(p) && (isHome||isAway)) {
          const side=isHome?"home":"away";
          normalized.handicap.push({side,selection:isHome?"1":"2",name:out.name,line:p,odds:price,bookmaker:book.key});
          bet.values.push({value:`${out.name} ${p}`,odd:price});
        }
        if (market.key === "totals" && Number.isFinite(p) && /^(over|under)$/i.test(String(out.name||""))) {
          const side=String(out.name).toLowerCase();
          normalized.totals.push({side,selection:out.name,name:out.name,line:p,odds:price,bookmaker:book.key});
          bet.values.push({value:`${out.name} ${p}`,odd:price});
        }
      }
      if (bet.values.length) item.bets.push(bet);
    }
    if (item.bets.length) normalized.bookmakers.push(item);
  }
  return normalized;
}

    const API_KEY =

      Deno.env.get("API_FOOTBALL_KEY");



    const OPENAI_API_KEY =

      Deno.env.get("OPENAI_API_KEY");

const FOOTBALL_DATA_KEY =

  Deno.env.get("FOOTBALL_DATA_KEY");

    const SUPABASE_URL =

      Deno.env.get("SUPABASE_URL");



    const SERVICE_ROLE_KEY =

      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");



    supabaseUrl = SUPABASE_URL || "";

    serviceRoleKey = SERVICE_ROLE_KEY || "";



    if (!API_KEY) {

      throw new Error("找不到 API_FOOTBALL_KEY");

    }




if (!FOOTBALL_DATA_KEY) {

  throw new Error("找不到 FOOTBALL_DATA_KEY");

}

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {

      throw new Error("找不到 Supabase 環境變數");

    }





    async function translateAnalysisToEnglish(

      sourceAnalysis: any

    ) {

      if (

        responseLanguage !== "en" ||

        !sourceAnalysis

      ) {

        return sourceAnalysis;

      }



      const translationRes = await fetch(

        "https://api.openai.com/v1/responses",

        {

          method: "POST",

          headers: {

            "Authorization":

              `Bearer ${OPENAI_API_KEY}`,

            "Content-Type":

              "application/json",

          },

          body: JSON.stringify({

            model: "gpt-5-mini",

            instructions: `

You are translating an existing structured football match analysis from Traditional Chinese into natural professional English.



IMPORTANT:

\- Translate only human-readable text.

\- Preserve the exact JSON structure and keys.

\- Preserve every numeric value exactly, including confidence, score, handicap line and percentages.

\- Preserve predicted score strings exactly.

\- Do not add, remove, recalculate, reinterpret or change any football conclusion.

\- Do not change market direction or recommendation strength.

\- Translate recommendation picks naturally:

  主隊 -> Home Team

  客隊 -> Away Team

  和局 -> Draw

  暫不推薦 -> No Recommendation

  主隊或和局 -> Home or Draw

  主隊或客隊 -> Home or Away

  和局或客隊 -> Draw or Away

  是 -> Yes

  否 -> No

  大 X -> Over X

  小 X -> Under X

\- Translate risk_level:

  低 -> Low

  中 -> Medium

  中等 -> Medium

  高 -> High

\- Output valid JSON only.

`,

            input:

              "Translate the following JSON object to English and return valid JSON only:\n\n" +

              JSON.stringify(sourceAnalysis),

            text: {

              format: {

                type: "json_object",

              },

            },

          }),

        }

      );



      if (!translationRes.ok) {

        const translationError =

          await translationRes.text();



        console.error(

          "ENGLISH ANALYSIS TRANSLATION ERROR:",

          translationError

        );



        throw new Error(

          "AI_ENGLISH_TRANSLATION_FAILED"

        );

      }



      const translationData =

        await translationRes.json();



      const translatedText = String(

        translationData?.output_text ||

        translationData?.output

          ?.find(

            (item: any) =>

              item?.type === "message"

          )

          ?.content

          ?.find(

            (item: any) =>

              item?.type === "output_text"

          )

          ?.text ||

        ""

      ).trim();



      if (!translatedText) {

        throw new Error(

          "AI_ENGLISH_TRANSLATION_EMPTY"

        );

      }



      try {

        return JSON.parse(

          translatedText

        );

      } catch {

        console.error(

          "ENGLISH TRANSLATION RAW:",

          translatedText

        );



        throw new Error(

          "AI_ENGLISH_TRANSLATION_INVALID_JSON"

        );

      }

    }



// ========================================
// 會員模式 / 公開戰績內部模式
// ========================================

let analysisUnlimited = internalPublic;
let memberAlreadyAnalyzed = internalPublic;
let dailyAnalysisUnlimited = internalPublic;
let quota: any = internalPublic
  ? {
      allowed: true,
      already_used: true,
      used: 0,
      limit: null,
    }
  : null;

let member: any = null;

async function refreshMemberCreditBalances() {
  if (internalPublic) {
    remainingPaidCredits = null;
    remainingDailyCredits = null;
    remainingCredits = null;
    return;
  }

  const latestMemberUrl =
    `${SUPABASE_URL}/rest/v1/members` +
    `?account=eq.${encodeURIComponent(account)}` +
    `&select=analysis_credits,member_level,daily_free_credits` +
    `&limit=1`;

  const latestMemberRes =
    await fetch(latestMemberUrl, {
      method: "GET",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization":
          `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":
          "application/json",
      },
    });

  if (!latestMemberRes.ok) {
    throw new Error(
      `重新取得會員積分失敗：${await latestMemberRes.text()}`
    );
  }

  const latestRows =
    await latestMemberRes.json();

  const latestMember =
    Array.isArray(latestRows)
      ? latestRows[0]
      : latestRows;

  remainingPaidCredits =
    Number(
      latestMember?.analysis_credits ?? 0
    );

  remainingDailyCredits =
    latestMember?.member_level === "vip"
      ? Number(
          latestMember?.daily_free_credits ?? 0
        )
      : 0;

  remainingCredits =
    remainingPaidCredits +
    remainingDailyCredits;
}

if (!internalPublic) {
  // ========================================
  // 驗證會員帳號
  // ========================================
  const memberUrl =
    `${SUPABASE_URL}/rest/v1/members` +
    `?account=eq.${encodeURIComponent(account)}` +
    `&select=id,account,expire_at,is_active,analysis_credits,analysis_unlimited,daily_analysis_limit,daily_analysis_unlimited,member_level,daily_free_credits,daily_free_credits_date,platform_account` +
    `&limit=1`;

  const memberRes = await fetch(memberUrl, {
    method: "GET",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!memberRes.ok) {
    throw new Error(
      `會員驗證失敗: ${await memberRes.text()}`
    );
  }

  const memberRows = await memberRes.json();

  if (!Array.isArray(memberRows) || memberRows.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "member_not_found",
        message: "此帳號尚未開通 AI 分析權限",
      }),
      {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  member = memberRows[0];

  if (member.is_active !== true) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "member_inactive",
        message: "您的 AI 分析權限目前已停用，請聯絡客服",
      }),
      {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  analysisUnlimited =
    member.analysis_unlimited === true;

  const analysisCredits =
    Number(member.analysis_credits ?? 0);

  const dailyFreeCredits =
    member.member_level === "vip"
      ? Number(member.daily_free_credits ?? 0)
      : 0;

  const totalAvailableCredits =
    analysisCredits + dailyFreeCredits;

  // ========================================
  // 已分析過 = 永久可再次查看，不再扣積分
  // ========================================
  const historyCheckUrl =
    `${SUPABASE_URL}/rest/v1/member_analysis_history` +
    `?account=eq.${encodeURIComponent(account)}` +
    `&fixture_id=eq.${fixtureId}` +
    `&select=id` +
    `&limit=1`;

  const historyCheckRes =
    await fetch(historyCheckUrl, {
      method: "GET",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization":
          `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":
          "application/json",
      },
    });

  if (historyCheckRes.ok) {
    const historyRows =
      await historyCheckRes.json();

    memberAlreadyAnalyzed =
      Array.isArray(historyRows) &&
      historyRows.length > 0;
  } else {
    console.error(
      "MEMBER ANALYSIS HISTORY CHECK ERROR:",
      await historyCheckRes.text()
    );
  }

  console.log(
    "MEMBER ALREADY ANALYZED:",
    account,
    fixtureId,
    memberAlreadyAnalyzed
  );

  if (
    !analysisUnlimited &&
    !memberAlreadyAnalyzed &&
    totalAvailableCredits <= 0
  ) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "analysis_credits_empty",
        message: "您的 AI 分析次數已用完，請聯絡客服。",
        remaining: 0,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // T-10 漏建補位。先驗證會員身份/積分，再做一次內部正式分析；
  // 未成功保存唯一快照時不消耗每日分析額度、不扣積分。
  const priorSnapshot = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?fixture_id=eq.${fixtureId}&select=fixture_id,prediction,kickoff_at,status&limit=1`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!priorSnapshot.ok) throw new Error("OFFICIAL_SNAPSHOT_PREFLIGHT_FAILED");
  const priorRows = await priorSnapshot.json();
  const priorPrediction = Array.isArray(priorRows) ? priorRows[0]?.prediction : null;
  const priorIsV2 = priorPrediction?.model_version === "football-v2-poisson-shrinkage-0.2.1";
  if (!priorIsV2) {
    const timeRes = await fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, {
      headers: {"x-apisports-key":API_KEY!},
    });
    if (!timeRes.ok) throw new Error("FOOTBALL_FIXTURE_TIME_LOOKUP_FAILED");
    const timePayload = await timeRes.json();
    const kickoff = new Date(timePayload?.response?.[0]?.fixture?.date || "").getTime();
    const delta = kickoff - Date.now();
    if (!Number.isFinite(kickoff) || delta <= 0 || delta > 10 * 3600000) {
      return new Response(JSON.stringify({success:false,error:"analysis_not_open",
        message:"此場不在賽前 10 小時的正式分析時間內"}), {
        status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }
    // 使用獨立 service_role 內部模式，不冒用會員身份、不產生會員專屬模型。
    const bootstrap = await fetch(`${SUPABASE_URL}/functions/v1/match-analysis`, {
      method:"POST",
      headers:{"Content-Type":"application/json",apikey:SERVICE_ROLE_KEY!,Authorization:`Bearer ${SERVICE_ROLE_KEY}`},
      body:JSON.stringify({fixture_id:fixtureId,internal_public:true,language:"zh-Hant"}),
    });
    if (!bootstrap.ok) console.warn("FOOTBALL_FIRST_MEMBER_BOOTSTRAP_FAILED",bootstrap.status);
    const confirmed = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?fixture_id=eq.${fixtureId}&select=fixture_id,prediction&limit=1`,
      {headers:{apikey:SERVICE_ROLE_KEY,Authorization:`Bearer ${SERVICE_ROLE_KEY}`}},
    );
    const confirmedRows = confirmed.ok ? await confirmed.json() : [];
    if (!Array.isArray(confirmedRows) || confirmedRows[0]?.prediction?.model_version !== "football-v2-poisson-shrinkage-0.2.1") {
      return new Response(JSON.stringify({success:false,processing:true,error:"official_snapshot_pending",
        message:"系統正在建立首次正式快照，請稍後再試"}), {
        status:202,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }
  }

  // ========================================
  // 每日 AI 分析額度
  // ========================================
  dailyAnalysisUnlimited =
    member.daily_analysis_unlimited === true;

  const quotaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/consume_analysis_quota`,
    {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_account: account,
        p_fixture_id: fixtureId,
      }),
    },
  );

  if (!quotaRes.ok) {
    throw new Error(
      `每日分析額度檢查失敗: ${await quotaRes.text()}`
    );
  }

  quota = await quotaRes.json();

  console.log(
    "ANALYSIS QUOTA:",
    account,
    fixtureId,
    quota
  );

/*
  每日免費額度用完時，不再阻擋儲值積分。

  真正是否可分析，統一由：
  daily_free_credits + analysis_credits
  與 consume_member_analysis_credit 控制。

  規則：
  1. 每日免費積分優先
  2. 每日免費用完後自動使用儲值積分
  3. 兩者都為 0 才回 analysis_credits_empty
*/
if (
  !dailyAnalysisUnlimited &&
  quota?.allowed !== true
) {
  console.log(
    "DAILY FREE LIMIT REACHED - FALLBACK TO PAID CREDITS:",
    account,
    fixtureId,
    {
      analysis_credits:
        analysisCredits,
      daily_free_credits:
        dailyFreeCredits,
    }
  );
}

  if (quota?.already_used !== true) {
    quotaShouldRefund = true;
    quotaAccount = account;
    quotaFixtureId = fixtureId;}
} else {
  console.log(
    "PUBLIC PREDICTION INTERNAL MODE:",
    fixtureId
  );

  remainingPaidCredits = null;
  remainingDailyCredits = null;
  remainingCredits = null;
}



// ========================================
// HABAO｜唯一正式分析版本
//
// ai_prediction_snapshots 一旦已有此 fixture_id，
// 一般會員之後全部固定讀這一份。
// 不再因 6 小時 cache 過期而產生第二版。
// ========================================

if (!internalPublic) {

  const officialSnapshotRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots` +
      `?fixture_id=eq.${fixtureId}` +
      `&select=fixture_id,kickoff_at,league_name,home_team,away_team,prediction,status` +
      `&limit=1`,
      {
        method: "GET",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization":
            `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
        },
      },
    );

if (!officialSnapshotRes.ok) {

  const snapshotErrorText =
    await officialSnapshotRes.text();

  console.error(
    "OFFICIAL SNAPSHOT READ ERROR:",
    snapshotErrorText,
  );

  return new Response(
    JSON.stringify({
      success: false,
      processing: true,
      error:
        "official_snapshot_read_failed",
      message:
        "正式分析讀取中，請稍後再試。",
      fixture_id:
        fixtureId,
    }),
    {
      status: 202,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );

} else {

    const officialRows =
      await officialSnapshotRes.json();

    const officialSnapshot =
      Array.isArray(officialRows)
        ? officialRows[0]
        : null;

    if (
      officialSnapshot?.prediction
    ) {

      console.log(
        "OFFICIAL SNAPSHOT HIT:",
        fixtureId,
      );

      /*
        會員第一次查看這場，
        仍沿用目前的會員積分制度；
        只是內容固定讀正式快照。
      */
      if (
        !analysisUnlimited &&
        !memberAlreadyAnalyzed
      ) {

        const creditRes =
          await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/consume_member_analysis_credit`,
            {
              method: "POST",
              headers: {
                "apikey":
                  SERVICE_ROLE_KEY,
                "Authorization":
                  `Bearer ${SERVICE_ROLE_KEY}`,
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                p_account:
                  account,
              }),
            },
          );

        if (!creditRes.ok) {
          throw new Error(
            `扣除 AI 分析積分失敗：${await creditRes.text()}`,
          );
        }

        const creditRows =
          await creditRes.json();

        const creditResult =
          Array.isArray(creditRows)
            ? creditRows[0]
            : creditRows;

        if (
          creditResult?.success !==
            true
        ) {
          throw new Error(
            "ANALYSIS_CREDITS_EMPTY",
          );
        }

        consumedCreditType =
          String(
            creditResult
              ?.consumed_type ||
            "",
          );

        creditShouldRefund =
          true;

        await refreshMemberCreditBalances();

        console.log(
          "MEMBER OFFICIAL SNAPSHOT CREDIT CONSUMED:",
          account,
          fixtureId,
          creditResult?.consumed_type,
          remainingCredits,
        );
      }

      /*
        嘗試沿用 cache 裡的 fixture / data_available，
        但 prediction 永遠以正式 snapshot 為準。
      */
      let officialBasePayload: any =
        null;

      const officialCacheRes =
        await fetch(
          `${SUPABASE_URL}/rest/v1/match_analysis_cache` +
          `?fixture_id=eq.${fixtureId}` +
          `&select=analysis` +
          `&limit=1`,
          {
            method: "GET",
            headers: {
              "apikey":
                SERVICE_ROLE_KEY,
              "Authorization":
                `Bearer ${SERVICE_ROLE_KEY}`,
              "Content-Type":
                "application/json",
            },
          },
        );

      if (officialCacheRes.ok) {

        const officialCacheRows =
          await officialCacheRes
            .json()
            .catch(() => []);

        officialBasePayload =
          Array.isArray(
            officialCacheRows,
          )
            ? officialCacheRows[0]
                ?.analysis
            : null;
      }

      let officialAnalysis =
        officialSnapshot.prediction;

      if (
        responseLanguage ===
          "en"
      ) {
        officialAnalysis =
          await translateAnalysisToEnglish(
            officialSnapshot
              .prediction,
          );
      }

      const fallbackFixture = {
        id:
          Number(fixtureId),

        date:
          officialSnapshot
            ?.kickoff_at ||
          null,

        league: {
          name:
            officialSnapshot
              ?.league_name ||
            "",
        },

        home: {
          name:
            officialSnapshot
              ?.home_team ||
            "",
        },

        away: {
          name:
            officialSnapshot
              ?.away_team ||
            "",
        },
      };

      /*
        正常回傳完成後，不退款。
      */
      creditShouldRefund =
        false;

      return new Response(
        JSON.stringify({
          success: true,

          fixture:
            officialBasePayload
              ?.fixture ||
            fallbackFixture,

          data_available:
            officialBasePayload
              ?.data_available ||
            {
              team_statistics:
                false,
              head_to_head:
                false,
              odds:
                false,
            },

          analysis:
            officialAnalysis,

          language:
            responseLanguage,

          official_snapshot:
            true,

          official_snapshot_status:
            officialSnapshot
              ?.status ||
            "pending",

          official_snapshot_kickoff_at:
            officialSnapshot
              ?.kickoff_at ||
            null,

          analysis_id:
            fixtureId,

          remaining_credits:
            analysisUnlimited
              ? null
              : remainingCredits,

          remaining_daily_credits:
            analysisUnlimited
              ? null
              : remainingDailyCredits,

          remaining_paid_credits:
            analysisUnlimited
              ? null
              : remainingPaidCredits,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }

  /*
  正式 T-10 快照尚未建立完成。
  一般會員禁止自行產生第二份分析。
*/
return new Response(
  JSON.stringify({
    success: false,
    processing: true,
    error:
      "official_snapshot_pending",
    message:
      "AI 正在建立賽前 10 小時正式分析，請稍後再試。",
    fixture_id:
      fixtureId,
  }),
  {
    status: 202,
    headers: {
      ...corsHeaders,
      "Content-Type":
        "application/json",
    },
  },
);

  }
}


// ========================================

// 先查 Supabase 賽事分析快取

// 有有效快取時直接回傳，不扣會員積分

// ========================================



const cacheNow = new Date().toISOString();



const cacheUrl =

  `${SUPABASE_URL}/rest/v1/match_analysis_cache` +

  `?fixture_id=eq.${fixtureId}` +

  `&expires_at=gt.${encodeURIComponent(cacheNow)}` +

  `&select=analysis` +

  `&order=created_at.desc` +

  `&limit=1`;



const cacheRes = await fetch(cacheUrl, {

  method: "GET",

  headers: {

    "apikey": SERVICE_ROLE_KEY,

    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,

    "Content-Type": "application/json",

  },

});



if (cacheRes.ok) {



  const cacheRows =

    await cacheRes.json();



  if (

    Array.isArray(cacheRows) &&

    cacheRows.length > 0 &&

    cacheRows[0]?.analysis?.analysis?.model_version === "football-v2-poisson-shrinkage-0.2.1"

  ) {



    console.log(

      "MATCH ANALYSIS CACHE HIT:",

      fixtureId

    );
    if (internalPublic) {
      try {
        const cachedPayload = cacheRows[0].analysis;
        const cachedFixture = cachedPayload?.fixture;
        const kickoff = new Date(cachedFixture?.date || "").getTime();
        const now = Date.now();
        const valid = Number.isFinite(kickoff) && (kickoff - now) > 0 && (kickoff - now) <= 10 * 3600000;
        if (valid && cachedPayload?.analysis) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?on_conflict=fixture_id`, {
            method:"POST",
            headers:{apikey:SERVICE_ROLE_KEY,Authorization:`Bearer ${SERVICE_ROLE_KEY}`,
              "Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},
            body:JSON.stringify({fixture_id:fixtureId,kickoff_at:new Date(kickoff).toISOString(),
              league_name:cachedFixture?.league?.name || null,home_team:cachedFixture?.home?.name || null,
              away_team:cachedFixture?.away?.name || null,prediction:cachedPayload.analysis,status:"pending"}),
          });
          if (!res.ok) console.error("FOOTBALL_CACHE_SNAPSHOT_REPAIR_FAILED",res.status);
        }
      } catch(err) {console.error("FOOTBALL_CACHE_SNAPSHOT_REPAIR_ERROR",String(err));}
    }




    /*

      quota.already_used === false

      代表這個會員第一次使用這場賽事。



      即使本場已有其他會員產生的快取，

      這個會員第一次查看仍需扣 1 積分。

    */

if (

  !analysisUnlimited &&

  !memberAlreadyAnalyzed

) {

  const creditRes =

    await fetch(

      `${SUPABASE_URL}/rest/v1/rpc/consume_member_analysis_credit`,

      {

        method: "POST",

        headers: {

          "apikey": SERVICE_ROLE_KEY,

          "Authorization":

            `Bearer ${SERVICE_ROLE_KEY}`,

          "Content-Type":

            "application/json",

        },

        body: JSON.stringify({

          p_account: account,

        }),

      }

    );



  if (!creditRes.ok) {

    throw new Error(

      `扣除 AI 分析積分失敗：${await creditRes.text()}`

    );

  }



  const creditRows =

    await creditRes.json();



  const creditResult =

    Array.isArray(creditRows)

      ? creditRows[0]

      : creditRows;



if (creditResult?.success !== true) {

  throw new Error(

    "ANALYSIS_CREDITS_EMPTY"

  );

}



consumedCreditType =

  String(

    creditResult?.consumed_type || ""

  );



creditShouldRefund = true;



await refreshMemberCreditBalances();



  console.log(

    "MEMBER FIRST VIEW CREDIT CONSUMED:",

    account,

    fixtureId,

    creditResult?.consumed_type,

    remainingCredits

  );

}



    const cachedPayload =

      cacheRows[0].analysis;



    let localizedCachedAnalysis =

      cachedPayload?.analysis;



    if (responseLanguage === "en") {

      const cachedEnglishAnalysis =

        cachedPayload?.translations?.en;



      if (cachedEnglishAnalysis) {

        localizedCachedAnalysis =

          cachedEnglishAnalysis;

        console.log(

          "MATCH ANALYSIS ENGLISH CACHE HIT:",

          fixtureId

        );

      } else {

        localizedCachedAnalysis =

          await translateAnalysisToEnglish(

            cachedPayload?.analysis

          );



        /*
          第一次英文查看完成翻譯後，把英文結果寫回
          同一筆 JSON 快取。之後再從「我的分析」進入，
          不需要再次呼叫 OpenAI 翻譯。
        */
        const enrichedCachedPayload = {

          ...cachedPayload,

          translations: {

            ...(cachedPayload?.translations || {}),

            en: localizedCachedAnalysis,

          },

        };



        const englishCacheSaveRes =

          await fetch(

            `${SUPABASE_URL}/rest/v1/match_analysis_cache?fixture_id=eq.${fixtureId}`,

            {

              method: "PATCH",

              headers: {

                "apikey":

                  SERVICE_ROLE_KEY,

                "Authorization":

                  `Bearer ${SERVICE_ROLE_KEY}`,

                "Content-Type":

                  "application/json",

                "Prefer":

                  "return=minimal",

              },

              body: JSON.stringify({

                analysis:

                  enrichedCachedPayload,

              }),

            }

          );



        if (!englishCacheSaveRes.ok) {

          console.error(

            "MATCH ANALYSIS ENGLISH CACHE SAVE ERROR:",

            await englishCacheSaveRes.text()

          );

        } else {

          console.log(

            "MATCH ANALYSIS ENGLISH CACHE SAVED:",

            fixtureId

          );

        }

      }

    }



    creditShouldRefund = false;



    return new Response(

      JSON.stringify({

        ...cachedPayload,

        language:
          responseLanguage,

        analysis:

          localizedCachedAnalysis,



remaining_credits:

  analysisUnlimited

    ? null

    : remainingCredits,



remaining_daily_credits:

  analysisUnlimited

    ? null

    : remainingDailyCredits,



remaining_paid_credits:

  analysisUnlimited

    ? null

    : remainingPaidCredits,



      }),

      {

        status: 200,

        headers: {

          ...corsHeaders,

          "Content-Type":

            "application/json",

        },

      }

    );

  }

} else {

  const cacheError = await cacheRes.text();



  console.error(

    "MATCH ANALYSIS CACHE READ ERROR:",

    cacheError

  );

}



console.log(

  "MATCH ANALYSIS CACHE MISS:",

  fixtureId

);



console.log("MEMBER ACCESS OK:", account);



// ========================================

// 清除已過期的快取 / 過期鎖

// ========================================

const expiredCleanupRes = await fetch(

  `${SUPABASE_URL}/rest/v1/match_analysis_cache` +

  `?fixture_id=eq.${fixtureId}` +

  `&expires_at=lt.${encodeURIComponent(cacheNow)}`,

  {

    method: "DELETE",

    headers: {

      "apikey": SERVICE_ROLE_KEY,

      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,

      "Content-Type": "application/json",

      "Prefer": "return=minimal",

    },

  }

);



if (!expiredCleanupRes.ok) {

  console.error(

    "MATCH ANALYSIS EXPIRED CACHE CLEANUP ERROR:",

    await expiredCleanupRes.text()

  );

} else {

  console.log(

    "MATCH ANALYSIS EXPIRED CACHE CLEANUP OK:",

    fixtureId

  );

}



// ========================================

// 取得本場分析 Lock

// ========================================

const lockExpiresAt = new Date();

lockExpiresAt.setMinutes(lockExpiresAt.getMinutes() + 5);



const lockRes = await fetch(

  `${SUPABASE_URL}/rest/v1/match_analysis_cache?on_conflict=fixture_id`,

  {

    method: "POST",

    headers: {

      "apikey": SERVICE_ROLE_KEY,

      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,

      "Content-Type": "application/json",

      "Prefer": "resolution=ignore-duplicates,return=representation",

    },

    body: JSON.stringify({

      fixture_id: fixtureId,

      status: "processing",

      analysis: null,

      expires_at: lockExpiresAt.toISOString(),

    }),

  }

);



if (!lockRes.ok) {

  throw new Error(

    `MATCH_ANALYSIS_LOCK_ERROR: ${await lockRes.text()}`

  );

}



const lockRows = await lockRes.json();



if (!Array.isArray(lockRows) || lockRows.length === 0) {

  console.log(

    "MATCH ANALYSIS ALREADY PROCESSING:",

    fixtureId

  );



  throw new Error("MATCH_ANALYSIS_PROCESSING");

}



lockAcquired = true;

lockFixtureId = fixtureId;



console.log(

  "MATCH ANALYSIS LOCK ACQUIRED:",

  fixtureId

);



// ========================================

// 會員第一次使用本場賽事才扣 1 積分

// 不論本場是讀快取或重新產生 AI

// 同會員同場賽事之後不再重複扣分

// ========================================

if (

  !analysisUnlimited &&

  !memberAlreadyAnalyzed

) {

  const creditRes = await fetch(

    `${SUPABASE_URL}/rest/v1/rpc/consume_member_analysis_credit`,

    {

      method: "POST",

      headers: {

        "apikey": SERVICE_ROLE_KEY,

        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,

        "Content-Type": "application/json",

      },

      body: JSON.stringify({

        p_account: account,

      }),

    }

  );



  if (!creditRes.ok) {

    throw new Error(

      `扣除 AI 分析積分失敗：${await creditRes.text()}`

    );

  }



  const creditRows =

    await creditRes.json();



  const creditResult =

    Array.isArray(creditRows)

      ? creditRows[0]

      : creditRows;



  if (creditResult?.success !== true) {

    throw new Error(

      "ANALYSIS_CREDITS_EMPTY"

    );

  }



  consumedCreditType =

    String(

      creditResult?.consumed_type || ""

    );



  creditShouldRefund = true;



await refreshMemberCreditBalances();



  console.log(

    "MEMBER CREDIT CONSUMED:",

    account,

    consumedCreditType,

    remainingCredits

  );

}



    const apiHeaders = {

      "x-apisports-key": API_KEY,

    };



    // ==========================================

    // 小工具：呼叫 API-Football

    // ==========================================

const footballApiCache = new Map<string, any>();



    async function footballApi(

  endpoint: string

) {



  if (footballApiCache.has(endpoint)) {

  console.log("API-Football CACHE HIT:", endpoint);

  return footballApiCache.get(endpoint);

}



  const res = await fetch(

    `https://v3.football.api-sports.io${endpoint}`,

    {

      method: "GET",

      headers: apiHeaders,

    });



  if (!res.ok) {

    throw new Error(

      `API-Football HTTP ${res.status}: ${endpoint}`

    );

  }



  const data = await res.json();



const errors = data?.errors;



if (

  errors &&

  typeof errors === "object" &&

  Object.keys(errors).length > 0

) {

  console.error(

    "API-Football API error:",

    endpoint,

    JSON.stringify(errors)

  );



  const errorText = JSON.stringify(errors).toLowerCase();



  const isDailyLimit =

    errorText.includes("request limit") ||

    errorText.includes("requests limit") ||

    errorText.includes("reached the request") ||

    errorText.includes("upgrade your plan");



  if (isDailyLimit) {

    throw new Error("API_FOOTBALL_DAILY_LIMIT");

  }



  throw new Error(

    `API-Football API error: ${JSON.stringify(errors)}`

  );

}



footballApiCache.set(endpoint, data);



  return data;

}

async function footballDataApi(

  endpoint: string

) {

  const res = await fetch(

    `https://api.football-data.org/v4${endpoint}`,

    {

      method: "GET",

      headers: {

        "X-Auth-Token": FOOTBALL_DATA_KEY!,

      },

    }

  );



  if (!res.ok) {

    const errorText = await res.text();



    throw new Error(

      `Football-Data error ${res.status}: ${endpoint} - ${errorText}`

    );

  }



  return await res.json();

}

    // ==========================================

    // 小工具：中文化球隊名稱

    // ==========================================

async function findFootballDataTeamId(

  teamName: string,

  competitionCode: string

) {

  try {

    const data = await footballDataApi(

      `/competitions/${competitionCode}/teams`

    );



    const teams = data?.teams || [];



    const normalize = (value: string) =>

      String(value || "")

        .toLowerCase()

        .replace(/fc|cf|sc|afc|club|football|soccer/g, "")

        .replace(/[^a-z0-9]/g, "");



    const target = normalize(teamName);



    const exactMatch = teams.find((team: any) => {

      const names = [

        team?.name,

        team?.shortName,

        team?.tla,

      ].filter(Boolean);



      return names.some(

        (name: string) => normalize(name) === target

      );

    });



    if (exactMatch?.id) {

      return exactMatch.id;

    }



    const partialMatch = teams.find((team: any) => {

      const names = [

        team?.name,

        team?.shortName,

      ].filter(Boolean);



      return names.some((name: string) => {

        const normalized = normalize(name);



        return (

          normalized.includes(target) ||

          target.includes(normalized)

        );

      });

    });



    return partialMatch?.id || null;



  } catch (error) {

    console.error(

      "Football-Data team lookup failed:",

      teamName,

      error

    );



    return null;

  }

}

const footballDataCompetitionMap: Record<string, string> = {

  "Premier League": "PL",

  "La Liga": "PD",

  "Bundesliga": "BL1",

  "Serie A": "SA",

  "Ligue 1": "FL1",

  "Eredivisie": "DED",

};







async function getFootballDataRecentMatches(

  teamName: string,

  competitionCode: string,

  beforeDate: string

) {

  try {

    const teamId = await findFootballDataTeamId(

      teamName,

      competitionCode

    );



    if (!teamId) {

      console.log(

        "Football-Data 找不到球隊:",

        teamName

      );



      return [];

    }



    console.log(

      "Football-Data Team ID:",

      teamName,

      teamId

    );



    const matchDate = new Date(beforeDate);



    // 往前抓 365 天

    const fromDate = new Date(matchDate);

    fromDate.setDate(fromDate.getDate() - 365);



    // 不包含本場比賽當天之後

    const toDate = new Date(matchDate);

    toDate.setDate(toDate.getDate() - 1);



    const formatDate = (date: Date) =>

      date.toISOString().slice(0, 10);



    const from = formatDate(fromDate);

    const to = formatDate(toDate);



    console.log(

      "Football-Data recent range:",

      teamName,

      from,

      to

    );



    const data = await footballDataApi(

      `/teams/${teamId}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}`

    );



    const matches = data?.matches || [];



    return matches

      .filter((match: any) => {

        return (

          match?.status === "FINISHED" &&

          match?.score?.fullTime?.home !== null &&

          match?.score?.fullTime?.away !== null

        );

      })

      .sort(

        (a: any, b: any) =>

          new Date(b.utcDate).getTime() -

          new Date(a.utcDate).getTime()

      )

      .slice(0, 5);



  } catch (error) {

    console.error(

      "Football-Data recent matches failed:",

      teamName,

      error

    );



    return [];

  }

}

function convertFootballDataMatches(

  matches: any[],

  footballDataTeamId: number,

  apiFootballTeamId: number

) {

  return (matches || []).map((match: any) => ({

    fixture: {

      date: match?.utcDate,

      status: {

        short: "FT",

      },

    },



    teams: {

      home: {

        id:

          match?.homeTeam?.id === footballDataTeamId

            ? apiFootballTeamId

            : match?.homeTeam?.id,



        name: match?.homeTeam?.name,

      },



      away: {

        id:

          match?.awayTeam?.id === footballDataTeamId

            ? apiFootballTeamId

            : match?.awayTeam?.id,



        name: match?.awayTeam?.name,

      },

    },



    goals: {

      home:

        match?.score?.fullTime?.home ?? null,



      away:

        match?.score?.fullTime?.away ?? null,

    },

  }));

}

    async function translateTeam(

      teamId: number,

      apiName: string

    ) {

      try {

        const res = await fetch(

          `${SUPABASE_URL}/functions/v1/team-translator`,

          {

            method: "POST",



            headers: {

              "Content-Type": "application/json",

              "apikey": SERVICE_ROLE_KEY,

              "Authorization":

                `Bearer ${SERVICE_ROLE_KEY}`,

            },



            body: JSON.stringify({

              team_id: teamId,

              api_name: apiName,

            }),

          }

        );



        const result = await res.json();



        if (

          res.ok &&

          result?.success &&

          result?.zh_name

        ) {

          return result.zh_name;

        }

      } catch (error) {

        console.error(

          "team translator error:",

          error

        );

      }



      return apiName;

    }



    // ==========================================

    // 1. 取得指定賽事

    // ==========================================



    const fixtureData =

      await footballApi(

        `/fixtures?id=${fixtureId}`

      );

      console.log(

  "FIXTURE RAW:",

  JSON.stringify(fixtureData)

);

    const match =

      fixtureData?.response?.[0];



    if (!match) {

      throw new Error("找不到指定賽事");

    }



    const leagueId =

      match.league?.id;



    const season =

      match.league?.season;



    const homeId =

      match.teams?.home?.id;



    const awayId =

      match.teams?.away?.id;



    const homeApiName =

      match.teams?.home?.name || "";



    const awayApiName =

      match.teams?.away?.name || "";



    if (

      !leagueId ||

      !season ||

      !homeId ||

      !awayId

    ) {

      throw new Error(

        "賽事缺少 league / season / team 資料"

      );

    }



    // ==========================================

    // 2. 中文隊名

    // ==========================================



    const [

      homeZhName,

      awayZhName,

    ] = await Promise.all([

      translateTeam(

        homeId,

        homeApiName

      ),



      translateTeam(

        awayId,

        awayApiName

      ),

    ]);



    // ==========================================

    // 3. 球隊賽季統計

    // ==========================================

// ======================================

// 3. 球隊賽季統計：正式恢復 API-Football，以 12h 共用快取控額

// ======================================



// 以聯賽、球季、球隊為快取鍵。資料缺失時不捏造數據，原模型會降低信心。
async function habaoFetchTeamSeasonStat(teamId:number): Promise<any> {
  const cacheKey = `football:teamstat:${leagueId}:${season}:${teamId}`;
  const cached = await habaoReadSharedCache(cacheKey);
  if (cached && typeof cached === "object") return cached;
  try {
    const res = await footballApi(`/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`);
    if (res?.response && typeof res.response === "object") {
      await habaoWriteSharedCache(cacheKey, res, 12 * 3600);
      return res;
    }
  } catch (err) { console.warn("FOOTBALL_TEAM_STATS_FALLBACK", teamId, String(err)); }
  return {response:null};
}
const [homeStatsData,awayStatsData] = await Promise.all([
  habaoFetchTeamSeasonStat(Number(homeId)),
  habaoFetchTeamSeasonStat(Number(awayId)),
]);
const homeStats:any = homeStatsData?.response || {};
const awayStats:any = awayStatsData?.response || {};
console.log("FOOTBALL_TEAM_STATS", {home:Boolean(homeStatsData?.response),away:Boolean(awayStatsData?.response)});


// ========================================

// 4. 雙方近期 5 場比賽

// ========================================



// ========================================

// 4. 雙方近期 5 場比賽

// 免費方案不使用 last=5

// 改用日期區間抓取，再自行挑最近 5 場

// ========================================

// ========================================

// 4. 雙方近期比賽

// 改用 Football-Data 補本季已完賽資料

// ========================================



const competitionCode =

  footballDataCompetitionMap[

    match.league?.name || ""

  ] || null;




let homeRecent: any[] = [];

let awayRecent: any[] = [];



if (competitionCode) {

  const [

    homeFootballDataId,

    awayFootballDataId,

  ] = await Promise.all([

    findFootballDataTeamId(

      homeApiName,

      competitionCode

    ),



    findFootballDataTeamId(

      awayApiName,

      competitionCode

    ),

  ]);



  console.log(

    "Football-Data HOME ID:",

    homeApiName,

    homeFootballDataId

  );



  console.log(

    "Football-Data AWAY ID:",

    awayApiName,

    awayFootballDataId

  );



  const [

    homeFootballDataMatches,

    awayFootballDataMatches,

  ] = await Promise.all([

    homeFootballDataId

      ? getFootballDataRecentMatches(

  homeApiName,

  competitionCode,

  match.fixture.date

)

      : Promise.resolve([]),



    awayFootballDataId

      ? getFootballDataRecentMatches(

  awayApiName,

  competitionCode,

  match.fixture.date

)

      : Promise.resolve([]),

  ]);



  homeRecent =

    homeFootballDataId

      ? convertFootballDataMatches(

          homeFootballDataMatches,

          homeFootballDataId,

          homeId

        )

      : [];



  awayRecent =

    awayFootballDataId

      ? convertFootballDataMatches(

          awayFootballDataMatches,

          awayFootballDataId,

          awayId

        )

      : [];



} else {

  console.log(

    "Football-Data 尚未支援此聯賽:",

    match.league?.name

  );

}



console.log("CURRENT LEAGUE NAME:", match.league?.name);



console.log(

  "HOME RECENT COUNT:",

  homeRecent.length

);



console.log(

  "AWAY RECENT COUNT:",

  awayRecent.length

);



    // ==========================================

    // 4. 最近 H2H

    // 某些球隊可能沒有資料，所以失敗不終止

    // ==========================================



    let h2h: any[] = [];



    try {

      const h2hData =

        await footballApi(

          `/fixtures/headtohead?h2h=${homeId}-${awayId}`

        );

        console.log(

  "H2H RAW:",

  JSON.stringify(h2hData)

);



      const allH2H = h2hData?.response || [];



const matchTime = new Date(match.fixture.date).getTime();



h2h = allH2H

  .filter((game: any) => {

    const gameTime =

      new Date(game.fixture?.date || 0).getTime();



    const status =

      game.fixture?.status?.short;



    return (

      gameTime < matchTime &&

      ["FT", "AET", "PEN"].includes(status)

    );

  })

  .sort(

    (a: any, b: any) =>

      new Date(b.fixture?.date || 0).getTime() -

      new Date(a.fixture?.date || 0).getTime()

  )

  .slice(0, 5);



console.log(

  "H2H COUNT:",

  h2h.length

);

    } catch (error) {

      console.error(

        "H2H unavailable:",

        error

      );

    }



    // ==========================================

    // 5. 本場賠率

    // 有些聯賽可能沒有

    // ==========================================



    // 唯一賠率來源：The Odds API v4。找不到同場同主客時保留空市場，不回退 The Odds API。
    const marketOdds = await habaoLoadOddsV4(
      Number(leagueId), String(match.fixture.date), homeApiName, awayApiName,
    );
    const odds: any[] = marketOdds?.bookmakers?.length
      ? [{ bookmakers: marketOdds.bookmakers }] : [];

    // =====================================

// 自動判斷本場主流大小球盤口

// =====================================

// ========================================

// 自動判斷本場主流大小球盤口

// 優先找市場賠率最接近均衡的盤口

// ========================================

let mainOverUnderLine: number | null = null;



type OverUnderMarket = {

  line: number;

  over: number;

  under: number;

  bookmaker: string;

};



const overUnderMarkets: OverUnderMarket[] = [];



for (const oddsItem of odds || []) {

  for (const bookmaker of oddsItem?.bookmakers || []) {

    for (const bet of bookmaker?.bets || []) {

      if (bet?.name !== "Goals Over/Under") continue;



      const lineMap = new Map<

        number,

        { over?: number; under?: number }

      >();



      for (const value of bet?.values || []) {

        const match = String(value?.value || "").match(

          /(?:Over|Under)\s+([0-9]+(?:\.[0-9]+)?)/

        );



        if (!match) continue;



        const line = Number(match[1]);

        const odd = Number(value?.odd);



        if (!Number.isFinite(line) || !Number.isFinite(odd)) {

          continue;

        }



        const current = lineMap.get(line) || {};



        if (/^Over/i.test(String(value?.value))) {

          current.over = odd;

        }



        if (/^Under/i.test(String(value?.value))) {

          current.under = odd;

        }



        lineMap.set(line, current);

      }



      for (const [line, prices] of lineMap.entries()) {

        if (

          Number.isFinite(prices.over) &&

          Number.isFinite(prices.under)

        ) {

          overUnderMarkets.push({

            line,

            over: prices.over!,

            under: prices.under!,

            bookmaker: bookmaker?.name || "",

          });

        }

      }

    }

  }

}



if (overUnderMarkets.length > 0) {

  // 每個盤口計算平均「大小賠率差距」

  // 差距越小，代表越接近市場均衡盤

  const lineStats = new Map<

    number,

    { totalDiff: number; count: number }

  >();



  for (const market of overUnderMarkets) {

    const diff = Math.abs(market.over - market.under);



    const current = lineStats.get(market.line) || {

      totalDiff: 0,

      count: 0,

    };



    current.totalDiff += diff;

    current.count += 1;



    lineStats.set(market.line, current);

  }



  const rankedLines = [...lineStats.entries()]

    .map(([line, stat]) => ({

      line,

      avgDiff: stat.totalDiff / stat.count,

      count: stat.count,

    }))

    .sort((a, b) => {

      // 第一優先：大小賠率越接近越好

      if (a.avgDiff !== b.avgDiff) {

        return a.avgDiff - b.avgDiff;

      }



      // 第二優先：有越多莊家提供越好

      return b.count - a.count;

    });



  mainOverUnderLine = rankedLines[0]?.line ?? null;

}



console.log(

  "MAIN OVER/UNDER LINE:",

  mainOverUnderLine

);



    // ==========================================

    // 6. 整理資料，避免把整包巨大 JSON 丟給 AI

    // ==========================================



    function simplifyStats(stats: any) {

      return {

        form:

          stats?.form || null,



        fixtures:

          stats?.fixtures || null,



        goals:

          stats?.goals || null,



        biggest:

          stats?.biggest || null,



        clean_sheet:

          stats?.clean_sheet || null,failed_to_score:

          stats?.failed_to_score || null,



        penalty:

          stats?.penalty || null,

      };

    }

function simplifyRecentGames(

  games: any[],

  teamId: number

) {

  return (games || []).map((game: any) => {



    const isHome =

      game?.teams?.home?.id === teamId;



    const teamGoals = isHome

      ? game?.goals?.home

      : game?.goals?.away;



    const opponentGoals = isHome

      ? game?.goals?.away

      : game?.goals?.home;



    let result = "未知";



    if (

      typeof teamGoals === "number" &&

      typeof opponentGoals === "number"

    ) {

      if (teamGoals > opponentGoals) result = "勝";

      else if (teamGoals < opponentGoals) result = "負";

      else result = "平";

    }



    return {

      date:

        game?.fixture?.date || null,



      venue:

        isHome ? "主場" : "客場",



      opponent:

        isHome

          ? game?.teams?.away?.name

          : game?.teams?.home?.name,



      score:

        `${teamGoals ?? "-"}-${opponentGoals ?? "-"}`,



      result,



      league:

        game?.league?.name || null,



      status:

        game?.fixture?.status?.short || null,

    };

  });

}

    const simplifiedH2H =

      h2h.map((game: any) => ({

        date:

          game.fixture?.date,



        home:

          game.teams?.home?.name,



        away:

          game.teams?.away?.name,



        homeGoals:

          game.goals?.home,



        awayGoals:

          game.goals?.away,



        status:

          game.fixture?.status?.short,

      }));



    // 賠率資料不要全部塞給 AI

    const simplifiedOdds =

      odds.slice(0, 3).map(

        (item: any) => ({

          bookmaker:

            item.bookmakers

              ?.slice(0, 3)

              ?.map((bookmaker: any) => ({

                name:

                  bookmaker.name,



                bets:

                  bookmaker.bets

                    ?.filter((bet: any) =>

                     (
  [

    "Match Winner",

    "Goals Over/Under",

    "Both Teams Score",

    "Asian Handicap",

  ].includes(

    bet.name

  ) ||
  /Asian Handicap/i.test(
    String(bet?.name || "")
  )
)

                    )

                    ?.map((bet: any) => ({

                      name:

                        bet.name,



                      values:

                        bet.values,

                    })),

              })),

        })

      );

      function calculateRecentMetrics(

  games: any[],

  teamId: number

) {

  let wins = 0;

  let draws = 0;

  let losses = 0;



  let goalsFor = 0;

  let goalsAgainst = 0;



  let bttsCount = 0;

  let over25Count = 0;

  let cleanSheets = 0;



  let validMatches = 0;



  for (const game of games || []) {

    const status = game?.fixture?.status?.short;



    if (!["FT", "AET", "PEN"].includes(status)) {

      continue;

    }



    const homeGoals = Number(game?.goals?.home);

    const awayGoals = Number(game?.goals?.away);



    if (

      !Number.isFinite(homeGoals) ||

      !Number.isFinite(awayGoals)

    ) {

      continue;

    }



    const isHome =

      game?.teams?.home?.id === teamId;



    const isAway =

      game?.teams?.away?.id === teamId;



    if (!isHome && !isAway) {

      continue;

    }



    const teamGoals =

      isHome ? homeGoals : awayGoals;



    const opponentGoals =

      isHome ? awayGoals : homeGoals;



    validMatches++;



    goalsFor += teamGoals;

    goalsAgainst += opponentGoals;



    if (teamGoals > opponentGoals) {

      wins++;

    } else if (teamGoals === opponentGoals) {

      draws++;

    } else {

      losses++;

    }



    if (homeGoals > 0 && awayGoals > 0) {

      bttsCount++;

    }



    if (homeGoals + awayGoals > 2.5) {

      over25Count++;

    }



    if (opponentGoals === 0) {

      cleanSheets++;

    }

  }



  return {

    matches: validMatches,



    wins,

    draws,

    losses,



    win_rate:

      validMatches > 0

        ? Math.round((wins / validMatches) * 100)

        : null,



    goals_for: goalsFor,

    goals_against: goalsAgainst,



    avg_goals_for:

      validMatches > 0

        ? Number(

            (goalsFor / validMatches).toFixed(2)

          )

        : null,



    avg_goals_against:

      validMatches > 0

        ? Number(

            (goalsAgainst / validMatches).toFixed(2)

          )

        : null,



    avg_total_goals:

      validMatches > 0

        ? Number(

            (

              (goalsFor + goalsAgainst) /

              validMatches

            ).toFixed(2)

          )

        : null,



    btts_count: bttsCount,



    btts_rate:

      validMatches > 0

        ? Math.round(

            (bttsCount / validMatches) * 100

          )

        : null,



    over_2_5_count: over25Count,



    over_2_5_rate:

      validMatches > 0

        ? Math.round(

            (over25Count / validMatches) * 100

          )

        : null,



    clean_sheets: cleanSheets,

  };

}

const homeRecentMetrics =

  calculateRecentMetrics(

    homeRecent,

    homeId

  );



const awayRecentMetrics =

  calculateRecentMetrics(

    awayRecent,

    awayId

  );



    const leagueNameZhById: Record<number, string> = {
      2: "歐洲冠軍聯賽",
      3: "歐霸盃",
      39: "英格蘭超級聯賽",
      140: "西班牙甲級聯賽",
      78: "德國甲級聯賽",
      135: "義大利甲級聯賽",
      61: "法國甲級聯賽",
      98: "日本職業足球甲級聯賽",
      292: "韓國職業足球甲級聯賽",
      169: "中國足球超級聯賽",
      88: "荷蘭甲級聯賽",
      71: "巴西甲級聯賽",
    };

    const leagueNameZhMap: Record<string, string> = {
      "UEFA Champions League": "歐洲冠軍聯賽",
      "UEFA Europa League": "歐霸盃",
      "Premier League": "英格蘭超級聯賽",
      "La Liga": "西班牙甲級聯賽",
      "Bundesliga": "德國甲級聯賽",
      "Serie A": "義大利甲級聯賽",
      "Ligue 1": "法國甲級聯賽",
      "J1 League": "日本職業足球甲級聯賽",
      "K League 1": "韓國職業足球甲級聯賽",
      "Chinese Super League": "中國足球超級聯賽",
      "Eredivisie": "荷蘭甲級聯賽",
      "Serie A Brazil": "巴西甲級聯賽",
      "Brazil Serie A": "巴西甲級聯賽",
      "Liga Profesional Argentina": "阿根廷甲級聯賽",
      "KNVB Beker": "荷蘭盃",
      "Copa Chile": "智利盃",
      "Primera A": "哥倫比亞甲級聯賽",
    };

    const rawApiLeagueName =
      String(match.league?.name || "");

    const apiLeagueName =
      Number(leagueId) === 71
        ? "Brazil Serie A"
        : rawApiLeagueName;

    const zhLeagueName =
      leagueNameZhById[Number(leagueId)] ||
      leagueNameZhMap[apiLeagueName] ||
      leagueNameZhMap[rawApiLeagueName] ||
      rawApiLeagueName;

    const sourceData = {

      fixture: {

        id:

          fixtureId,



        league: {

          id:
            leagueId,

          name:
            zhLeagueName,

          api_name:
            apiLeagueName,

          logo:
            match.league?.logo || null,

          country:
            match.league?.country || null,

        },



        country:

          match.league?.country,



        season:

          season,



        date:

          match.fixture?.date,



        venue:

          match.fixture?.venue,



        home: {

          id:

            homeId,



          name:

            homeZhName,



          api_name:

            homeApiName,



          logo:

            match.teams?.home?.logo,

        },



        away: {

          id:

            awayId,



          name:

            awayZhName,



          api_name:

            awayApiName,



          logo:

            match.teams?.away?.logo,

        },

      },



      home_statistics:

        simplifyStats(homeStats),



      away_statistics:

        simplifyStats(awayStats),

home_recent:

  simplifyRecentGames(homeRecent, homeId),



home_recent_metrics:

  homeRecentMetrics,



away_recent:

  simplifyRecentGames(awayRecent, awayId),



away_recent_metrics:

  awayRecentMetrics,



head_to_head:

  simplifiedH2H,



      odds:

        simplifiedOdds,



        market_odds:

  marketOdds,



      main_over_under_line:

      mainOverUnderLine,  

    };



    // ===============================================================
    // HABAO Football V2 | research-only pre-kickoff capture + capped fallback
    // This NEVER replaces sourceData or changes V1 official predictions.
    // If Football-Data provides fewer than 3 valid finished games, V2 alone
    // can fetch the real historical fixtures via existing API-Football subscription.
    // ===============================================================
    try {
      const v2ShadowSecret = Deno.env.get("FOOTBALL_V2_INGEST_SECRET") || "";
      const v2KickoffMs = Date.parse(String(sourceData?.fixture?.date || ""));
      const v2CapturedMs = Date.now();
      const v2TimeToKickoff = v2KickoffMs - v2CapturedMs;
      const v2ValidMetrics = (m: any) =>
        m && Number.isInteger(m.matches) && m.matches >= 3 && m.matches <= 100 &&
        Number.isFinite(m.avg_goals_for) && m.avg_goals_for >= 0 && m.avg_goals_for <= 8 &&
        Number.isFinite(m.avg_goals_against) && m.avg_goals_against >= 0 && m.avg_goals_against <= 8;

      // Do not backfill completed games: only original pre-kickoff T-10 processing.
      const v2Eligible = Boolean(v2ShadowSecret) && internalPublic &&
        Number.isFinite(v2KickoffMs) && v2TimeToKickoff > 0 &&
        v2TimeToKickoff <= 10 * 60 * 60 * 1000;

      if (v2Eligible) {
        // Real team IDs are already present in the primary API-Football match.
        // No fuzzy name matching or inferred statistics in the backup path.
        const v2ReadApiFootballRecent = async (team: number, label: string): Promise<any | null> => {
          if (!Number.isSafeInteger(team) || team <= 0) return null;
          // API-Football requires season when fixtures are filtered by team.
          // Use the fixture's actual league season, never an inferred current calendar year.
          const v2Season = Number(season);
          if (!Number.isInteger(v2Season) || v2Season < 2000 || v2Season > 2100) {
            console.warn("FOOTBALL_V2_RECENT_NO_SEASON", Number(fixtureId), label);
            return null;
          }
          // Keep the 365-day historical window, even if we need both football seasons.
          const fromDate = new Date(v2CapturedMs - 365 * 86400000).toISOString().slice(0, 10);
          const toDate = new Date(v2CapturedMs).toISOString().slice(0, 10);
          // Cached metrics must have been collected no later than this snapshot;
          // otherwise an earlier T-10 snapshot might use later results.
          const cacheKey = `football:v2:recent:seasonfix:v2:${team}:${v2Season}:${toDate}`;
          const cached = await habaoReadSharedCache(cacheKey);
          if (cached && Number(cached?.collected_ms) <= v2CapturedMs &&
              Number(cached?.collected_ms) > 0) {
            if (cached.ok === true && v2ValidMetrics(cached.metrics)) {
              console.log("FOOTBALL_V2_RECENT_CACHE_HIT", Number(fixtureId), label);
              return cached.metrics;
            }
            if (cached.ok === false) return null;
          }

          const finishedGames: any[] = [];
          let apiFailed = false;
          // One team/year request per season. Second request only if fewer than 5
          // valid games exist in current season, for start-of-season coverage.
          for (const querySeason of [v2Season, v2Season - 1]) {
            if (finishedGames.length >= 5) break;
            try {
              const url = `/fixtures?team=${team}&season=${querySeason}&from=${fromDate}&to=${toDate}`;
              const response = await footballApi(url); // Throws on errors even if HTTP 200.
              if (!Array.isArray(response?.response)) {
                apiFailed = true;
                console.warn("FOOTBALL_V2_RECENT_BAD_RESPONSE", Number(fixtureId), label, querySeason);
                break;
              }
              finishedGames.push(...response.response.filter((game: any) => {
                const stamp = Date.parse(String(game?.fixture?.date || ""));
                const home = game?.goals?.home;
                const away = game?.goals?.away;
                // A 4h safety margin eliminates games not completed at T-10,
                // even if the provider reports a final status during a later API call.
                return Number.isFinite(stamp) && stamp >= v2CapturedMs - 365 * 86400000 &&
                  stamp <= v2CapturedMs - 4 * 3600000 &&
                  ["FT", "AET", "PEN"].includes(String(game?.fixture?.status?.short || "")) &&
                  typeof home === "number" && Number.isFinite(home) &&
                  typeof away === "number" && Number.isFinite(away) &&
                  (Number(game?.teams?.home?.id) === team || Number(game?.teams?.away?.id) === team);
              }));
              console.log("FOOTBALL_V2_RECENT_QUERY", Number(fixtureId), label,
                { season: querySeason, fetched: response.response.length });
            } catch (error) {
              apiFailed = true;
              console.warn("FOOTBALL_V2_RECENT_FALLBACK_FAILED", Number(fixtureId), label,
                { season: querySeason, error: String(error).slice(0, 160) });
              break;
            }
          }
          const seen = new Set<string>();
          const games = finishedGames
            .sort((a: any, b: any) => Date.parse(String(b?.fixture?.date || "")) - Date.parse(String(a?.fixture?.date || "")))
            .filter((game: any) => {
              const fixtureKey = String(game?.fixture?.id || "");
              if (!fixtureKey || seen.has(fixtureKey)) return false;
              seen.add(fixtureKey); return true;
            }).slice(0, 5);
          const metrics = calculateRecentMetrics(games, team);
          const good = v2ValidMetrics(metrics);
          // Don't write negative cache for API errors, permitting retries after fixes.
          if (!apiFailed) {
            await habaoWriteSharedCache(cacheKey,
              {ok: good, metrics: good ? metrics : null, collected_ms: v2CapturedMs},
              good ? 6 * 3600 : 20 * 60);
          }
          console.log("FOOTBALL_V2_RECENT_FALLBACK", Number(fixtureId), label,
            { finished: games.length, valid: metrics.matches, success: good, api_failed: apiFailed });
          return good ? metrics : null;
        };
        const v2Task = async () => {
          try {
            let homeMetrics: any = sourceData?.home_recent_metrics;
            let awayMetrics: any = sourceData?.away_recent_metrics;
            let homeSource = "football_data";
            let awaySource = "football_data";
            // Backup requests are ONLY issued for invalid research samples.
            const missingHome = !v2ValidMetrics(homeMetrics);
            const missingAway = !v2ValidMetrics(awayMetrics);
            if (missingHome || missingAway) {
              const [homeExtra, awayExtra] = await Promise.all([
                missingHome ? v2ReadApiFootballRecent(Number(homeId), "home") : Promise.resolve(null),
                missingAway ? v2ReadApiFootballRecent(Number(awayId), "away") : Promise.resolve(null),
              ]);
              if (homeExtra) { homeMetrics = homeExtra; homeSource = "api_football_recent_fallback"; }
              if (awayExtra) { awayMetrics = awayExtra; awaySource = "api_football_recent_fallback"; }
            }
            if (!v2ValidMetrics(homeMetrics) || !v2ValidMetrics(awayMetrics)) {
              console.warn("FOOTBALL_V2_SHADOW_INSUFFICIENT", Number(fixtureId),
                { home: homeMetrics?.matches ?? null, away: awayMetrics?.matches ?? null });
              return;
            }

            const v2Line = Number.isFinite(mainOverUnderLine) ? mainOverUnderLine : null;
            const v2Totals = Array.isArray(marketOdds?.totals) ? marketOdds.totals : [];
            const v2AverageOdds = (side: string): number | null => {
              const prices = v2Totals
                .filter((entry: any) => entry?.side === side && v2Line !== null && Number(entry?.line) === v2Line)
                .map((entry: any) => Number(entry.odds))
                .filter((price: number) => Number.isFinite(price) && price > 1 && price <= 50);
              return prices.length ? Number((prices.reduce((sum: number, price: number) => sum + price, 0) / prices.length).toFixed(4)) : null;
            };
            const v2Input = {
              fixture_id: Number(fixtureId),
              kickoff_at: new Date(v2KickoffMs).toISOString(),
              captured_at: new Date(v2CapturedMs).toISOString(),
              home_recent_metrics: {
                matches: homeMetrics.matches,
                avg_goals_for: homeMetrics.avg_goals_for,
                avg_goals_against: homeMetrics.avg_goals_against,
              },
              away_recent_metrics: {
                matches: awayMetrics.matches,
                avg_goals_for: awayMetrics.avg_goals_for,
                avg_goals_against: awayMetrics.avg_goals_against,
              },
              market: {
                total_line: v2Line,
                over_odds: v2AverageOdds("over"),
                under_odds: v2AverageOdds("under"),
              },
              source_meta: {
                source: "match-analysis",
                capture_mode: "system_auto",
                source_metrics: "pre_match_recent_games",
                home_recent_source: homeSource,
                away_recent_source: awaySource,
                odds_provider: marketOdds?.source || null,
                captured_before_kickoff: true,
                cached_source_age_unknown: homeSource === "football_data" || awaySource === "football_data",
              },
            };
            const response = await fetch(
              `${SUPABASE_URL}/functions/v1/football-v2-shadow-ingest`,
              { method: "POST", headers: {
                "content-type": "application/json",
                "x-v2-ingest-secret": v2ShadowSecret,
              }, body: JSON.stringify(v2Input), signal: AbortSignal.timeout(3500) },
            );
            if (!response.ok) {
              console.warn("FOOTBALL_V2_SHADOW_CAPTURE_SKIPPED", Number(fixtureId), response.status);
            }
          } catch (error) {
            console.warn("FOOTBALL_V2_SHADOW_CAPTURE_UNAVAILABLE", Number(fixtureId), String(error));
          }
        };
        // Keep the official V1 HTTP response independent of this optional research.
        const v2Runtime = (globalThis as unknown as {
          EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
        }).EdgeRuntime;
        if (typeof v2Runtime?.waitUntil === "function") {
          v2Runtime.waitUntil(v2Task());
        } else {
          await v2Task();
        }
      }
    } catch (v2ShadowError) {
      console.warn("FOOTBALL_V2_SHADOW_NONBLOCKING_ERROR", String(v2ShadowError));
    }

    // ==========================================

    // 7. V2 Poisson shrinkage 正式分析

    // ==========================================



    // V2 is the active football prediction engine. The feature snapshot is
    // captured by the V2 feature pipeline before this analysis request.
    const v2FeatureRes = await fetch(
      `${SUPABASE_URL}/rest/v1/football_v2_shadow_feature_snapshots?select=*&fixture_id=eq.${fixtureId}&order=captured_at.desc&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(10000) },
    );
    if (!v2FeatureRes.ok) throw new Error(`FOOTBALL_V2_FEATURE_READ_${v2FeatureRes.status}`);
    const v2Features = await v2FeatureRes.json();
    const v2Feature = Array.isArray(v2Features) ? v2Features[0] : null;
    if (!v2Feature) throw new Error("FOOTBALL_V2_FEATURE_SNAPSHOT_MISSING");
    const v2Kickoff = Date.parse(String(v2Feature.kickoff_at || sourceData?.fixture?.date || ""));
    const v2CapturedAt = Date.parse(String(v2Feature.captured_at || ""));
    const requestedKickoff = Date.parse(String(sourceData?.fixture?.date || ""));
    if (!Number.isFinite(v2Kickoff) || !Number.isFinite(v2CapturedAt) || v2CapturedAt > Date.now() || v2Kickoff <= Date.now() ||
        v2CapturedAt >= v2Kickoff || v2Kickoff - v2CapturedAt > 52 * 3600000 ||
        (Number.isFinite(requestedKickoff) && Math.abs(v2Kickoff - requestedKickoff) > 90 * 1000)) {
      throw new Error("FOOTBALL_V2_FEATURE_SNAPSHOT_INVALID_OR_STALE");
    }

    const v2N = (v: any): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v); return Number.isFinite(n) ? n : null;
    };
    const v2Base = v2N(v2Feature.league_baseline?.avg_goals_for_per_match);
    if (v2Base === null || v2Base <= 0) throw new Error("FOOTBALL_V2_LEAGUE_BASELINE_MISSING");
    const v2Clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
    const v2Shrink = (x: number | null, prior: number, n: number, k = 5) => x === null ? prior : n / (n + k) * x + k / (n + k) * prior;
    const v2Venue = (team: any, overall: number | null) => {
      const v = v2N(team?.venue?.opponent_adjusted_avg_goals_for), n = Number(team?.venue?.matches || 0);
      if (v === null || overall === null || overall <= 0 || n <= 0) return 1;
      const observed = v2Clamp(v / overall, .85, 1.15), weight = n / (n + 5);
      return 1 + (observed - 1) * weight;
    };
    const v2Blend = (team: any, recent: number | null, seasonValue: number | null, n: number, seasonN: number) => {
      const r = v2Shrink(recent, v2Base!, n);
      if (seasonValue === null || seasonN <= 0) return r;
      const history = Array.isArray(team?.history) ? team.history : [];
      const overlap = history.filter((g: any) => Number(g?.season) === Number(v2Feature.season)).length;
      const seasonWeight = .4 * v2Clamp((seasonN - Math.min(seasonN, overlap)) / seasonN, 0, 1);
      return (1 - seasonWeight) * r + seasonWeight * v2Shrink(seasonValue, v2Base!, seasonN);
    };
    const v2Home = v2Feature.home_features, v2Away = v2Feature.away_features;
    const v2Ha = v2Blend(v2Home, v2N(v2Home?.opponent_adjusted_avg_goals_for), v2N(v2Home?.season_features?.goals_for_per_match), Number(v2Home?.matches || 0), Number(v2Home?.season_features?.matches_played || 0));
    const v2Hd = v2Blend(v2Home, v2N(v2Home?.opponent_adjusted_avg_goals_against), v2N(v2Home?.season_features?.goals_against_per_match), Number(v2Home?.matches || 0), Number(v2Home?.season_features?.matches_played || 0));
    const v2Aa = v2Blend(v2Away, v2N(v2Away?.opponent_adjusted_avg_goals_for), v2N(v2Away?.season_features?.goals_for_per_match), Number(v2Away?.matches || 0), Number(v2Away?.season_features?.matches_played || 0));
    const v2Ad = v2Blend(v2Away, v2N(v2Away?.opponent_adjusted_avg_goals_against), v2N(v2Away?.season_features?.goals_against_per_match), Number(v2Away?.matches || 0), Number(v2Away?.season_features?.matches_played || 0));
    const v2Hxg = v2Clamp(((v2Ha + v2Ad) / 2) * v2Venue(v2Home, v2Ha), .15, 4);
    const v2Axg = v2Clamp(((v2Aa + v2Hd) / 2) * v2Venue(v2Away, v2Aa), .15, 4);
    const v2Poisson = (lambda: number, k: number) => { let p = Math.exp(-lambda); for (let i = 1; i <= k; i++) p *= lambda / i; return p; };
    const v2Hp = Array.from({ length: 19 }, (_, i) => v2Poisson(v2Hxg, i));
    const v2Ap = Array.from({ length: 19 }, (_, i) => v2Poisson(v2Axg, i));
    const v2Mass = v2Hp.reduce((a, b) => a + b, 0) * v2Ap.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(v2Mass) || v2Mass < .99999) throw new Error("FOOTBALL_V2_PROBABILITY_MASS_INVALID");
    const v2Grid: Array<{ h: number; a: number; p: number }> = [];
    let v2PHome = 0, v2PDraw = 0, v2PAway = 0, v2PBtts = 0;
    for (let h = 0; h <= 18; h++) for (let a = 0; a <= 18; a++) {
      const p = v2Hp[h] * v2Ap[a] / v2Mass; v2Grid.push({ h, a, p });
      if (h > a) v2PHome += p; else if (h === a) v2PDraw += p; else v2PAway += p;
      if (h > 0 && a > 0) v2PBtts += p;
    }
    const v2TotalsOver = (line: number) => v2Grid.reduce((sum, x) => sum + (x.h + x.a > line ? x.p : 0), 0);
    const v2Expected = (side: "home" | "away", line: number) => v2Grid.reduce((sum, x) => sum + ((side === "home" ? x.h + line - x.a : x.a + line - x.h) > 0 ? x.p : 0), 0);
    const v2Names = { home: String(sourceData?.fixture?.home?.name || "主隊"), away: String(sourceData?.fixture?.away?.name || "客隊") };
    const v2Quality = String(v2Feature.data_quality || "low_sample");
    const v2Cap = v2Quality === "research_ready" ? 72 : 62;
    const v2Confidence = (p: number, baseline = 0.5) => Math.round(v2Clamp(50 + Math.max(0, p - baseline) * 100, 45, v2Cap));
    const v2Outcomes = [{ key: "home" as const, p: v2PHome }, { key: "draw" as const, p: v2PDraw }, { key: "away" as const, p: v2PAway }].sort((a, b) => b.p - a.p);
    const v2Winner = v2Outcomes[0];
    const v2MoneyPick = v2Winner.key === "home" ? "主隊" : v2Winner.key === "away" ? "客隊" : "和局";
    const v2Line = Number.isFinite(mainOverUnderLine) ? Number(mainOverUnderLine) : null;
    const v2OverP = v2Line === null ? null : v2TotalsOver(v2Line);
    const v2TotalPick = v2OverP === null ? "暫不推薦" : v2OverP >= .5 ? `大${v2Line}` : `小${v2Line}`;
    const v2TotalP = v2OverP === null ? 0 : Math.max(v2OverP, 1 - v2OverP);
    const v2BttsPick = v2PBtts >= .5 ? "是" : "否";
    const v2BttsP = Math.max(v2PBtts, 1 - v2PBtts);
    const v2HandicapQuotes = Array.isArray(marketOdds?.handicap) ? marketOdds.handicap : [];
    const v2HandicapCandidates = v2HandicapQuotes.map((q: any) => {
      const side = q?.side === "home" ? "home" : q?.side === "away" ? "away" : null;
      const line = v2N(q?.line); if (!side || line === null) return null;
      return { q, side, line, p: v2Expected(side, line) };
    }).filter(Boolean) as Array<{q:any;side:"home"|"away";line:number;p:number}>;
    const v2Handicap = v2HandicapCandidates.sort((a, b) => b.p - a.p)[0];
    const v2HandicapPick = v2Handicap && v2Handicap.p >= .5 ? (v2Handicap.side === "home" ? "主隊" : "客隊") : "暫不推薦";
    const v2Scores = v2Grid.sort((a, b) => b.p - a.p).slice(0, 3);
    const v2FormatScore = (x: {h:number;a:number;p:number}) => ({ score: `${x.h}-${x.a}`, confidence: Math.round(x.p * 100) });
    const v2SourceInfo = {
      model: "football-v2-poisson-shrinkage-0.2.1",
      feature_stage: v2Feature.stage,
      feature_captured_at: v2Feature.captured_at,
      data_quality: v2Quality,
      home_xg: Number(v2Hxg.toFixed(4)), away_xg: Number(v2Axg.toFixed(4)),
      probabilities: { home_win: v2PHome, draw: v2PDraw, away_win: v2PAway, btts_yes: v2PBtts, btts_no: 1 - v2PBtts,
        totals_over: Object.fromEntries([1.5,2.5,3.5,4.5,5.5].map(x => [String(x), v2TotalsOver(x)])),
        totals_under: Object.fromEntries([1.5,2.5,3.5,4.5,5.5].map(x => [String(x), 1-v2TotalsOver(x)])),
        most_likely_scores: v2Scores.map(x => ({score:`${x.h}-${x.a}`, probability:x.p})) },
      fair_odds: { home_win: 1/v2PHome, draw: 1/v2PDraw, away_win: 1/v2PAway, btts_yes: 1/v2PBtts, btts_no: 1/(1-v2PBtts) },
      research_only: false,
    };
    const v2Analysis = {
      summary: `${v2Names.home} xG ${v2Hxg.toFixed(2)}，${v2Names.away} xG ${v2Axg.toFixed(2)}；Poisson 機率模型以 ${v2Feature.stage} 特徵快照計算。`,
      home_form: `主隊模型預期進球 ${v2Hxg.toFixed(2)}；特徵資料品質：${v2Quality}。`,
      away_form: `客隊模型預期進球 ${v2Axg.toFixed(2)}；特徵資料品質：${v2Quality}。`,
      h2h_analysis: "本次 V2 推薦以已保存的賽前特徵與聯賽基準計算。",
      goal_analysis: `模型總進球期望 ${ (v2Hxg+v2Axg).toFixed(2) }；BTTS 是機率 ${(v2PBtts*100).toFixed(1)}%。`,
      market_analysis: v2Line === null ? "未取得有效大小球主流盤口，大小球不給推薦。" : `採用 The Odds API 主流大小球盤 ${v2Line}。`,
      recommendations: {
        moneyline: { pick: v2MoneyPick, confidence: v2Confidence(v2Winner.p, 1/3), reason: `V2 Poisson 機率：主勝 ${(v2PHome*100).toFixed(1)}%、和局 ${(v2PDraw*100).toFixed(1)}%、客勝 ${(v2PAway*100).toFixed(1)}%。` },
        over_under: { pick: v2TotalPick, line: v2Line, confidence: v2Confidence(v2TotalP), reason: v2Line === null ? "沒有真實大小球盤口。" : `模型在 ${v2Line} 線的大球機率 ${(v2OverP!*100).toFixed(1)}%。`, market_source: v2Line === null ? null : "the_odds_api" },
        btts: { pick: v2BttsPick, confidence: v2Confidence(v2BttsP), reason: `BTTS 是機率 ${(v2PBtts*100).toFixed(1)}%。` },
        handicap: { pick: v2HandicapPick, line: v2Handicap?.line ?? null, confidence: v2Handicap ? v2Confidence(v2Handicap.p) : 0, reason: v2Handicap ? `V2比分分布估算 ${v2Handicap.side === "home" ? "主隊" : "客隊"}過盤機率 ${(v2Handicap.p*100).toFixed(1)}%。` : "沒有可用的真實讓分盤口。", market_source: v2Handicap ? "the_odds_api" : null },
      },
      predicted_scores: v2Scores.map(v2FormatScore),
      risk_level: v2Quality === "research_ready" && v2Winner.p >= .55 ? "中" : "高",
      final_note: `此版本使用 V2 Poisson shrinkage；特徵資料品質為 ${v2Quality}，信心分數上限已按資料品質限制。`,
      model_version: "football-v2-poisson-shrinkage-0.2.1",
      probability_research: v2SourceInfo,
    };
    const outputText = JSON.stringify(v2Analysis);



function cleanPublicText(value) {

  if (typeof value !== "string") return value;



  return value

    // 中文化市場名稱

    .replace(/Match Winner/gi, "勝平負盤")

    .replace(/Goals Over\/Under/gi, "大小球盤")

    .replace(/Both Teams Score/gi, "雙方進球盤")

    .replace(/\bBTTS\b/gi, "雙方進球")

    .replace(/\bHome\b/gi, "主勝")

    .replace(/\bAway\b/gi, "客勝")

    .replace(/\bDraw\b/gi, "和局")

    .replace(/Under\s+([0-9]+(?:\.[0-9]+)?)/gi, "小於 $1 球")

    .replace(/Over\s+([0-9]+(?:\.[0-9]+)?)/gi, "大於 $1 球")



    // 移除內部欄位名稱

    .replace(/\bavg_total_goals\b/gi, "平均總進球")

    .replace(/\bavg_goals_for\b/gi, "平均進球")

    .replace(/\bavg_goals_against\b/gi, "平均失球")

    .replace(/\brecent_metrics\b/gi, "")

    .replace(/\bclean_sheets\b/gi, "零封場次")

    .replace(/\bover_2_5_rate\b/gi, "大球比例")

    .replace(/\bbtts_rate\b/gi, "雙方進球比例")



    // 修掉太像系統報告的句型

    .replace(/資料顯示本場為資料不完整情況[^。]\*。?/g, "")

    .replace(/近期雙方在最近\s\*5\s\*場皆有完整資料[，。]?/g, "")

    .replace(/主隊近期無可用比賽資料[，。]?/g, "")

    .replace(/客隊近期無可用比賽資料[，。]?/g, "")

    .replace(/資料不足[，。]?/g, "")

    .replace(/資料缺失[，。]?/g, "")

    .replace(/根據規則[^。]\*。?/g, "")

    .replace(/信心上限[^。]\*。?/g, "")



    // 清理多餘空白

    .replace(/\s{2,}/g, " ")

    .trim();

}




function parseHabaoExactScore(
  value: unknown,
) {
  const raw =
    String(
      value || "",
    ).trim();

  const match =
    raw.match(
      /^(\d{1,2})\s*[-:：]\s*(\d{1,2})$/,
    );

  if (!match) {
    return null;
  }

  const home =
    Number(match[1]);

  const away =
    Number(match[2]);

  if (
    !Number.isFinite(home) ||
    !Number.isFinite(away) ||
    home < 0 ||
    away < 0 ||
    home > 9 ||
    away > 9
  ) {
    return null;
  }

  return {
    home,
    away,
  };
}

function parseHabaoMarketLine(
  value: unknown,
) {
  const raw =
    String(
      value ?? "",
    )
      .replace(/−/g, "-")
      .replace(/＋/g, "+");

  const slashParts =
    raw
      .split("/")
      .map(
        (part) =>
          Number(
            part.trim(),
          ),
      )
      .filter(
        (value) =>
          Number.isFinite(
            value,
          ),
      );

  if (
    slashParts.length >= 2
  ) {
    return Number(
      (
        (
          slashParts[0] +
          slashParts[1]
        ) /
        2
      ).toFixed(2),
    );
  }

  const match =
    raw.match(
      /[+-]?\d+(?:\.\d+)?/,
    );

  if (!match) {
    return null;
  }

  const line =
    Number(match[0]);

  return Number.isFinite(
    line,
  )
    ? line
    : null;
}

function getHabaoScoreContext(
  analysis: any,
  sourceData: any,
) {
  const recommendations =
    analysis
      ?.recommendations ||
    {};

  const overUnder =
    recommendations
      ?.over_under || {};

  const moneyline =
    recommendations
      ?.moneyline || {};

  const btts =
    recommendations
      ?.btts || {};

  const handicap =
    recommendations
      ?.handicap || {};

  const overPick =
    String(
      overUnder?.pick ||
      "",
    );

  const moneyPick =
    String(
      moneyline?.pick ||
      "",
    );

  const bttsPick =
    String(
      btts?.pick ||
      "",
    );

  const handicapPick =
    String(
      handicap?.pick ||
      "",
    );

  const overLine =
    parseHabaoMarketLine(
      overPick,
    ) ??
    parseHabaoMarketLine(
      sourceData
        ?.main_over_under_line,
    );

  const habaoSafeRecentNumber = (value: unknown): number =>
    value === null || value === undefined || value === "" ? NaN : Number(value);

  const homeAttack =
    habaoSafeRecentNumber(
      sourceData
        ?.home_recent_metrics
        ?.avg_goals_for,
    );

  const homeDefense =
    habaoSafeRecentNumber(
      sourceData
        ?.home_recent_metrics
        ?.avg_goals_against,
    );

  const awayAttack =
    habaoSafeRecentNumber(
      sourceData
        ?.away_recent_metrics
        ?.avg_goals_for,
    );

  const awayDefense =
    habaoSafeRecentNumber(
      sourceData
        ?.away_recent_metrics
        ?.avg_goals_against,
    );

  const valid =
    (value: number) =>
      Number.isFinite(
        value,
      );

  let expectedHome =
    valid(homeAttack) &&
    valid(awayDefense)
      ? (
          homeAttack +
          awayDefense
        ) / 2
      : valid(homeAttack)
      ? homeAttack
      : valid(awayDefense)
      ? awayDefense
      : 1.15;

  let expectedAway =
    valid(awayAttack) &&
    valid(homeDefense)
      ? (
          awayAttack +
          homeDefense
        ) / 2
      : valid(awayAttack)
      ? awayAttack
      : valid(homeDefense)
      ? homeDefense
      : 1.05;

  expectedHome =
    Math.max(
      0.15,
      Math.min(
        3.8,
        expectedHome,
      ),
    );

  expectedAway =
    Math.max(
      0.15,
      Math.min(
        3.8,
        expectedAway,
      ),
    );

  return {
    overPick,
    overLine,
    moneyPick,
    bttsPick,
    handicapPick,
    expectedHome,
    expectedAway,
  };
}

function habaoSoftMarketBonus(
  score: {
    home: number;
    away: number;
  },
  context:
    ReturnType<
      typeof getHabaoScoreContext
    >,
) {
  let bonus = 0;

  /*
    獨贏 / BTTS / 讓分只提供很小的排序微調，
    絕不作硬性條件。
  */
  if (
    context.moneyPick.includes(
      "主隊",
    ) &&
    score.home >
      score.away
  ) {
    bonus += 0.35;
  } else if (
    context.moneyPick.includes(
      "客隊",
    ) &&
    score.away >
      score.home
  ) {
    bonus += 0.35;
  } else if (
    context.moneyPick.includes(
      "和局",
    ) &&
    score.home ===
      score.away
  ) {
    bonus += 0.35;
  }

  if (
    (
      context.bttsPick ===
        "是" ||
      /yes/i.test(
        context.bttsPick,
      )
    ) &&
    score.home > 0 &&
    score.away > 0
  ) {
    bonus += 0.20;
  }

  if (
    (
      context.bttsPick ===
        "否" ||
      /no/i.test(
        context.bttsPick,
      )
    ) &&
    (
      score.home === 0 ||
      score.away === 0
    )
  ) {
    bonus += 0.20;
  }

  if (
    context.handicapPick.includes(
      "主隊",
    ) &&
    score.home >
      score.away
  ) {
    bonus += 0.10;
  } else if (
    context.handicapPick.includes(
      "客隊",
    ) &&
    score.away >
      score.home
  ) {
    bonus += 0.10;
  }

  return bonus;
}

function habaoOverUnderBonus(
  score: {
    home: number;
    away: number;
  },
  context:
    ReturnType<
      typeof getHabaoScoreContext
    >,
) {
  if (
    context.overLine ===
      null ||
    !context.overPick ||
    context.overPick.includes(
      "暫不推薦",
    )
  ) {
    return 0;
  }

  const total =
    score.home +
    score.away;

  if (
    context.overPick.includes(
      "大",
    ) ||
    /over/i.test(
      context.overPick,
    )
  ) {
    if (
      total >
      context.overLine
    ) {
      return 1.25;
    }

    /*
      差距只有 0.5~1 球時仍屬可接受劇本，
      不做硬性排除。
    */
    return -0.55;
  }

  if (
    context.overPick.includes(
      "小",
    ) ||
    /under/i.test(
      context.overPick,
    )
  ) {
    if (
      total <
      context.overLine
    ) {
      return 1.25;
    }

    return -0.55;
  }

  return 0;
}

function scoreHabaoCandidate(
  score: {
    home: number;
    away: number;
  },
  context:
    ReturnType<
      typeof getHabaoScoreContext
    >,
) {
  let value = 0;

  /*
    真實近期進失球是主體。
  */
  value -=
    Math.abs(
      score.home -
      context.expectedHome
    ) * 1.65;

  value -=
    Math.abs(
      score.away -
      context.expectedAway
    ) * 1.65;

  /*
    大小分是較高權重市場參考，
    但仍然只是排序加減分，不是硬規則。
  */
  value +=
    habaoOverUnderBonus(
      score,
      context,
    );

  /*
    其他市場只有非常小的 soft bonus。
  */
  value +=
    habaoSoftMarketBonus(
      score,
      context,
    );

  /*
    沒有足夠資料時避免極端高比分佔優。
  */
  value -=
    Math.max(
      0,
      score.home +
        score.away -
        5,
    ) * 0.7;

  return value;
}

function buildHabaoConsistentScores(
  analysis: any,
  sourceData: any,
) {
  const context =
    getHabaoScoreContext(
      analysis,
      sourceData,
    );

  const candidates:
    Array<{
      home: number;
      away: number;
      rank: number;
    }> = [];

  for (
    let home = 0;
    home <= 6;
    home++
  ) {
    for (
      let away = 0;
      away <= 6;
      away++
    ) {
      const score = {
        home,
        away,
      };

      candidates.push({
        ...score,
        rank:
          scoreHabaoCandidate(
            score,
            context,
          ),
      });
    }
  }

  candidates.sort(
    (a, b) => {
      if (
        b.rank !==
        a.rank
      ) {
        return (
          b.rank -
          a.rank
        );
      }

      const aDistance =
        Math.abs(
          a.home -
          context.expectedHome
        ) +
        Math.abs(
          a.away -
          context.expectedAway
        );

      const bDistance =
        Math.abs(
          b.home -
          context.expectedHome
        ) +
        Math.abs(
          b.away -
          context.expectedAway
        );

      return (
        aDistance -
        bDistance
      );
    },
  );

  return candidates
    .slice(
      0,
      3,
    );
}

function habaoHasExtremeOverUnderConflict(
  scores:
    Array<{
      home: number;
      away: number;
    }>,
  context:
    ReturnType<
      typeof getHabaoScoreContext
    >,
) {
  if (
    context.overLine ===
      null ||
    !context.overPick ||
    context.overPick.includes(
      "暫不推薦",
    )
  ) {
    return false;
  }

  const totals =
    scores.map(
      (score) =>
        score.home +
        score.away,
    );

  /*
    只有「三組全部」都跟大小分方向明顯背離，
    而且平均總進球差距很大時才視為極端矛盾。
    這樣不會因單一合理替代劇本就被強制改掉。
  */
  const avgTotal =
    totals.reduce(
      (
        sum,
        value,
      ) =>
        sum +
        value,
      0,
    ) /
    totals.length;

  if (
    context.overPick.includes(
      "大",
    ) ||
    /over/i.test(
      context.overPick,
    )
  ) {
    const allUnderOrEqual =
      totals.every(
        (total) =>
          total <=
          context.overLine!,
      );

    return (
      allUnderOrEqual &&
      avgTotal <=
        context.overLine -
          0.75
    );
  }

  if (
    context.overPick.includes(
      "小",
    ) ||
    /under/i.test(
      context.overPick,
    )
  ) {
    const allOverOrEqual =
      totals.every(
        (total) =>
          total >=
          context.overLine!,
      );

    return (
      allOverOrEqual &&
      avgTotal >=
        context.overLine +
          0.75
    );
  }

  return false;
}

function predictedScoresNeedRepair(
  analysis: any,
  sourceData: any,
) {
  const rawScores =
    Array.isArray(
      analysis
        ?.predicted_scores,
    )
      ? analysis
          .predicted_scores
      : [];

  if (
    rawScores.length !==
      3
  ) {
    return true;
  }

  const parsed =
    rawScores.map(
      (item: any) =>
        parseHabaoExactScore(
          item?.score,
        ),
    );

  if (
    parsed.some(
      (score) =>
        !score,
    )
  ) {
    return true;
  }

  const validScores =
    parsed as Array<{
      home: number;
      away: number;
    }>;

  const unique =
    new Set(
      validScores.map(
        (score) =>
          `${score.home}-${score.away}`,
      ),
    );

  if (
    unique.size !== 3
  ) {
    return true;
  }

  const context =
    getHabaoScoreContext(
      analysis,
      sourceData,
    );

  /*
    不再檢查 moneyline / BTTS / handicap 一致性。
    只在三組比分全部與大小球出現「極端矛盾」時修正。
  */
  return (
    habaoHasExtremeOverUnderConflict(
      validScores,
      context,
    )
  );
}

function ensureHabaoPredictedScores(
  analysis: any,
  sourceData: any,
) {
  if (
    !analysis ||
    typeof analysis !==
      "object"
  ) {
    return analysis;
  }

  if (
    !predictedScoresNeedRepair(
      analysis,
      sourceData,
    )
  ) {
    return analysis;
  }

  const original =
    Array.isArray(
      analysis
        ?.predicted_scores,
    )
      ? analysis
          .predicted_scores
      : [];

  const confidencePool =
    original
      .map(
        (item: any) =>
          Number(
            item
              ?.confidence,
          ),
      )
      .filter(
        (value: number) =>
          Number.isFinite(
            value,
          ),
      )
      .map(
        (value: number) =>
          Math.max(
            0,
            Math.min(
              100,
              Math.round(
                value,
              ),
            ),
          ),
      )
      .sort(
        (
          a: number,
          b: number,
        ) =>
          b - a,
      );

  while (
    confidencePool.length <
      3
  ) {
    confidencePool.push(
      [
        52,
        46,
        40,
      ][
        confidencePool
          .length
      ],
    );
  }

  const repaired =
    buildHabaoConsistentScores(
      analysis,
      sourceData,
    );

  analysis.predicted_scores =
    repaired.map(
      (
        item,
        index,
      ) => ({
        score:
          `${item.home}-${item.away}`,

        confidence:
          confidencePool[
            index
          ],
      }),
    );

  console.log(
    "PREDICTED SCORES REPAIRED:",
    {
      fixture_id:
        sourceData
          ?.fixture
          ?.id,

      reason:
        "invalid_duplicate_or_extreme_ou_conflict",

      before:
        original,

      after:
        analysis
          .predicted_scores,
    },
  );

  return analysis;
}

  // ==================================================
// HABAO｜讓分 / 大小球最終只能使用 The Odds API 真實可下注盤
// ==================================================

function habaoParseAsianLine(value: any) {
  // 支援含市場方向的亞洲四分之一盤：
  // 「大 2/2.5」= 2.25、「主隊 -0.5/-1」= -0.75。
  // 舊程式會因第一段含中文而回退成首個數字，造成盤口誤判。
  const raw = String(value ?? "")
    .trim()
    .replace(/[−–－]/g, "-")
    .replace(/＋/g, "+");
  if (!raw) return null;

  const numberPattern = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)/;
  const parsePart = (text: string) => {
    const found = String(text).match(numberPattern);
    if (!found) return null;
    const num = Number(found[0]);
    return Number.isFinite(num) ? num : null;
  };

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length !== 2) return null;
    const first = parsePart(parts[0]);
    let second = parsePart(parts[1]);
    if (first === null || second === null) return null;
    // 第一段為負，第二段省略符號時，沿用第一段負號。
    if (first < 0 && !/^[\s]*[+-]/.test(parts[1])) second = -Math.abs(second);
    // 亞洲四分之一盤上下半盤相差 0.5，不接受不合理的斜線字串。
    if (Math.abs(first - second) > 0.500001) return null;
    if (first * second < 0) return null;
    return Number(((first + second) / 2).toFixed(2));
  }
  return parsePart(raw);
}


// HABAO football Poisson/Asian-market research audit — uncalibrated, NEVER changes official picks.
function habaoFootballResearchAudit(analysis: any, sourceData: any) {
  const safe = (x: unknown): number | null => {
    if (x === null || x === undefined || typeof x === "boolean" || String(x).trim() === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const data = {home:sourceData?.home_recent_metrics || {}, away:sourceData?.away_recent_metrics || {}};
  const hm = data.home, am = data.away;
  const market = sourceData?.market_odds;
  const rows = (name: string): any[] => Array.isArray(market?.[name]) ? market[name] : [];
  const rec = analysis?.recommendations || {};
  const core: any = {
    version: "habao-football-poisson-research-v1.1",
    research_only: true,
    affects_official_pick: false,
    status: "insufficient_data",
    warning: "近期攻守平均進球的簡化 Poisson 尚未校準，不是正式預測引擎，也不能據此推斷實際命中率",
    sample: {home: safe(hm.matches), away: safe(am.matches)},
    market_quality: {
      event_matched: market?.ok === true,
      bookmakers: Array.isArray(market?.bookmakers) ? market.bookmakers.length : 0,
      totals_quotes: rows("totals").length,
      handicap_quotes: rows("handicap").length,
    },
    formal_recommendations: {
      moneyline: {pick:rec?.moneyline?.pick ?? null},
      handicap: {pick:rec?.handicap?.pick ?? null, line:rec?.handicap?.line ?? null, signal_level:rec?.handicap?.signal_level ?? null},
      over_under: {pick:rec?.over_under?.pick ?? null, line:rec?.over_under?.line ?? null, signal_level:rec?.over_under?.signal_level ?? null},
      btts: {pick:rec?.btts?.pick ?? null},
    },
  };
  const hs=safe(hm.avg_goals_for), hc=safe(hm.avg_goals_against), as=safe(am.avg_goals_for), ac=safe(am.avg_goals_against);
  if ((safe(hm.matches) ?? 0) < 3 || (safe(am.matches) ?? 0) < 3 ||
      [hs,hc,as,ac].some(x=>x===null || x < 0 || x > 8)) return core;
  const lh=Math.max(.1,Math.min(4.5,(hs!+ac!)/2));
  const la=Math.max(.1,Math.min(4.5,(as!+hc!)/2));
  const pList=(l:number):number[]=>{
    const r=[Math.exp(-l)]; for(let i=1;i<=18;i++) r.push(r[i-1]*l/i);
    return r;
  };
  const ph=pList(lh), pa=pList(la);
  const matrix: Array<{h:number;a:number;p:number}> = [];
  let totalMass=0, home=0, draw=0, away=0, btts=0;
  for(let h=0;h<ph.length;h++) for(let a=0;a<pa.length;a++){
    const p=ph[h]*pa[a]; matrix.push({h,a,p}); totalMass+=p;
    if(h>a)home+=p; else if(h<a)away+=p; else draw+=p;
    if(h&&a)btts+=p;
  }
  // Truncation mass must be nearly complete. Never quietly normalize obviously truncated data.
  if(totalMass<.99999) return core;
  const round5=(v:number)=>Number(v.toFixed(5));
  const settle=(diff:number, odds:number):number=>diff>1e-9?odds-1:diff < -1e-9?-1:0;
  const asianProfit=(diffAtLine:(line:number)=>number,line:number,odds:number):number|null=>{
    const q=Math.round(line*4);
    if (Math.abs(line*4-q)>1e-8) return null;
    return q%2!==0 ? (settle(diffAtLine(line-.25),odds)+settle(diffAtLine(line+.25),odds))/2 : settle(diffAtLine(line),odds);
  };
  const marketValue=(type:'handicap'|'over_under')=>{
    const entry=rec?.[type];
    const pick=String(entry?.pick ?? "");
    if(!market?.ok || !pick || pick.includes('暫不推薦') || entry?.market_source!=='the_odds_api') return null;
    const line=safe(entry?.line),odds=safe(entry?.market_odds);
    if(line===null||odds===null||odds<=1.01||odds>50) return null;
    if(type==='over_under' && (line<0||line>15))return null;
    if(type==='handicap' && Math.abs(line)>15)return null;
    const side=type==='over_under' ? (/^大|over/i.test(pick)?'over':/^小|under/i.test(pick)?'under':null)
      : (/^主|home/i.test(pick)?'home':/^客|away/i.test(pick)?'away':null);
    if(!side) return null;
    let ev=0;
    for (const s of matrix){
      const net=asianProfit(l=>type==='over_under' ? (side==='over'?s.h+s.a-l:l-s.h-s.a)
        : (side==='home'?s.h-s.a+l:s.a-s.h+l),line,odds);
      if(net===null)return null;
      ev+=s.p*net;
    }
    return {market: type, selection: side, asian_line: line, decimal_odds: odds,
      expected_return_per_unit:round5(ev/totalMass), research_only:true};
  };
  return {...core, status:'estimated_uncalibrated',
    poisson_goals:{home:round5(lh),away:round5(la)},
    probabilities: {home_win:round5(home/totalMass), draw:round5(draw/totalMass),
      away_win:round5(away/totalMass), btts_yes:round5(btts/totalMass), btts_no:round5(1-btts/totalMass)},
    selected_market_ev_research: {handicap:marketValue('handicap'),over_under:marketValue('over_under')},
  };
}

function habaoLockToRealOddsMarket(
  analysis: any,
  sourceData: any
) {
  const rec =
    analysis?.recommendations;

  const market =
    sourceData?.market_odds;

  if (!rec) return analysis;
  if (!market || market?.ok === false) {
    console.log("HABAO_FOOTBALL_MARKET_RESOLUTION", JSON.stringify({
      fixture_id: sourceData?.fixture?.id || null,
      odds_event_matched: false,
      totals_quotes: 0,
      handicap_quotes: 0,
      reason: "real_market_unavailable",
    }));
    // 沒有 The Odds API 真盤：可以顯示模型原始方向，但禁止假裝有可驗證盤線。
    for (const [key,direction] of [["handicap", "handicap"],["over_under", "total"]] as const) {
      const row=rec[key];
      if(!row) continue;
      const raw=String(row.pick||"");
      const side=direction==="total" ?
        (/大|over/i.test(raw)?"大":/小|under/i.test(raw)?"小":"暫不推薦") :
        (/主|home/i.test(raw)?"主隊":/客|away/i.test(raw)?"客隊":"暫不推薦");
      row.display_pick=side;
      row.display_line=null;
      row.signal_level="no_market";
      row.pick="暫不推薦";
      row.line=null;
    }
    return analysis;
  }

  // 最多只允許模型盤與市場盤相差 0.5 球
  // 超過 0.5 球代表模型原盤與實盤相差較大，只顯示模型方向，不算正式可驗證推薦。
  const MAX_DISTANCE = 0.5;

  const closestRow = (
    rows: any[],
    wanted: number
  ) => {
    return rows
      .map((row) => ({
        row,
        line: habaoParseAsianLine(row?.line),
      }))
      .filter((x) => x.line !== null)
      .sort(
        (a, b) =>
          Math.abs(Number(a.line) - wanted) -
          Math.abs(Number(b.line) - wanted)
      )[0] || null;
  };


  // ==============================
  // 大小球
  // ==============================

  const ou =
    rec?.over_under;

  if (
    ou &&
    !String(ou?.pick || "")
      .includes("暫不推薦")
  ) {
    const pickText =
      String(ou?.pick || "")
        .toLowerCase();

    const side =
      pickText.includes("大") ||
      pickText.includes("over")
        ? "over"
        : pickText.includes("小") ||
          pickText.includes("under")
          ? "under"
          : "";

    // AI 可能只輸出「大／小」而未附盤口；此時使用本場已確認的真實主盤，
    // 不自行創造盤口，也不改變 AI 大小球方向。
    const wanted =
      habaoParseAsianLine(ou?.line) ??
      habaoParseAsianLine(ou?.pick) ??
      habaoParseAsianLine(sourceData?.main_over_under_line);

    const rows =
      (
        Array.isArray(market?.totals)
          ? market.totals
          : []
      ).filter((row: any) => {
        const raw =
          `${row?.side || ""} ${row?.selection || ""} ${row?.name || ""}`
            .toLowerCase();

        if (side === "over") {
          return (
            raw.includes("over") ||
            raw.includes("大")
          );
        }

        if (side === "under") {
          return (
            raw.includes("under") ||
            raw.includes("小")
          );
        }

        return false;
      });

    const matched =
      wanted !== null
        ? closestRow(rows, wanted)
        : null;

    if (
      !matched ||
      Math.abs(
        Number(matched.line) -
        Number(wanted)
      ) > MAX_DISTANCE
    ) {
      ou.display_pick = side === "over" ? "大" : side === "under" ? "小" : "暫不推薦";
      ou.display_line = matched?.line ?? null;
      ou.signal_level = matched ? "low_advantage" : "no_market";
      ou.pick = "暫不推薦";
      ou.line = null;
    } else {
      // 最終 line 一定來自 The Odds API 真實盤
      ou.pick =
        side === "over"
          ? "大"
          : "小";

      ou.line =
        Number(matched.line);

      ou.market_odds =
        Number(
          matched.row?.odds
        ) || null;

      ou.market_source = "the_odds_api";
      ou.display_pick = ou.pick;
      ou.display_line = ou.line;
      ou.signal_level = "qualified";
    }
  }


  // ==============================
  // 亞洲讓分
  // ==============================

  const handicap =
    rec?.handicap;

  if (
    handicap &&
    !String(handicap?.pick || "")
      .includes("暫不推薦")
  ) {
    const pickText =
      String(
        handicap?.pick || ""
      ).toLowerCase();

    const side =
      pickText.includes("主") ||
      pickText.includes("home")
        ? "home"
        : pickText.includes("客") ||
          pickText.includes("away")
          ? "away"
          : "";

    // AI 若把盤線寫在 pick 而省略 line，僅解析文字內已有的數值；
    // 實際正式盤仍必須由市場清單匹配通過，不允許虛構。
    const wanted =
      habaoParseAsianLine(handicap?.line) ??
      habaoParseAsianLine(handicap?.pick);

    const homeName =
      String(
        sourceData
          ?.fixture
          ?.home
          ?.name || ""
      ).toLowerCase();

    const awayName =
      String(
        sourceData
          ?.fixture
          ?.away
          ?.name || ""
      ).toLowerCase();

    const rows =
      (
        Array.isArray(
          market?.handicap
        )
          ? market.handicap
          : []
      ).filter((row: any) => {
        const selection =
          String(
            row?.selection || ""
          )
            .trim()
            .toLowerCase();

        const name =
          String(
            row?.name || ""
          ).toLowerCase();

        if (side === "home") {
          return (
            selection === "1" ||
            selection === "home" ||
            (
              homeName &&
              name.includes(homeName)
            )
          );
        }

        if (side === "away") {
          return (
            selection === "2" ||
            selection === "away" ||
            (
              awayName &&
              name.includes(awayName)
            )
          );
        }

        return false;
      });

    const matched =
      wanted !== null
        ? closestRow(
            rows,
            wanted
          )
        : null;

    if (
      !matched ||
      Math.abs(
        Number(matched.line) -
        Number(wanted)
      ) > MAX_DISTANCE
    ) {
      handicap.display_pick = side === "home" ? "主隊" : side === "away" ? "客隊" : "暫不推薦";
      handicap.display_line = matched?.line ?? null;
      handicap.signal_level = matched ? "low_advantage" : "no_market";
      handicap.pick = "暫不推薦";
      handicap.line = null;
    } else {
      // 最終 line 一定來自 The Odds API 真實盤
      handicap.line =
        Number(
          matched.line
        );

      handicap.market_odds =
        Number(
          matched.row?.odds
        ) || null;

      handicap.market_source = "the_odds_api";
      handicap.display_pick = handicap.pick;
      handicap.display_line = handicap.line;
      handicap.signal_level = "qualified";
    }
  }

  // 沒有對應市場（或原始 AI 為暫不推薦）時，保留模型方向供前台參考；
  // 但僅真實市場上的 qualified pick 可進入正式戰績。
  for (const [k,marketRows] of [["handicap",market?.handicap],["over_under",market?.totals]] as const) {
    const row=rec?.[k];
    if (!row) continue;
    if (row.display_pick != null) continue;
    if (!Array.isArray(marketRows) || marketRows.length===0) {
      const raw=String(row.pick || "");
      row.display_pick=k==="handicap" ?
        (/主|home/i.test(raw)?"主隊":/客|away/i.test(raw)?"客隊":"暫不推薦") :
        (/大|over/i.test(raw)?"大":/小|under/i.test(raw)?"小":"暫不推薦");
      row.display_line=null;
      row.signal_level="no_market";
      row.pick="暫不推薦";
      row.line=null;
    }
  }
  // 僅輸出市場覆蓋與推薦轉換摘要，不記錄密鑰及完整原始賠率。
  console.log("HABAO_FOOTBALL_MARKET_RESOLUTION", JSON.stringify({
    fixture_id: sourceData?.fixture?.id || null,
    odds_event_matched: Boolean(market?.ok),
    totals_quotes: Array.isArray(market?.totals) ? market.totals.length : 0,
    handicap_quotes: Array.isArray(market?.handicap) ? market.handicap.length : 0,
    totals_signal: rec?.over_under?.signal_level || null,
    handicap_signal: rec?.handicap?.signal_level || null,
    totals_pick: rec?.over_under?.pick || null,
    handicap_pick: rec?.handicap?.pick || null,
  }));
  return analysis;
}

    let analysis;



    try {

      analysis =

        JSON.parse(outputText);

    // V2 recommendations were calculated from Poisson probabilities above.
    // Preserve them as the official result; V1 market rewriting is not applied.

    // ===== 前台文字統一清洗 =====

analysis.summary = cleanPublicText(analysis.summary);

analysis.home_form = cleanPublicText(analysis.home_form);

analysis.away_form = cleanPublicText(analysis.away_form);

analysis.h2h_analysis = cleanPublicText(analysis.h2h_analysis);

analysis.goal_analysis = cleanPublicText(analysis.goal_analysis);

analysis.market_analysis = cleanPublicText(analysis.market_analysis);

analysis.final_note = cleanPublicText(analysis.final_note);



// 四個正式推薦原因

if (analysis.recommendations) {

  if (analysis.recommendations.moneyline) {

    analysis.recommendations.moneyline.reason =

      cleanPublicText(analysis.recommendations.moneyline.reason);

  }



  if (analysis.recommendations.over_under) {

    analysis.recommendations.over_under.reason =

      cleanPublicText(analysis.recommendations.over_under.reason);

  }



  if (analysis.recommendations.btts) {

    analysis.recommendations.btts.reason =

      cleanPublicText(analysis.recommendations.btts.reason);

  }



  if (analysis.recommendations.handicap) {

    analysis.recommendations.handicap.reason =

      cleanPublicText(analysis.recommendations.handicap.reason);

  }



  // 雙重機會已從正式產品移除。
  // 若模型仍回傳舊欄位，後端直接刪除。
  if ("double_chance" in analysis.recommendations) {

    delete analysis.recommendations.double_chance;

  }

}



// ===== 精確比分合理性檢查 =====
// 真實資料優先；大小分為高權重參考。
// moneyline / BTTS / handicap 不作硬性限制。
// 只有比分無效、重複，或三組全部與大小球出現極端矛盾時才修正。
// V2 scores and probability metadata are produced directly by the active model.



}catch {

      console.error(

        "V2 analysis output:",

        outputText

      );



      throw new Error(

        "AI 回傳格式不是有效 JSON"

      );

    }



    const responseAnalysis =

      await translateAnalysisToEnglish(

        analysis

      );



    // ==========================================

    // 8. 回傳給網站

    // ==========================================

// ========================================

// 寫入賽事分析快取

// ========================================

const cacheExpiresAt = new Date();

cacheExpiresAt.setHours(cacheExpiresAt.getHours() + 6);



const cacheUpdateRes = await fetch(

  `${SUPABASE_URL}/rest/v1/match_analysis_cache?fixture_id=eq.${fixtureId}`,

  {

    method: "PATCH",

    headers: {

      "apikey": SERVICE_ROLE_KEY,

      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,

      "Content-Type": "application/json",

      "Prefer": "return=minimal",

    },

    body: JSON.stringify({

      status: "ready",

      analysis: {

        success: true,

        fixture: sourceData.fixture,

        data_available: {

          team_statistics: Boolean(

            homeStatsData?.response ||

            awayStatsData?.response

          ),

          head_to_head: h2h.length > 0,

          odds: odds.length > 0,

        },

        analysis,

        translations:

          responseLanguage === "en"

            ? {

                en: responseAnalysis,

              }

            : {},

      },

      expires_at: cacheExpiresAt.toISOString(),

    }),

  }

);



if (!cacheUpdateRes.ok) {

  console.error(

    "MATCH ANALYSIS CACHE UPDATE ERROR:",

    await cacheUpdateRes.text()

  );

} else {

  console.log(

    "MATCH ANALYSIS CACHE READY:",

    fixtureId

  );

}



// ==================================================

// AI 正式賽前預測快照

// 同一 fixture_id 只允許保存第一份，不覆蓋

// ==================================================

try {

  const kickoffAt = sourceData?.fixture?.date

    ? new Date(sourceData.fixture.date)

    : null;



  const now = new Date();



  // ================================================
  // HABAO｜唯一正式版本建立規則
  //
  // 系統 runner 進入 T-10h 後自動建立。
  // 如果剛進入 T-10h、runner 尚未跑到，
  // 第一位會員的分析也可直接鎖成同一份正式版本。
  // on_conflict=fixture_id 保證同場只保留第一份。
  // ================================================
  const officialAnalysisWindowMs =
    10 * 60 * 60 * 1000;

  const msUntilKickoff =
    kickoffAt &&
    !Number.isNaN(
      kickoffAt.getTime(),
    )
      ? kickoffAt.getTime() -
        now.getTime()
      : NaN;

  const insideOfficialWindow =
    Number.isFinite(
      msUntilKickoff,
    ) &&
    msUntilKickoff > 0 &&
    msUntilKickoff <=
      officialAnalysisWindowMs;

  if (
    (internalPublic ||
      insideOfficialWindow) &&
    kickoffAt &&
    !Number.isNaN(kickoffAt.getTime()) &&
    now.getTime() < kickoffAt.getTime()
  ) {

    const snapshotRes = await fetch(

      `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?on_conflict=fixture_id`,

      {

        method: "POST",

        headers: {

          "apikey": SERVICE_ROLE_KEY,

          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,

          "Content-Type": "application/json",

          "Prefer": "resolution=merge-duplicates,return=minimal",

        },

        body: JSON.stringify({

          fixture_id: Number(fixtureId),

          kickoff_at: kickoffAt.toISOString(),

          league_name:

  sourceData?.fixture?.league?.name ??
  sourceData?.fixture?.league?.api_name ??
  null,



home_team:

  sourceData?.fixture?.home?.name ?? null,



away_team:

  sourceData?.fixture?.away?.name ?? null,

          prediction: analysis,

          status: "pending",

        }),

      }

    );



    if (!snapshotRes.ok) {

      console.error(

        "AI PREDICTION SNAPSHOT ERROR:",

        await snapshotRes.text()

      );

    } else {

      console.log(

        "AI PREDICTION SNAPSHOT READY:",

        fixtureId

      );

    }

  } else if (internalPublic) {

    console.log(

      "AI PREDICTION SNAPSHOT SKIPPED - MATCH STARTED:",

      fixtureId

    );

  } else {

    console.log(

      "AI PREDICTION SNAPSHOT SKIPPED - OUTSIDE T10 WINDOW:",

      fixtureId

    );

  }

} catch (snapshotError) {

  console.error(

    "AI PREDICTION SNAPSHOT EXCEPTION:",

    snapshotError

  );

}



    return new Response(

      JSON.stringify({

        success: true,

        language:
          responseLanguage,

        internal_public: internalPublic,



remaining_credits:

  analysisUnlimited

    ? null

    : remainingCredits,



remaining_daily_credits:

  analysisUnlimited

    ? null

    : remainingDailyCredits,



remaining_paid_credits:

  analysisUnlimited

    ? null

    : remainingPaidCredits,



        fixture: sourceData.fixture,



        data_available: {

          team_statistics:

            Boolean(

              homeStatsData?.response ||

              awayStatsData?.response

            ),



          head_to_head:

            h2h.length > 0,



          odds:

            odds.length > 0,

        },



        analysis:

          responseAnalysis,

      }),

      {

        status: 200,



        headers: {

          ...corsHeaders,

          "Content-Type":

            "application/json",

        },

      }

    );



  } catch (error) {



  console.error(error);



  const errorMessage =

    error instanceof Error

      ? error.message

      : String(error);



// ==============================

// AI 分析失敗：退回會員 AI 次數

// ==============================

if (

  creditShouldRefund &&

  requestAccount &&

  consumedCreditType

) {

  try {

    const creditRefundRes = await fetch(

      `${supabaseUrl}/rest/v1/rpc/refund_member_analysis_credit`,

      {

        method: "POST",

        headers: {

          "apikey": serviceRoleKey,

          "Authorization":

            `Bearer ${serviceRoleKey}`,

          "Content-Type":

            "application/json",

        },

        body: JSON.stringify({

          p_account: requestAccount,

          p_credit_type:

            consumedCreditType,

        }),

      }

    );



    if (!creditRefundRes.ok) {

      console.error(

        "MEMBER CREDIT REFUND ERROR:",

        await creditRefundRes.text()

      );

    } else {

      console.log(

"MEMBER CREDIT REFUNDED:",

requestAccount,

consumedCreditType

      );

    }

  } catch (creditRefundError) {

    console.error(

      "MEMBER CREDIT REFUND EXCEPTION:",

      creditRefundError

    );

  }

}



if (

  quotaShouldRefund &&

  quotaAccount &&

  quotaFixtureId > 0

) {try {

    const refundDate = new Date(

      new Date().toLocaleString("en-US", {

        timeZone: "Asia/Taipei",

      })

    );



    const usageDate =

      refundDate.getFullYear() +

      "-" +

      String(refundDate.getMonth() + 1).padStart(2, "0") +

      "-" +

      String(refundDate.getDate()).padStart(2, "0");



    const refundRes = await fetch(

      `${supabaseUrl}/rest/v1/analysis_usage` +

        `?account=eq.${encodeURIComponent(quotaAccount)}` +

        `&fixture_id=eq.${quotaFixtureId}` +

        `&usage_date=eq.${usageDate}`,

      {

        method: "DELETE",

        headers: {

          "apikey": serviceRoleKey,

          "Authorization": `Bearer ${serviceRoleKey}`,

          "Content-Type": "application/json",

          "Prefer": "return=minimal",

        },

      }

    );



    if (!refundRes.ok) {

      console.error(

        "ANALYSIS QUOTA REFUND ERROR:",

        await refundRes.text()

      );

    } else {

      console.log(

        "ANALYSIS QUOTA REFUNDED:",

        quotaAccount,

        quotaFixtureId

      );

    }

  } catch (refundError) {

    console.error(

      "ANALYSIS QUOTA REFUND EXCEPTION:",

      refundError

    );

  }

}



// ==============================

// 分析失敗：清除本次取得的 processing Lock

// ==============================

if (

  lockAcquired &&

  supabaseUrl &&

  serviceRoleKey &&

  lockFixtureId > 0

) {

  try {

    const lockCleanupRes = await fetch(

      `${supabaseUrl}/rest/v1/match_analysis_cache` +

      `?fixture_id=eq.${lockFixtureId}` +

      `&status=eq.processing`,

      {

        method: "DELETE",

        headers: {

          "apikey": serviceRoleKey,

          "Authorization": `Bearer ${serviceRoleKey}`,

          "Content-Type": "application/json",

          "Prefer": "return=minimal",

        },

      }

    );



    if (!lockCleanupRes.ok) {

      console.error(

        "MATCH ANALYSIS LOCK CLEANUP ERROR:",

        await lockCleanupRes.text()

      );

    } else {

console.log(

  "MATCH ANALYSIS LOCK CLEANED:",

  lockFixtureId

);

    }

  } catch (lockCleanupError) {

    console.error(

      "MATCH ANALYSIS LOCK CLEANUP EXCEPTION:",

      lockCleanupError

    );

  }

}



if (errorMessage === "MATCH_ANALYSIS_PROCESSING") {

  return new Response(

    JSON.stringify({

      success: false,

      processing: true,

      message: "此賽事正在分析中，請稍後再試",

    }),

    {

      status: 202,

      headers: {

        ...corsHeaders,

        "Content-Type": "application/json",

      },

    }

  );

}



if (errorMessage === "ANALYSIS_CREDITS_EMPTY") {

  return new Response(

    JSON.stringify({

      success: false,

      error: "analysis_credits_empty",

      message: "您的 AI 分析次數已用完，請聯絡客服。",

      remaining: 0,

    }),

    {

      status: 429,

      headers: {

        ...corsHeaders,

        "Content-Type": "application/json",

      },

    }

  );

}



  if (errorMessage === "API_FOOTBALL_DAILY_LIMIT") {

    return new Response(

      JSON.stringify({

        success: false,

        error: "api_football_daily_limit",

        message: "今日賽事資料查詢額度已用完，請稍後再試。",

      }),

      {

        status: 503,

        headers: {

          ...corsHeaders,

          "Content-Type": "application/json",

        },

      }

    );

  }



  return new Response(

    JSON.stringify({

      success: false,

      error: "system_error",

      message: "系統暫時無法完成賽事分析，請稍後再試。",

    }),

    {

      status: 500,

      headers: {

        ...corsHeaders,

        "Content-Type": "application/json",

      },

    }

  );

}

});