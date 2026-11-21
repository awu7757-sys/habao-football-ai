// NBA 推薦規則 V3 離線測試（不連資料庫、不呼叫 API）。node tests/nba-rules-v3.test.cjs
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const canonical = read('supabase/functions/_shared/nba-rules-v3.js');
const runnerSrc = read('supabase/functions/nba-v2-stage-runner/index.ts');
const t10Src = read('supabase/functions/basketball-analysis/index.ts');
const ctx = vm.createContext({ Date, Number, String, Math, Object });
vm.runInContext(canonical + '\nthis.R={NBA_RULES_V3,NBA_RULES_V3_REASONS,nbaRulesV3Active,nbaRulesV3Favorite,nbaRulesV3Decide,nbaRulesV3Wrap};', ctx);
const R = ctx.R;
const tests = []; const test = (n, f) => tests.push({ n, f });
const rec = (pick, extra = {}) => ({ pick, line: -4.5, confidence: 72, reason: '原因', ...extra });
const D = (o) => R.nbaRulesV3Decide(o);

test('已完成的兩個入口（T-10、階段 runner）嵌入程式與正本一致', () => {
  cp.execFileSync('node', [path.join(root, 'scripts/sync-nba-rules-v3.cjs'), '--check'], { stdio: 'pipe' });
  for (const src of [runnerSrc, t10Src]) assert.ok(src.includes(canonical.trim()));
});
test('啟用時間：之前不套、等於與之後套用、無法解析時套用', () => {
  assert.equal(R.nbaRulesV3Active('2026-11-23T23:59:59+08:00'), false);
  assert.equal(R.nbaRulesV3Active('2026-11-24T00:00:00+08:00'), true);
  assert.equal(R.nbaRulesV3Active('2026-11-25T10:00:00Z'), true);
  assert.equal(R.nbaRulesV3Active('bad-date'), true);
  assert.equal(R.nbaRulesV3Active(null), true);
});
test('熱門：負＝主隊、正＝客隊；0／缺值／無效值不判定', () => {
  assert.equal(R.nbaRulesV3Favorite(-3.5), '主隊');
  assert.equal(R.nbaRulesV3Favorite('2'), '客隊');
  for (const v of [0, null, undefined, '', 'abc', true, 61, -99]) assert.equal(R.nbaRulesV3Favorite(v), null, String(v));
});
test('原本暫不推薦不會變成推薦', () => {
  for (const market of ['moneyline', 'handicap', 'over_under']) {
    assert.equal(D({ stage: 't2', market, rec: { pick: '暫不推薦' }, homeSpread: -5 }), null);
    const out = R.nbaRulesV3Wrap({ pick: '暫不推薦', confidence: 0 }, { stage: 't2', market, homeSpread: null });
    assert.equal(out.pick, '暫不推薦');
  }
});
test('獨贏：推熱門保留、推冷門擋下、無盤口擋下', () => {
  assert.equal(D({ stage: 't10', market: 'moneyline', rec: rec('主隊'), homeSpread: -6 }), null);
  assert.equal(D({ stage: 't10', market: 'moneyline', rec: rec('主隊'), homeSpread: 6 }), 'underdog_pick');
  assert.equal(D({ stage: 't10', market: 'moneyline', rec: rec('客隊'), homeSpread: 0 }), 'favorite_unknown');
  assert.equal(D({ stage: 't10', market: 'moneyline', rec: rec('客隊'), homeSpread: null }), 'favorite_unknown');
});
test('T-2／T-15 獨贏：寬鬆只擋反向，T-10 沒推可獨立判斷；嚴格才擋 T-10 沒推', () => {
  const base = { stage: 't15', market: 'moneyline', rec: rec('客隊'), homeSpread: 4 };
  assert.equal(D({ ...base, t10MoneylinePick: '客隊', t10Policy: 'lenient' }), null);
  assert.equal(D({ ...base, t10MoneylinePick: '主隊', t10Policy: 'lenient' }), 'conflict_with_t10');
  assert.equal(D({ ...base, t10MoneylinePick: '暫不推薦', t10Policy: 'lenient' }), null);
  assert.equal(D({ ...base, t10MoneylinePick: null, t10Policy: 'lenient' }), null);
  assert.equal(D({ ...base, t10MoneylinePick: '暫不推薦', t10Policy: 'strict' }), 't10_not_qualified');
  assert.equal(D({ ...base, homeSpread: -4, t10MoneylinePick: '客隊' }), 'underdog_pick');
});
test('讓分：T-10 不變；T-2／T-15 信心 69 擋、70 保留、缺值擋', () => {
  assert.equal(D({ stage: 't10', market: 'handicap', rec: rec('主隊', { confidence: 50 }) }), null);
  assert.equal(D({ stage: 't2', market: 'handicap', rec: rec('主隊', { confidence: 69 }) }), 'low_confidence');
  assert.equal(D({ stage: 't2', market: 'handicap', rec: rec('主隊', { confidence: 70 }) }), null);
  assert.equal(D({ stage: 't15', market: 'handicap', rec: rec('主隊', { confidence: null }) }), 'low_confidence');
});
test('大小分：差距邊界用未取整值；缺值不放行', () => {
  const ou = (m, t, stage = 't10', variant) => D({ stage, market: 'over_under', rec: rec('大'), modelTotal: m, marketTotal: t, variant });
  assert.equal(ou(224.5, 220), null);          // 4.5
  assert.equal(ou(225.99, 220), null);         // 5.99（顯示會四捨五入成 6.0，但仍保留）
  assert.equal(ou(226, 220), 'edge_too_large'); // 6
  assert.equal(ou(214, 220, 't2'), 'edge_too_large');
  assert.equal(ou(217.1, 220, 't2'), null);
  assert.equal(ou(null, 220), 'gap_unknown');
  assert.equal(ou(225, ''), 'gap_unknown');
  assert.equal(ou(222.9, 220, 't2', 'challenger'), null);           // 2.9
  assert.equal(ou(223, 220, 't2', 'challenger'), 'challenger_gap'); // 3
  assert.equal(ou(225, 220, 't10', 'challenger'), null);            // T-10 不受挑戰規則影響
});
test('Wrap：保留完整原推薦，被擋下改成暫不推薦並降為參考等級', () => {
  const r = { pick: '大', line: 220, confidence: 66, reason: '模型公平總分 230', official_pick_is_qualified: true, signal_level: '正式推薦', decision_code: 'qualified', display_pick: '大' };
  const out = R.nbaRulesV3Wrap(r, { stage: 't10', market: 'over_under', modelTotal: 230, marketTotal: 220, blockedSignalLevel: '低優勢方向' });
  assert.equal(out.pick, '暫不推薦'); assert.equal(out.line, null); assert.equal(out.confidence, 0);
  assert.equal(out.official_pick_is_qualified, false); assert.equal(out.signal_level, '低優勢方向');
  assert.equal(out.decision_code, 'edge_too_large'); assert.equal(out.reason, R.NBA_RULES_V3_REASONS.edge_too_large);
  assert.equal(out.display_pick, '大');
  assert.deepEqual({ ...out.pre_rule }, { pick: '大', line: 220, confidence: 66, reason: '模型公平總分 230', official_pick_is_qualified: true, decision_code: 'qualified' });
  assert.equal(out.rule_version, R.NBA_RULES_V3.version);
  const kept = R.nbaRulesV3Wrap(r, { stage: 't10', market: 'over_under', modelTotal: 225, marketTotal: 220 });
  assert.equal(kept.pick, '大'); assert.equal(kept.line, 220); assert.equal(kept.pre_rule.pick, '大');
});
test('階段 runner：stageRecommendations 讀 T-10 正式獨贏、啟用前不動', () => {
  const pick = s => { const a = runnerSrc.indexOf(s); assert.ok(a >= 0, s); return runnerSrc.slice(a, runnerSrc.indexOf('\n', a)); };
  const c2 = vm.createContext({ Date, Number, String, Math, Object });
  vm.runInContext(canonical + '\n' + pick('function t10MoneylinePick(') + '\n' + runnerSrc.slice(runnerSrc.indexOf('function stageRecommendations('), runnerSrc.indexOf('function stageResult(')) + '\nthis.f=stageRecommendations;', c2);
  const raw = { moneyline: { pick: '主隊', line: null, confidence: 63, reason: 'x' }, handicap: { pick: '客隊', line: 3.5, confidence: 68, reason: 'y' }, over_under: { pick: '小', line: 221, confidence: 58, reason: 'z' } };
  const model = { market: { home_spread: -3.5, total: 221 }, expected_total: 216.5 };
  const s = { fixture_time: '2026-11-25T08:00:00Z', prediction_data: { analysis: { recommendations: { moneyline: { pick: '客隊' } } } } };
  const out = c2.f(s, 't2', model, raw);
  assert.equal(out.moneyline.decision_code, 'conflict_with_t10');
  assert.equal(out.handicap.decision_code, 'low_confidence');
  assert.equal(out.over_under.pick, '小'); assert.equal(out.over_under.pre_rule.pick, '小');
  const before = c2.f({ ...s, fixture_time: '2026-11-20T08:00:00Z' }, 't2', model, raw);
  assert.equal(before, raw);
  assert.ok(runnerSrc.includes("recommendations:stageRecommendations(s,stage,model,{moneyline:pick(p,'主隊','客隊')"));
});
test('T-10：只在啟用後套用，並使用本快照的 marketHomeLine／fairTotal', () => {
  assert.match(t10Src, /if \(nbaRulesV3Active\(payload\?\.fixture\?\.date\)\) \{\s*const ctx = \{ stage: "t10", homeSpread: marketHomeLine, modelTotal: fairTotal, marketTotal, blockedSignalLevel: referenceLabel \};/);
  assert.match(t10Src, /return output;\n\}/);
});
test('前台：暫不推薦原因優先依 decision_code，舊快照用文字備援', () => {
  for (const f of ['analysis.html', 'mlb-analysis.html']) {
    const h = read(f), a = h.indexOf('const NO_PICK_CODE_LABELS='), b = h.indexOf('return "未提供推薦";};', a);
    const c3 = vm.createContext({}); vm.runInContext(h.slice(a, b + 'return "未提供推薦";};'.length) + '\nthis.f=noPickReasonLabel;', c3);
    assert.equal(c3.f({ decision_code: 'conflict_with_t10', reason: '與 T-10 賽前分析方向相反' }), '與 T-10 方向相反');
    assert.equal(c3.f({ decision_code: 'underdog_pick', reason: '盤口冷門' }), '冷門方向');
    assert.equal(c3.f({ decision_code: 'edge_too_large', reason: '盤口總分差距過大' }), '差距過大');
    assert.equal(c3.f({ reason: '與莊家方向相反' }), '與莊家方向相反');
    assert.equal(c3.f({ decision_code: 'market_unavailable', reason: '目前沒有可用的真實市場讓分盤口' }), '未取得盤口');
  }
});

