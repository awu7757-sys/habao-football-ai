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

test('三份嵌入程式與正本一致', () => {
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

(async () => { let failed = 0; for (const t of tests) { try { await t.f(); console.log('PASS ' + t.n); } catch (e) { failed++; console.error('FAIL ' + t.n + '\n' + e.stack); } }
  console.log(JSON.stringify({ suite: 'NBA rules v3', passed: tests.length - failed, failed })); process.exitCode = failed ? 1 : 0; })();
