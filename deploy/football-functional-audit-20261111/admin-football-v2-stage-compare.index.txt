// Read-only paired-stage research backtest for V2 T-10 / T-2 / T-15 snapshots.
// It does not alter the member-facing T-10 snapshot or public performance data.
const VERSION = "football-v2-poisson-player-impact-0.3.0";
const STAGES = ["t10", "t2", "t15"] as const;
const PAGE_SIZE = 1000, MAX_ROWS = 10000, GRID_MAX = 18;
const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-session, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function safe(x: unknown) { return String(x ?? "").slice(0, 180).replace(/[\r\n]/g, " "); }
function num(x: unknown): number | null {
  if (x === null || x === undefined || typeof x === "boolean" || String(x).trim() === "") return null;
  const n = Number(x); return Number.isFinite(n) ? n : null;
}
function json(x: unknown): any {
  if (typeof x !== "string") return x ?? {};
  try { return JSON.parse(x); } catch { return {}; }
}
function poisson(lambda: number, k: number) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
function scoreGrid(homeXg: number, awayXg: number) {
  const hp = Array.from({ length: GRID_MAX + 1 }, (_, i) => poisson(homeXg, i));
  const ap = Array.from({ length: GRID_MAX + 1 }, (_, i) => poisson(awayXg, i));
  const mass = hp.reduce((s, p) => s + p, 0) * ap.reduce((s, p) => s + p, 0);
  if (!Number.isFinite(mass) || mass <= 0) throw new Error("poisson_probability_mass_invalid");
  const cells: Array<{ h: number; a: number; p: number }> = [];
  for (let h = 0; h <= GRID_MAX; h++) for (let a = 0; a <= GRID_MAX; a++) cells.push({ h, a, p: hp[h] * ap[a] / mass });
  return cells;
}
function accuracy(rows: any[], stage: string, getter: (p: any) => boolean | null) {
  const outcomes = rows.map(r => getter(r.predictions[stage])).filter((x): x is boolean => typeof x === "boolean");
  const correct = outcomes.filter(Boolean).length;
  return { correct, total: outcomes.length, pushes_or_unavailable: rows.length - outcomes.length,
    accuracy: outcomes.length ? correct / outcomes.length : null };
}
function marketQuote(snapshot: any) {
  const context = json(snapshot.market_context);
  const oddsOkay = (x: unknown) => num(x) !== null && Number(x) > 1 && Number(x) <= 100;
  const totalRows = Array.isArray(context?.totals) ? context.totals : context?.total ? [context.total] : [];
  const handicapRows = Array.isArray(context?.handicaps) ? context.handicaps : context?.handicap ? [context.handicap] : [];
  const totals = totalRows.filter((x: any) => num(x?.line) !== null && Math.abs(Number(x.line)*4-Math.round(Number(x.line)*4))<1e-6 && oddsOkay(x?.over_odds) && oddsOkay(x?.under_odds))
    .map((x: any) => ({ line: Number(x.line), over_odds: Number(x.over_odds), under_odds: Number(x.under_odds), bookmaker_count: Number(x.bookmaker_count)||0 }))
    .sort((a: any,b: any) => a.line-b.line);
  const handicaps = handicapRows.filter((x: any) => num(x?.home_line) !== null && num(x?.away_line) !== null && Math.abs(Number(x.home_line)+Number(x.away_line))<1e-6 && Math.abs(Number(x.home_line)*4-Math.round(Number(x.home_line)*4))<1e-6 && oddsOkay(x?.home_odds) && oddsOkay(x?.away_odds))
    .map((x: any) => ({ home_line: Number(x.home_line), away_line: Number(x.away_line), home_odds: Number(x.home_odds), away_odds: Number(x.away_odds), bookmaker_count: Number(x.bookmaker_count)||0 }))
    .sort((a: any,b: any) => a.home_line-b.home_line);
  return { totals, handicaps, total: totals[0] || null, handicap: handicaps[0] || null };
}
function splitLine(line: number) {
  const scaled = Math.round(line * 100), rem = Math.abs(scaled % 100);
  if (rem === 25) return [(Math.floor(line * 2) / 2), (Math.ceil(line * 2) / 2)];
  if (rem === 75) return [(Math.floor(line * 2) / 2), (Math.ceil(line * 2) / 2)];
  return [line];
}
function marketLegResult(value: number, line: number, side: "over" | "under" | "home" | "away") {
  const margin = side === "over" ? value - line : side === "under" ? line - value : value + line;
  return margin > 1e-9 ? "win" : margin < -1e-9 ? "loss" : "push";
}
function settlement(value: number, line: number, side: "over" | "under" | "home" | "away", odds: number) {
  const lines = splitLine(line), stake = 1 / lines.length;
  let returned = 0, wins = 0, pushes = 0;
  for (const leg of lines) {
    const outcome = marketLegResult(value, leg, side);
    if (outcome === "win") { returned += stake * odds; wins++; }
    else if (outcome === "push") { returned += stake; pushes++; }
  }
  const profit = returned - 1;
  const result = profit > 1e-9 ? (pushes ? "half_win" : "win")
    : profit < -1e-9 ? (pushes ? "half_loss" : "loss") : "push";
  return { result, hit: profit > 1e-9 ? true : profit < -1e-9 ? false : null,
    return_units: Number(profit.toFixed(6)), lines };
}
function expectedReturn(cells: Array<{h:number;a:number;p:number}>, line: number, side: "over" | "under" | "home" | "away", odds: number) {
  const lines = splitLine(line), stake = 1 / lines.length;
  let returned = 0;
  for (const cell of cells) for (const leg of lines) {
    const value = side === "over" || side === "under" ? cell.h + cell.a
      : side === "home" ? cell.h - cell.a : cell.a - cell.h;
    const outcome = marketLegResult(value, leg, side);
    returned += cell.p * stake * (outcome === "win" ? odds : outcome === "push" ? 1 : 0);
  }
  return returned - 1;
}
function pairedData(byFixture: Map<number, Map<string, any>>, results: Map<number, any>) {
  const rows: any[] = [];
  for (const [id, result] of results) {
    const stages = byFixture.get(id);
    if (!stages || !STAGES.every(s => stages.has(s))) continue;
    const hs = num(result.home_score), as = num(result.away_score);
    if (!Number.isInteger(hs) || !Number.isInteger(as) || hs===null || as===null || hs<0 || as<0 || result.excluded_from_public === true) continue;
    const predictions: Record<string, any> = {};
    for (const stage of STAGES) {
      const snap = stages.get(stage), homeXg = num(snap.home_xg), awayXg = num(snap.away_xg), quote = marketQuote(snap);
      if (homeXg === null || awayXg === null || homeXg < 0 || awayXg < 0 || homeXg > 12 || awayXg > 12) {
        predictions[stage] = { unavailable: "invalid_xg", market: quote }; continue;
      }
      const grid = scoreGrid(homeXg, awayXg), p: any = json(snap.probabilities);
      const winner = [["home", num(p.home_win)], ["draw", num(p.draw)], ["away", num(p.away_win)]]
        .filter((x: any) => x[1] !== null && x[1] >= 0 && x[1] <= 1)
        .sort((a: any, b: any) => b[1] - a[1])[0]?.[0] ?? null;
      const actualWinner = hs > as ? "home" : hs < as ? "away" : "draw", bttsProb = num(p.btts_yes);
      const totalPredictions = quote.totals.map((line: any) => {
        const overEV = expectedReturn(grid, line.line, "over", line.over_odds);
        const underEV = expectedReturn(grid, line.line, "under", line.under_odds);
        const pick = overEV >= underEV ? "over" : "under", odds = pick === "over" ? line.over_odds : line.under_odds;
        return { line: line.line, pick, odds, bookmaker_count: line.bookmaker_count,
          expected_return_units: Number(Math.max(overEV, underEV).toFixed(6)), ...settlement(hs + as, line.line, pick, odds) };
      });
      const selectedTotal = totalPredictions.reduce((best: any, x: any) =>
        !best || x.expected_return_units > best.expected_return_units ? x : best, null);
      const handicapPredictions = quote.handicaps.map((h: any) => {
        const homeEV = expectedReturn(grid, h.home_line, "home", h.home_odds);
        const awayEV = expectedReturn(grid, h.away_line, "away", h.away_odds);
        const pick = homeEV >= awayEV ? "home" : "away", line = pick === "home" ? h.home_line : h.away_line;
        const odds = pick === "home" ? h.home_odds : h.away_odds;
        const value = pick === "home" ? hs - as : as - hs;
        return { home_line: h.home_line, away_line: h.away_line, pick, odds, bookmaker_count: h.bookmaker_count,
          expected_return_units: Number(Math.max(homeEV, awayEV).toFixed(6)), ...settlement(value, line, pick, odds) };
      });
      const selectedHandicap = handicapPredictions.reduce((best: any, x: any) =>
        !best || x.expected_return_units > best.expected_return_units ? x : best, null);
      const source = json(snap.source_meta), llm = source?.llm_shadow, providers: Record<string, any> = {};
      for (const provider of ["gpt", "claude"]) {
        const saved = llm?.providers?.[provider] || { status: "not_run" };
        if (saved.status !== "ready" || !saved.output) { providers[provider] = { status: saved.status, model: saved.model || null }; continue; }
        const output = saved.output;
        const totalSettlements = (Array.isArray(output.total_picks) ? output.total_picks : []).flatMap((pick: any) => {
          const line = quote.totals.find((x: any) => Number(x.line).toFixed(2) === Number(pick.line).toFixed(2));
          if (!line || !["over","under"].includes(String(pick.pick))) return [];
          const odds = pick.pick === "over" ? line.over_odds : line.under_odds;
          return [{ line: line.line, pick: pick.pick, ...settlement(hs + as, line.line, pick.pick, odds) }];
        });
        const handicapSettlements = (Array.isArray(output.handicap_picks) ? output.handicap_picks : []).flatMap((pick: any) => {
          const line = quote.handicaps.find((x: any) => Number(x.home_line).toFixed(2) === Number(pick.home_line).toFixed(2));
          if (!line || !["home","away"].includes(String(pick.pick))) return [];
          const selectedLine = pick.pick === "home" ? line.home_line : line.away_line;
          const value = pick.pick === "home" ? hs - as : as - hs;
          const odds = pick.pick === "home" ? line.home_odds : line.away_odds;
          return [{ home_line: line.home_line, away_line: line.away_line, pick: pick.pick, ...settlement(value, selectedLine, pick.pick, odds) }];
        });
        providers[provider] = {
          status: saved.status, model: saved.model || null,
          output: { ...output,
            moneyline_hit: ["home","draw","away"].includes(String(output.moneyline_pick)) ? output.moneyline_pick === actualWinner : null,
            btts_hit: ["yes","no"].includes(String(output.btts_pick)) ? (output.btts_pick === "yes") === (hs > 0 && as > 0) : null,
            total_settlements: totalSettlements, handicap_settlements: handicapSettlements }
        };
      }
      predictions[stage] = {
        moneyline_pick: winner, moneyline_hit: winner === null ? null : winner === actualWinner,
        btts_pick: bttsProb === null ? null : bttsProb >= 0.5 ? "yes" : "no",
        btts_hit: bttsProb === null ? null : (bttsProb >= 0.5) === (hs > 0 && as > 0),
        market: { total: selectedTotal, totals: selectedTotal ? [selectedTotal] : [],
          handicap: selectedHandicap, handicaps: selectedHandicap ? [selectedHandicap] : [] },
        llm: { status: llm?.status || "not_run", version: llm?.version || null, generated_at: llm?.generated_at || null, providers }
      };
    }
    rows.push({ fixture_id: id, kickoff_at: String(result.kickoff_at || ""), home_score: hs, away_score: as, predictions });
  }
  return rows.sort((a, b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at));
}
function summarizeBets(bets: any[]) {
  const settled = bets.filter((x: any) => typeof x.hit === "boolean"), correct = settled.filter((x: any) => x.hit).length;
  return { correct, total: settled.length, pushes_or_unavailable: bets.length - settled.length,
    accuracy: settled.length ? correct / settled.length : null,
    avg_return_units: bets.length && bets.some((x: any) => x.return_units !== undefined)
      ? bets.reduce((sum:number,x:any)=>sum+Number(x.return_units||0),0)/bets.length : null,
    bet_count: bets.length };
}
function marketMetrics(rows: any[], market: "total" | "handicap") {
  const field = market === "total" ? "total" : "handicap";
  const selected = (r: any, stage: string) => r.predictions?.[stage]?.market?.[field] || null;
  // One selected market outcome per fixture and stage; keep the same fixtures paired across all three stages.
  const paired = rows.filter(r => STAGES.every(s => selected(r, s) !== null));
  const byStage = Object.fromEntries(STAGES.map(stage => {
    const bets = paired.map(r => selected(r, stage));
    return [stage, summarizeBets(bets)];
  }));
  return { paired_fixture_count: paired.length, by_stage: byStage, unit: "match" };
}
function llmMetrics(rows: any[]) {
  const metrics: Record<string, any> = {};
  for (const provider of ["gpt","claude"]) {
    metrics[provider] = {};
    for (const market of ["moneyline","btts","totals","handicaps"]) {
      metrics[provider][market] = Object.fromEntries(STAGES.map(stage => {
        const bets = rows.flatMap(r => {
          const x = r.predictions?.[stage]?.llm?.providers?.[provider]?.output;
          if (!x) return [];
          if (market === "moneyline") return typeof x.moneyline_hit === "boolean" ? [{ hit:x.moneyline_hit }] : [];
          if (market === "btts") return typeof x.btts_hit === "boolean" ? [{ hit:x.btts_hit }] : [];
          return market === "totals" ? (x.total_settlements || []) : (x.handicap_settlements || []);
        });
        const summary: any = summarizeBets(bets);
        if (market === "totals" || market === "handicaps") {
          const lineField = market === "totals" ? "line" : "home_line";
          const lineKeys = [...new Set(bets.map((x: any) => Number(x[lineField]).toFixed(2)))].sort((a,b)=>Number(a)-Number(b));
          summary.by_line = Object.fromEntries(lineKeys.map(line => [line, summarizeBets(bets.filter((x: any) => Number(x[lineField]).toFixed(2) === line))]));
        }
        return [stage, summary];
      }));
    }
  }
  return metrics;
}
function coverage(stage: string, snaps: any[], audits: any[], paired: any[]) {
  const allStageSnaps = snaps.filter(x => x.stage === stage);
  const recovered = allStageSnaps.filter(x => json(x.source_meta)?.capture_mode === "late_pre_match_recovery");
  const s = allStageSnaps.filter(x => json(x.source_meta)?.eligible_for_stage_metrics !== false && json(x.source_meta)?.capture_mode !== "late_pre_match_recovery"), a = audits.filter(x => x.stage === stage);
  const statuses: Record<string, number> = {};
  for (const row of a) statuses[row.status || "unknown"] = (statuses[row.status || "unknown"] || 0) + 1;
  const leads = s.map(x => (Date.parse(x.kickoff_at) - Date.parse(x.captured_at)) / 60000).filter(Number.isFinite);
  return { snapshots: s.length, late_recovery_snapshots: recovered.length, audit_rows: a.length, audit_statuses: statuses, paired_verified: paired.length,
    average_minutes_before_kickoff: leads.length ? leads.reduce((x, y) => x + y, 0) / leads.length : null };
}
async function adminAllowed(req: Request) {
  const token = String(req.headers.get("x-admin-session") || "").trim();
  if (!token) return false;
  const r = await fetch(BASE + "/functions/v1/admin-center", {
    method: "POST", headers: { "content-type": "application/json", "x-admin-session": token },
    body: JSON.stringify({ action: "auth_me" }), signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) return false;
  const d = await r.json().catch(() => ({})), a = d?.admin;
  return a?.is_super_admin === true || (Array.isArray(a?.permissions) && a.permissions.includes("performance"));
}
async function readAll(table: string, q: URLSearchParams) {
  const rows: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const end = Math.min(offset + PAGE_SIZE - 1, MAX_ROWS - 1);
    const r = await fetch(BASE + "/rest/v1/" + table + "?" + q.toString(), {
      headers: { apikey: ROLE, authorization: "Bearer " + ROLE, Range: offset + "-" + end },
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) throw new Error("read_" + table + "_" + r.status + "_" + safe(await r.text()));
    const batch = await r.json();
    if (!Array.isArray(batch)) throw new Error("bad_rows_" + table);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  return rows;
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { success: false, error: "method_not_allowed" });
  if (!BASE || !ROLE) return reply(503, { success: false, error: "storage_not_configured" });
  try {
    if (!await adminAllowed(req)) return reply(401, { success: false, error: "admin_session_invalid_or_forbidden" });
    const body = await req.json().catch(() => ({})), days = Number(body?.days ?? 90);
    if (![0, 7, 30, 90, 365].includes(days)) return reply(400, { success: false, error: "invalid_days" });
    const since = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
    const q = (select: string) => {
      const x = new URLSearchParams({ select, order: "kickoff_at.desc" });
      if (since) x.set("kickoff_at", "gte." + since);
      return x;
    };
    const snapQ = q("fixture_id,stage,kickoff_at,captured_at,home_xg,away_xg,probabilities,market_context,source_meta,model_version,data_quality,research_only");
    snapQ.set("stage", "in.(t10,t2,t15)"); snapQ.set("model_version", "eq." + VERSION); snapQ.set("research_only", "eq.true");
    const auditQ = q("fixture_id,stage,kickoff_at,status,reason_code,attempts,terminal,updated_at"); auditQ.set("stage", "in.(t10,t2,t15)");
    const resultQ = q("fixture_id,kickoff_at,home_score,away_score,verified_at,excluded_from_public");
    resultQ.set("verified_at", "not.is.null"); resultQ.set("home_score", "not.is.null"); resultQ.set("away_score", "not.is.null");
    const [snaps, audits, resultRows] = await Promise.all([
      readAll("football_v2_shadow_stage_snapshots", snapQ), readAll("football_v2_shadow_stage_audit", auditQ),
      readAll("ai_prediction_snapshots", resultQ)
    ]);
    const results = new Map<number, any>(); for (const r of resultRows) results.set(Number(r.fixture_id), r);
    const byFixture = new Map<number, Map<string, any>>();
    for (const r of snaps) {
      const id = Number(r.fixture_id), stage = String(r.stage);
      if (!Number.isSafeInteger(id) || !STAGES.includes(stage as any)) continue;
      const meta = json(r.source_meta);
      if (meta?.capture_mode === "late_pre_match_recovery" || meta?.eligible_for_stage_metrics === false) continue;
      const m = byFixture.get(id) || new Map<string, any>(); if (!m.has(stage)) m.set(stage, r); byFixture.set(id, m);
    }
    const paired = pairedData(byFixture, results);
    const metrics: Record<string, any> = {
      moneyline: Object.fromEntries(STAGES.map(s => [s, accuracy(paired, s, p => p.moneyline_hit)])),
      btts: Object.fromEntries(STAGES.map(s => [s, accuracy(paired, s, p => p.btts_hit)]))
    };
    metrics.totals_market_line = marketMetrics(paired, "total");
    metrics.handicap_market_line = marketMetrics(paired, "handicap");
    const llm_metrics = llmMetrics(paired);
    return reply(200, {
      success: true, research_only: true, model_version: VERSION, window_days: days,
      verified_result_fixtures: resultRows.filter(x => x.excluded_from_public !== true).length,
      paired_fixture_count: paired.length,
      comparison_method: "每場每階段逐條使用實際市場線及雙邊賠率；V2以Poisson分數矩陣選期望報酬較高的一邊。GPT與Claude各自讀取同一份凍結特徵、V2結果及市場報價，獨立產生影子選擇。三種模型結果均按實際比分結算；走盤不計命中率分母，大小球與讓分另按線別列統計。只供後台研究，不進公開戰績。",
      market_lines: "all_fixture_stage_quotes", market_metrics: { totals: metrics.totals_market_line, handicap: metrics.handicap_market_line }, llm_metrics, metrics,
      stages: Object.fromEntries(STAGES.map(s => [s, coverage(s, snaps, audits, paired)])),
      paired_rows: paired.slice(0, 300),
      truncated: snaps.length >= MAX_ROWS || audits.length >= MAX_ROWS || resultRows.length >= MAX_ROWS,
      note: paired.length < 30 ? "三階段配對樣本少於 30 場，命中率僅供觀察。晚到補抓快照僅列入資料覆蓋數，不進入正式階段比對。" : "晚到補抓快照僅列入資料覆蓋數，不進入正式階段比對。",
      no_writes: true, football_api_calls: 0
    });
  } catch (e) {
    console.error("FOOTBALL_V2_STAGE_COMPARE_ERROR", safe(e));
    return reply(500, { success: false, error: safe(e) });
  }
});


