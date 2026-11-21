# NBA 推薦規則修改說明（2026-11-22，待 GPT 交叉審查）

> 狀態：**草案，尚未修改任何後端程式**。GPT 確認後，由 Claude 一步一步帶使用者部署。
> 依據：`deploy/analysis-20261122/results/` 兩份查詢結果（11/13 起已驗證賽事）。
> 所有規則都只是「把既有推薦過濾成暫不推薦」，**不會產生新方向**，所以可以用已存快照回算，也不需要新資料表。

---

## 0. 共通原則

1. **只套用在新快照**：以開賽時間判斷，常數 `NBA_RULES_V3_FROM`（部署當天決定，暫定 `2026-11-24T00:00:00+08:00`）。之前已封存的快照不改寫，沿用 11/15 加 70 門檻時的寫法（`Date.parse(fixture.date) >= Date.parse(...)`）。
2. 被規則擋下的推薦一律改成 `pick: "暫不推薦"`、`confidence: 0`，並給會員看得懂的 `reason`；另外加 `decision_code`，讓後台統計。
3. 原本的模型方向保留在 `display_pick`（T-10 已有此欄位），方便後台回算與比對。
4. 盤口熱門的定義：**主隊讓分盤 < 0 → 主隊熱門；> 0 → 客隊熱門；= 0 或沒有盤口 → 無法判斷，獨贏暫不推薦**。

---

## 1. 四條新規則

### 規則 1：獨贏只推盤口熱門（T-10、T-2、T-15）

| 階段 | 熱門判斷來源 |
|---|---|
| T-10 | `basketball-analysis` 內的 `marketHomeLine`（第 515 行附近，主盤優先、否則 consensus） |
| T-2／T-15 | `nba-v2-stage-runner` 的 `model.market.home_spread`（= 封存的 `market_data.market.consensus.home_spread`） |

- 推冷門 → 暫不推薦。原因：「模型看好的一方是盤口冷門，冷門推薦歷史命中率偏低，暫不列入正式推薦。」`decision_code: "underdog_pick"`
- 沒有讓分盤 → 暫不推薦。原因：「目前沒有讓分盤口可判斷熱門方，暫不列入正式獨贏推薦。」`decision_code: "favorite_unknown"`
- 資料：推冷門三階段合計 4/16＝25.0%；推熱門 69/102＝67.6%。

### 規則 2：T-2／T-15 獨贏必須和 T-10 同方向

- 從 `s.prediction_data.analysis.recommendations.moneyline.pick` 讀取 T-10 正式推薦（備援路徑同查詢 01：`prediction_data.recommendations`、`prediction_data.prediction.analysis.recommendations`）。
- T-10 為「暫不推薦」或方向相反 → 暫不推薦。
  - 反向原因：「與 T-10 賽前分析方向相反，訊號不一致，暫不推薦。」`decision_code: "conflict_with_t10"`
  - T-10 沒推原因：「T-10 賽前分析未列入正式獨贏推薦，本階段不單獨推薦。」`decision_code: "t10_not_qualified"`
- 資料：反向 2/7＝28.6%；同向 30/50＝60.0%。
- **給 GPT 確認**：T-10 沒推時要不要讓 T-2／T-15 自己推？草案是「不推」（比較保守，場數會變少）。

### 規則 3：大小分依模型與盤口差距篩選

差距 `gap = |模型總分 − 盤口總分|`。

| 階段 | 改前 | 改後 |
|---|---|---|
| T-10 | `gap ≥ 4.5` 且信心 ≥ 58 | `4.5 ≤ gap < 6` 且信心 ≥ 58（實際上「3～6 分」那組就是 4.5～6） |
| T-2／T-15 | 機率在 45～55% 之外就推 | 另外加 `gap < 6` |

- `gap ≥ 6` → 暫不推薦。原因：「模型與盤口總分差距過大（≥6 分），這類情況歷史上多半是模型誤判，暫不推薦。」`decision_code: "edge_too_large"`
- 資料：T-10 3～6 分 10/13＝76.9%，6 分以上 6/14＝42.9%。T-2／T-15 6 分以上 23/48＝47.9%。

### 規則 4：T-2／T-15 讓分信心要 70 以上

