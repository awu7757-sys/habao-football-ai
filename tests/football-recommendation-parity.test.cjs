// 足球 T-2／T-15 推薦一致性檢查（2026-11-15，待辦第 6 項）
//
// 同一份階段快照的推薦在兩個地方各算一次：
//   會員看的：supabase/functions/football-v2-stage-member/index.ts  → toAnalysis()
//   公開戰績：supabase/functions/ai-performance/index.ts             → 讀取時重算
// 本測試直接從兩個原始檔抽出計算程式，用大量合成快照比對兩邊的
// 獨贏／大小／讓分／BTTS 推薦與盤線。任何一邊改了算法而另一邊沒改，這裡就會失敗。
// 只讀原始檔，不呼叫 Supabase、不需要網路。
//
// 執行：node tests/football-recommendation-parity.test.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '..');
const strip = code => stripTypeScriptTypes(code, { mode: 'strip' });
const between = (src, start, end, label) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `${label}：找不到開頭標記，原始碼結構已變更，請同步更新本測試`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j >= 0, `${label}：找不到結尾標記，原始碼結構已變更，請同步更新本測試`);
  return src.slice(i, j);
};

// ---- 會員端：toAnalysis() ----
const memberSrc = fs.readFileSync(path.join(root, 'supabase/functions/football-v2-stage-member/index.ts'), 'utf8');
const memberCode = between(memberSrc, 'function scoreGrid(', '\nDeno.serve(', 'stage-member'); // toAnalysis 之後是 Deno.serve
const memberCtx = { VERSION: 'test', Math, Number, Array, String, Date, Object, JSON };
vm.createContext(memberCtx);
vm.runInContext(strip(memberCode) + '\nthis.toAnalysis = toAnalysis;', memberCtx);
assert.equal(typeof memberCtx.toAnalysis, 'function', 'stage-member：toAnalysis 未抽出');

// ---- 公開戰績端：ai-performance 讀取時重算 ----
const perfSrc = fs.readFileSync(path.join(root, 'supabase/functions/ai-performance/index.ts'), 'utf8');
const helpers = between(perfSrc, 'const poisson = (lambda: number, k: number)', 'const patchedRows', 'ai-performance helpers');
const body = between(perfSrc, 'const hxg = Number(snapshot.home_xg)', 'patchedRows.push({...row,public_stage:selectedStage', 'ai-performance body');
const perfFn = `
${helpers}
this.perfRecommend = function (snapshot, row) {
  ${body}
  return { recommendations, settlement };
};`;
const perfCtx = { Math, Number, Array, String, Object, JSON };
vm.createContext(perfCtx);
// 原始碼中 `if (!Number.isFinite(...)) continue;` 在迴圈內；包成函式後改為 return null。
vm.runInContext(strip(perfFn.replace(/\)\s*continue;/g, ') return null;')), perfCtx);
assert.equal(typeof perfCtx.perfRecommend, 'function', 'ai-performance：計算區塊未抽出');

// ---- 合成資料 ----
let seed = 20261115;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pickOf = arr => arr[Math.floor(rand() * arr.length)];
const quarter = () => pickOf([1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5]);
const hcap = () => pickOf([-1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25]);
const odds = () => Number((1.6 + rand() * 0.8).toFixed(2));

function makeSnapshot() {
  const hx = Number((0.3 + rand() * 2.8).toFixed(3));
  const ax = Number((0.3 + rand() * 2.8).toFixed(3));
  const totals = Array.from({ length: Math.floor(rand() * 3) }, () => ({ line: quarter(), over_odds: odds(), under_odds: odds() }));
  const handicaps = Array.from({ length: Math.floor(rand() * 3) }, () => { const l = hcap(); return { home_line: l, away_line: -l, home_odds: odds(), away_odds: odds() }; });
  // 一半樣本附上 runner 會存的機率（同一 0～18 比分網格），一半留空讓兩邊自行由 xG 計算。
  let probabilities = {};
  if (rand() < 0.5) {
    const pois = (l, k) => { let p = Math.exp(-l); for (let n = 1; n <= k; n++) p *= l / n; return p; };
    const hp = Array.from({ length: 19 }, (_, k) => pois(hx, k)), ap = Array.from({ length: 19 }, (_, k) => pois(ax, k));
    const mass = hp.reduce((x, y) => x + y, 0) * ap.reduce((x, y) => x + y, 0);
    let h = 0, d = 0, a = 0, bt = 0;
    for (let i = 0; i < 19; i++) for (let j = 0; j < 19; j++) { const p = hp[i] * ap[j] / mass; if (i > j) h += p; else if (i === j) d += p; else a += p; if (i && j) bt += p; }
    probabilities = { home_win: h, draw: d, away_win: a, btts_yes: bt };
  }
  return { fixture_id: 1, kickoff_at: '2026-11-15T12:00:00Z', home_xg: hx, away_xg: ax, probabilities, market_context: { totals, handicaps }, source_meta: {} };
}

const norm = r => ({
  moneyline: r.moneyline.pick,
  btts: r.btts.pick,
  over_under: [r.over_under.pick, r.over_under.line],
  handicap: [r.handicap.pick, r.handicap.line],
});

let passed = 0;
const N = 3000;
for (let i = 0; i < N; i++) {
  const snap = makeSnapshot();
  const m = memberCtx.toAnalysis(snap, {}, pickOf(['t2', 't15'])).analysis.recommendations;
  const p = perfCtx.perfRecommend(snap, { home_score: 1, away_score: 1 });
  assert.ok(p, `第 ${i} 筆：公開戰績端拒絕了會員端接受的快照`);
  assert.deepEqual(norm(p.recommendations), norm(m), `第 ${i} 筆推薦不一致：xG ${snap.home_xg}/${snap.away_xg}`);
  passed++;
}
console.log(`PASS ${passed} 筆合成快照：會員推薦與公開戰績推薦一致`);

// ---- 後台：admin-center 的逐字複本（2026-11-15）----
// 後台 AI 分析紀錄用同一份 toAnalysis 顯示 T-2／T-15 系統快照推薦，必須和會員端一字不差。
const adminSrc = fs.readFileSync(path.join(root, 'supabase/functions/admin-center/index.ts'), 'utf8');
const adminBlock = between(adminSrc, 'const STAGE_MODEL_VERSION', '// ===== END COPY: football-v2-stage-member toAnalysis', 'admin-center copy');
const adminCode = adminBlock.slice(adminBlock.indexOf('function scoreGrid(')).replace(/\bSTAGE_MODEL_VERSION\b/g, 'VERSION').trim();
assert.equal(adminCode, memberCode.trim(), 'admin-center 的 toAnalysis 複本與 football-v2-stage-member 不一致，請同步');
console.log('PASS admin-center toAnalysis 複本與會員端一致');
