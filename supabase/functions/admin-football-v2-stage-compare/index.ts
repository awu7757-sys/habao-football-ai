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

// ===== 2026-11-15 研究：市場融合版（只讀、只在後台顯示，不影響正式推薦）=====
// 版本 1.1（依 GPT 2026-11-15 審查 R1～R5 修正）；1.2（第二輪複審 A～F）：市場擷取時間須嚴格早於開賽且不晚於快照；
//   分批以資料指紋（set_hash）鎖定同一評估集合，資料變動即回報 research_dataset_changed；研究路徑不再重算整批舊比較。
// - 從快照當時主盤口（market_context.total／handicap，最多莊家）去水機率反推「市場隱含」主客預期進球。
//   去水採雙邊倒數賠率比例正規化（假設，非已證明的真實機率）。
// - 「過盤權重比」= 拆盤後贏注權重 /（贏 + 輸），排除走盤；這是公平賠率的反推量，不是整張注單獲利機率。
// - 只有大小盤與讓分盤都有效、時間合法、反推有解且最終殘差合格的「場次×階段」才納入比較；
//   缺一種市場、無解、殘差超標、時間不合法分別計數排除，不混入成功樣本（純市場不再沿用模型補足）。
// - 融合 = 模型 xG 與市場 xG 各 50%；BTTS 推薦門檻 58%。兩者為固定參數，不依結果調整；
//   58% 曾參考 11/15 以前資料（PROJECT_NOTES 5n），故 11/16 以前開賽列為「探索期」，11/16 起才算「樣本外」。
// - 研究獨贏取最高機率，未套正式規則「與熱門相反暫不推薦」，研究命中率不等於會員正式成績。
// - 結算用賠率 2 只作命中分類（半贏算命中、半輸算未中、走盤不計），不代表真實賠率報酬。
// - CPU 保護：每次呼叫最多計算 RESEARCH_BATCH_FIXTURES 場（依開賽時間新到舊、同時間依賽事 ID），
//   以 research_offset 分批，前端合併；回傳賽事 ID 供前端檢查不漏不重。
const RESEARCH_VERSION = "football-market-blend-research-1.2-20261115";
const RESEARCH_BLEND_WEIGHT = 0.5;
const RESEARCH_BTTS_THRESHOLD = 0.58;
const RESEARCH_FIT_TOLERANCE = 0.002;          // 反推後兩個市場機率殘差上限（0.2 個百分點，依數值精度事先固定）
const RESEARCH_BATCH_FIXTURES = 80;
const RESEARCH_OUT_OF_SAMPLE_FROM = Date.parse("2026-11-16T00:00:00+08:00");
function legWinShare(cells: Array<{h:number;a:number;p:number}>, line: number, side: "over" | "home") {
  let win = 0, lose = 0;
  for (const c of cells) for (const leg of splitLine(line)) {
    const r = marketLegResult(side === "over" ? c.h + c.a : c.h - c.a, leg, side);
    if (r === "win") win += c.p; else if (r === "loss") lose += c.p;
  }
  return win + lose > 0 ? win / (win + lose) : 0.5;
}
function validOdds(x: unknown) { const n = num(x); return n !== null && n > 1 && n <= 100 ? n : null; }
function quarterStep(x: number) { return Math.abs(x * 4 - Math.round(x * 4)) < 1e-6; }
function researchMarkets(context: any) {
  const t = context?.total, h = context?.handicap;
  const tl = num(t?.line), ov = validOdds(t?.over_odds), un = validOdds(t?.under_odds);
  const total = tl !== null && quarterStep(tl) && tl >= 0.5 && tl <= 10 && ov !== null && un !== null
    ? { line: tl, p: (1 / ov) / (1 / ov + 1 / un) } : null;
  const hl = num(h?.home_line), al = num(h?.away_line), ho = validOdds(h?.home_odds), ao = validOdds(h?.away_odds);
  const handicap = hl !== null && al !== null && Math.abs(hl + al) < 1e-6 && quarterStep(hl) && Math.abs(hl) <= 10 && ho !== null && ao !== null
    ? { line: hl, p: (1 / ho) / (1 / ho + 1 / ao) } : null;
  return { total, handicap };
}
// 反推用 0～12 球網格（控制 CPU）；最後一律用 0～18 完整網格驗證殘差。
function fitGrid(homeXg: number, awayXg: number) {
  const hp = Array.from({ length: 13 }, (_, i) => poisson(homeXg, i)), ap = Array.from({ length: 13 }, (_, i) => poisson(awayXg, i));
  const mass = hp.reduce((s, p) => s + p, 0) * ap.reduce((s, p) => s + p, 0);
  const cells: Array<{ h: number; a: number; p: number }> = [];
  for (let h = 0; h <= 12; h++) for (let a = 0; a <= 12; a++) cells.push({ h, a, p: hp[h] * ap[a] / mass });
  return cells;
}
// 單調遞增函數的二分法；目標不在端點值之間時回傳 null（無解），不回傳邊界值。
function bisect(f: (x: number) => number, lo: number, hi: number, target: number): number | null {
  const flo = f(lo), fhi = f(hi);
  if (!(target >= flo - 1e-9 && target <= fhi + 1e-9)) return null;
  for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (f(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// 回傳 { ok:true, home, away, residual } 或 { ok:false, reason }。
function marketImpliedXg(context: any, initHome: number, initAway: number) {
  const m = researchMarkets(context);
  if (!m.total || !m.handicap) return { ok: false, reason: !m.total && !m.handicap ? "no_valid_market" : "single_market_only" };
  let sum = initHome + initAway > 0 ? initHome + initAway : 2.6, share = initHome + initAway > 0 ? initHome / (initHome + initAway) : 0.5;
  for (let round = 0; round < 10; round++) {
    const s2 = bisect(x => legWinShare(fitGrid(x * share, x * (1 - share)), m.total!.line, "over"), 0.2, 9, m.total.p);
    if (s2 === null) return { ok: false, reason: "no_solution_total" };
    sum = s2;
    const sh = bisect(x => legWinShare(fitGrid(sum * x, sum * (1 - x)), m.handicap!.line, "home"), 0.02, 0.98, m.handicap.p);
    if (sh === null) return { ok: false, reason: "no_solution_handicap" };
    share = sh;
    const g = fitGrid(sum * share, sum * (1 - share));
    if (Math.abs(legWinShare(g, m.total.line, "over") - m.total.p) < RESEARCH_FIT_TOLERANCE / 4 &&
        Math.abs(legWinShare(g, m.handicap.line, "home") - m.handicap.p) < RESEARCH_FIT_TOLERANCE / 4) break;
  }
  const home = sum * share, away = sum * (1 - share), full = scoreGrid(home, away);
  const residual = Math.max(Math.abs(legWinShare(full, m.total.line, "over") - m.total.p),
    Math.abs(legWinShare(full, m.handicap.line, "home") - m.handicap.p));
  if (!(residual <= RESEARCH_FIT_TOLERANCE)) return { ok: false, reason: "fit_residual_exceeded" };
  return { ok: true, home, away, residual };
}
function researchPicks(homeXg: number, awayXg: number, context: any, hs: number, as: number) {
  const cells = scoreGrid(homeXg, awayXg), m = researchMarkets(context);
  let ph = 0, pd = 0, pa = 0, pb = 0;
  for (const c of cells) { if (c.h > c.a) ph += c.p; else if (c.h === c.a) pd += c.p; else pa += c.p; if (c.h > 0 && c.a > 0) pb += c.p; }
  const winner = [["home", ph], ["draw", pd], ["away", pa]].sort((x: any, y: any) => y[1] - x[1])[0][0];
  const actual = hs > as ? "home" : hs < as ? "away" : "draw";
  const out: any = { home_xg: Number(homeXg.toFixed(3)), away_xg: Number(awayXg.toFixed(3)), moneyline_pick: winner, moneyline_hit: winner === actual };
  if (m.total) { const over = legWinShare(cells, m.total.line, "over") >= 0.5; out.total = { line: m.total.line, pick: over ? "over" : "under", ...settlement(hs + as, m.total.line, over ? "over" : "under", 2) }; }
  if (m.handicap) { const hl = m.handicap.line, home = legWinShare(cells, hl, "home") >= 0.5; out.handicap = { home_line: hl, pick: home ? "home" : "away", ...settlement(home ? hs - as : as - hs, home ? hl : -hl, home ? "home" : "away", 2) }; }
  out.btts_pick = Math.max(pb, 1 - pb) >= RESEARCH_BTTS_THRESHOLD ? (pb >= 0.5 ? "yes" : "no") : null;
  out.btts_hit = out.btts_pick === null ? null : (out.btts_pick === "yes") === (hs > 0 && as > 0);
  return out;
}
// 時間資格：快照與市場擷取時間都必須「嚴格早於」開賽；市場在快照流程中先擷取、快照完成時間在後，
// 所以市場時間也不得晚於快照時間（原 1.1 容許晚 60 秒，沒有可確認的需求，1.2 移除）。
function researchTimesValid(snap: any, context: any) {
  const kick = Date.parse(String(snap?.kickoff_at || "")), cap = Date.parse(String(snap?.captured_at || "")), mcap = Date.parse(String(context?.captured_at || ""));
  return Number.isFinite(kick) && Number.isFinite(cap) && Number.isFinite(mcap) && cap < kick && mcap < kick && mcap <= cap;
}
// 一個「場次×階段」的研究結果；只用快照資料選方向，比分只用於結算。
function researchStage(snap: any, hs: number, as: number) {
  const context = json(snap.market_context), mh = num(snap.home_xg), ma = num(snap.away_xg);
  if (mh === null || ma === null || mh < 0 || ma < 0 || mh > 12 || ma > 12) return { ok: false, reason: "invalid_model_xg" };
  if (!researchTimesValid(snap, context)) return { ok: false, reason: "time_invalid_or_missing" };
  const implied: any = marketImpliedXg(context, mh, ma);
  if (!implied.ok) return { ok: false, reason: implied.reason };
  const w = RESEARCH_BLEND_WEIGHT;
  return { ok: true, residual: implied.residual,
    model: researchPicks(mh, ma, context, hs, as),
    blend: researchPicks(w * mh + (1 - w) * implied.home, w * ma + (1 - w) * implied.away, context, hs, as),
    market: researchPicks(implied.home, implied.away, context, hs, as) };
}
// 研究用配對清單：與 pairedData 相同的資格（三階段快照都在、比分合法、未排除），但不做舊比較的計算。
function researchOrder(byFixture: Map<number, Map<string, any>>, results: Map<number, any>) {
  const order: Array<{ id: number; kick: number; hs: number; as: number }> = [];
  for (const [id, result] of results) {
    const stages = byFixture.get(id);
    if (!stages || !STAGES.every(s => stages.has(s))) continue;
    const hs = num(result.home_score), as = num(result.away_score);
    if (!Number.isInteger(hs) || !Number.isInteger(as) || hs === null || as === null || hs < 0 || as < 0 || result.excluded_from_public === true) continue;
    order.push({ id: Number(id), kick: Date.parse(String(result.kickoff_at || "")), hs, as });
  }
  return order.sort((a, b) => b.kick - a.kick || a.id - b.id);
}
// 評估集合指紋：研究版本、期間、每場 ID／開賽／比分，以及每階段快照的開賽時間、擷取時間、xG、盤口內容
// （= researchStage／researchTimesValid 用到的全部快照欄位；GPT 第三輪複審補上快照 kickoff_at）。
// 任何一項改變（新增、排除、更正比分或快照）指紋就不同；分批期間不同即中止，不混合新舊資料。
function researchFingerprint(order: Array<{ id: number; kick: number; hs: number; as: number }>, byFixture: Map<number, Map<string, any>>, days: number) {
  let h = 0x811c9dc5;
  const feed = (text: string) => { for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  feed(RESEARCH_VERSION + "|" + days + "|" + order.length);
  for (const f of order) {
    feed("|" + f.id + ":" + f.kick + ":" + f.hs + "-" + f.as);
    for (const stage of STAGES) {
      const snap = byFixture.get(f.id)?.get(stage);
      feed("|" + stage + ":" + String(snap?.kickoff_at || "") + ":" + String(snap?.captured_at || "") + ":" + String(snap?.home_xg ?? "") + ":" + String(snap?.away_xg ?? "") + ":" +
        (typeof snap?.market_context === "string" ? snap.market_context : JSON.stringify(snap?.market_context ?? null)));
    }
  }
  return h.toString(16).padStart(8, "0") + "-" + order.length;
}
function researchBatch(order: Array<{ id: number; kick: number; hs: number; as: number }>, byFixture: Map<number, Map<string, any>>, offset: number, setHash: string) {
  const slice = order.slice(offset, offset + RESEARCH_BATCH_FIXTURES);
  const counts: any = {}, exclusions: Record<string, number> = {};
  const bump = (period: string, market: string, variant: string, stage: string, hit: unknown) => {
    const x = (((counts[period] ??= {})[market] ??= {})[variant] ??= {})[stage] ??= { candidates: 0, correct: 0, total: 0 };
    x.candidates++; if (typeof hit === "boolean") { x.total++; if (hit) x.correct++; }
  };
  // 各期間：任一階段合格的不同賽事、各階段合格場數、三階段都合格的賽事
  const used: Record<string, number[]> = { exploration: [], out_of_sample: [] }, allStages: Record<string, number[]> = { exploration: [], out_of_sample: [] };
  const stageValid: any = { exploration: { t10: 0, t2: 0, t15: 0 }, out_of_sample: { t10: 0, t2: 0, t15: 0 } };
  for (const f of slice) {
    const period = f.kick >= RESEARCH_OUT_OF_SAMPLE_FROM ? "out_of_sample" : "exploration";
    let okStages = 0;
    for (const stage of STAGES) {
      const snap = byFixture.get(f.id)?.get(stage); if (!snap) continue;
      const r: any = researchStage(snap, f.hs, f.as);
      if (!r.ok) { exclusions[r.reason] = (exclusions[r.reason] || 0) + 1; continue; }
      okStages++; stageValid[period][stage]++;
      for (const v of ["model", "blend", "market"]) {
        bump(period, "moneyline", v, stage, r[v].moneyline_hit);
        bump(period, "total", v, stage, r[v].total?.hit);
        bump(period, "handicap", v, stage, r[v].handicap?.hit);
        bump(period, "btts", v, stage, r[v].btts_hit);
      }
    }
    if (okStages > 0) used[period].push(f.id);
    if (okStages === STAGES.length) allStages[period].push(f.id);
  }
  return { version: RESEARCH_VERSION, set_hash: setHash, weight: RESEARCH_BLEND_WEIGHT, btts_threshold: RESEARCH_BTTS_THRESHOLD,
    fit_tolerance: RESEARCH_FIT_TOLERANCE, out_of_sample_from: new Date(RESEARCH_OUT_OF_SAMPLE_FROM).toISOString(),
    offset, batch_size: RESEARCH_BATCH_FIXTURES, total_fixtures: order.length,
    next_offset: offset + RESEARCH_BATCH_FIXTURES < order.length ? offset + RESEARCH_BATCH_FIXTURES : null,
    batch_fixture_ids: slice.map(f => f.id), used_fixture_ids: used, all_stage_fixture_ids: allStages, stage_valid: stageValid, counts, exclusions };
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
    // 研究分批：action=research 只建立研究配對清單（不重算舊比較），並核對評估集合指紋。
    const rOrder = researchOrder(byFixture, results), rHash = researchFingerprint(rOrder, byFixture, days);
    if (body?.action === "research") {
      const expected = String(body?.research_set_hash || ""), expectedVersion = String(body?.research_version || "");
      if (expectedVersion !== RESEARCH_VERSION) return reply(409, { success: false, error: "research_version_changed", research_version: RESEARCH_VERSION });
      if (!expected || expected !== rHash) return reply(409, { success: false, error: "research_dataset_changed", research_set_hash: rHash });
      const researchOffsetOnly = Math.max(0, Math.floor(Number(body?.research_offset) || 0));
      return reply(200, { success: true, research_only: true, window_days: days, research_metrics: researchBatch(rOrder, byFixture, researchOffsetOnly, rHash), no_writes: true, football_api_calls: 0 });
    }
    const paired = pairedData(byFixture, results);
    const metrics: Record<string, any> = {
      moneyline: Object.fromEntries(STAGES.map(s => [s, accuracy(paired, s, p => p.moneyline_hit)])),
      btts: Object.fromEntries(STAGES.map(s => [s, accuracy(paired, s, p => p.btts_hit)]))
    };
    metrics.totals_market_line = marketMetrics(paired, "total");
    metrics.handicap_market_line = marketMetrics(paired, "handicap");
    const llm_metrics = llmMetrics(paired);
    const research_metrics = researchBatch(rOrder, byFixture, 0, rHash);
    return reply(200, {
      success: true, research_only: true, model_version: VERSION, window_days: days,
      verified_result_fixtures: resultRows.filter(x => x.excluded_from_public !== true).length,
      paired_fixture_count: paired.length,
      comparison_method: "每場每階段逐條使用實際市場線及雙邊賠率；V2以Poisson分數矩陣選期望報酬較高的一邊。GPT與Claude各自讀取同一份凍結特徵、V2結果及市場報價，獨立產生影子選擇。三種模型結果均按實際比分結算；走盤不計命中率分母，大小球與讓分另按線別列統計。只供後台研究，不進公開戰績。",
      market_lines: "all_fixture_stage_quotes", market_metrics: { totals: metrics.totals_market_line, handicap: metrics.handicap_market_line }, llm_metrics, research_metrics, metrics,
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