- 信心 < 70 → 暫不推薦。原因：「本階段讓分信心低於 70，暫不列入正式推薦。」`decision_code: "low_confidence"`
- 資料：T-2 信心 ≥70 為 15/22＝68.2%（全部 33/57＝57.9%）；T-15 14/21＝66.7%（全部 31/55＝56.4%）。
- T-10 讓分不變（約 50%，之後另外討論）。

---

## 2. ⚠️ 請 GPT 特別看這一點：T-2／T-15 大小分「差 6 分以內」幾乎沒有改善

| 階段 | 全部 | 改後（gap < 6） | 挑戰規則（gap < 3） |
|---|---|---|---|
| T-2 | 25/51＝49.0% | 15/29＝51.7% | 5/7＝71.4% |
| T-15 | 26/54＝48.1% | 13/28＝46.4% | 6/7＝85.7% |

原因是 3～6 分這組最差（合計 17/43＝39.5%）。所以「差 6 分以內」等於把差的留下來了。

可選方案：
- **A（目前決定）**：會員端用 `gap < 6`，`gap < 3` 當背景挑戰規則，兩週後看資料再決定。
- **B**：會員端直接用 `gap < 3`。樣本只有 14 場，而且區間是看過資料才選的，過度擬合的風險高，T-2／T-15 大小分場數會掉到大約 1/4。
- **C**：T-2／T-15 大小分先暫停正式推薦，只在背景跑。使用者已表示大小分最多人玩，不希望停推。

Claude 建議維持 A，但公開戰績的說明要誠實：T-2／T-15 大小分目前還在觀察期。

---

## 3. 預期影響（11/13 起回算；in-sample，會偏樂觀）

| 階段×玩法 | 改前 | 改後 | 說明 |
|---|---|---|---|
| T-10 獨贏 | 41/60＝68.3% | 39/54＝72.2% | 少約 6 場 |
| T-2 獨贏 | 16/29＝55.2% | ≤15/24（≥62.5%） | 熱門＋同向的交集要等後台回算才知道確切數字 |
| T-15 獨贏 | 16/30＝53.3% | ≤15/24（≥62.5%） | 同上 |
| T-2 讓分 | 33/57＝57.9% | 15/22＝68.2% | 少約 35 場 |
| T-15 讓分 | 31/55＝56.4% | 14/21＝66.7% | 少約 34 場 |
| T-10 大小分 | 16/27＝59.3% | 10/13＝76.9% | 少約 14 場 |
| T-2／T-15 大小分 | 見第 2 節 | 見第 2 節 | 少約一半 |

推薦總場數大約會減少 40～50%。換來的是準度：這是「精選」路線，和之前討論的一致。

---

## 4. 要改的程式

### 4-1 `supabase/functions/basketball-analysis/index.ts`（T-10）

- 約 556～580 行 `moneylineQualified`：在新規則日期之後，要多加一個條件 `pickIsFavorite`。`marketHomeLine` 在第 515 行就已經算出來，所以要把 moneyline 區塊移到它之後，或者改成在後面才判斷。
- 約 700～740 行大小分：`Math.abs(edge) >= 4.5` 改成 `>= 4.5 && < 6`（日期之後），並補上 ≥6 時的 reason。
- 約 784～830 行 `decision_code`：新增 `underdog_pick`、`favorite_unknown`、`edge_too_large`。
- `display_pick`／`display_reason` 不動，維持模型原本的方向。

### 4-2 `supabase/functions/nba-v2-stage-runner/index.ts`（T-2／T-15）

約 466 行的 `pick()` 是三種玩法共用的。草案是保留 `pick()` 當「模型原始方向」，在 `stageResult()` 裡面再分別包一層過濾：

```js
const raw = { moneyline: pick(p,…), handicap: spread, over_under: pick(model.over_probability,…) };
const t10ml = t10Rec(s)?.moneyline?.pick;          // 主隊／客隊／暫不推薦
const fav = m.home_spread < 0 ? '主隊' : m.home_spread > 0 ? '客隊' : null;
const gap = (m.total == null || model.expected_total == null) ? null : Math.abs(model.expected_total - m.total);
const rules = afterRulesFrom(s.fixture_time);
// moneyline：rules && (fav==null → favorite_unknown；raw!=fav → underdog_pick；t10ml!=raw → conflict_with_t10 / t10_not_qualified)
// handicap：rules && raw.confidence < 70 → low_confidence
// over_under：rules && gap >= 6 → edge_too_large
// 被擋下的：{pick:'暫不推薦', line:null, confidence:0, reason, decision_code, model_pick: raw.pick, model_confidence: raw.confidence}
```