// ---- 實際入口：直接執行 repo 裡的 stageResult()、buildFixedRecommendations()、createNarrative() ----
const { stripTypeScriptTypes } = require('node:module');
function runnerContext() {
  const a = runnerSrc.indexOf('// === NBA_RULES_V3 BEGIN ==='), b = runnerSrc.indexOf('async function patchStage(');
  const c = vm.createContext({ Date, Number, String, Math, Object, JSON, Array });
  vm.runInContext("const STAGE_VERSION='test';const round=(x,n=3)=>Number(x.toFixed(n));\n" + runnerSrc.slice(a, b) + '\nthis.stageResult=stageResult;', c);
  return c;
}
const RC = runnerContext();
const stageRun = (model, fixture_time = '2026-11-25T08:00:00Z', t10 = '主隊') => JSON.parse(JSON.stringify(RC.stageResult(
  { game_id: 1, fixture_time, prediction_data: { fixture: { home: {}, away: {} }, analysis: { recommendations: { moneyline: { pick: t10 } } } } },
  't2', { home_win_probability: 0.6, home_cover_probability: 0.72, over_probability: 0.6, expected_total: 222, expected_home_points: 112, expected_away_points: 110, expected_margin: 2,
    market: { available: true, home_spread: -3.5, total: 220, quotes: [] }, ...model }, { captured_at: 'x', capture_mode: 'scheduled' }))).analysis.recommendations;
