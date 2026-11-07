Deno.serve(async (req) => {

  const corsHeaders = {

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Headers":

      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods": "GET, OPTIONS",

  };



  if (req.method === "OPTIONS") {

    return new Response("ok", { headers: corsHeaders });

  }



  if (req.method !== "GET") {

    return new Response(

      JSON.stringify({ success: false, error: "method_not_allowed" }),

      {

        status: 405,

        headers: {

          ...corsHeaders,

          "Content-Type": "application/json; charset=utf-8",

        },

      },

    );

  }



  try {

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");



    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {

      throw new Error("Supabase environment variables missing");

    }



    const url = new URL(req.url);

    const daysParam = url.searchParams.get("days");

    const days = daysParam === "7" ? 7 : daysParam === "30" ? 30 : null;



    let query =

      `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots` +

      `?status=eq.verified` +

      `&excluded_from_public=eq.false` +

      `&settlement=not.is.null` +

      `&verified_at=not.is.null` +

      `&select=fixture_id,kickoff_at,league_name,home_team,away_team,prediction,home_score,away_score,settlement,verified_at,excluded_from_public` +

      `&order=kickoff_at.desc` +

      `&limit=1000`;



    if (days) {

      const since = new Date(

        Date.now() - days * 24 * 60 * 60 * 1000,

      ).toISOString();

      query += `&kickoff_at=gte.${encodeURIComponent(since)}`;

    }



    const response = await fetch(query, {

      headers: {

        apikey: SERVICE_ROLE_KEY,

        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,

      },

    });



    if (!response.ok) {

      throw new Error(await response.text());

    }



    let rows: any[] = await response.json();
    let publicStage = "t10";
    let publicStageEffectiveAt: string | null = null;
    let publicStageHistory: Array<{ stage: string; effective_at: string }> = [];
    try {
      const settingResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/football_v2_rollout_settings?select=public_stage,public_stage_effective_at&id=eq.true&limit=1`,
        { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(10000) },
      );
      if (settingResponse.ok) {
        const settingRows: any[] = await settingResponse.json();
        publicStage = ["t10", "t2", "t15"].includes(settingRows?.[0]?.public_stage) ? settingRows[0].public_stage : "t10";
        publicStageEffectiveAt = settingRows?.[0]?.public_stage_effective_at || null;
      }
      const historyResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/football_v2_public_stage_history?select=stage,effective_at&order=effective_at.asc&limit=200`,
        { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(10000) },
      );
      if (historyResponse.ok) {
        const historyRows: any[] = await historyResponse.json();
        publicStageHistory = Array.isArray(historyRows) ? historyRows.filter(x => ["t10", "t2", "t15"].includes(x.stage) && Number.isFinite(Date.parse(x.effective_at))) : [];
      }
    } catch (settingError) {
      console.warn("AI PERFORMANCE public stage setting unavailable; using T-10", settingError);
    }

    // Apply the stage that was active at each fixture's kickoff. This keeps
    // every previous public record stable across repeated admin switches.
    const stageAtKickoff = (value: unknown) => {
      const kickoff = Date.parse(String(value || ""));
      let selected = "t10";
      for (const item of publicStageHistory) if (Date.parse(item.effective_at) <= kickoff) selected = item.stage;
      return selected;
    };
    const rowStage = new Map<number, string>();
    for (const row of rows) rowStage.set(Number(row.fixture_id), stageAtKickoff(row.kickoff_at));
    const eligibleIds = rows.filter((row: any) => rowStage.get(Number(row.fixture_id)) !== "t10").map((row: any) => Number(row.fixture_id)).filter((id: number) => Number.isSafeInteger(id));
    if (eligibleIds.length) {
      const stageRows: any[] = [];
      for (let i = 0; i < eligibleIds.length; i += 80) {
        const ids = eligibleIds.slice(i, i + 80);
        if (!ids.length) continue;
        const stageUrl = `${SUPABASE_URL}/rest/v1/football_v2_shadow_stage_snapshots?fixture_id=in.(${ids.join(",")})&stage=in.(t2,t15)&model_version=eq.football-v2-poisson-shrinkage-0.2.1&research_only=eq.true&select=fixture_id,stage,kickoff_at,home_xg,away_xg,probabilities,market_context,model_version&limit=1000`;
        const stageResponse = await fetch(stageUrl, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(15000) });
        if (!stageResponse.ok) throw new Error(`public_stage_snapshot_read_${stageResponse.status}: ${await stageResponse.text()}`);
        const values = await stageResponse.json();
        if (Array.isArray(values)) stageRows.push(...values);
      }
      const byId = new Map<string, any>();
      for (const snapshot of stageRows) byId.set(`${Number(snapshot.fixture_id)}|${snapshot.stage}`, snapshot);
      const poisson = (lambda: number, k: number) => { let p = Math.exp(-lambda); for (let n = 1; n <= k; n++) p *= lambda / n; return p; };
      const splitLine = (line: number) => Math.abs(line * 4 - Math.round(line * 4)) < 1e-6 && Math.round(line * 4) % 2 ? [Math.floor(line * 2) / 2, Math.floor(line * 2) / 2 + 0.5] : [line];
      const settle = (value: number, line: number, side: "over" | "under" | "home" | "away") => {
        const outcomes = splitLine(line).map(part => {
          const adj = side === "over" ? value - part : side === "under" ? part - value : value + part;
          return adj > 1e-9 ? 1 : adj < -1e-9 ? -1 : 0;
        });
        const score = outcomes.reduce((sum, x) => sum + x, 0);
        return score === outcomes.length ? "win" : score === -outcomes.length ? "loss" : score > 0 ? "half_win" : score < 0 ? "half_loss" : "push";
      };
      const expected = (grid: any[], line: number, side: "over" | "under" | "home" | "away", odds: number) => {
        const parts = splitLine(line), stake = 1 / parts.length;
        let returned = 0;
        for (const cell of grid) for (const part of parts) {
          const value = side === "over" || side === "under" ? cell.h + cell.a : side === "home" ? cell.h - cell.a : cell.a - cell.h;
          const adj = side === "over" ? value - part : side === "under" ? part - value : value + part;
          const result = adj > 1e-9 ? 1 : adj < -1e-9 ? -1 : 0;
          returned += cell.p * stake * (result > 0 ? odds : result === 0 ? 1 : 0);
        }
        return returned - 1;
      };
      const patchedRows: any[] = [];
      for (const row of rows) {
        const selectedStage = rowStage.get(Number(row.fixture_id)) || "t10";
        const snapshot = selectedStage === "t10" ? null : byId.get(`${Number(row.fixture_id)}|${selectedStage}`);
        if (selectedStage !== "t10" && !snapshot) continue; // no silent T-10 fallback after a stage switch
        if (snapshot) {
          const hxg = Number(snapshot.home_xg), axg = Number(snapshot.away_xg), scoreGrid: any[] = [];
          if (!Number.isFinite(hxg) || !Number.isFinite(axg)) continue;
          const hp = Array.from({ length: 19 }, (_, n) => poisson(hxg, n)), ap = Array.from({ length: 19 }, (_, n) => poisson(axg, n));
          const mass = hp.reduce((s, p) => s + p, 0) * ap.reduce((s, p) => s + p, 0);
          for (let h = 0; h < 19; h++) for (let a = 0; a < 19; a++) scoreGrid.push({ h, a, p: hp[h] * ap[a] / mass });
          const p = snapshot.probabilities || {};
          const homeP = Number(p.home_win), drawP = Number(p.draw), awayP = Number(p.away_win), bttsP = Number(p.btts_yes);
          const home = Number.isFinite(homeP) ? homeP : scoreGrid.filter(x => x.h > x.a).reduce((s,x)=>s+x.p,0);
          const draw = Number.isFinite(drawP) ? drawP : scoreGrid.filter(x => x.h === x.a).reduce((s,x)=>s+x.p,0);
          const away = Number.isFinite(awayP) ? awayP : scoreGrid.filter(x => x.h < x.a).reduce((s,x)=>s+x.p,0);
          const both = Number.isFinite(bttsP) ? bttsP : scoreGrid.filter(x => x.h > 0 && x.a > 0).reduce((s,x)=>s+x.p,0);
          const money = [{ pick:"主勝", p:home },{ pick:"和局", p:draw },{ pick:"客勝", p:away }].sort((a,b)=>b.p-a.p)[0];
          const market = snapshot.market_context || {};
          const totalQuotes = Array.isArray(market.totals) ? market.totals : market.total ? [market.total] : [];
          const handicapQuotes = Array.isArray(market.handicaps) ? market.handicaps : market.handicap ? [market.handicap] : [];
          let totalPick: any = null, handicapPick: any = null;
          const totalOptions = totalQuotes.flatMap((quote: any) => {
            const line = Number(quote?.line), overOdds = Number(quote?.over_odds), underOdds = Number(quote?.under_odds);
            if (!Number.isFinite(line) || !(overOdds > 1) || !(underOdds > 1)) return [];
            const overEv = expected(scoreGrid,line,"over",overOdds), underEv = expected(scoreGrid,line,"under",underOdds), side = overEv >= underEv ? "over" : "under";
            return [{ pick:side === "over" ? "大" : "小", line, ev:Math.max(overEv,underEv) }];
          }).sort((a: any,b: any)=>b.ev-a.ev);
          if (totalOptions.length) { const best=totalOptions[0]; totalPick={pick:best.pick,line:best.line,reason:`比較所選階段所有實際大小球盤線後選出：${best.line}`}; }
          const handicapOptions = handicapQuotes.flatMap((quote: any) => {
            const homeLine = Number(quote?.home_line), awayLine = Number(quote?.away_line), homeOdds = Number(quote?.home_odds), awayOdds = Number(quote?.away_odds);
            if (!Number.isFinite(homeLine) || !Number.isFinite(awayLine) || !(homeOdds > 1) || !(awayOdds > 1)) return [];
            const homeEv = expected(scoreGrid,homeLine,"home",homeOdds), awayEv = expected(scoreGrid,awayLine,"away",awayOdds), home = homeEv >= awayEv;
            return [{ pick:home ? "主隊" : "客隊", line:home ? homeLine : awayLine, ev:Math.max(homeEv,awayEv) }];
          }).sort((a: any,b: any)=>b.ev-a.ev);
          if (handicapOptions.length) { const best=handicapOptions[0]; handicapPick={pick:best.pick,line:best.line,reason:`比較所選階段所有實際讓分盤線後選出：${best.line}`}; }
          const bttsPick = both >= 0.5 ? "是" : "否";
          const recommendations = {
            moneyline:{pick:money.pick,confidence:Math.round(money.p*100)},
            over_under:totalPick || {pick:"暫不推薦",line:null,confidence:0},
            handicap:handicapPick || {pick:"暫不推薦",line:null,confidence:0},
            btts:{pick:bttsPick,confidence:Math.round(Math.max(both,1-both)*100)},
          };
          const actualWinner = Number(row.home_score) > Number(row.away_score) ? "主勝" : Number(row.home_score) < Number(row.away_score) ? "客勝" : "和局";
          const settlement: any = {
            moneyline:{result:money.pick === actualWinner ? "win" : "loss",pick:money.pick,decided:true},
            btts:{result:(bttsPick === "是") === (Number(row.home_score)>0 && Number(row.away_score)>0) ? "win" : "loss",pick:bttsPick,decided:true},
          };
          if (totalPick) settlement.over_under = {result:settle(Number(row.home_score)+Number(row.away_score),Number(totalPick.line),totalPick.pick === "大" ? "over" : "under"),pick:totalPick.pick,line:totalPick.line,decided:true};
          if (handicapPick) settlement.handicap = {result:settle(handicapPick.pick === "主隊" ? Number(row.home_score)-Number(row.away_score) : Number(row.away_score)-Number(row.home_score),Number(handicapPick.line),handicapPick.pick === "主隊" ? "home" : "away"),pick:handicapPick.pick,line:handicapPick.line,decided:true};
          patchedRows.push({...row,public_stage:selectedStage,prediction:{analysis:{recommendations},v2_public_stage:selectedStage},settlement});
        } else patchedRows.push({...row,public_stage:"t10"});
      }
      rows = patchedRows;
    }

    // =====================================================
    // Optional historical backtest aggregate
    // Only used by ALL-TIME top summary / market cards.
    // Never injected into recent form, trend, leagues or records.
    // Keep this table empty unless values come from a real backtest.
    // =====================================================
    let backtestSummary: any = null;

    if (!days && publicStage === "t10" && !publicStageHistory.some(item => item.stage !== "t10")) {
      try {
        const backtestQuery =
          `${SUPABASE_URL}/rest/v1/ai_backtest_summary` +
          `?sport=eq.football` +
          `&active=eq.true` +
          `&select=sample_matches,moneyline,over_under,btts,range_start,range_end,sample_kind,sample_note` +
          `&order=updated_at.desc` +
          `&limit=1`;

        const backtestResponse = await fetch(backtestQuery, {
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
        });

        if (backtestResponse.ok) {
          const backtestRows: any[] = await backtestResponse.json();
          backtestSummary = backtestRows?.[0] || null;
        } else if (backtestResponse.status !== 404) {
          console.warn(
            "AI PERFORMANCE backtest summary read failed:",
            await backtestResponse.text(),
          );
        }
      } catch (backtestError) {
        console.warn(
          "AI PERFORMANCE backtest summary read error:",
          backtestError,
        );
      }
    }

    const MARKET_KEYS = ["moneyline", "over_under", "btts"] as const;



    const createMarketStats = () => ({

      total: 0,

      win: 0,

      loss: 0,

      push: 0,

      half_win: 0,

      half_loss: 0,

    });



    const normalizeResult = (value: unknown) => {

      const text = String(value ?? "").trim().toLowerCase();

      if (text === "win" || text === "won") return "win";

      if (text === "loss" || text === "lose" || text === "lost") return "loss";

      if (text === "push") return "push";

      if (text === "half_win" || text === "half-win") return "half_win";

      if (text === "half_loss" || text === "half-loss") return "half_loss";

      return null;

    };



    const getSettlementResult = (settlement: any, market: string) => {

      if (!settlement) return null;

      const value = settlement?.[market];

      if (value && typeof value === "object") {

        return normalizeResult(value.result ?? value.status ?? value.outcome);

      }

      return normalizeResult(value);

    };



    const addResult = (marketStats: any, rawResult: unknown) => {

      const result = normalizeResult(rawResult);

      if (!result) return;

      marketStats.total++;

      marketStats[result]++;

    };



    const effectiveParts = (market: any) => {

      const win = Number(market?.win || 0);

      const loss = Number(market?.loss || 0);

      const halfWin = Number(market?.half_win || 0);

      const halfLoss = Number(market?.half_loss || 0);

      const effectiveWins = win + halfWin * 0.5;

      const effectiveLosses = loss + halfLoss * 0.5;

      return {

        effectiveWins,

        effectiveLosses,

        denominator: effectiveWins + effectiveLosses,

      };

    };



    const calcRate = (market: any) => {

      const { effectiveWins, denominator } = effectiveParts(market);

      if (denominator <= 0) return 0;

      return Number(((effectiveWins / denominator) * 100).toFixed(1));

    };



    const withRate = (market: any) => {

      const { effectiveWins, effectiveLosses, denominator } = effectiveParts(market);

      return {

        ...market,

        effective_wins: Number(effectiveWins.toFixed(1)),

        effective_losses: Number(effectiveLosses.toFixed(1)),

        decided: Number(denominator.toFixed(1)),

        hit_rate: calcRate(market),

      };

    };



    const mergeMarket = (target: any, source: any) => {

      for (const key of ["total", "win", "loss", "push", "half_win", "half_loss"]) {

        target[key] += Number(source?.[key] || 0);

      }

    };



    const stats: any = {

      total_matches: rows.length,

      overall: createMarketStats(),

      moneyline: createMarketStats(),

      over_under: createMarketStats(),

      btts: createMarketStats(),

    };



    const leagueMap: Record<string, any> = {};

    const dailyMap: Record<string, any> = {};



    const taipeiDateKey = (value: string) => {

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) return "unknown";

      const parts = new Intl.DateTimeFormat("en-CA", {

        timeZone: "Asia/Taipei",

        year: "numeric",

        month: "2-digit",

        day: "2-digit",

      }).formatToParts(date);

      const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

      return `${get("year")}-${get("month")}-${get("day")}`;

    };





    // ==========================================

    // Enrich snapshot rows with fixture_cache

    // so old public records can still expose

    // API original names for English UI.

    // ==========================================

    const fixtureMetaMap = new Map<string, any>();



    const rowDates = rows

      .map((row: any) => taipeiDateKey(row?.kickoff_at))

      .filter((date: string) => date && date !== "unknown")

      .sort();



    if (rowDates.length) {

      const minDate = rowDates[0];

      const maxDate = rowDates[rowDates.length - 1];



      const cacheQuery =

        `${SUPABASE_URL}/rest/v1/fixture_cache` +

        `?select=fixture_date,fixtures` +

        `&fixture_date=gte.${encodeURIComponent(minDate)}` +

        `&fixture_date=lte.${encodeURIComponent(maxDate)}` +

        `&order=fixture_date.asc` +

        `&limit=1000`;



      try {

        const cacheResponse = await fetch(cacheQuery, {

          headers: {

            apikey: SERVICE_ROLE_KEY,

            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,

          },

        });



        if (cacheResponse.ok) {

          const cacheRows: any[] = await cacheResponse.json();



          for (const cacheRow of cacheRows) {

            const fixtures = Array.isArray(cacheRow?.fixtures)

              ? cacheRow.fixtures

              : [];



            for (const fixture of fixtures) {

              const id = fixture?.fixtureId;

              if (id == null) continue;



              fixtureMetaMap.set(String(id), {

                league: fixture?.league || null,

                home: fixture?.home || null,

                away: fixture?.away || null,

              });

            }

          }

        } else {

          console.warn(

            "AI PERFORMANCE fixture_cache enrich failed:",

            await cacheResponse.text(),

          );

        }

      } catch (cacheError) {

        console.warn(

          "AI PERFORMANCE fixture_cache enrich error:",

          cacheError,

        );

      }

    }



    const getFixtureMeta = (row: any) =>

      fixtureMetaMap.get(String(row?.fixture_id ?? "")) || {};



    const normalizeLeagueName = (value: any) => {

      if (value && typeof value === "object") {

        return String(value?.name || value?.api_name || value?.league_name || "其他聯賽").trim() || "其他聯賽";

      }

      const text = String(value ?? "").trim();

      if (text.startsWith("{") || text.startsWith("[")) {

        try { return normalizeLeagueName(JSON.parse(text)); } catch {}

      }

      return text || "其他聯賽";

    };



    const isGenericOtherLeague = (value: unknown) => {

      const text = String(value ?? "").trim().toLowerCase();

      return (

        !text ||

        text === "--" ||

        text === "其他聯賽" ||

        text === "其他联赛" ||

        text === "other league"

      );

    };



    const scoreResult = (result: string | null) => {

      if (result === "win") return 1;

      if (result === "half_win") return 0.5;

      if (result === "loss") return -1;

      if (result === "half_loss") return -0.5;

      return 0;

    };



    const classifyMatchOverall = (settlement: any) => {

      const results = MARKET_KEYS

        .map((market) => getSettlementResult(settlement, market))

        .filter(Boolean) as string[];

      if (!results.length) return null;

      const score = results.reduce((sum, result) => sum + scoreResult(result), 0);

      if (score > 0) return "win";

      if (score < 0) return "loss";

      return "push";

    };



    for (const row of rows) {

      const settlement = row?.settlement;

      if (!settlement) continue;



      const marketResults: Record<string, string | null> = {};

      for (const market of MARKET_KEYS) {

        const result = getSettlementResult(settlement, market);

        marketResults[market] = result;

        addResult(stats[market], result);

        addResult(stats.overall, result);

      }



      const fixtureMeta = getFixtureMeta(row);

      const storedLeagueName =

        normalizeLeagueName(row?.league_name);



      const enrichedLeagueName =

        isGenericOtherLeague(storedLeagueName) &&

        String(fixtureMeta?.league?.name || "").trim()

          ? String(fixtureMeta.league.name).trim()

          : storedLeagueName;



      const leagueName = enrichedLeagueName;



      if (!leagueMap[leagueName]) {

        leagueMap[leagueName] = {

          league: leagueName,

          league_id:

            fixtureMeta?.league?.id != null

              ? Number(fixtureMeta.league.id)

              : null,

          league_api_name:

            String(

              fixtureMeta?.league?.api_name ||

              fixtureMeta?.league?.name ||

              "",

            ).trim() || null,

          league_logo:

            String(fixtureMeta?.league?.logo || "").trim() || null,

          matches: 0,

          overall: createMarketStats(),

          moneyline: createMarketStats(),

          over_under: createMarketStats(),

          btts: createMarketStats(),

        };

      } else {

        if (

          leagueMap[leagueName].league_id == null &&

          fixtureMeta?.league?.id != null

        ) {

          leagueMap[leagueName].league_id =

            Number(fixtureMeta.league.id);

        }



        if (

          !leagueMap[leagueName].league_api_name &&

          (fixtureMeta?.league?.api_name || fixtureMeta?.league?.name)

        ) {

          leagueMap[leagueName].league_api_name =

            String(

              fixtureMeta?.league?.api_name ||

              fixtureMeta?.league?.name ||

              "",

            ).trim() || null;

        }



        if (

          !leagueMap[leagueName].league_logo &&

          fixtureMeta?.league?.logo

        ) {

          leagueMap[leagueName].league_logo =

            String(fixtureMeta.league.logo).trim() || null;

        }

      }



      const leagueStats = leagueMap[leagueName];

      leagueStats.matches++;

      for (const market of MARKET_KEYS) {

        addResult(leagueStats[market], marketResults[market]);

        addResult(leagueStats.overall, marketResults[market]);

      }



      const day = taipeiDateKey(row.kickoff_at);

      if (!dailyMap[day]) {

        dailyMap[day] = {

          date: day,

          matches: 0,

          overall: createMarketStats(),

          moneyline: createMarketStats(),

          over_under: createMarketStats(),

          btts: createMarketStats(),

        };

      }

      const daily = dailyMap[day];

      daily.matches++;

      for (const market of MARKET_KEYS) {

        addResult(daily[market], marketResults[market]);

        addResult(daily.overall, marketResults[market]);

      }

    }



    // Merge historical backtest into TOP-LEVEL totals only.
    // Public league / recent / trend / record data stays untouched.
    if (!days && backtestSummary) {
      const backtestMatches = Math.max(0, Number(backtestSummary?.sample_matches || 0));
      stats.total_matches += backtestMatches;

      for (const market of MARKET_KEYS) {
        const source = backtestSummary?.[market] || {};
        mergeMarket(stats[market], source);
        mergeMarket(stats.overall, source);
      }
    }

    const leagues = Object.values(leagueMap)

      .map((league: any) => ({

        league: league.league,

        league_id: league.league_id ?? null,

        league_api_name: league.league_api_name ?? null,

        league_logo: league.league_logo ?? null,

        matches: league.matches,

        overall: withRate(league.overall),

        moneyline: withRate(league.moneyline),

        over_under: withRate(league.over_under),

        btts: withRate(league.btts),

      }))

      .sort((a: any, b: any) => b.matches - a.matches);



    const trend = Object.values(dailyMap)

      .map((day: any) => ({

        date: day.date,

        matches: day.matches,

        overall: withRate(day.overall),

        moneyline: withRate(day.moneyline),

        over_under: withRate(day.over_under),

        btts: withRate(day.btts),

      }))

      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));



    const recentForMarket = (market: string) => {

      const items: any[] = [];

      for (const row of rows) {

        const result = getSettlementResult(row?.settlement, market);

        if (!result) continue;

        const fixtureMeta = getFixtureMeta(row);

        items.push({

          fixture_id: row.fixture_id,

          kickoff_at: row.kickoff_at,

          league:

            isGenericOtherLeague(row.league_name) &&

            fixtureMeta?.league?.name

              ? fixtureMeta.league.name

              : normalizeLeagueName(row.league_name),

          league_id:

            fixtureMeta?.league?.id != null

              ? Number(fixtureMeta.league.id)

              : null,

          league_api_name:

            fixtureMeta?.league?.api_name ||

            fixtureMeta?.league?.name ||

            null,

          home: row.home_team,

          home_api_name:

            fixtureMeta?.home?.api_name || null,

          away: row.away_team,

          away_api_name:

            fixtureMeta?.away?.api_name || null,

          result,

        });

        if (items.length >= 10) break;

      }

      return items;

    };



    const recentOverall: any[] = [];

    for (const row of rows) {

      const result = classifyMatchOverall(row?.settlement);

      if (!result) continue;

      const fixtureMeta = getFixtureMeta(row);

      recentOverall.push({

        fixture_id: row.fixture_id,

        kickoff_at: row.kickoff_at,

        league:

          isGenericOtherLeague(row.league_name) &&

          fixtureMeta?.league?.name

            ? fixtureMeta.league.name

            : normalizeLeagueName(row.league_name),

        league_id:

          fixtureMeta?.league?.id != null

            ? Number(fixtureMeta.league.id)

            : null,

        league_api_name:

          fixtureMeta?.league?.api_name ||

          fixtureMeta?.league?.name ||

          null,

        home: row.home_team,

        home_api_name:

          fixtureMeta?.home?.api_name || null,

        away: row.away_team,

        away_api_name:

          fixtureMeta?.away?.api_name || null,

        result,

      });

      if (recentOverall.length >= 10) break;

    }



    const summarizeRecent = (items: any[]) => {

      const summary = { total: items.length, win: 0, loss: 0, push: 0, half_win: 0, half_loss: 0 };

      for (const item of items) {

        const result = normalizeResult(item?.result);

        if (result) summary[result]++;

      }

      return summary;

    };



    const recent_form = {

      overall: { items: recentOverall, summary: summarizeRecent(recentOverall) },

      moneyline: { items: recentForMarket("moneyline"), summary: null as any },

      over_under: { items: recentForMarket("over_under"), summary: null as any },

      btts: { items: recentForMarket("btts"), summary: null as any },

    };

    recent_form.moneyline.summary = summarizeRecent(recent_form.moneyline.items);

    recent_form.over_under.summary = summarizeRecent(recent_form.over_under.items);

    recent_form.btts.summary = summarizeRecent(recent_form.btts.items);



    const publicDates = rows
      .map((row: any) => String(row?.kickoff_at || ""))
      .filter(Boolean)
      .sort();

    let rangeStart = publicDates.length ? publicDates[0] : null;
    let rangeEnd = publicDates.length ? publicDates[publicDates.length - 1] : null;

    if (!days && backtestSummary) {
      const backtestStart = backtestSummary?.range_start
        ? new Date(`${backtestSummary.range_start}T00:00:00+08:00`).toISOString()
        : null;
      const backtestEnd = backtestSummary?.range_end
        ? new Date(`${backtestSummary.range_end}T23:59:59+08:00`).toISOString()
        : null;

      if (backtestStart && (!rangeStart || backtestStart < rangeStart)) rangeStart = backtestStart;
      if (backtestEnd && (!rangeEnd || backtestEnd > rangeEnd)) rangeEnd = backtestEnd;
    }

    const result = {

      success: true,

      generated_at: new Date().toISOString(),

      filter: {

        days,

        label: days === 7 ? "近 7 天" : days === 30 ? "近 30 天" : "全部",

      },

      public_stage: publicStage,
      public_stage_effective_at: publicStageEffectiveAt,

      methodology: {

        automatic_inclusion: true,

        pre_match_snapshot: true,

        manual_selection: false,

        note: `公開戰績依每場開賽時的管理員設定使用 T-10、T-2 或 T-15 階段；目前新賽事選用 ${publicStage === "t2" ? "T-2 小時" : publicStage === "t15" ? "T-15 分鐘" : "T-10 小時"}。切換只影響之後開賽的賽事，舊賽事不回寫。`,

      },

      summary: {

        verified_matches: stats.total_matches,

        total_market_verifications: stats.overall.total,

        overall: withRate(stats.overall),

        range_start: rangeStart,

        range_end: rangeEnd,

        backtest_matches: !days ? Math.max(0, Number(backtestSummary?.sample_matches || 0)) : 0,
        backtest_kind: !days ? String(backtestSummary?.sample_kind || "") : "",
        backtest_note: !days ? String(backtestSummary?.sample_note || "") : "",

      },

      markets: {

        moneyline: withRate(stats.moneyline),

        over_under: withRate(stats.over_under),

        btts: withRate(stats.btts),

      },

      recent_form,

      trend,

      leagues,

      matches: rows.map((row: any) => {

        const fixtureMeta = getFixtureMeta(row);



        return {

          fixture_id: row.fixture_id,

          kickoff_at: row.kickoff_at,



          league:

            isGenericOtherLeague(row.league_name) &&

            fixtureMeta?.league?.name

              ? fixtureMeta.league.name

              : normalizeLeagueName(row.league_name),



          league_id:

            fixtureMeta?.league?.id != null

              ? Number(fixtureMeta.league.id)

              : null,



          league_api_name:

            fixtureMeta?.league?.api_name ||

            fixtureMeta?.league?.name ||

            null,



          league_logo:

            fixtureMeta?.league?.logo || null,



          home: row.home_team,

          home_api_name:

            fixtureMeta?.home?.api_name || null,



          away: row.away_team,

          away_api_name:

            fixtureMeta?.away?.api_name || null,



          final_score:

            row.home_score != null && row.away_score != null

              ? `${row.home_score}-${row.away_score}`

              : null,



          prediction: row.prediction,

          public_stage: row.public_stage || "t10",

          settlement: row.settlement,

          verified_at: row.verified_at,

        };

      }),

    };



    return new Response(JSON.stringify(result), {

      headers: {

        ...corsHeaders,

        "Content-Type": "application/json; charset=utf-8",

        "Cache-Control": "public, max-age=60",

      },

    });

  } catch (error) {

    console.error("AI PERFORMANCE ERROR:", error);

    return new Response(

      JSON.stringify({

        success: false,

        error: error instanceof Error ? error.message : "Unknown error",

      }),

      {

        status: 500,

        headers: {

          ...corsHeaders,

          "Content-Type": "application/json; charset=utf-8",

        },

      },

    );

  }

});
