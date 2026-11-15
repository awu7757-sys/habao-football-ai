import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getSecretKey() {
  const legacy =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (legacy) return legacy;

  const raw =
    Deno.env.get("SUPABASE_SECRET_KEYS");

  if (!raw) return "";

  try {
    const keys = JSON.parse(raw);
    return String(keys?.default || "");
  } catch {
    return "";
  }
}

const SUPABASE_URL =
  String(Deno.env.get("SUPABASE_URL") || "").trim();

const SECRET_KEY =
  getSecretKey();

let supabaseAdmin:
  ReturnType<typeof createClient> |
  null = null;

function requireSupabaseAdmin() {
  if (!SUPABASE_URL || !SECRET_KEY) {
    throw new Error("SUPABASE_ADMIN_ENV_MISSING");
  }

  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      SUPABASE_URL,
      SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return supabaseAdmin;
}

function isBackendRequest(req: Request) {
  if (!SECRET_KEY) return false;

  const apikey =
    String(req.headers.get("apikey") || "").trim();

  const authorization =
    String(req.headers.get("authorization") || "").trim();

  if (apikey && apikey === SECRET_KEY) {
    return true;
  }

  if (
    !SECRET_KEY.startsWith("sb_secret_") &&
    authorization === `Bearer ${SECRET_KEY}`
  ) {
    return true;
  }

  return false;
}


function backendHeaders() {
  const headers:
    Record<string, string> = {
      "Content-Type":
        "application/json",
      apikey:
        SECRET_KEY,
    };

  if (
    SECRET_KEY &&
    !SECRET_KEY.startsWith(
      "sb_secret_",
    )
  ) {
    headers.Authorization =
      `Bearer ${SECRET_KEY}`;
  }

  return headers;
}

async function loadMarketContext(
  fixture: any,
) {
  if (
    !SUPABASE_URL ||
    !SECRET_KEY
  ) {
    return null;
  }

  try {
    const response =
      await fetch(
        `${SUPABASE_URL}/functions/v1/basketball-market-context`,
        {
          method:
            "POST",
          headers:
            backendHeaders(),
          body:
            JSON.stringify({
              action:
                "get",
              game_id:
                fixture?.game_id ||
                fixture?.fixture_id ||
                null,
              home_team:
                fixture?.home?.name ||
                "",
              away_team:
                fixture?.away?.name ||
                "",
              kickoff_at:
                fixture?.date ||
                null,
            }),
        },
      );

    const data =
      await response
        .json()
        .catch(
          () => null,
        );

    if (
      !response.ok ||
      data?.success !==
        true
    ) {
      console.warn(
        "NBA MARKET CONTEXT UNAVAILABLE:",
        response.status,
        data,
      );

      return null;
    }

    return data;
  } catch (
    error
  ) {
    console.warn(
      "NBA MARKET CONTEXT ERROR:",
      error,
    );

    return null;
  }
}

function applyInjuryConfidence(
  model: any,
  injuryContext: any,
) {
  const home =
    injuryContext?.home
      ?.summary || {};

  const away =
    injuryContext?.away
      ?.summary || {};

  const totalOut =
    Number(
      home?.out || 0,
    ) +
    Number(
      away?.out || 0,
    );

  const totalDayToDay =
    Number(
      home?.day_to_day || 0,
    ) +
    Number(
      away?.day_to_day || 0,
    );

  /*
    傷病資料目前用於「不確定性修正」：
    不直接把每位球員硬換算成分數，避免把角色球員與明星球員當成相同影響。
    先降低信心，待球員價值模型完成後再進一步調整比分 / 勝率。
  */
  const penalty =
    Math.min(
      8,
      Math.round(
        totalOut * 1.2 +
        totalDayToDay * 1.8,
      ),
    );

  return {
    ...model,
    confidence:
      Math.max(
        45,
        Number(
          model?.confidence ||
          0,
        ) -
        penalty,
      ),
    injury_context: {
      available:
        injuryContext
          ?.available ===
        true,
      confidence_penalty:
        penalty,
      home:
        home,
      away:
        away,
    },
  };
}

function roundRecommendationConfidence(
  value: number,
) {
  return Math.round(
    Math.max(
      0,
      Math.min(
        82,
        value,
      ),
    ),
  );
}


// HABAO｜NBA 整季統計快取；服務端持久化，不靠 Deno warm instance。
async function nbaCachedStatistics(path:string, apiKey:string) {
  const db=requireSupabaseAdmin();
  const cacheKey=`nba:statistics:${path}`;
  try {
    const {data,error}=await db.from("habao_api_response_cache")
      .select("response_data").eq("cache_key",cacheKey)
      .gt("expires_at",new Date().toISOString()).maybeSingle();
    if(!error && data?.response_data) return data.response_data;
  } catch (err) {console.warn("NBA_STAT_CACHE_READ",String(err));}
  const response=await nbaApi(path,apiKey);
  try {
    if(response && Array.isArray(response?.body?.response) && response.body.response.length) {
      const {error}=await db.from("habao_api_response_cache").upsert({
        cache_key:cacheKey,response_data:response,
        expires_at:new Date(Date.now()+12*3600000).toISOString(),
        updated_at:new Date().toISOString(),
      },{onConflict:"cache_key"});
      if(error)console.warn("NBA_STAT_CACHE_WRITE",error.message);
    }
  } catch(err) {console.warn("NBA_STAT_CACHE_WRITE_ERROR",String(err));}
  return response;
}