const assertNoPick = (r, code) => { assert.equal(r.pick, '暫不推薦'); assert.equal(r.line, null); assert.equal(r.confidence, 0); if (code) assert.equal(r.decision_code, code); };

test('stageResult：null／undefined／NaN／Infinity／範圍外／字串異常的機率都不產生推薦', () => {
  for (const v of [null, undefined]) assertNoPick(stageRun({ over_probability: v }).over_under, 'market_unavailable');
  for (const v of [NaN, Infinity, -Infinity, -0.1, 1.2, '', 'abc', true]) assertNoPick(stageRun({ over_probability: v }).over_under, 'invalid_probability');
  assertNoPick(stageRun({ home_cover_probability: NaN }).handicap, 'invalid_probability');
  assertNoPick(stageRun({ home_win_probability: 2 }).moneyline, 'invalid_probability');
  assert.equal(stageRun({ over_probability: '0.6' }).over_under.pick, '大');   // 數字字串明確正規化
});
test('stageResult：缺讓分盤（機率 70%）、缺大小分盤都不推；0 讓分是有效盤', () => {
  for (const hs of [null, undefined, '', 'x']) assertNoPick(stageRun({ home_cover_probability: 0.70, market: { available: true, home_spread: hs, total: 220, quotes: [] } }).handicap, 'market_unavailable');
  for (const t of [null, undefined, '']) assertNoPick(stageRun({ market: { available: true, home_spread: -3.5, total: t, quotes: [] } }).over_under);
  const pk = stageRun({ home_cover_probability: 0.72, market: { available: true, home_spread: 0, total: 220, quotes: [] } });
  assert.equal(pk.handicap.pick, '主隊'); assert.equal(pk.handicap.line, 0); assert.equal(pk.handicap.confidence, 72);
  assert.equal(pk.moneyline.decision_code, 'favorite_unknown');                // 0 讓分不能判斷熱門
});
test('stageResult：45%／55% 邊界與取整 70 維持原行為；不輸出有方向但缺 confidence／line', () => {
  assert.equal(stageRun({ over_probability: 0.45, expected_total: 218 }).over_under.pick, '小');
  assert.equal(stageRun({ over_probability: 0.45001 }).over_under.pick, '暫不推薦');
  assert.equal(stageRun({ over_probability: 0.55 }).over_under.pick, '大');
  assert.equal(stageRun({ home_cover_probability: 0.6949 }).handicap.decision_code, 'low_confidence');
  assert.equal(stageRun({ home_cover_probability: 0.695 }).handicap.pick, '主隊');
  assert.equal(stageRun({ home_cover_probability: 0.305 }).handicap.pick, '客隊');
  assert.equal(stageRun({ home_cover_probability: 0.305 }).handicap.line, 3.5);
  assert.equal(stageRun({ home_cover_probability: 0.3051 }).handicap.decision_code, 'low_confidence');
  for (const v of [undefined, NaN, 0.7, 0.3, 0.5]) for (const m of [{ home_spread: null, total: null }, { home_spread: -2, total: 210 }]) {
    const r = stageRun({ home_cover_probability: v, over_probability: v, home_win_probability: v, market: { available: true, quotes: [], ...m } });
    for (const k of ['moneyline', 'handicap', 'over_under']) if (r[k].pick !== '暫不推薦') {
      assert.equal(typeof r[k].confidence, 'number', k);
      if (k !== 'moneyline') assert.equal(typeof r[k].line, 'number', k);
    }
  }
});
test('stageResult：V3 完整路徑（啟用前不包裝、啟用後保留 pre_rule）', () => {
  const after = stageRun({}), before = stageRun({}, '2026-11-20T08:00:00Z');
  assert.equal(after.handicap.rule_version, 'nba-rules-v3-20261122'); assert.equal(after.handicap.pre_rule.pick, '主隊');
  assert.equal(before.handicap.rule_version, undefined);
  assert.equal(stageRun({}, undefined, '客隊').moneyline.decision_code, 'conflict_with_t10');
});

