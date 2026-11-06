// Read-only paired-stage research backtest for V2 T-10 / T-2 / T-15 snapshots.
// It does not alter the member-facing T-10 snapshot or public performance data.
const VERSION = "football-v2-poisson-shrinkage-0.2.1";
const STAGES = ["t10", "t2", "t15"] as const;
const TOTAL_LINES = [2.5, 3, 4] as const;
// Asian handicap lines are signed from the home team's perspective.
const HANDICAP_LINES = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5] as const;
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
  if (x === null || x === undefined || x === "") return null;
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
function pairedData(byFixture: Map<number, Map<string, any>>, results: Map<number, any>) {
  const rows: any[] = [];
  for (const [id, result] of results) {
    const stages = byFixture.get(id);
    if (!stages || !STAGES.every(s => stages.has(s))) continue;
    const hs = Number(result.home_score), as = Number(result.away_score);
    if (!Number.isInteger(hs) || !Number.isInteger(as) || result.excluded_from_public === true) continue;
    const predictions: Record<string, any> = {};
    for (const stage of STAGES) {
      const snap = stages.get(stage), homeXg = num(snap.home_xg), awayXg = num(snap.away_xg);
      if (homeXg === null || awayXg === null || homeXg < 0 || awayXg < 0 || homeXg > 12 || awayXg > 12) {
        predictions[stage] = { unavailable: "invalid_xg" }; continue;
      }
      const grid = scoreGrid(homeXg, awayXg);
      const p: any = json(snap.probabilities);
      const winner = [["home", num(p.home_win)], ["draw", num(p.draw)], ["away", num(p.away_win)]]
        .filter((x: any) => x[1] !== null && x[1] >= 0 && x[1] <= 1)
        .sort((a: any, b: any) => b[1] - a[1])[0]?.[0] ?? null;
      const actualWinner = hs > as ? "home" : hs < as ? "away" : "draw";
      const bttsProb = num(p.btts_yes);
      const totals: Record<string, any> = {};
      for (const line of TOTAL_LINES) {
        let over = 0, under = 0, push = 0;
        for (const cell of grid) {
          const sum = cell.h + cell.a;
          if (sum > line) over += cell.p; else if (sum < line) under += cell.p; else push += cell.p;
        }
        const pick = over > under ? "over" : under > over ? "under" : null;
        const actual = hs + as > line ? "over" : hs + as < line ? "under" : "push";
        totals[String(line)] = { pick, hit: pick === null || actual === "push" ? null : pick === actual,
          result: actual, over_probability: over, under_probability: under, push_probability: push };
      }
      const handicaps: Record<string, any> = {};
      for (const line of HANDICAP_LINES) {
        let homeCover = 0, awayCover = 0, push = 0;
        for (const cell of grid) {
          const adjusted = cell.h - cell.a + line;
          if (adjusted > 0) homeCover += cell.p; else if (adjusted < 0) awayCover += cell.p; else push += cell.p;
        }
        const pick = homeCover > awayCover ? "home" : awayCover > homeCover ? "away" : null;
        const actualMargin = hs - as + line;
        const actual = actualMargin > 0 ? "home" : actualMargin < 0 ? "away" : "push";
        handicaps[String(line)] = { pick, hit: pick === null || actual === "push" ? null : pick === actual,
          result: actual, home_cover_probability: homeCover, away_cover_probability: awayCover, push_probability: push };
      }
      predictions[stage] = {
        moneyline_pick: winner, moneyline_hit: winner === null ? null : winner === actualWinner,
        btts_pick: bttsProb === null ? null : bttsProb >= 0.5 ? "yes" : "no",
        btts_hit: bttsProb === null ? null : (bttsProb >= 0.5) === (hs > 0 && as > 0),
        totals, handicaps
      };
    }
    rows.push({ fixture_id: id, kickoff_at: String(result.kickoff_at || ""),
      home_score: hs, away_score: as, predictions });
  }
  return rows.sort((a, b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at));
}
function coverage(stage: string, snaps: any[], audits: any[], paired: any[]) {
  const s = snaps.filter(x => x.stage === stage), a = audits.filter(x => x.stage === stage);
  const statuses: Record<string, number> = {};
  for (const row of a) statuses[row.status || "unknown"] = (statuses[row.status || "unknown"] || 0) + 1;
  const leads = s.map(x => (Date.parse(x.kickoff_at) - Date.parse(x.captured_at)) / 60000).filter(Number.isFinite);
  return { snapshots: s.length, audit_rows: a.length, audit_statuses: statuses, paired_verified: paired.length,
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
    const snapQ = q("fixture_id,stage,kickoff_at,captured_at,home_xg,away_xg,probabilities,model_version,data_quality,research_only");
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
      const m = byFixture.get(id) || new Map<string, any>(); if (!m.has(stage)) m.set(stage, r); byFixture.set(id, m);
    }
    const paired = pairedData(byFixture, results);
    const metrics: Record<string, any> = {
      moneyline: Object.fromEntries(STAGES.map(s => [s, accuracy(paired, s, p => p.moneyline_hit)])),
      btts: Object.fromEntries(STAGES.map(s => [s, accuracy(paired, s, p => p.btts_hit)]))
    };
    for (const line of TOTAL_LINES) metrics[`total_${line}`] = Object.fromEntries(STAGES.map(s => [s,
      accuracy(paired, s, p => p.totals?.[String(line)]?.hit ?? null)]));
    for (const line of HANDICAP_LINES) metrics[`handicap_${line}`] = Object.fromEntries(STAGES.map(s => [s,
      accuracy(paired, s, p => p.handicaps?.[String(line)]?.hit ?? null)]));
    return reply(200, {
      success: true, research_only: true, model_version: VERSION, window_days: days,
      verified_result_fixtures: resultRows.filter(x => x.excluded_from_public !== true).length,
      paired_fixture_count: paired.length,
      comparison_method: "同一賽事必須同時具有三個階段的 V2 研究快照及已驗證比分；T-3 與整數讓分走盤不計入命中率分母。機率依快照 xG 以同版 Poisson 分數矩陣推算。",
      market_lines: { totals: TOTAL_LINES, handicap_home_lines: HANDICAP_LINES }, metrics,
      stages: Object.fromEntries(STAGES.map(s => [s, coverage(s, snaps, audits, paired)])),
      paired_rows: paired.slice(0, 300),
      truncated: snaps.length >= MAX_ROWS || audits.length >= MAX_ROWS || resultRows.length >= MAX_ROWS,
      note: paired.length < 30 ? "三階段配對樣本少於 30 場，命中率僅供觀察。" : null,
      no_writes: true, football_api_calls: 0
    });
  } catch (e) {
    console.error("FOOTBALL_V2_STAGE_COMPARE_ERROR", safe(e));
    return reply(500, { success: false, error: safe(e) });
  }
});
