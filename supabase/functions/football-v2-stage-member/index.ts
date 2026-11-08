import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || ROLE;
const PILOT_ACCOUNT = "google_2d3cef6b6e2d";
const VERSION = "football-v2-poisson-player-impact-0.3.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const safe = (value: unknown) => String(value ?? "").slice(0, 220).replace(/[\r\n]/g, " ");
const headers = (prefer?: string) => ({ apikey: ROLE, Authorization: `Bearer ${ROLE}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) });

async function rest<T>(table: string, query: string): Promise<T[]> {
  const r = await fetch(`${BASE}/rest/v1/${table}?${query}`, { headers: headers(), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`read_${table}_${r.status}_${safe(await r.text())}`);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error(`bad_rows_${table}`);
  return rows as T[];
}
async function post(table: string, value: Record<string, unknown>, prefer: string) {
  return await fetch(`${BASE}/rest/v1/${table}`, { method: "POST", headers: headers(prefer), body: JSON.stringify(value), signal: AbortSignal.timeout(12000) });
}
async function patchClaim(account: string, fixtureId: number, stage: string, value: Record<string, unknown>) {
  const r = await fetch(`${BASE}/rest/v1/football_v2_stage_member_claims?account=eq.${encodeURIComponent(account)}&fixture_id=eq.${fixtureId}&stage=eq.${stage}`, {
    method: "PATCH", headers: headers("return=minimal"), body: JSON.stringify(value), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`claim_update_${r.status}_${safe(await r.text())}`);
}
async function authenticatedMemberAccount(req: Request): Promise<string | null> {
  const bearer = String(req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer || !PUBLIC_KEY) return null;
  const r = await fetch(`${BASE}/functions/v1/oauth-member-login?mode=refresh`, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ action: "refresh" }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return data?.success === true && data?.member?.account ? String(data.member.account) : null;
}
function scoreGrid(homeXg: number, awayXg: number) {
  const poisson = (lambda: number, k: number) => { let p = Math.exp(-lambda); for (let i = 1; i <= k; i++) p *= lambda / i; return p; };
  const h = Array.from({ length: 19 }, (_, i) => poisson(homeXg, i));
  const a = Array.from({ length: 19 }, (_, i) => poisson(awayXg, i));
  const mass = h.reduce((s, x) => s + x, 0) * a.reduce((s, x) => s + x, 0);
  return h.flatMap((hp, hi) => a.map((ap, ai) => ({ h: hi, a: ai, p: hp * ap / mass })));
}
function splitLine(line: number) {
  const scaled = line * 4, q = Math.round(scaled);
  if (Math.abs(scaled - q) > 1e-6 || q % 2 === 0) return [line];
  const lower = Math.floor(line * 2) / 2;
  return [lower, lower + 0.5];
}
function legResult(value: number, line: number, side: "over" | "under" | "home" | "away") {
  const adjusted = side === "over" ? value - line : side === "under" ? line - value : value + line;
  return adjusted > 1e-9 ? 1 : adjusted < -1e-9 ? -1 : 0;
}
function expectedReturn(grid: Array<{h:number;a:number;p:number}>, line: number, side: "over" | "under" | "home" | "away", odds: number) {
  const parts = splitLine(line), stake = 1 / parts.length;
  let returned = 0;
  for (const cell of grid) for (const part of parts) {
    const value = side === "over" || side === "under" ? cell.h + cell.a : side === "home" ? cell.h - cell.a : cell.a - cell.h;
    const result = legResult(value, part, side);
    returned += cell.p * stake * (result > 0 ? odds : result === 0 ? 1 : 0);
  }
  return returned - 1;
}
function probabilities(snapshot: any, grid: Array<{h:number;a:number;p:number}>) {
  const p = snapshot.probabilities || {};
  if (Number.isFinite(Number(p.home_win)) && Number.isFinite(Number(p.draw)) && Number.isFinite(Number(p.away_win))) {
    return { home: Number(p.home_win), draw: Number(p.draw), away: Number(p.away_win), btts: Number(p.btts_yes) };
  }
  let home = 0, draw = 0, away = 0, btts = 0;
  for (const x of grid) { if (x.h > x.a) home += x.p; else if (x.h === x.a) draw += x.p; else away += x.p; if (x.h > 0 && x.a > 0) btts += x.p; }
  return { home, draw, away, btts };
}
function toAnalysis(snapshot: any, fixture: any, stage: string) {
  const grid = scoreGrid(Number(snapshot.home_xg), Number(snapshot.away_xg));
  const probs = probabilities(snapshot, grid), context = snapshot.market_context || {};
  const home = Number(probs.home), draw = Number(probs.draw), away = Number(probs.away);
  const money = [{ pick: "主勝", p: home }, { pick: "和局", p: draw }, { pick: "客勝", p: away }].sort((a,b) => b.p-a.p)[0];
  const bttsYes = Number(probs.btts), bttsPick = bttsYes >= 0.5;
  const confidence = (p: number) => Math.max(0, Math.min(100, Math.round(p * 100)));
  const totalQuotes = Array.isArray(context.totals) ? context.totals : context.total ? [context.total] : [];
  let totalPick = "暫不推薦", totalLine: number | null = null, totalConfidence = 0, totalReason = "此階段沒有可用的實際大小球盤線";
  const totalOptions = totalQuotes.flatMap((quote: any) => {
    const line = Number(quote?.line), overOdds = Number(quote?.over_odds), underOdds = Number(quote?.under_odds);
    if (!Number.isFinite(line) || !(overOdds > 1) || !(underOdds > 1)) return [];
    const overEv = expectedReturn(grid, line, "over", overOdds), underEv = expectedReturn(grid, line, "under", underOdds);
    const over = overEv >= underEv;
    return [{ line, pick: over ? "大" : "小", ev: Math.max(overEv, underEv), probability: over ? grid.filter(x => x.h+x.a > line).reduce((s,x)=>s+x.p,0) : grid.filter(x => x.h+x.a < line).reduce((s,x)=>s+x.p,0) }];
  }).sort((a: any,b: any)=>b.ev-a.ev);
  if (totalOptions.length) {
    const chosen = totalOptions[0]; totalLine = chosen.line; totalPick = chosen.pick; totalConfidence = confidence(chosen.probability);
    totalReason = `比較本階段所有實際大小球盤線與雙邊賠率後，選擇模型期望回報較高的一條：${totalLine}`;
  }
  const handicapQuotes = Array.isArray(context.handicaps) ? context.handicaps : context.handicap ? [context.handicap] : [];
  let handicapPick = "暫不推薦", handicapLine: number | null = null, handicapConfidence = 0, handicapReason = "此階段沒有可用的實際讓分盤線";
  const handicapOptions = handicapQuotes.flatMap((quote: any) => {
    const homeLine = Number(quote?.home_line), awayLine = Number(quote?.away_line), homeOdds = Number(quote?.home_odds), awayOdds = Number(quote?.away_odds);
    if (!Number.isFinite(homeLine) || !Number.isFinite(awayLine) || !(homeOdds > 1) || !(awayOdds > 1)) return [];
    const homeEv = expectedReturn(grid, homeLine, "home", homeOdds), awayEv = expectedReturn(grid, awayLine, "away", awayOdds), onHome = homeEv >= awayEv;
    const line = onHome ? homeLine : awayLine, probability = grid.filter(x => onHome ? x.h-x.a+homeLine > 0 : x.a-x.h+awayLine > 0).reduce((s,x)=>s+x.p,0);
    return [{ line, pick: onHome ? "主隊" : "客隊", ev: Math.max(homeEv, awayEv), probability }];
  }).sort((a: any,b: any)=>b.ev-a.ev);
  if (handicapOptions.length) {
    const chosen = handicapOptions[0]; handicapLine = chosen.line; handicapPick = chosen.pick; handicapConfidence = confidence(chosen.probability);
    handicapReason = `比較本階段所有實際讓分盤線與雙邊賠率後，選擇模型期望回報較高的一條：${handicapLine > 0 ? "+" : ""}${handicapLine}`;
  }
  const scoreRows = [...grid].sort((a,b)=>b.p-a.p).slice(0,5).map(x=>({score:`${x.h}-${x.a}`,confidence:confidence(x.p)}));
  const bttsMarket = context.btts || {};
  const items = Array.isArray(snapshot.availability_evidence?.items) ? snapshot.availability_evidence.items : [];
  const lineups = Array.isArray(snapshot.lineup_evidence?.teams) ? snapshot.lineup_evidence.teams : [];
  const injurySummary = items.slice(0, 8).map((x: any) => `${String(x.player_name || "球員")}${x.reason || x.type ? `（${String(x.reason || x.type)}）` : ""}`).join("、") || "目前沒有可用傷停名單";
  const lineupSummary = lineups.map((x: any) => `${String(x?.team?.name || x?.team_name || "球隊")}：先發 ${Array.isArray(x?.startXI) ? x.startXI.length : 0} 人`).join("；") || "目前沒有可用先發名單";
  const playerCoverage = (value: unknown) => value === "fresh" || value === "cached" ? "完整快取" : /partial/.test(String(value || "")) ? "名單部分資料" : String(value || "資料不足");
  const evidence = {
    stage, captured_at: snapshot.captured_at,
    availability: snapshot.availability_evidence || { status: "not_collected_at_this_stage", items: [] },
    lineups: snapshot.lineup_evidence || { status: "not_available", teams: [] },
    player_adjustment_applied: snapshot.source_meta?.player_adjustment_applied === true,
    player_adjustment: snapshot.player_adjustment || null,
    capture_mode: snapshot.source_meta?.capture_mode || "scheduled",
    scheduled_target_at: snapshot.source_meta?.scheduled_target_at || null,
    note: snapshot.source_meta?.capture_mode === "late_pre_match_recovery"
      ? `系統於 ${new Date(snapshot.captured_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 賽前補抓；這不是原定 T-${stage === "t2" ? "2" : "15"} 快照，不列入正式階段比對。球員調整狀態：${snapshot.source_meta?.player_adjustment_status || "未套用"}。`
      : snapshot.source_meta?.player_adjustment_applied === true
        ? `本階段已把球員資料納入預測：預估主隊 xG 修正 ${Number(snapshot.source_meta?.player_xg_delta?.home || 0) >= 0 ? "+" : ""}${Number(snapshot.source_meta?.player_xg_delta?.home || 0).toFixed(2)}，客隊 ${Number(snapshot.source_meta?.player_xg_delta?.away || 0) >= 0 ? "+" : ""}${Number(snapshot.source_meta?.player_xg_delta?.away || 0).toFixed(2)}（球員統計：主隊${playerCoverage(snapshot.player_adjustment?.player_data?.home)}／客隊${playerCoverage(snapshot.player_adjustment?.player_data?.away)}）。`
        : `本階段球員資料不足，未套用球員修正（主隊：${snapshot.player_adjustment?.player_data?.home || "未知"}；客隊：${snapshot.player_adjustment?.player_data?.away || "未知"}）；基礎預測仍可查看。`,
  };
  const fixtureData = fixture && typeof fixture === "object" ? fixture : {};
  return {
    success: true,
    fixture: {
      id: Number(snapshot.fixture_id), date: snapshot.kickoff_at,
      league: fixtureData.league || { name: "足球賽事" },
      home: fixtureData.home || { name: `主隊 ${snapshot.home_team_id || ""}` },
      away: fixtureData.away || { name: `客隊 ${snapshot.away_team_id || ""}` },
    },
    analysis: {
      model_version: snapshot.model_version || VERSION,
      recommendations: {
        moneyline: { pick: money.pick, confidence: confidence(money.p), reason: "取模型勝和負機率最高的一項" },
        over_under: { pick: totalPick, line: totalLine, confidence: totalConfidence, reason: totalReason },
        handicap: { pick: handicapPick, line: handicapLine, confidence: handicapConfidence, reason: handicapReason },
        btts: { pick: bttsPick ? "是" : "否", confidence: confidence(bttsPick ? bttsYes : 1-bttsYes), reason: "依模型雙方進球機率" },
      },
      summary: `${stage === "t2" ? "T-2 深度分析" : "T-15 最終分析"}：模型預估主隊 ${Number(snapshot.home_xg).toFixed(2)} 球、客隊 ${Number(snapshot.away_xg).toFixed(2)} 球。獨贏依勝和負機率最高項目；大小球與讓分使用本階段市場實際盤線。`,
      market_analysis: `本階段市場盤線：大小球 ${totalLine === null ? "未取得" : totalLine}；讓分 ${handicapLine === null ? "未取得" : handicapLine}。傷停：${injurySummary}。先發：${lineupSummary}。${evidence.note}`,
      predicted_scores: scoreRows,
      v2_stage_evidence: evidence,
      xg: { home: snapshot.home_xg, away: snapshot.away_xg },
    },
    v2_stage: stage,
    v2_stage_label: stage === "t2" ? "深度分析" : "最終分析",
    v2_data_quality: snapshot.data_quality || "uncalibrated",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { success: false, error: "method_not_allowed" });
  if (!BASE || !ROLE) return reply(503, { success: false, error: "storage_not_configured" });
  try {
    const body = await req.json().catch(() => ({}));
    const account = String(body?.account || "").trim();
    const action = String(body?.action || "status").trim();
    const fixtureIds = [...new Set((Array.isArray(body?.fixture_ids) ? body.fixture_ids : [body?.fixture_id])
      .map(Number).filter((x: number) => Number.isSafeInteger(x) && x > 0))].slice(0, 80);
    if (!account || !fixtureIds.length) return reply(400, { success: false, error: "account_and_fixture_ids_required" });
    const settingsRows = await rest<any>("football_v2_rollout_settings", "select=pilot_account,all_members_enabled,public_stage,public_stage_effective_at&id=eq.true&limit=1");
    const settings = settingsRows[0] || { pilot_account: PILOT_ACCOUNT, all_members_enabled: false, public_stage: "t10" };
    const allowed = settings.all_members_enabled === true || account === String(settings.pilot_account || PILOT_ACCOUNT);
    if (!allowed) return reply(200, { success: true, enabled: false, stages: {} });
    const members = await rest<any>("members", `account=eq.${encodeURIComponent(account)}&select=account,is_active,analysis_unlimited&limit=1`);
    if (!members[0] || members[0].is_active !== true) return reply(403, { success: false, error: "member_inactive" });
    const verifiedAccount = await authenticatedMemberAccount(req);
    if ((/^(google|line)_/i.test(account) && verifiedAccount !== account) || (verifiedAccount && verifiedAccount !== account)) {
      return reply(401, { success: false, error: "member_authentication_required" });
    }
    const ids = `(${fixtureIds.join(",")})`;
    const [claims, officialHistory, readyRows] = await Promise.all([
      rest<any>("football_v2_stage_member_claims", `account=eq.${encodeURIComponent(account)}&fixture_id=in.${ids}&select=fixture_id,stage,claim_state,claimed_at&order=created_at.asc`),
      rest<any>("member_analysis_history", `account=eq.${encodeURIComponent(account)}&fixture_id=in.${ids}&select=fixture_id`),
      rest<any>("football_v2_shadow_stage_snapshots", `fixture_id=in.${ids}&stage=in.(t2,t15)&model_version=eq.${encodeURIComponent(VERSION)}&research_only=eq.true&select=fixture_id,stage,kickoff_at`),
    ]);
    const historySet = new Set(officialHistory.map(x => Number(x.fixture_id)));
    const result: Record<string, unknown> = {};
    for (const id of fixtureIds) {
      const c = claims.filter(x => Number(x.fixture_id) === id && x.claim_state === "claimed");
      const t10 = historySet.has(id) || c.some(x => x.stage === "t10");
      const t2 = c.some(x => x.stage === "t2");
      const t15 = c.some(x => x.stage === "t15");
      const ready = Object.fromEntries(readyRows.filter(x => Number(x.fixture_id) === id).map(x => [x.stage, Date.parse(x.kickoff_at) > Date.now()]));
      result[String(id)] = { claimed: { t10, t2, t15 }, ready, next_stage: !t10 ? "t10" : !t2 ? "t2" : !t15 ? "t15" : null };
    }
    if (action === "status") return reply(200, { success: true, enabled: true, public_stage: settings.public_stage || "t10", stages: result });
    if (action !== "claim") return reply(400, { success: false, error: "unknown_action" });
    const stage = String(body?.stage || "");
    if (stage !== "t2" && stage !== "t15") return reply(400, { success: false, error: "stage_must_be_t2_or_t15" });
    const fixtureId = fixtureIds[0];
    const current = result[String(fixtureId)] as any;
    const existing = claims.find(x => Number(x.fixture_id) === fixtureId && x.stage === stage && x.claim_state === "claimed");
    if (existing) {
      const saved = await rest<any>("football_v2_stage_member_claims", `account=eq.${encodeURIComponent(account)}&fixture_id=eq.${fixtureId}&stage=eq.${stage}&select=result_data&limit=1`);
      if (saved[0]?.result_data) return reply(200, { success: true, already_claimed: true, result: saved[0].result_data });
    }
    const snapshots = await rest<any>("football_v2_shadow_stage_snapshots", `fixture_id=eq.${fixtureId}&stage=eq.${stage}&model_version=eq.${encodeURIComponent(VERSION)}&research_only=eq.true&select=fixture_id,stage,kickoff_at,captured_at,home_team_id,away_team_id,home_xg,away_xg,probabilities,fair_odds,market_context,availability_evidence,lineup_evidence,player_adjustment,data_quality,model_version,source_meta&limit=1`);
    let recovery: any = null;
    if (!snapshots[0]) {
      const recoverResponse = await fetch(`${BASE}/functions/v1/football-v2-shadow-stage-runner`, {
        method: "POST", headers: { ...headers() },
        body: JSON.stringify({ action: "recover_stage", fixture_id: fixtureId, stage }), signal: AbortSignal.timeout(45000),
      });
      recovery = await recoverResponse.json().catch(() => ({ status: "invalid_recovery_response" }));
      const refreshed = await rest<any>("football_v2_shadow_stage_snapshots", `fixture_id=eq.${fixtureId}&stage=eq.${stage}&model_version=eq.${encodeURIComponent(VERSION)}&research_only=eq.true&select=fixture_id,stage,kickoff_at,captured_at,home_team_id,away_team_id,home_xg,away_xg,probabilities,fair_odds,market_context,availability_evidence,lineup_evidence,player_adjustment,data_quality,model_version,source_meta&limit=1`);
      snapshots.push(...refreshed);
    }
    if (!snapshots[0]) return reply(409, { success: false, error: "stage_snapshot_not_ready", recovery_status: recovery?.status || recovery?.error || "not_ready", can_retry: true });
    const model = snapshots[0];
    const minutesToKickoff = (Date.parse(model.kickoff_at) - Date.now()) / 60000;
    if (minutesToKickoff <= 0) return reply(410, { success: false, error: "match_already_started" });
    const stageIsOpen = stage === "t2"
      ? minutesToKickoff > 15 && minutesToKickoff <= 120
      : minutesToKickoff <= 15;
    if (!stageIsOpen) return reply(409, { success: false, error: "stage_not_open" });
    const fixtureData = body?.fixture && typeof body.fixture === "object" ? body.fixture : {};
    let claimId: number | null = null;
    const reserve = await post("football_v2_stage_member_claims", {
      account, fixture_id: fixtureId, stage, claim_state: "processing", fixture_data: fixtureData, model_version: VERSION,
    }, "return=representation");
    if (!reserve.ok) {
      const duplicate = await rest<any>("football_v2_stage_member_claims", `account=eq.${encodeURIComponent(account)}&fixture_id=eq.${fixtureId}&stage=eq.${stage}&select=claim_state,result_data,created_at,fixture_data&limit=1`);
      if (duplicate[0]?.claim_state === "claimed" && duplicate[0]?.result_data) return reply(200, { success: true, already_claimed: true, result: duplicate[0].result_data });
      if (duplicate[0]?.claim_state === "processing" && Date.now() - Date.parse(duplicate[0].created_at || "") > 120000) {
        const recovered = toAnalysis(model, duplicate[0].fixture_data || fixtureData, stage);
        await patchClaim(account, fixtureId, stage, { claim_state: "claimed", claimed_at: new Date().toISOString(), result_data: recovered });
        return reply(200, { success: true, already_claimed: true, recovered_stale_claim: true, result: recovered });
      }
      return reply(409, { success: false, error: duplicate[0]?.claim_state === "processing" ? "stage_claim_processing" : "stage_claim_reservation_failed" });
    }
    const reserved = await reserve.json().catch(() => []);
    claimId = Array.isArray(reserved) ? Number(reserved[0]?.id) || null : null;
    let creditConsumed = false;
    try {
      if (members[0].analysis_unlimited !== true) {
        const credit = await fetch(`${BASE}/rest/v1/rpc/consume_member_analysis_credit`, {
          method: "POST", headers: headers(), body: JSON.stringify({ p_account: account }), signal: AbortSignal.timeout(12000),
        });
        if (!credit.ok) throw new Error(`analysis_credit_consume_${credit.status}_${safe(await credit.text())}`);
        const raw = await credit.json(), value = Array.isArray(raw) ? raw[0] : raw;
        if (value?.success !== true) throw new Error("analysis_credits_empty");
        creditConsumed = true;
      }
      const result = toAnalysis(model, fixtureData, stage);
      await patchClaim(account, fixtureId, stage, { claim_state: "claimed", claimed_at: new Date().toISOString(), result_data: result });
      return reply(200, { success: true, already_claimed: false, result });
    } catch (error) {
      if (claimId && !creditConsumed) {
        const del = await fetch(`${BASE}/rest/v1/football_v2_stage_member_claims?id=eq.${claimId}&claim_state=eq.processing`, { method: "DELETE", headers: headers("return=minimal"), signal: AbortSignal.timeout(10000) });
        if (!del.ok) console.error("stage_claim_cleanup_failed", del.status);
      }
      const message = safe(error);
      return reply(message.includes("analysis_credits_empty") ? 429 : 503, { success: false, error: message.includes("analysis_credits_empty") ? "analysis_credits_empty" : message });
    }
  } catch (error) {
    console.error("FOOTBALL_V2_STAGE_MEMBER_ERROR", safe(error));
    return reply(500, { success: false, error: safe(error) });
  }
});