async function nbaOfficialSnapshot(gameId:number){
  const {data,error}=await requireSupabaseAdmin()
    .from("basketball_prediction_snapshots").select("game_id,prediction_data,source,generated_at,fixture_time")
    .eq("game_id",gameId).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function nbaRestoreSnapshotFromReadyCache(gameId:number, cache:any) {
  // 快取必須是原本系統自動產生，不能把會員臨時資料當成正式版。
  const fixture=cache?.analysis_data?.fixture||{};
  const kickoff=new Date(fixture.date||"").getTime();
  const generated=new Date(cache?.generated_at||"").getTime();
  const msToKickoff=kickoff-Date.now();
  const ageAtGeneration=kickoff-generated;
  if(cache?.source!=="t10_auto" || !cache?.analysis_data || !Number.isFinite(kickoff) ||
    !Number.isFinite(generated) || msToKickoff<=0 || msToKickoff>10*3600000 ||
    ageAtGeneration<=0 || ageAtGeneration>10*3600000) return false;
  const snapshotRow={game_id:gameId,fixture_time:fixture.date,home_team:fixture?.home?.name||null,
    away_team:fixture?.away?.name||null,model_version:cache.model_version||null,
    prediction_data:cache.analysis_data,generated_at:cache.generated_at,source:"t10_auto"};
  const {error}=await requireSupabaseAdmin().from("basketball_prediction_snapshots")
    .upsert(snapshotRow,{onConflict:"game_id",ignoreDuplicates:true});
  if(error)throw error;
  return Boolean(await nbaOfficialSnapshot(gameId));
}


// HABAO value/probability audit v1.1 — RESEARCH ONLY, NEVER selects the official pick.
// Probability / EV must not be interpreted as validated until retrospective calibration.
function habaoNbaResearchAudit(model: any, market: any, narrative: any) {
  const num = (x: unknown): number | null => {
    if (x === null || x === undefined || typeof x === "boolean" || String(x).trim() === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const price = (x: unknown): number | null => {
    const n = num(x);
    return n !== null && n > 1.01 && n <= 100 ? n : null;
  };
  const prob = (x: unknown): number | null => {
    const n = num(x);
    return n !== null && n >= 0 && n <= 100 ? n / 100 : null;
  };
  const decimal5 = (n: number): number => Number(n.toFixed(5));
  const primary = market?.primary || {};
  const consensus = market?.consensus || {};
  const available = market?.available === true;
  // Market context retains American odds for legacy consumers and exposes
  // *_decimal explicitly. Use decimal pairs only for research probability/EV.
  const fromAmerican = (x: unknown): number | null => {
    const n = num(x);
    if (n === null || Math.abs(n) < 100) return null;
    return price(n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n));
  };
  const decimalOdds = (source: any, key: string) =>
    price(source?.[`${key}_decimal`]) ??
    (String(source?.odds_format || market?.odds_format || "").toLowerCase() === "american"
      ? fromAmerican(source?.[key]) : price(source?.[key]));
  const primaryPair = [decimalOdds(primary,"home_moneyline"), decimalOdds(primary,"away_moneyline")];
  const consensusPair = [decimalOdds(consensus,"home_moneyline"), decimalOdds(consensus,"away_moneyline")];
  const usePrimary = primaryPair.every(x => x !== null);
  const useConsensus = consensusPair.every(x => x !== null);
  // Price must be a SAME-source home/away pair; never mix bookies.
  const pair = usePrimary ? primaryPair : useConsensus ? consensusPair : [null, null];
  const [homeOdds, awayOdds] = pair;
  const validOdds = available && homeOdds !== null && awayOdds !== null;
  const impliedSum = validOdds ? 1/homeOdds! + 1/awayOdds! : null;
  const validBook = impliedSum !== null && impliedSum >= 0.95 && impliedSum <= 1.35;
  const h = prob(model?.win_probability?.home), a = prob(model?.win_probability?.away);
  const modelReady = h !== null && a !== null && Math.abs(h+a-1) <= 0.03;
  const rec = narrative?.recommendations || {};
  const official = (key: string) => ({
    pick: rec?.[key]?.pick ?? null,
    decision_code: rec?.[key]?.decision_code ?? null,
    official_pick_is_qualified: rec?.[key]?.official_pick_is_qualified === true,
  });
  const fairTotal = num(model?.fair_total), fairSpread = num(model?.fair_spread?.home_line);
  const total = num(rec?.over_under?.display_line);
  const spH = num(primary?.home_spread), spA = num(primary?.away_spread);
  const scH = num(consensus?.home_spread), scA = num(consensus?.away_spread);
  const pairOkay = (x: number | null, y: number | null) => (x !== null || y !== null) &&
    (x === null || y === null || Math.abs(x+y) <= .01);
  const spread = pairOkay(spH,spA) && (spH === null || Math.abs(spH)<=60) && (spA===null||Math.abs(spA)<=60)
    ? (spH ?? (spA !== null ? -spA : null))
    : pairOkay(scH,scA) && (scH === null || Math.abs(scH)<=60) && (scA===null||Math.abs(scA)<=60)
      ? (scH ?? (scA !== null ? -scA : null)) : null;
  return {
    version: "habao-nba-value-research-v1.1",
    research_only: true,
    affects_official_pick: false,
    warning: "模型勝率尚未完成歷史機率校準；EV 只能做離線研究，不能用於正式推薦或收益承諾",
    price_quality: {
      market_available: available,
      moneyline_source: validBook ? (usePrimary ? "primary" : "consensus") : null,
      moneyline_pair_valid: validBook,
      overround: validBook ? decimal5(impliedSum! - 1) : null,
    },
    win_probability: modelReady ? {home:h,away:a} : null,
    market_no_vig_probability: validBook ? {
      home: decimal5((1/homeOdds!)/impliedSum!),
      away: decimal5((1/awayOdds!)/impliedSum!),
    } : null,
    moneyline_ev_per_unit: modelReady && validBook ? {
      home: decimal5(h!*homeOdds! - 1),
      away: decimal5(a!*awayOdds! - 1),
    } : null,
    // Spread and total are points-gap diagnostics ONLY; they are not a probability or EV estimate.
    spread_points_gap: available && fairSpread !== null && spread !== null && Math.abs(spread)<=60
      ? Number((spread - fairSpread).toFixed(2)) : null,
    total_points_gap: available && fairTotal !== null && total !== null && total>=120 && total<=350
      ? Number((fairTotal - total).toFixed(2)) : null,
    formal_recommendations: {
      moneyline: official("moneyline"),
      handicap: official("handicap"),
      over_under: official("over_under"),
    },
  };
}

// Research calculations must never fail the production NBA analysis.
function habaoSafeNbaResearchAudit(model: any, market: any, narrative: any) {
  try { return habaoNbaResearchAudit(model, market, narrative); }
  catch (error) {
    console.warn("HABAO_NBA_RESEARCH_AUDIT_ERROR", String(error));
    return {version:"habao-nba-value-research-v1.1",research_only:true,
      affects_official_pick:false,status:"audit_error"};
  }
}

// Diagnostic record is for debugging/coverage audits only; it never selects picks.
function nbaAnalysisDiagnostics(sourceData: any, rec: any) {
  const market = sourceData?.market_data?.market || {};
  const model = sourceData?.model || {};
  const num = (v: unknown) => {
    if (v == null || typeof v === "boolean" || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const firstValid = (values: unknown[], check: (n: number) => boolean) => {
    for (const v of values) { const n = num(v); if (n !== null && check(n)) return n; }
    return null;
  };
  const p=market?.primary || {}, c=market?.consensus || {};
  const marketReady=market?.available === true;
  const primaryHome=firstValid([p.home_spread],n=>Math.abs(n)<=60);
  const primaryAway=firstValid([p.away_spread],n=>Math.abs(n)<=60);
  const consensusHome=firstValid([c.home_spread],n=>Math.abs(n)<=60);
  const consensusAway=firstValid([c.away_spread],n=>Math.abs(n)<=60);
  const coherent=(h:number|null,a:number|null) => (h!==null||a!==null) &&
    (h===null||a===null||Math.abs(h+a)<=0.01);
  const primarySpread=coherent(primaryHome,primaryAway);
  const consensusSpread=coherent(consensusHome,consensusAway);
  const primaryTotal=firstValid([p.total],n=>n>=120&&n<=350);
  const consensusTotal=firstValid([c.total],n=>n>=120&&n<=350);
  const spreadSource=!marketReady?"unavailable":primarySpread?"primary":consensusSpread?"consensus":"missing_or_inconsistent";
  const totalSource=!marketReady?"unavailable":primaryTotal!==null?"primary":consensusTotal!==null?"consensus":"missing";
  return {
    version: "habao-nba-v1-readonly-audit-20261027",
    audit_only: true,
    affects_official_pick: false,
    confidence: num(model?.confidence),
    model_fair_spread: num(model?.fair_spread?.home_line),
    model_fair_total: num(model?.fair_total),
    home_recent_games: num(sourceData?.recent_metrics?.home?.games),
    away_recent_games: num(sourceData?.recent_metrics?.away?.games),
    regular_season_games_home: num(model?.current_regular_season_sample?.home),
    regular_season_games_away: num(model?.current_regular_season_sample?.away),
    model_uses_default_team_baseline:
      !sourceData?.recent_metrics?.home?.games || !sourceData?.recent_metrics?.away?.games,
    market_available_flag: marketReady,
    spread_source: spreadSource,
    total_source: totalSource,
    has_spread: marketReady && (primarySpread || consensusSpread),
    has_total: marketReady && (primaryTotal!==null || consensusTotal!==null),
    provider_status: sourceData?.market_data?.provider_status || null,
    reason_codes: {
      moneyline: rec?.moneyline?.decision_code || null,
      handicap: rec?.handicap?.decision_code || null,
      over_under: rec?.over_under?.decision_code || null,
    },
  };
}

function buildFixedRecommendations(
  payload: any,
) {
  const model =
    payload?.model || {};

  const market =
    payload?.market_data
      ?.market || {};

  const consensus =
    market?.consensus || {};

  // 只採用有效實數；Number(null) / Number("") = 0 不能視為真實盤線。
  const readLine = (value: unknown): number | null => {
    if (value === null || value === undefined ||
        typeof value === "boolean" || String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const spread = (value: unknown): number | null => {
    const n = readLine(value);
    return n !== null && Math.abs(n) <= 60 ? n : null;
  };
  const total = (value: unknown): number | null => {
    const n = readLine(value);
    return n !== null && n >= 120 && n <= 350 ? n : null;
  };

  // 正式推薦與 display_* 同樣優先 primary；主盤不可用才退回 consensus。
  // 同一盤商的主客讓分保持一組，避免把不同供應者的主客線拼在一起。
  const primary = market?.primary || {};
  const primaryHome = spread(primary?.home_spread);
  const primaryAway = spread(primary?.away_spread);
  const consensusHome = spread(consensus?.home_spread);
  const consensusAway = spread(consensus?.away_spread);
  const primaryTotal = total(primary?.total);
  const consensusTotal = total(consensus?.total);
  const isCoherentSpreadPair = (h: number | null, a: number | null) =>
    h === null || a === null || Math.abs(h + a) <= 0.01;
  const primaryHasSpread = (primaryHome !== null || primaryAway !== null) &&
    isCoherentSpreadPair(primaryHome, primaryAway);
  const consensusHasSpread = (consensusHome !== null || consensusAway !== null) &&
    isCoherentSpreadPair(consensusHome, consensusAway);
  const marketHomeLine = primaryHasSpread
    ? (primaryHome ?? (primaryAway !== null ? -primaryAway : null))
    : consensusHasSpread
      ? (consensusHome ?? (consensusAway !== null ? -consensusAway : null))
      : null;
  const marketAwayLine = primaryHasSpread
    ? (primaryAway ?? (primaryHome !== null ? -primaryHome : null))
    : consensusHasSpread
      ? (consensusAway ?? (consensusHome !== null ? -consensusHome : null))
      : null;
  const marketTotal = primaryTotal ?? consensusTotal;
  const spreadSource = primaryHasSpread
    ? String(primary?.title || primary?.key || "The Odds API primary")
    : consensusHasSpread ? "The Odds API 共識" : null;
  const totalSource = primaryTotal !== null
    ? String(primary?.title || primary?.key || "The Odds API primary")
    : consensusTotal !== null ? "The Odds API 共識" : null;
  const marketReady = market?.available === true;

  const homeWinProb =
    Number(
      model
        ?.win_probability
        ?.home || 0,
    );

  const awayWinProb =
    Number(
      model
        ?.win_probability
        ?.away || 0,
    );

  const modelConfidence =
    Number(
      model?.confidence ||
      0,
    );

  const strongestWinProb =
    Math.max(
      homeWinProb,
      awayWinProb,
    );

  const moneylineQualified =
    strongestWinProb >= 55 &&
    modelConfidence >= 60;

  const moneyline = {
    pick:
      !moneylineQualified
        ? "暫不推薦"
        : homeWinProb >=
            awayWinProb
          ? "主隊"
          : "客隊",
    confidence:
      moneylineQualified
        ? modelConfidence
        : 0,
    reason:
      moneylineQualified
        ? "依近期攻守效率、主客場表現、歷史交手、當季數據與最新傷病資訊綜合評估。"
        : strongestWinProb < 55
          ? "預測最高勝率低於 55%，不符合正式獨贏推薦條件。"
          : "模型信心低於 60，暫不列入正式獨贏推薦。",
  };

  const fairHomeLine = readLine(model?.fair_spread?.home_line);

  let handicap: any = {
    pick:
      "暫不推薦",
    line:
      null,
    confidence:
      0,
    reason:
      "目前沒有可用的真實市場讓分盤口，僅保留模型公平讓分線。",
  };

  if (
    marketReady &&
    fairHomeLine !== null &&
    marketHomeLine !== null
  ) {
    const edge =
      marketHomeLine -
      fairHomeLine;

    if (
      Math.abs(edge) >=
        2.5 &&
      modelConfidence >= 58
    ) {
      const homeSide =
        edge > 0;

      const selectedLine =
        homeSide
          ? marketHomeLine
          : marketAwayLine!;

      handicap = {
        pick:
          homeSide
            ? "主隊"
            : "客隊",
        line:
          selectedLine,
        confidence:
          roundRecommendationConfidence(
            modelConfidence *
              0.78 +
            Math.min(
              Math.abs(edge),
              7,
            ) *
              3.2,
          ),
        reason:
          `模型公平讓分為 ${model?.fair_spread?.display || fairHomeLine}，市場主隊讓分約 ${marketHomeLine > 0 ? "+" : ""}${marketHomeLine}，兩者差距 ${Math.abs(edge).toFixed(1)} 分。`,
        edge:
          Math.round(
            edge * 10,
          ) / 10,
      };
    } else {
      handicap.reason = modelConfidence < 58
        ? `本場信心 ${modelConfidence} 低於正式推薦門檻 58；市場主隊盤線 ${marketHomeLine}，模型公平線 ${fairHomeLine}，僅保留參考方向。`
        : `市場主隊讓分約 ${marketHomeLine > 0 ? "+" : ""}${marketHomeLine}，與模型公平線差距不足 2.5 分的正式推薦門檻。`;
    }
  }

  const fairTotal = readLine(model?.fair_total);

  let overUnder: any = {
    pick:
      "暫不推薦",
    line:
      null,
    confidence:
      0,
    reason:
      "目前沒有可用的真實市場大小分盤口，僅保留模型公平總分。",
  };

  if (
    marketReady &&
    fairTotal !== null &&
    marketTotal !== null
  ) {
    const edge =
      fairTotal -
      marketTotal;

    if (
      Math.abs(edge) >=
        4.5 &&
      modelConfidence >= 58
    ) {
      overUnder = {
        pick:
          edge > 0
            ? "大"
            : "小",
        line:
          marketTotal,
        confidence:
          roundRecommendationConfidence(
            modelConfidence *
              0.78 +
            Math.min(
              Math.abs(edge),
              10,
            ) *
              2.2,
          ),
        reason:
          `模型公平總分 ${fairTotal}，市場大小分約 ${marketTotal}，差距 ${Math.abs(edge).toFixed(1)} 分。`,
        edge:
          Math.round(
            edge * 10,
          ) / 10,
      };
    } else {
      overUnder.reason = modelConfidence < 58
        ? `本場信心 ${modelConfidence} 低於正式推薦門檻 58；市場大小分 ${marketTotal}，模型公平總分 ${fairTotal}，僅保留參考方向。`
        : `市場大小分約 ${marketTotal}，與模型公平總分差距不足 4.5 分的正式推薦門檻。`;
    }
  }

  // 方向展示獨立於正式推薦；同一市場的展示/正式盤線完全一致。
  const displayHome = marketHomeLine;
  const displayAway = marketAwayLine;
  const displayTotal = marketTotal;
  const qualifiedLabel = "正式推薦";
  const referenceLabel = "低優勢方向";
  const noLineLabel = "缺少有效盤線";

  const displayMoneyline =
    Number.isFinite(homeWinProb) &&
    Number.isFinite(awayWinProb) &&
    (homeWinProb + awayWinProb > 0) &&
    homeWinProb !== awayWinProb
      ? (homeWinProb > awayWinProb ? "主隊" : "客隊")
      : "暫不推薦";
  // Moneyline labels must reflect a real two-sided price from ONE source;
  // never mark zero, negative or malformed prices as available.
  const validPrice = (value: unknown) => {
    const n = readLine(value);
    return n !== null && n > 1.01 && n <= 100 ? n : null;
  };
  const validMoneylinePair = (book: any): boolean => {
    const convertAmerican = (v: unknown): number | null => {
      const n = readLine(v);
      return n === null || Math.abs(n) < 100 ? null :
        (n > 0 ? 1 + n/100 : 1 + 100/Math.abs(n));
    };
    const isAmerican = String(book?.odds_format || market?.odds_format || "").toLowerCase() === "american";
    const h = validPrice(book?.home_moneyline_decimal) ??
      validPrice(isAmerican ? convertAmerican(book?.home_moneyline) : book?.home_moneyline);
    const a = validPrice(book?.away_moneyline_decimal) ??
      validPrice(isAmerican ? convertAmerican(book?.away_moneyline) : book?.away_moneyline);
    if (h === null || a === null) return false;
    const implied = 1 / h + 1 / a;
    return implied >= 0.95 && implied <= 1.35;
  };
  const moneylineOddsAvailable = marketReady &&
    (validMoneylinePair(primary) || validMoneylinePair(consensus));

  const handicapEdge =
    marketReady &&
    displayHome !== null &&
    fairHomeLine !== null
      ? displayHome - fairHomeLine
      : null;
  const displayHandicap =
    handicapEdge === null || Math.abs(handicapEdge) < 0.00001
      ? "暫不推薦"
      : handicapEdge > 0 ? "主隊" : "客隊";
  const displayHandicapLine =
    displayHandicap === "主隊" ? displayHome :
    displayHandicap === "客隊" ? displayAway : null;

  const totalEdge =
    marketReady &&
    displayTotal !== null &&
    fairTotal !== null
      ? fairTotal - displayTotal
      : null;
  const displayOverUnder =
    totalEdge === null || Math.abs(totalEdge) < 0.00001
      ? "暫不推薦"
      : totalEdge > 0 ? "大" : "小";

  return {
    moneyline: {
      ...moneyline,
      display_pick: displayMoneyline,
      display_line: null,
      display_confidence: modelConfidence,
      official_pick_is_qualified: moneylineQualified,
      signal_level: displayMoneyline === "暫不推薦"
        ? noLineLabel
        : moneylineQualified ? qualifiedLabel : referenceLabel,
      moneyline_odds_available: moneylineOddsAvailable,
      decision_code: !moneylineQualified
        ? (strongestWinProb < 55 ? "insufficient_win_probability" : "low_confidence")
        : "qualified",
      display_reason: displayMoneyline === "暫不推薦"
        ? "模型未產生明確勝負方向。"
        : moneylineOddsAvailable
          ? `模型較看好${displayMoneyline}，但是否具有投注優勢仍須依盤口檢查。`
          : `模型較看好${displayMoneyline}；目前沒有有效的獨贏市場賠率，僅供勝負方向參考。`,
    },
    handicap: {
      ...handicap,
      display_pick: displayHandicap,
      display_line: displayHandicapLine,
      display_confidence: modelConfidence,
      official_pick_is_qualified: handicap.pick !== "暫不推薦",
      signal_level: displayHandicap === "暫不推薦"
        ? noLineLabel
        : handicap.pick !== "暫不推薦"
          ? qualifiedLabel : referenceLabel,
      market_line_source: marketReady ? spreadSource : null,
      decision_code: !marketReady ? "market_unavailable" :
        marketHomeLine === null ? "missing_or_inconsistent_spread_line" :
        fairHomeLine === null ? "missing_fair_spread" :
        modelConfidence < 58 ? "low_confidence" :
        Math.abs(handicapEdge ?? 0) < 2.5 ? "insufficient_edge" : "qualified",
      display_reason: handicapEdge === null
        ? "沒有可用的真實市場讓分盤線。"
        : `模型公平主隊讓分 ${fairHomeLine >= 0 ? "+" : ""}${fairHomeLine}，市場主隊 ${displayHome! >= 0 ? "+" : ""}${displayHome}，差距 ${Math.abs(handicapEdge).toFixed(1)} 分。`,
    },
    over_under: {
      ...overUnder,
      display_pick: displayOverUnder,
      display_line: marketReady ? displayTotal : null,
      display_confidence: modelConfidence,
      official_pick_is_qualified: overUnder.pick !== "暫不推薦",
      signal_level: displayOverUnder === "暫不推薦"
        ? noLineLabel
        : overUnder.pick !== "暫不推薦"
          ? qualifiedLabel : referenceLabel,
      market_line_source: marketReady ? totalSource : null,
      decision_code: !marketReady ? "market_unavailable" :
        marketTotal === null ? "missing_total_line" :
        fairTotal === null ? "missing_fair_total" :
        modelConfidence < 58 ? "low_confidence" :
        Math.abs(totalEdge ?? 0) < 4.5 ? "insufficient_edge" : "qualified",
      display_reason: totalEdge === null
        ? "沒有可用的真實市場大小分盤線。"
        : `模型預估總分 ${fairTotal}，市場大小分 ${displayTotal}，差距 ${Math.abs(totalEdge).toFixed(1)} 分。`,
    },
  };
}

async function readReadyCache(gameId: number) {
  const { data, error } =
    await requireSupabaseAdmin()
      .from("basketball_analysis_cache")
      .select(
        "id,game_id,analysis_data,generated_at,updated_at,source,status,model_version",
      )
      .eq("game_id", gameId)
      .eq("status", "ready")
      .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function writeAutoCache(
  gameId: number,
  result: any,
) {
  const fixture = result?.fixture || {};
  const nowIso = new Date().toISOString();

  const cacheRow = {
    game_id: gameId,
    fixture_time: fixture?.date || null,
    league: fixture?.league || "NBA",
    season: fixture?.season ?? null,
    stage: fixture?.stage ?? null,
    home_team: fixture?.home?.name || null,
    away_team: fixture?.away?.name || null,
    home_team_id: fixture?.home?.id ?? null,
    away_team_id: fixture?.away?.id ?? null,
    model_version: result?.version || null,
    analysis_data: result,
    generated_at: result?.generated_at || nowIso,
    updated_at: nowIso,
    source: "t10_auto",
    status: "ready",
  };

  const { data: cacheData, error: cacheError } =
    await requireSupabaseAdmin()
      .from("basketball_analysis_cache")
      .upsert(cacheRow, {
        onConflict: "game_id",
      })
      .select("id,game_id,generated_at,source,status")
      .single();

  if (cacheError) throw cacheError;

  const kickoffMs =
    new Date(fixture?.date || "").getTime();

  let snapshotCreated = false;

  if (
    Number.isFinite(kickoffMs) &&
    Date.now() < kickoffMs
  ) {
    const snapshotRow = {
      game_id: gameId,
      fixture_time: fixture?.date || null,
      home_team: fixture?.home?.name || null,
      away_team: fixture?.away?.name || null,
      model_version: result?.version || null,
      prediction_data: result,
      generated_at: result?.generated_at || nowIso,
      source: "t10_auto",
    };

    const { data: snapshotData, error: snapshotError } =
      await requireSupabaseAdmin()
        .from("basketball_prediction_snapshots")
        .upsert(snapshotRow, {
          onConflict: "game_id",
          ignoreDuplicates: true,
        })
        .select("id,game_id");

    if (snapshotError) throw snapshotError;
    snapshotCreated = Array.isArray(snapshotData) && snapshotData.length > 0;
  }

  return {
    cache: cacheData,
    snapshot_created: snapshotCreated,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

const NBA_BASE = "https://v2.nba.api-sports.io";

const NBA_TEAM_NAME_ZH: Record<string, string> = {
  "Atlanta Hawks": "亞特蘭大老鷹",
  "Boston Celtics": "波士頓塞爾提克",
  "Brooklyn Nets": "布魯克林籃網",
  "Charlotte Hornets": "夏洛特黃蜂",
  "Chicago Bulls": "芝加哥公牛",
  "Cleveland Cavaliers": "克里夫蘭騎士",
  "Dallas Mavericks": "達拉斯獨行俠",
  "Denver Nuggets": "丹佛金塊",
  "Detroit Pistons": "底特律活塞",
  "Golden State Warriors": "金州勇士",
  "Houston Rockets": "休士頓火箭",
  "Indiana Pacers": "印第安納溜馬",
  "Los Angeles Clippers": "洛杉磯快艇",
  "LA Clippers": "洛杉磯快艇",
  "Los Angeles Lakers": "洛杉磯湖人",
  "Memphis Grizzlies": "曼斐斯灰熊",
  "Miami Heat": "邁阿密熱火",
  "Milwaukee Bucks": "密爾瓦基公鹿",
  "Minnesota Timberwolves": "明尼蘇達灰狼",
  "New Orleans Pelicans": "紐奧良鵜鶘",
  "New York Knicks": "紐約尼克",
  "Oklahoma City Thunder": "奧克拉荷馬雷霆",
  "Orlando Magic": "奧蘭多魔術",
  "Philadelphia 76ers": "費城76人",
  "Phoenix Suns": "鳳凰城太陽",
  "Portland Trail Blazers": "波特蘭拓荒者",
  "Sacramento Kings": "沙加緬度國王",
  "San Antonio Spurs": "聖安東尼奧馬刺",
  "Toronto Raptors": "多倫多暴龍",
  "Utah Jazz": "猶他爵士",
  "Washington Wizards": "華盛頓巫師",
};

function zhTeam(name: unknown) {
  const raw = String(name || "").trim();
  return NBA_TEAM_NAME_ZH[raw] || raw;
}

function safeInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function safeNumber(value: unknown) {
  // IMPORTANT:
  // Number(null) === 0 and Number("") === 0, which would turn
  // "score not supplied by API" into a real 0-point game.
  // Reject missing/blank values before numeric conversion.
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isFinished(game: any) {
  return Number(game?.status?.short) === 3;
}

// 與 basketball-fixtures 使用同一套 NBA 正式賽季起始規則。
// 不能只靠 API 的 stage 數字判斷 regular season，因為實測同一 season
// 會出現「正式開季日前卻標成 stage=2」的資料，會把 preseason 誤當正式賽。
const NBA_OFFICIAL_START: Record<number, string> = {
  2026: "2026-10-20",
};

function nbaOfficialStartMs(season: number) {
  const date =
    NBA_OFFICIAL_START[season] ||
    `${season}-10-20`;

  return new Date(`${date}T00:00:00.000Z`).getTime();
}

function gameStartMs(game: any) {
  const ms = new Date(game?.date?.start || "").getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function seasonForDate(dateText: string) {
  const d = new Date(dateText);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function scoreFromSide(side: any) {
  const points = safeNumber(side?.points);
  if (points !== null) return points;

  // Do not turn a missing/null quarter into 0; for a completed game,
  // only reconstruct the final total from an entirely valid linescore.
  const rawLines = Array.isArray(side?.linescore) ? side.linescore : [];
  const lines = rawLines.map((x: any) => safeNumber(x));
  if (!lines.length || lines.some((x: number | null) => x === null || x < 0)) {
    return null;
  }
  return lines.reduce((a: number, b: number | null) => a + (b as number), 0);
}

function getTeamScore(game: any, teamId: number) {
  const homeId = Number(game?.teams?.home?.id);
  const awayId = Number(game?.teams?.visitors?.id);

  if (homeId === teamId) {
    return {
      pf: scoreFromSide(game?.scores?.home),
      pa: scoreFromSide(game?.scores?.visitors),
      isHome: true,
    };
  }

  if (awayId === teamId) {
    return {
      pf: scoreFromSide(game?.scores?.visitors),
      pa: scoreFromSide(game?.scores?.home),
      isHome: false,
    };
  }

  return {
    pf: null,
    pa: null,
    isHome: false,
  };
}

function stageWeight(game: any, targetSeason: number) {
  const season = Number(game?.season);
  const stage = Number(game?.stage);
  const startMs = gameStartMs(game);

  if (season === targetSeason) {
    const officialStartMs =
      nbaOfficialStartMs(targetSeason);

    // 正式開季日前，一律視為 preseason / exhibition 輔助樣本。
    // 不信任 stage=2 單獨作為 regular season 判定。
    if (
      startMs > 0 &&
      startMs < officialStartMs
    ) {
      return 0.35;
    }

    // 正式開季日之後才給當季正式賽高權重。
    if (startMs >= officialStartMs) {
      return 1.0;
    }

    // 日期異常時保守降權。
    if (stage === 1) return 0.30;
    return 0.40;
  }

  if (season === targetSeason - 1) {
    if ([2, 3, 4].includes(stage)) return 0.72;
    if (stage === 1) return 0.25;
    return 0.45;
  }

  return 0.25;
}

function collectRecentGames(
  rows: any[],
  teamId: number,
  targetStartMs: number,
  targetSeason: number,
  limit = 12,
) {
  const seen = new Set<string>();

  return rows
    .filter((game: any) => game?.id != null)
    .filter((game: any) => {
      const key = String(game.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((game: any) => isFinished(game))
    .filter((game: any) => {
      const ms = gameStartMs(game);
      return ms > 0 && ms < targetStartMs;
    })
    .map((game: any) => {
      const score = getTeamScore(game, teamId);

      return {
        game,
        pf: score.pf,
        pa: score.pa,
        isHome: score.isHome,
        baseWeight: stageWeight(game, targetSeason),
      };
    })
    .filter((item: any) =>
      item.pf !== null &&
      item.pa !== null
    )
    .sort((a: any, b: any) =>
      gameStartMs(b.game) - gameStartMs(a.game)
    )
    .slice(0, limit);
}

function metricsFromRecent(items: any[]) {
  if (!items.length) {
    return {
      games: 0,
      weighted_games: 0,
      avg_for: null,
      avg_against: null,
      avg_total: null,
      avg_margin: null,
      win_rate: null,
      home_games: 0,
      home_avg_for: null,
      home_avg_against: null,
      away_games: 0,
      away_avg_for: null,
      away_avg_against: null,
    };
  }

  let wSum = 0;
  let pfSum = 0;
  let paSum = 0;
  let winSum = 0;

  let homeW = 0;
  let homePf = 0;
  let homePa = 0;

  let awayW = 0;
  let awayPf = 0;
  let awayPa = 0;

  items.forEach((item: any, index: number) => {
    const recencyWeight = Math.pow(0.93, index);
    const weight = item.baseWeight * recencyWeight;

    wSum += weight;
    pfSum += item.pf * weight;
    paSum += item.pa * weight;
    winSum += (item.pf > item.pa ? 1 : 0) * weight;

    if (item.isHome) {
      homeW += weight;
      homePf += item.pf * weight;
      homePa += item.pa * weight;
    } else {
      awayW += weight;
      awayPf += item.pf * weight;
      awayPa += item.pa * weight;
    }
  });

  const avgFor = wSum ? pfSum / wSum : 0;
  const avgAgainst = wSum ? paSum / wSum : 0;

  return {
    games: items.length,
    weighted_games: round1(wSum),
    avg_for: round1(avgFor),
    avg_against: round1(avgAgainst),
    avg_total: round1(avgFor + avgAgainst),
    avg_margin: round1(avgFor - avgAgainst),
    win_rate: Math.round((wSum ? winSum / wSum : 0) * 100),
    home_games: items.filter((x: any) => x.isHome).length,
    home_avg_for: homeW ? round1(homePf / homeW) : null,
    home_avg_against: homeW ? round1(homePa / homeW) : null,
    away_games: items.filter((x: any) => !x.isHome).length,
    away_avg_for: awayW ? round1(awayPf / awayW) : null,
    away_avg_against: awayW ? round1(awayPa / awayW) : null,
  };
}

function compactRecent(items: any[]) {
  return items.slice(0, 8).map((item: any) => ({
    id: item.game?.id ?? null,
    season: item.game?.season ?? null,
    stage: item.game?.stage ?? null,
    start: item.game?.date?.start ?? null,
    home: item.game?.teams?.home?.name ?? null,
    away: item.game?.teams?.visitors?.name ?? null,
    team_points: item.pf,
    opponent_points: item.pa,
    venue: item.isHome ? "home" : "away",
    result: item.pf > item.pa ? "W" : "L",
    weight: round1(item.baseWeight),
  }));
}

function apiErrorCount(errors: any) {
  if (!errors) return 0;
  if (Array.isArray(errors)) return errors.length;
  if (typeof errors === "object") return Object.keys(errors).length;
  return String(errors).trim() ? 1 : 0;
}

async function nbaApi(path: string, apiKey: string) {
  const response = await fetch(`${NBA_BASE}${path}`, {
    method: "GET",
    headers: {
      "x-apisports-key": apiKey,
    },
  });

  const text = await response.text();

  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(`API_NBA_HTTP_${response.status}:${path}`);
  }

  if (apiErrorCount(body?.errors) > 0) {
    throw new Error(
      `API_NBA_ERROR:${path}:${JSON.stringify(body.errors)}`
    );
  }

  return {
    body,
    remaining:
      response.headers.get("x-ratelimit-requests-remaining"),
  };
}

function responseRows(call: any) {
  return Array.isArray(call?.body?.response)
    ? call.body.response
    : [];
}

function h2hMetrics(
  rows: any[],
  homeId: number,
  awayId: number,
  targetStartMs: number,
) {
  const games = rows
    .filter((g: any) => isFinished(g))
    .filter((g: any) => {
      const ms = gameStartMs(g);
      return ms > 0 && ms < targetStartMs;
    })
    .sort((a: any, b: any) => gameStartMs(b) - gameStartMs(a))
    .slice(0, 8);

  if (!games.length) {
    return {
      games: 0,
      home_side_wins: 0,
      away_side_wins: 0,
      avg_total: null,
      avg_margin_for_home_side: null,
    };
  }

  let homeWins = 0;
  let awayWins = 0;
  let total = 0;
  let margin = 0;
  let count = 0;

  for (const game of games) {
    const homeTeamScore = getTeamScore(game, homeId);
    const awayTeamScore = getTeamScore(game, awayId);

    if (
      homeTeamScore.pf === null ||
      homeTeamScore.pa === null ||
      awayTeamScore.pf === null ||
      awayTeamScore.pa === null
    ) {
      continue;
    }

    if (homeTeamScore.pf > homeTeamScore.pa) homeWins++;
    else awayWins++;

    total += homeTeamScore.pf + homeTeamScore.pa;
    margin += homeTeamScore.pf - homeTeamScore.pa;
    count++;
  }

  return {
    games: count,
    home_side_wins: homeWins,
    away_side_wins: awayWins,
    avg_total: count ? round1(total / count) : null,
    avg_margin_for_home_side: count ? round1(margin / count) : null,
  };
}

function standingSummary(rows: any[]) {
  const row = rows?.[0];
  if (!row) return null;

  return {
    conference: row?.conference ?? null,
    division: row?.division ?? null,
    win: row?.win ?? null,
    loss: row?.loss ?? null,
    gamesBehind: row?.gamesBehind ?? null,
    streak: row?.streak ?? null,
    winStreak: row?.winStreak ?? null,
  };
}

function teamSeasonStatSummary(rows: any[]) {
  const row = rows?.[0];
  if (!row) return null;

  return {
    games: safeNumber(row?.games),
    points: safeNumber(row?.points),
    fgp: safeNumber(row?.fgp),
    ftp: safeNumber(row?.ftp),
    tpp: safeNumber(row?.tpp),
    offReb: safeNumber(row?.offReb),
    defReb: safeNumber(row?.defReb),
    totReb: safeNumber(row?.totReb),
    assists: safeNumber(row?.assists),
    steals: safeNumber(row?.steals),
    turnovers: safeNumber(row?.turnovers),
    blocks: safeNumber(row?.blocks),
    plusMinus: safeNumber(row?.plusMinus),
  };
}

function buildQuantModel(
  homeMetrics: any,
  awayMetrics: any,
  h2h: any,
  homeSeasonStats: any,
  awaySeasonStats: any,
  targetSeasonRegularGamesHome: number,
  targetSeasonRegularGamesAway: number,
) {
  const homeOff = safeNumber(homeMetrics.avg_for) ?? 110;
  const homeDef = safeNumber(homeMetrics.avg_against) ?? 110;
  const awayOff = safeNumber(awayMetrics.avg_for) ?? 110;
  const awayDef = safeNumber(awayMetrics.avg_against) ?? 110;

  const homeSplitOff =
    safeNumber(homeMetrics.home_avg_for) ?? homeOff;
  const homeSplitDef =
    safeNumber(homeMetrics.home_avg_against) ?? homeDef;

  const awaySplitOff =
    safeNumber(awayMetrics.away_avg_for) ?? awayOff;
  const awaySplitDef =
    safeNumber(awayMetrics.away_avg_against) ?? awayDef;

  // 核心估分：近期攻守 + 主客場切片 + 主場優勢
  let homePoints =
    0.40 * ((homeOff + awayDef) / 2) +
    0.45 * ((homeSplitOff + awaySplitDef) / 2) +
    0.15 * homeOff +
    1.6;

  let awayPoints =
    0.40 * ((awayOff + homeDef) / 2) +
    0.45 * ((awaySplitOff + homeSplitDef) / 2) +
    0.15 * awayOff;

  // H2H 只給小權重，避免舊陣容影響過大。
  const h2hMargin = safeNumber(h2h?.avg_margin_for_home_side);
  const h2hTotal = safeNumber(h2h?.avg_total);

  if (h2hMargin !== null && h2h?.games >= 3) {
    homePoints += clamp(h2hMargin, -15, 15) * 0.06;
    awayPoints -= clamp(h2hMargin, -15, 15) * 0.06;
  }

  if (h2hTotal !== null && h2h?.games >= 3) {
    const currentTotal = homePoints + awayPoints;
    const totalAdjust =
      clamp(h2hTotal - currentTotal, -20, 20) * 0.08;

    homePoints += totalAdjust / 2;
    awayPoints += totalAdjust / 2;
  }

  // 當季球隊統計只做微調。開季前 team stats 可能主要是 preseason，
  // 因此 regular-season 樣本不足時權重極低。
  const currentRegularGames =
    Math.min(
      targetSeasonRegularGamesHome,
      targetSeasonRegularGamesAway,
    );

  const seasonWeight =
    currentRegularGames >= 8
      ? 0.14
      : currentRegularGames >= 4
      ? 0.08
      : 0.03;

  const homeFg = safeNumber(homeSeasonStats?.fgp);
  const awayFg = safeNumber(awaySeasonStats?.fgp);
  const homeTpp = safeNumber(homeSeasonStats?.tpp);
  const awayTpp = safeNumber(awaySeasonStats?.tpp);

  if (homeFg !== null && awayFg !== null) {
    const diff = clamp(homeFg - awayFg, -10, 10);
    homePoints += diff * seasonWeight;
    awayPoints -= diff * seasonWeight * 0.6;
  }

  if (homeTpp !== null && awayTpp !== null) {
    const diff = clamp(homeTpp - awayTpp, -10, 10);
    homePoints += diff * seasonWeight * 0.5;
    awayPoints -= diff * seasonWeight * 0.3;
  }

  homePoints = clamp(homePoints, 88, 135);
  awayPoints = clamp(awayPoints, 88, 135);

  const rawMargin = homePoints - awayPoints;
  const total = homePoints + awayPoints;

  // 近似勝率模型，不以市場賠率為基礎。
  const homeWinProb =
    1 / (1 + Math.exp(-rawMargin / 6.8));

  const dataScore =
    Math.min(homeMetrics.games, 10) * 2.1 +
    Math.min(awayMetrics.games, 10) * 2.1 +
    Math.min(h2h?.games || 0, 6) * 1.4 +
    (homeSeasonStats ? 6 : 0) +
    (awaySeasonStats ? 6 : 0);

  // 開季資料保守處理：
  // 0 場例行賽時，不應因 preseason / 前一季資料很多就出現 70+ 高信心。
  const openingPenalty =
    currentRegularGames === 0 ? 18 :
    currentRegularGames < 4 ? 12 :
    currentRegularGames < 8 ? 6 : 0;

  const confidenceCap =
    currentRegularGames === 0 ? 64 :
    currentRegularGames < 4 ? 68 :
    currentRegularGames < 8 ? 76 : 82;

  const strengthBonus =
    Math.min(Math.abs(rawMargin) * 1.2, 9);

  const confidence =
    Math.round(
      clamp(
        48 +
          dataScore * 0.45 +
          strengthBonus -
          openingPenalty,
        45,
        confidenceCap,
      )
    );

  const fairSpreadHome = round1(-rawMargin);
  const fairTotal = round1(total);

  return {
    predicted_score: {
      home: Math.round(homePoints),
      away: Math.round(awayPoints),
    },
    fair_spread: {
      home_line: fairSpreadHome,
      display:
        fairSpreadHome < 0
          ? `主隊 ${fairSpreadHome}`
          : fairSpreadHome > 0
          ? `主隊 +${fairSpreadHome}`
          : "PK",
    },
    fair_total: fairTotal,
    win_probability: {
      home: Math.round(homeWinProb * 100),
      away: Math.round((1 - homeWinProb) * 100),
    },
    confidence,
    current_regular_season_sample: {
      home: targetSeasonRegularGamesHome,
      away: targetSeasonRegularGamesAway,
    },
  };
}

async function createNarrative(
  openAiKey: string,
  payload: any,
) {
  const fixed =
    buildFixedRecommendations(
      payload,
    );

  const marketAvailable =
    payload?.market_data
      ?.market?.available ===
    true;

  const injuriesAvailable =
    payload?.market_data
      ?.injuries?.available ===
    true;

  const homeInjuryCount =
    Number(
      payload?.market_data
        ?.injuries
        ?.home
        ?.summary
        ?.total || 0,
    );

  const awayInjuryCount =
    Number(
      payload?.market_data
        ?.injuries
        ?.away
        ?.summary
        ?.total || 0,
    );

  const fallback = {
    summary:
      `${payload.fixture.home.name_zh} 對 ${payload.fixture.away.name_zh}，` +
      `模型預估比分 ${payload.model.predicted_score.home}-${payload.model.predicted_score.away}。` +
      (
        injuriesAvailable
          ? ` 傷病名單目前主隊 ${homeInjuryCount} 人、客隊 ${awayInjuryCount} 人。`
          : ""
      ),
    recommendations:
      fixed,
  };

  if (!openAiKey) {
    return fallback;
  }

  const instructions = `
你是一名專業 NBA 賽前數據分析師。

所有模型數字與最終推薦方向已由 HABAO 程式先計算完成。
你只能負責解釋，絕對不得改動 pick、line、confidence 或模型數字。

規則：
1. recommendations.moneyline / handicap / over_under 的 pick、line、confidence 必須完全照輸入 fixed_recommendations。
2. predicted_score、fair_spread、fair_total、win_probability 不得修改。
3. market_data.market.available=true 時，這些是真實市場盤口資料，可以用來解釋「模型公平線 vs 市場線」。
4. market_data.market.available=false 時，不得虛構盤口。
5. market_data.injuries.available=true 時，可以說明傷病名單與狀態；不得虛構未提供的球員傷情。
6. 傷病目前只做信心不確定性修正，尚未把每名球員硬換算成固定分數；不得聲稱某球員固定影響幾分。
7. preseason 只能視為輔助；開季樣本少時要保持保守。
8. 只回傳合法 JSON：
{
  "summary": "...",
  "recommendations": {
    "moneyline": {"reason": "..."},
    "handicap": {"reason": "..."},
    "over_under": {"reason": "..."}
  }
}
`;

  try {
    const res =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method:
            "POST",
          headers: {
            "Authorization":
              `Bearer ${openAiKey}`,
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify({
              model:
                "gpt-5-mini",
              instructions,
              input:
                "請根據以下 NBA 模型、真實市場盤口與傷病資料產生簡潔分析文字。不得修改 fixed_recommendations：\n\n" +
                JSON.stringify({
                  fixture:
                    payload.fixture,
                  model:
                    payload.model,
                  market_data:
                    payload.market_data,
                  fixed_recommendations:
                    fixed,
                }),
              text: {
                format: {
                  type:
                    "json_object",
                },
              },
            }),
        },
      );

    if (!res.ok) {
      console.error(
        "OPENAI NARRATIVE ERROR:",
        await res.text(),
      );

      return fallback;
    }

    const data =
      await res.json();

    const outputText =
      String(
        data?.output_text ||
        data?.output
          ?.find(
            (item: any) =>
              item?.type ===
              "message",
          )
          ?.content
          ?.find(
            (item: any) =>
              item?.type ===
              "output_text",
          )
          ?.text ||
        "",
      ).trim();

    if (!outputText) {
      return fallback;
    }

    const parsed =
      JSON.parse(
        outputText,
      );

    return {
      summary:
        String(
          parsed?.summary ||
          fallback.summary,
        ),
      recommendations: {
        moneyline: {
          ...fixed.moneyline,
          reason:
            String(
              parsed
                ?.recommendations
                ?.moneyline
                ?.reason ||
              fixed
                .moneyline
                .reason,
            ),
        },
        handicap: {
          ...fixed.handicap,
          reason:
            String(
              parsed
                ?.recommendations
                ?.handicap
                ?.reason ||
              fixed
                .handicap
                .reason,
            ),
        },
        over_under: {
          ...fixed
            .over_under,
          reason:
            String(
              parsed
                ?.recommendations
                ?.over_under
                ?.reason ||
              fixed
                .over_under
                .reason,
            ),
        },
      },
    };

  } catch (
    error
  ) {
    console.error(
      "OPENAI NARRATIVE EXCEPTION:",
      error,
    );

    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json(
      {
        success: false,
        error: "POST only",
      },
      405,
    );
  }

  try {
    const body =
      await req.json().catch(() => ({}));

    const mode =
      String(body?.mode || "preview").trim() === "system_auto"
        ? "system_auto"
        : "preview";

    const gameId =
      safeInt(
        body?.game_id ??
        body?.fixture_id,
      );

    if (!gameId) {
      return json(
        {
          success: false,
          error: "game_id_required",
          message:
            "請提供 NBA game_id",
        },
        400,
      );
    }

    const force = body?.force === true;

    if (mode === "system_auto") {
      if (!isBackendRequest(req)) {
        return json(
          {
            success: false,
            error: "backend_authorization_required",
            message: "system_auto 僅允許後端服務呼叫",
          },
          403,
        );
      }

      // 只要正式 snapshot 已存在就不可覆寫；不信任 force 重新分析。
      const priorSnapshot=await nbaOfficialSnapshot(gameId);
      if (priorSnapshot?.prediction_data) {
        // 正式快照存在但快取不見：只用快照原文重建 cache，絕不重跑模型。
        const ready=await readReadyCache(gameId);
        if(!ready) await writeAutoCache(gameId,priorSnapshot.prediction_data);
        return json({...priorSnapshot.prediction_data,mode:"system_auto",from_snapshot:true});
      }
      const cached=await readReadyCache(gameId);
      if(cached?.analysis_data) {
        const restored=await nbaRestoreSnapshotFromReadyCache(gameId,cached);
        if(!restored) return json({success:false,error:"ready_cache_without_valid_t10_snapshot",
          message:"快取不符合首次正式快照安全補建條件，已停止避免覆寫"},409);
        return json({...cached.analysis_data,mode:"system_auto",from_cache:true,
          snapshot_created:true,cache:{id:cached.id,source:cached.source,generated_at:cached.generated_at}});
      }
    }

    const nbaApiKey =
      String(
        Deno.env.get("API_NBA_KEY") ||
        Deno.env.get("API_FOOTBALL_KEY") ||
        "",
      ).trim();

    const openAiKey =
      String(
        Deno.env.get("OPENAI_API_KEY") ||
        "",
      ).trim();

    if (!nbaApiKey) {
      throw new Error(
        "找不到 API_NBA_KEY 或 API_FOOTBALL_KEY",
      );
    }

    // preview：不寫 DB、不扣會員次數。
    // system_auto：供 T-10 後端流程使用，寫入 NBA 專用 cache + 首次 snapshot。
    // 會員扣次數仍留到下一階段，不與本次快取上線混在一起。
    const targetCall =
      await nbaApi(
        `/games?id=${gameId}`,
        nbaApiKey,
      );

    const target =
      responseRows(targetCall)?.[0];

    if (!target) {
      return json(
        {
          success: false,
          error: "game_not_found",
          message:
            "找不到這場 NBA 賽事",
        },
        404,
      );
    }

    const homeId =
      Number(target?.teams?.home?.id);
    const awayId =
      Number(target?.teams?.visitors?.id);

    const targetStart =
      String(
        target?.date?.start || "",
      );

    const targetStartMs =
      new Date(targetStart).getTime();

    const targetSeason =
      Number(
        target?.season ||
        seasonForDate(targetStart),
      );

    const previousSeason =
      targetSeason - 1;

    if (
      !homeId ||
      !awayId ||
      !Number.isFinite(targetStartMs)
    ) {
      throw new Error(
        "NBA_TARGET_GAME_INVALID",
      );
    }

    const [
      homeCurrent,
      homePrevious,
      awayCurrent,
      awayPrevious,
      h2hCall,
      homeStanding,
      awayStanding,
      homeTeamStats,
      awayTeamStats,
    ] = await Promise.all([
      nbaApi(
        `/games?league=standard&season=${targetSeason}&team=${homeId}`,
        nbaApiKey,
      ),
      nbaApi(
        `/games?league=standard&season=${previousSeason}&team=${homeId}`,
        nbaApiKey,
      ),
      nbaApi(
        `/games?league=standard&season=${targetSeason}&team=${awayId}`,
        nbaApiKey,
      ),
      nbaApi(
        `/games?league=standard&season=${previousSeason}&team=${awayId}`,
        nbaApiKey,
      ),
      nbaApi(
        `/games?h2h=${homeId}-${awayId}`,
        nbaApiKey,
      ),
      nbaApi(
        `/standings?league=standard&season=${targetSeason}&team=${homeId}`,
        nbaApiKey,
      ),
      nbaApi(
        `/standings?league=standard&season=${targetSeason}&team=${awayId}`,
        nbaApiKey,
      ),
      nbaCachedStatistics(`/teams/statistics?id=${homeId}&season=${targetSeason}`,nbaApiKey),
      nbaCachedStatistics(`/teams/statistics?id=${awayId}&season=${targetSeason}`,nbaApiKey),
    ]);

    const homeAll = [
      ...responseRows(homeCurrent),
      ...responseRows(homePrevious),
    ];

    const awayAll = [
      ...responseRows(awayCurrent),
      ...responseRows(awayPrevious),
    ];

    const homeRecent =
      collectRecentGames(
        homeAll,
        homeId,
        targetStartMs,
        targetSeason,
        12,
      );

    const awayRecent =
      collectRecentGames(
        awayAll,
        awayId,
        targetStartMs,
        targetSeason,
        12,
      );

    const homeMetrics =
      metricsFromRecent(homeRecent);

    const awayMetrics =
      metricsFromRecent(awayRecent);

    const h2h =
      h2hMetrics(
        responseRows(h2hCall),
        homeId,
        awayId,
        targetStartMs,
      );

    const homeStandingSummary =
      standingSummary(
        responseRows(homeStanding),
      );

    const awayStandingSummary =
      standingSummary(
        responseRows(awayStanding),
      );

    const homeSeasonStats =
      teamSeasonStatSummary(
        responseRows(homeTeamStats),
      );

    const awaySeasonStats =
      teamSeasonStatSummary(
        responseRows(awayTeamStats),
      );

    const officialStartMs =
      nbaOfficialStartMs(targetSeason);

    const homeRegularGames =
      responseRows(homeCurrent)
        .filter((g: any) => {
          const ms = gameStartMs(g);

          return (
            isFinished(g) &&
            ms >= officialStartMs &&
            ms < targetStartMs
          );
        }).length;

    const awayRegularGames =
      responseRows(awayCurrent)
        .filter((g: any) => {
          const ms = gameStartMs(g);

          return (
            isFinished(g) &&
            ms >= officialStartMs &&
            ms < targetStartMs
          );
        }).length;

    let model =
      buildQuantModel(
        homeMetrics,
        awayMetrics,
        h2h,
        homeSeasonStats,
        awaySeasonStats,
        homeRegularGames,
        awayRegularGames,
      );

    const fixture = {
      sport: "basketball",
      game_id: gameId,
      fixture_id: gameId,
      league: "NBA",
      season: targetSeason,
      stage:
        target?.stage ?? null,
      date:
        targetStart,
      status:
        target?.status ?? null,
      arena:
        target?.arena ?? null,
      home: {
        id: homeId,
        name:
          target?.teams?.home?.name ||
          "",
        name_zh:
          zhTeam(
            target?.teams?.home?.name,
          ),
        code:
          target?.teams?.home?.code ||
          "",
        logo:
          target?.teams?.home?.logo ||
          "",
      },
      away: {
        id: awayId,
        name:
          target?.teams?.visitors?.name ||
          "",
        name_zh:
          zhTeam(
            target?.teams?.visitors?.name,
          ),
        code:
          target?.teams?.visitors?.code ||
          "",
        logo:
          target?.teams?.visitors?.logo ||
          "",
      },
    };

    const marketContext =
      await loadMarketContext(
        fixture,
      );

    if (
      marketContext
        ?.injuries
        ?.available ===
      true
    ) {
      model =
        applyInjuryConfidence(
          model,
          marketContext
            .injuries,
        );
    }

    const sourceData = {
      fixture,
      recent_metrics: {
        home: homeMetrics,
        away: awayMetrics,
      },
      recent_games: {
        home:
          compactRecent(homeRecent),
        away:
          compactRecent(awayRecent),
      },
      head_to_head: h2h,
      standings: {
        home:
          homeStandingSummary,
        away:
          awayStandingSummary,
      },
      team_season_statistics: {
        home:
          homeSeasonStats,
        away:
          awaySeasonStats,
      },
      market_data: {
        odds_available:
          marketContext
            ?.market
            ?.available ===
          true,
        injuries_available:
          marketContext
            ?.injuries
            ?.available ===
          true,
        market:
          marketContext
            ?.market ||
          {
            available:
              false,
          },
        injuries:
          marketContext
            ?.injuries ||
          {
            available:
              false,
          },
        provider_status:
          marketContext
            ?.provider_status ||
          null,
      },
      model,
    };

    const narrative =
      await createNarrative(
        openAiKey,
        sourceData,
      );

    const baseResult: any = {
      success: true,
      mode,
      version:
        "habao-nba-quant-v1.3-market-line-aligned",
      generated_at:
        new Date().toISOString(),
      from_cache: false,
      fixture,
      data_available: {
        recent_games:
          homeRecent.length > 0 &&
          awayRecent.length > 0,
        head_to_head:
          h2h.games > 0,
        standings:
          Boolean(
            homeStandingSummary ||
            awayStandingSummary,
          ),
        team_statistics:
          Boolean(
            homeSeasonStats ||
            awaySeasonStats,
          ),
        market_odds:
          marketContext
            ?.market
            ?.available ===
          true,
        injuries:
          marketContext
            ?.injuries
            ?.available ===
          true,
      },
      model: {
        ...model,
        market_value_research: habaoSafeNbaResearchAudit(model, sourceData.market_data?.market, narrative),
      },
      market_data:
        sourceData.market_data,
      analysis: narrative,
      diagnostics: nbaAnalysisDiagnostics(sourceData, narrative?.recommendations),
      warnings: [
        marketContext
          ?.market
          ?.available ===
        true
          ? `已接入真實 NBA 市場盤口：市場主隊讓分 ${marketContext?.market?.primary?.home_spread ?? marketContext?.market?.consensus?.home_spread ?? "—"}｜市場大小分 ${marketContext?.market?.primary?.total ?? marketContext?.market?.consensus?.total ?? "—"}。`
          : "目前尚未取得真實市場讓分 / 大小分盤口，因此讓分與大小分會保守暫不推薦。",
        marketContext
          ?.injuries
          ?.available ===
        true
          ? `已接入正式 NBA 傷病資料：主隊 ${Number(marketContext?.injuries?.home?.summary?.total || 0)} 人｜客隊 ${Number(marketContext?.injuries?.away?.summary?.total || 0)} 人；目前先用於風險與信心修正。`
          : "目前尚未取得正式傷病資料，不虛構球員缺陣資訊。",
        "開季初 regular-season 樣本不足時，preseason 僅以較低權重作為輔助，前一季正式賽事作為較高權重基準。",
        "真實盤口推薦門檻：讓分模型差距至少 2.5 分；大小分模型差距至少 4.5 分，且模型 confidence 至少 58。",
        "傷病 v1 只做不確定性信心修正，不把角色球員與明星球員粗暴換算成相同固定分數。",
      ],
      api_quota_remaining:
        targetCall.remaining ?? null,
    };

    if (mode === "system_auto") {
      const writeResult =
        await writeAutoCache(
          gameId,
          baseResult,
        );

      return json({
        ...baseResult,
        cache: writeResult.cache,
        snapshot_created:
          writeResult.snapshot_created,
      });
    }

    return json({
      ...baseResult,
      debug:
        body?.debug === true
          ? sourceData
          : undefined,
    });
  } catch (error) {
    console.error(
      "BASKETBALL ANALYSIS ERROR:",
      error,
    );

    return json(
      {
        success: false,
        error: "system_error",
        message:
          "NBA AI 分析暫時無法完成",
        detail:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
});
