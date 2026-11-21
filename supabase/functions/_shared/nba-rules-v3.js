// === NBA_RULES_V3 BEGIN ===
// NBA 推薦規則 V3（2026-11-22）。正本：supabase/functions/_shared/nba-rules-v3.js
// 這一段會原封不動複製到 basketball-analysis、nba-v2-stage-runner、admin-nba-v2-compare（Supabase 網站貼上部署，無法跨函式 import）。
// 修改請只改正本，再執行 node scripts/sync-nba-rules-v3.cjs；tests/nba-rules-v3.test.cjs 會檢查三份是否一致。
// 純函式：不讀資料庫、不呼叫 API、不讀賽果。只會把既有推薦改成暫不推薦，不會產生新方向。
// 規格：deploy/nba-rules-20261122/NBA_RULES_CHANGE_SPEC.md
const NBA_RULES_V3 = { version: 'nba-rules-v3-20261122', from: '2026-11-24T00:00:00+08:00', totalGapMax: 6, challengerGapMax: 3, stageSpreadConfMin: 70 };
const NBA_RULES_V3_REASONS = {
  underdog_pick: '模型看好的一方是盤口冷門，冷門推薦歷史命中率偏低，暫不列入正式推薦。',
  favorite_unknown: '目前沒有可判斷熱門方的讓分盤口，暫不列入正式獨贏推薦。',
  conflict_with_t10: '與 T-10 賽前分析方向相反，訊號不一致，暫不推薦。',
  t10_not_qualified: 'T-10 賽前分析未列入正式獨贏推薦，本階段不單獨推薦。',
  edge_too_large: '模型與盤口總分差距過大（6 分以上），這類情況歷史上多半是模型誤判，暫不推薦。',
  gap_unknown: '缺少模型總分或盤口總分，暫不推薦。',
  low_confidence: '本階段讓分模型機率低於 70%，暫不列入正式推薦。',
  challenger_gap: '挑戰規則：模型與盤口總分差距 3 分以上（僅後台比較用）。',
};
// 是否為被 V3 規則擋下的推薦（固定原因不得被 AI 文案覆蓋）。
function nbaRulesV3Blocked(rec) {
  return !!(rec && rec.rule_version && String(rec.pick || '').trim() === '暫不推薦' &&
    Object.prototype.hasOwnProperty.call(NBA_RULES_V3_REASONS, String(rec.decision_code || '')));
}
// 合併 AI 解說：被 V3 擋下的保留固定規則原因（AI 文案不採用）；其餘維持原設計（AI 文案優先，空白時用原因）。
function nbaRulesV3MergeNarrative(rec, aiReason) {
  if (nbaRulesV3Blocked(rec)) return { ...rec };
  return { ...rec, reason: String(aiReason || (rec && rec.reason) || '') };
}
function nbaRulesV3Num(v) {
  if (v === null || v === undefined || typeof v === 'boolean' || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// 開賽時間 >= 啟用時間才套用；時間無法解析時保守套用。
function nbaRulesV3Active(fixtureTime) {
  const t = Date.parse(String(fixtureTime || ''));
  return !Number.isFinite(t) || t >= Date.parse(NBA_RULES_V3.from);
}
// 讓分盤熱門：同場同階段的主隊讓分，負＝主隊、正＝客隊；0、缺值、無效值不判定。
function nbaRulesV3Favorite(homeSpread) {
  const n = nbaRulesV3Num(homeSpread);
  if (n === null || n === 0 || Math.abs(n) > 60) return null;
  return n < 0 ? '主隊' : '客隊';
}
function nbaRulesV3Side(pick) {
  const p = String(pick || '').trim();
  return p === '主隊' ? '主隊' : p === '客隊' ? '客隊' : null;
}
function nbaRulesV3IsPick(pick) {
  const p = String(pick || '').trim();
  return p !== '' && p !== '暫不推薦';
}
// input: { stage:'t10'|'t2'|'t15', market:'moneyline'|'handicap'|'over_under', rec:{pick,confidence,...},
//          homeSpread, modelTotal, marketTotal, t10MoneylinePick, t10Policy:'lenient'|'strict', variant:'official'|'challenger' }
// 回傳 decision_code（被擋下）或 null（保留）。原本就暫不推薦的一律回傳 null。
function nbaRulesV3Decide(input) {
  const i = input || {}, rec = i.rec || {};
  if (!nbaRulesV3IsPick(rec.pick)) return null;
  const stage = i.stage === 't2' || i.stage === 't15' ? i.stage : 't10';
  if (i.market === 'moneyline') {
    const fav = nbaRulesV3Favorite(i.homeSpread), side = nbaRulesV3Side(rec.pick);
    if (!fav) return 'favorite_unknown';
    if (side !== fav) return 'underdog_pick';
    if (stage !== 't10') {
      const t10 = nbaRulesV3Side(i.t10MoneylinePick);
      if (t10 && t10 !== side) return 'conflict_with_t10';
      if (!t10 && i.t10Policy === 'strict') return 't10_not_qualified';
    }
    return null;
  }
  if (i.market === 'handicap') {
    if (stage === 't10') return null;
    const c = nbaRulesV3Num(rec.confidence);
    return c === null || c < NBA_RULES_V3.stageSpreadConfMin ? 'low_confidence' : null;
  }
  if (i.market === 'over_under') {
    const m = nbaRulesV3Num(i.modelTotal), t = nbaRulesV3Num(i.marketTotal);
    if (m === null || t === null) return 'gap_unknown';
    const gap = Math.abs(m - t), challenger = i.variant === 'challenger' && stage !== 't10';
    if (challenger && gap >= NBA_RULES_V3.challengerGapMax) return 'challenger_gap';
    return gap >= NBA_RULES_V3.totalGapMax ? 'edge_too_large' : null;
  }
  return null;
}
// 套用到一筆正式推薦物件：保留套用前的完整推薦（pre_rule），被擋下則改成暫不推薦。
// blockedSignalLevel：T-10 被擋下時要顯示的 signal_level（參考等級）；階段推薦沒有此欄位可不傳。
function nbaRulesV3Wrap(rec, input) {
  const r = rec || {};
  const pre_rule = {
    pick: r.pick ?? null, line: r.line ?? null, confidence: r.confidence ?? null, reason: r.reason ?? null,
    official_pick_is_qualified: r.official_pick_is_qualified ?? nbaRulesV3IsPick(r.pick), decision_code: r.decision_code ?? null,
  };
  const code = nbaRulesV3Decide({ ...(input || {}), rec: r });
  if (!code) return { ...r, pre_rule, rule_version: NBA_RULES_V3.version };
  const out = { ...r, pick: '暫不推薦', line: null, confidence: 0, reason: NBA_RULES_V3_REASONS[code], decision_code: code,
    official_pick_is_qualified: false, pre_rule, rule_version: NBA_RULES_V3.version };
  if ('signal_level' in r && input && input.blockedSignalLevel) out.signal_level = input.blockedSignalLevel;
  return out;
}
// === NBA_RULES_V3 END ===