- 新增欄位 `model_pick`／`model_confidence`／`decision_code`，讓後台不需要重算模型就能比較舊規則和新規則。
- `STAGE_REVISION` 要更新，方便追查是哪一版規則產生的快照。

### 4-3 不需要改的

前台（`analysis.html`、`performance.html`）本來就會顯示 `暫不推薦` 和 `reason`。公開戰績只統計正式推薦，所以會自動套用新規則。部署後要實際打開確認一次。

---

## 5. 後台「NBA V1／V2 比較」全面改版

### 5-1 改成什麼

舊版比的是 V1 和 V2 unified，這個比較已經過時了。新版改成：**三個階段 × 三種玩法 × 三套規則**。

| 規則 | 定義 |
|---|---|
| 舊規則 | 快照裡原本存的正式推薦（改版前的規則） |
| 新規則 | 舊規則再套第 1 節的四條過濾 |
| 挑戰規則 | 新規則，但 T-2／T-15 大小分改成 `gap < 3`（**只在後台，不給會員看**） |

每一格顯示：推薦場數、命中、走水、命中率（win=1、half_win=0.5、push 不計）。

分成兩段：
- **回測**（`NBA_RULES_V3_FROM` 之前）：標示「用同一批資料選出的規則，數字偏樂觀」。
- **上線後**（`NBA_RULES_V3_FROM` 之後）：這段才是真正驗證規則有沒有效。

另外提供「逐場明細」，可以篩「被新規則擋下的場次」，看擋掉的是對還是錯。

### 5-2 後端：`admin-nba-v2-compare` 改寫（API_VERSION 改成 `nba-rules-v3-compare-2026112x`）

- 資料來源：
  - T-10：`basketball_prediction_snapshots`（prediction_data、final_score）。
  - T-2／T-15：`basketball_v2_stage_snapshots`（result_data；status=ready，capture_mode=scheduled）。
  - 不再讀 `basketball_v2_unified_snapshots`。
- 舊快照沒有 `model_pick`，就從快照裡已存的資料即時回算：推薦方向、信心、盤口（consensus.home_spread／total），以及模型總分（T-10 `model.expected_total`／`fair_total`；T-2／T-15 `result_data.model.expected_total`），T-10 的方向也從 prediction_data 讀。規則函式寫成一個共用的 `applyRulesV3(stage, market, rec, ctx)`，和 4-2 的邏輯一模一樣。**計算規則只寫一份，避免前後不一致**。
- 參數：`days`（7／14／30／全部）、`stage`、`market`。上限從 200 筆提高，用分頁抓。
- 仍然需要管理員 session。

### 5-3 前台：`admin.html` 的 `nbaModelBacktestPage`（1859～1887 行）

- 上方三個篩選：期間、階段、玩法。
- 主表：每列是「階段×玩法」，欄是「舊／新／挑戰」的場數與命中率，分成回測和上線後兩區塊。
- 下方逐場明細：日期、對戰、玩法、模型方向、舊規則、新規則、挑戰規則、`decision_code`、結果。
- 沿用 `loadNbaResearch()`／`renderNbaResearch()` 的結構，改掉裡面的欄位就好。這部分 Claude 可以直接改並提交，但要等後端函式部署後才會有資料。

---

## 6. 部署順序（GPT 確認後）

1. Claude 修改 `basketball-analysis`、`nba-v2-stage-runner`、`admin-nba-v2-compare` 的程式碼並提交（**不自動部署**）。
2. 使用者照步驟用 Supabase 部署三個函式。Claude 會一步一步帶。
3. 用 `dry_run` 跑一場確認輸出欄位，打開前台分析頁和戰績頁看是否正常。
4. Claude 改 `admin.html` 比較頁並提交。
5. 兩週後（約 12/8）在後台看「上線後」的數字，決定挑戰規則要不要轉正。

## 7. 請 GPT 回答

1. 熱門定義用讓分盤正負號可以嗎？還是要改看獨贏賠率？
2. T-10 沒推的時候，T-2／T-15 獨贏要不要也不推？（第 2 條）
3. T-2／T-15 大小分選 A、B 還是 C？（第 2 節）
4. 共用規則函式 `applyRulesV3` 要不要抽成 `_shared/nba-rules.ts`？目前三個函式都是獨立部署的。