function t10Context(fetchImpl) {
  const js = stripTypeScriptTypes(t10Src.replace(/^import .*$/m, ''), { mode: 'strip' });
  const c = vm.createContext({ Date, Number, String, Math, Object, JSON, Array, console: { error() {}, log() {} }, fetch: fetchImpl,
    Deno: { env: { get: () => '' }, serve: () => {} }, createClient: () => ({}) });
  vm.runInContext(js + '\nthis.build=buildFixedRecommendations;this.narr=createNarrative;', c);
  return c;
}
const t10Payload = (over = {}) => ({
  fixture: { date: '2026-11-25T08:00:00Z', home: { name_zh: '主' }, away: { name_zh: '客' } },
  model: { win_probability: { home: 70, away: 30 }, confidence: 75, fair_total: 226, fair_spread: { home_line: -8 }, predicted_score: { home: 116, away: 110 } },
  market_data: { market: { available: true, primary: { home_spread: -5, away_spread: 5, total: 220 }, consensus: {} } }, ...over });
test('T-10 buildFixedRecommendations：gap 4.49 不推、4.5／5.99 推、6 擋；primary 不一致退回 consensus；啟用前不動', () => {
  const C = t10Context(async () => { throw Error('no'); });
  const ou = ft => C.build(t10Payload({ model: { ...t10Payload().model, fair_total: ft } })).over_under;
  assert.equal(ou(224.49).pick, '暫不推薦'); assert.equal(ou(224.5).pick, '大'); assert.equal(ou(225.99).pick, '大');
  const blocked = ou(226); assert.equal(blocked.decision_code, 'edge_too_large'); assert.equal(blocked.pre_rule.pick, '大'); assert.equal(blocked.official_pick_is_qualified, false);
  const inc = C.build(t10Payload({ market_data: { market: { available: true, primary: { home_spread: -5, away_spread: -5, total: 220 }, consensus: { home_spread: 4, away_spread: -4 } } } }));
  assert.equal(inc.moneyline.decision_code, 'underdog_pick');               // consensus +4 → 客隊熱門，模型推主隊
  const old = C.build(t10Payload({ fixture: { ...t10Payload().fixture, date: '2026-11-20T08:00:00Z' }, model: { ...t10Payload().model, fair_total: 226 } }));
  assert.equal(old.over_under.pick, '大'); assert.equal(old.over_under.rule_version, undefined);
});
test('T-10 createNarrative：AI 文案不能覆蓋 V3 拒絕原因；未擋下的照原設計；AI 失敗／無金鑰 fallback 正確', async () => {
  const ai = { summary: 's', recommendations: { moneyline: { reason: 'AI 獨贏' }, handicap: { reason: 'AI 讓分' }, over_under: { reason: '模型看好大分，值得推薦' } } };
  const C = t10Context(async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(ai) }), text: async () => '' }));
  const out = await C.narr('key', t10Payload());
  const ou = out.recommendations.over_under;
  assert.equal(ou.pick, '暫不推薦'); assert.equal(ou.line, null); assert.equal(ou.confidence, 0); assert.equal(ou.official_pick_is_qualified, false);
  assert.equal(ou.decision_code, 'edge_too_large'); assert.equal(ou.reason, R.NBA_RULES_V3_REASONS.edge_too_large);
  assert.equal(ou.pre_rule.pick, '大'); assert.equal(ou.rule_version, 'nba-rules-v3-20261122');
  assert.equal(out.recommendations.moneyline.pick, '主隊'); assert.equal(out.recommendations.moneyline.reason, 'AI 獨贏');
  const F = t10Context(async () => ({ ok: false, text: async () => 'err' }));
  assert.equal((await F.narr('key', t10Payload())).recommendations.over_under.reason, R.NBA_RULES_V3_REASONS.edge_too_large);
  assert.equal((await F.narr('', t10Payload())).recommendations.over_under.decision_code, 'edge_too_large');
});

(async () => { let failed = 0; for (const t of tests) { try { await t.f(); console.log('PASS ' + t.n); } catch (e) { failed++; console.error('FAIL ' + t.n + '\n' + e.stack); } }
  console.log(JSON.stringify({ suite: 'NBA rules v3', passed: tests.length - failed, failed })); process.exitCode = failed ? 1 : 0; })();
