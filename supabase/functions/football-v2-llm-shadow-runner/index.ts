// Admin-only shadow forecasts from GPT and Claude.
// Reads the frozen V2 feature/prediction/market snapshot, asks both providers independently,
// and writes only source_meta.llm_shadow on the research snapshot. It never changes official predictions.
const VERSION = "football-v2-llm-shadow-0.1.0";
const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_KEY = Deno.env.get("FOOTBALL_V2_STAGE_CRON_KEY") || "";
const ENABLED = Deno.env.get("FOOTBALL_V2_LLM_SHADOW_ENABLED") === "true";
const GPT_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const GPT_MODEL = Deno.env.get("FOOTBALL_V2_GPT_MODEL") || "gpt-5-mini";
const CLAUDE_MODEL = Deno.env.get("FOOTBALL_V2_CLAUDE_MODEL") || "claude-sonnet-4-5";
const MAX_SNAPSHOTS = 4;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-habao-cron-key, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: CORS });
const safe = (x: unknown) => String(x ?? "").slice(0, 180).replace(/[\r\n]/g, " ");
const headers = (prefer?: string) => ({
  apikey: ROLE, authorization: "Bearer " + ROLE, "content-type": "application/json",
  ...(prefer ? { prefer } : {})
});
function json(x: unknown): any {
  if (typeof x !== "string") return x ?? {};
  try { return JSON.parse(x); } catch { return {}; }
}
function validPick(x: any, allowed: string[]) { return allowed.includes(String(x)) ? String(x) : null; }
function validate(raw: any, market: any) {
  const totals = Array.isArray(market?.totals) ? market.totals :
    market?.total ? [market.total] : [];
  const handicaps = Array.isArray(market?.handicaps) ? market.handicaps :
    market?.handicap ? [market.handicap] : [];
  const totalLines = new Set(totals.map((x: any) => Number(x.line)).filter(Number.isFinite).map((x: number) => x.toFixed(2)));
  const handicapLines = new Set(handicaps.map((x: any) => Number(x.home_line)).filter(Number.isFinite).map((x: number) => x.toFixed(2)));
  const totalPicks = Array.isArray(raw?.total_picks) ? raw.total_picks
    .filter((x: any) => totalLines.has(Number(x?.line).toFixed(2)) && ["over", "under"].includes(String(x?.pick)))
    .map((x: any) => ({ line: Number(x.line), pick: String(x.pick) })) : [];
  const handicapPicks = Array.isArray(raw?.handicap_picks) ? raw.handicap_picks
    .filter((x: any) => handicapLines.has(Number(x?.home_line).toFixed(2)) && ["home", "away"].includes(String(x?.pick)))
    .map((x: any) => ({ home_line: Number(x.home_line), pick: String(x.pick) })) : [];
  const confidence = Number(raw?.confidence);
  return {
    moneyline_pick: validPick(raw?.moneyline_pick, ["home", "draw", "away"]),
    btts_pick: validPick(raw?.btts_pick, ["yes", "no"]),
    total_picks: totalPicks,
    handicap_picks: handicapPicks,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : null,
    v2_assessment: validPick(raw?.v2_assessment, ["agree", "reconsider", "insufficient_data"]),
    concerns: Array.isArray(raw?.concerns) ? raw.concerns.slice(0, 5).map((x: any) => safe(x)) : [],
    evidence_checks: Array.isArray(raw?.evidence_checks) ? raw.evidence_checks.slice(0, 5).map((x: any) => safe(x)) : [],
    summary: safe(raw?.summary)
  };
}
function parseModelJson(text: string) {
  const trimmed = text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/i, "");
  const first = trimmed.indexOf("{"), last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("model_json_missing");
  return JSON.parse(trimmed.slice(first, last + 1));
}
async function callGpt(input: any, market: any) {
  if (!GPT_KEY) return { status: "not_configured" };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer " + GPT_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model: GPT_MODEL, store: false, max_output_tokens: 1200,
      instructions: SYSTEM_PROMPT,
      input: JSON.stringify(input)
    }),
    signal: AbortSignal.timeout(18000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { status: "provider_error", error: "http_" + r.status + "_" + safe(body?.error?.code || body?.error?.message) };
  const text = String(body?.output_text || (body?.output || []).flatMap((x: any) => x?.content || []).map((x: any) => x?.text || "").join("\n"));
  try { return { status: "ready", model: GPT_MODEL, output: validate(parseModelJson(text), market) }; }
  catch (e) { return { status: "invalid_output", model: GPT_MODEL, error: safe(e) }; }
}
async function callClaude(input: any, market: any) {
  if (!CLAUDE_KEY) return { status: "not_configured" };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 1200, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input) }]
    }),
    signal: AbortSignal.timeout(18000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { status: "provider_error", error: "http_" + r.status + "_" + safe(body?.error?.type || body?.error?.message) };
  const text = (body?.content || []).filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n");
  try { return { status: "ready", model: CLAUDE_MODEL, output: validate(parseModelJson(text), market) }; }
  catch (e) { return { status: "invalid_output", model: CLAUDE_MODEL, error: safe(e) }; }
}
const SYSTEM_PROMPT = `You are an independent football forecast reviewer. You receive a frozen, pre-match feature snapshot, the deterministic V2 Poisson forecast, and the market quotes captured for that exact stage. Analyze only those supplied facts; do not invent injuries, news, or data sources. Return exactly one JSON object, no markdown, with:
{"moneyline_pick":"home|draw|away","btts_pick":"yes|no","total_picks":[{"line":2.5,"pick":"over|under"}],"handicap_picks":[{"home_line":-0.5,"pick":"home|away"}],"confidence":0-100,"v2_assessment":"agree|reconsider|insufficient_data","concerns":["..."],"evidence_checks":["..."],"summary":"..."}.
Return one total pick for every supplied total line and one handicap pick for every supplied home line. If a market is missing, return an empty array for it. Treat your picks as an independent shadow forecast; do not change the supplied V2 probabilities or claim to have recalculated them. Keep the explanation short and cite the supplied field names in concerns/evidence_checks.`;
async function dbGet(table: string, query: string) {
  const r = await fetch(BASE + "/rest/v1/" + table + "?" + query, {
    headers: headers(), signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error("read_" + table + "_" + r.status);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error("bad_rows_" + table);
  return data;
}
async function run() {
  if (!BASE || !ROLE) throw new Error("storage_not_configured");
  if (!ENABLED) return { success: true, status: "disabled", processed: 0 };
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const snapshots = await dbGet(
    "football_v2_shadow_stage_snapshots",
    new URLSearchParams({
      select: "fixture_id,stage,kickoff_at,captured_at,home_xg,away_xg,probabilities,fair_odds,market_context,source_meta,model_version,research_only",
      model_version: "eq.football-v2-poisson-shrinkage-0.2.1",
      research_only: "eq.true", kickoff_at: "gt." + new Date().toISOString(),
      captured_at: "gte." + since, order: "captured_at.asc", limit: String(MAX_SNAPSHOTS)
    }).toString()
  );
  const results: any[] = [];
  for (const snap of snapshots) {
    const source = json(snap.source_meta), old = source.llm_shadow;
    if (old?.status === "complete" || old?.status === "partial") continue;
    const featureAt = source.feature_captured_at;
    if (!featureAt) { results.push({ fixture_id: snap.fixture_id, stage: snap.stage, status: "feature_timestamp_missing" }); continue; }
    const fq = new URLSearchParams({
      select: "fixture_id,stage,captured_at,season,home_features,away_features,league_baseline,data_quality",
      fixture_id: "eq." + snap.fixture_id, captured_at: "eq." + featureAt, limit: "1"
    });
    const features = await dbGet("football_v2_shadow_feature_snapshots", fq.toString());
    if (!features[0]) { results.push({ fixture_id: snap.fixture_id, stage: snap.stage, status: "feature_snapshot_missing" }); continue; }
    const market = json(snap.market_context);
    const input = {
      fixture_id: Number(snap.fixture_id), stage: String(snap.stage), kickoff_at: snap.kickoff_at,
      feature_snapshot: features[0],
      v2_prediction: { home_xg: snap.home_xg, away_xg: snap.away_xg, probabilities: json(snap.probabilities), fair_odds: json(snap.fair_odds) },
      market_snapshot: market
    };
    const [gpt, claude] = await Promise.all([callGpt(input, market), callClaude(input, market)]);
    const done = [gpt, claude].filter((x: any) => x.status === "ready").length;
    const shadow = { status: done === 2 ? "complete" : done === 1 ? "partial" : "failed", version: VERSION,
      generated_at: new Date().toISOString(), stage: snap.stage, feature_captured_at: featureAt,
      same_input: true, providers: { gpt, claude } };
    const merged = { ...source, llm_shadow: shadow };
    const patchUrl = new URL(BASE + "/rest/v1/football_v2_shadow_stage_snapshots");
    patchUrl.searchParams.set("fixture_id", "eq." + snap.fixture_id);
    patchUrl.searchParams.set("stage", "eq." + snap.stage);
    patchUrl.searchParams.set("captured_at", "eq." + snap.captured_at);
    const wr = await fetch(patchUrl, { method: "PATCH", headers: headers("return=minimal"),
      body: JSON.stringify({ source_meta: merged }), signal: AbortSignal.timeout(10000) });
    if (!wr.ok) throw new Error("write_llm_shadow_" + wr.status + "_" + safe(await wr.text()));
    results.push({ fixture_id: snap.fixture_id, stage: snap.stage, status: shadow.status,
      gpt_status: (gpt as any).status, claude_status: (claude as any).status });
  }
  return { success: true, status: "processed", processed: results.length, results };
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { success: false, error: "method_not_allowed" });
  if (!CRON_KEY || request.headers.get("x-habao-cron-key") !== CRON_KEY) return reply(401, { success: false, error: "unauthorized" });
  try { return reply(200, await run()); }
  catch (e) { console.error("FOOTBALL_V2_LLM_SHADOW_ERROR", safe(e)); return reply(500, { success: false, error: safe(e) }); }
});
