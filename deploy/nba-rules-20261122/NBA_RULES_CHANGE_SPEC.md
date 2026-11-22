# NBA 推薦規則修改說明 V2（2026-11-22，依 GPT 審查修正）

> 狀態：**程式已寫好、離線測試通過，待 GPT 複審後部署**（後台比較頁另外做）。
> 第一版（commit db101bb）的 GPT 審查：`HB_NBA_RULES_REVIEW_HANDOFF_20261122.md`（R1～R7）。這一版已逐條修正，修正對照見第 8 節。
> 所有規則都只是「把既有推薦過濾成暫不推薦」，**不會產生新方向，原本暫不推薦的也不會變成推薦**。

---

## 0. 已決定／待決定

| 項目 | 狀態 |
|---|---|
| 獨贏只推讓分盤熱門（三階段） | ✅ 使用者已決定 |
| T-2／T-15 獨贏不能和 T-10 反向 | ✅ 使用者已決定 |
| T-10 沒推時，T-2／T-15 獨贏要不要也不推 | ✅ **寬鬆**：只擋反向，T-10 沒推可獨立判斷（查詢 03：寬鬆 63.6%，嚴格 61.9%，嚴格多擋掉的是贏的那場） |
| 大小分：差 6 分以上不推；T-2／T-15 背景挑戰規則用「差 3 分以內」 | ✅ 選方案 A。T-10 有效（59.3%→76.9%）。T-2／T-15 回算沒有改善（約 43～46%），但 NBA 公開戰績是用 T-10 算，不受影響；不另外標示「觀察中」（使用者要求公開戰績只走正式規則） |
| T-2／T-15 讓分信心 ≥ 70 | ✅ 使用者已決定 |
| 啟用時間 `NBA_RULES_V3_FROM` | ⏳ 部署當天決定，用台灣時間 00:00 |
| 規則函式抽成 `_shared/nba-rules.ts` | ✅ 採用 GPT 建議 |

---

使用者優先順序（2026-11-22）：**讓分 > 大小分 > 獨贏**（獨贏賠率低，玩的人最少）。下一個要處理的是 T-10 讓分：它算在公開戰績裡，命中率 48.4%（31 場）。

---

## 1. 共通原則

1. **只套用在新快照**：開賽時間 ≥ `NBA_RULES_V3_FROM`（含等於）才套新規則。日期無法解析時一律套新規則（保守），並在 `rule_version` 註明。已封存的快照不改寫。
2. **讓分盤熱門**：使用同一場、同一階段當時封存的主隊讓分。負值代表主隊熱門，正值代表客隊熱門，0、缺值或無效值都不判定。不可以用推薦那一方的盤線，也不可以拿後面階段的盤口補前面階段。
   - T-10：沿用 `basketball-analysis` 的 `marketHomeLine`：|讓分| ≤ 60，主客盤線必須一致，primary 優先，否則退回 consensus。
   - T-2／T-15：用 runner 的 `model.market.home_spread`，也就是封存的 `market_data.market.consensus.home_spread`。它雖然叫 consensus，實際上是同一家盤商成對的盤線，直接用封存值。
3. **差距**：`gap = |模型總分 − 盤口總分|`，用**未取整**的值。T-10 的模型總分是 `fair_total`（和正式程式算 edge 的口徑一樣）；T-2／T-15 是 `model.expected_total` 對 `model.market.total`。任一邊缺值就不推，不可以用 0 代替，也不可以因為和 null 比較而放行。
4. **信心口徑不能混用**：T-10 用綜合信心分數。T-2／T-15 用已存的 `round(100×max(p,1−p))` 取整後的模型機率，「≥ 70」就是指這個取整後的整數。
5. **原有門檻全部保留**：T-10 的 55%／70／58／4.5，以及 T-2／T-15 的 45～55%（45%、55% 本身可以推），都照舊，新規則只是多加的過濾。
6. **保留套用新規則前的完整推薦（R5）**：每個玩法另外存一份 `pre_rule`，包含 `{pick, line, confidence, reason, official_pick_is_qualified, decision_code}`（欄位名稱和實作一致，後台也讀同名欄位），同時存 `rule_version: "nba-rules-v3-…"`，正式輸出照常寫在原欄位。這樣舊規則仍然可以用原本的盤線結算。T-10 的 `display_pick` 只是模型參考方向，不能拿來當舊規則的推薦。

---

## 2. 規則與會員看到的原因

| # | 規則 | 階段 | decision_code | 會員看到的 reason |
|---|---|---|---|---|
| 1a | 推的是冷門 | 三階段 | `underdog_pick` | 模型看好的一方是盤口冷門，冷門推薦歷史命中率偏低，暫不列入正式推薦。 |
| 1b | 沒有可用讓分盤 | 三階段 | `favorite_unknown` | 目前沒有可判斷熱門方的讓分盤口，暫不列入正式獨贏推薦。 |
| 2a | 和 T-10 正式方向相反 | T-2／T-15 | `conflict_with_t10` | 與 T-10 賽前分析方向相反，訊號不一致，暫不推薦。 |
| 2b | T-10 沒有正式方向（只在選「嚴格」時才擋） | T-2／T-15 | `t10_not_qualified` | T-10 賽前分析未列入正式獨贏推薦，本階段不單獨推薦。 |
| 3a | 大小分差距 ≥ 6 | 三階段 | `edge_too_large` | 模型與盤口總分差距過大（≥6 分），這類情況歷史上多半是模型誤判，暫不推薦。 |
| 3b | 缺少模型總分或盤口 | 三階段 | `gap_unknown` | 缺少模型總分或盤口總分，暫不推薦。 |
| 4 | 讓分信心 < 70 | T-2／T-15 | `low_confidence` | 本階段讓分模型機率低於 70%，暫不列入正式推薦。 |

- 判斷 T-10 方向時，一律用**套用新規則之後**的 T-10 正式推薦（R6）。正式執行時，runner 讀到的本來就是新規則的 T-10，回算也照同樣的方式做。
- 2b 的分支要寫清楚：T-10 有正式方向 → 檢查有沒有反向；T-10 暫不推薦 → 嚴格方案擋下，寬鬆方案照自己的條件判斷；T-10 快照不存在或讀不到 → 視同暫不推薦。
- 被擋下的推薦一律輸出 `pick:"暫不推薦"`、`line:null`、`confidence:0`、`official_pick_is_qualified:false`，`signal_level` 改成參考等級。

---

## 3. 預期影響：等查詢 03 的結果

第一版的影響表有錯，已經撤回：
- 熱門分組用了錯階段的盤口（R1），T-10 甚至用到當時還不知道的盤口。
- 「熱門＋同向 ≥ 62.5%」這個下限不成立（R2）。
- 母體混進了補抓的快照（R3）。

新的唯讀查詢 `deploy/analysis-20261122/03_nba_rules_v3_backtest_readonly.sql` 會逐筆套用完整規則，列出每個階段 × 玩法 × 規則（舊／新嚴格／新寬鬆／挑戰）的保留賽事數、勝、負、走水、命中率，以及被擋下的是原本贏還是原本輸。查詢已經在本機用模擬資料驗證過：primary 盤口不一致時會退回 consensus、補抓快照會排除、嚴格和寬鬆會分流、走水另外計算。

解讀時的注意事項：
- 數字是回算，而且規則是看同一批資料決定的，會偏樂觀。
- 同一場比賽的不同階段彼此相關，不能把階段紀錄加起來當成獨立場數。
- 走水不算進命中率，但要算進「會員看到的推薦數」。
- 這次是**減少推薦數量**，準確率有沒有提升，要等上線後驗證。
- 「熱門比較準」不等於比較賺，這次沒有驗證賠率報酬。

---

## 4. 要改的程式（請以函式名稱定位，行號是以 db101bb 為準）

### 4-0 實作狀態（2026-11-22）

- 使用者是在 Supabase 網站貼上程式碼部署，函式之間不能互相 import。所以正本放在 `supabase/functions/_shared/nba-rules-v3.js`，再由 `scripts/sync-nba-rules-v3.cjs` 原封不動複製到各函式的 `// === NBA_RULES_V3 BEGIN/END ===` 區段，測試會檢查每一份都和正本相同。**修改時只改正本，改完再執行同步**。
- 已完成：`basketball-analysis`（T-10）、`nba-v2-stage-runner`（T-2／T-15，`STAGE_REVISION` 已改成 `nba-stages-player-context-20261122-rules-v3`）、`analysis.html`／`mlb-analysis.html` 的原因標籤、`tests/nba-rules-v3.test.cjs`。
- 現有的 nba-batch（4 項失敗）、nba-frontend（1 項失敗）、nba-live-settlement（無法執行）在改版前就是這個狀態，和這次修改無關。
- GPT 實作複審（`GPT_REVIEW_R2_IMPL_20261122.md`）兩項必修已補正：
  ① T-10 被 V3 擋下的推薦，`createNarrative()` 不再用 AI 文案覆蓋固定原因（`nbaRulesV3MergeNarrative`）；
  ② 階段 `pick()` 現在只接受 0～1 的有效機率（`invalid_probability`），讓分／大小分必須有有效盤線（`market_unavailable`），0 讓分視為有效平手盤；45%／55% 和取整 70 的規則不變。這項防呆不論啟用日期都生效（屬於修 bug，不是規則變更）。
- 測試增加為 18 項，直接執行 `stageResult()`、`buildFixedRecommendations()`、`createNarrative()`。`sync --check` 會把兩個已完成的入口列為必要項目。
- 後台比較頁（第 5 節）已實作（2026-11-22）：`admin-nba-v2-compare` 改寫為舊／新／挑戰三套規則比較，API_VERSION 為 `nba-rules-v3-compare-20261122`，嵌入同一份規則正本，sync 已改列為必要入口；`admin.html` 和 `admin-nba-v2.js` 也同步改版。原本的 V1／unified V2 比較已經退役，相關測試改成新規則比較的測試。
- 啟用時間暫定 `2026-11-24T00:00:00+08:00`。如果部署日期改變，要改正本、執行同步，再重跑測試。

### 4-1 共用規則（原規劃為 `_shared/nba-rules.ts`，實作後改成上面 4-0 的做法）

這裡放純函式：不讀資料庫、不呼叫 API、不讀賽果。

```ts
export const NBA_RULES_V3 = { version: "nba-rules-v3-2026112x", from: "2026-11-2xT00:00:00+08:00", totalGapMax: 6, challengerGapMax: 3, stageSpreadConfMin: 70 };
export function rulesActive(fixtureTime: string): boolean;              // >= from；無法解析 → true
export function favoriteSide(homeSpread: number | null): "主隊" | "客隊" | null;
export function applyRulesV3(input: {
  stage: "t10" | "t2" | "t15"; market: "moneyline" | "handicap" | "over_under";
  rec: { pick: string; line: number | null; confidence: number; reason: string };   // 套規則前的正式推薦
  homeSpread: number | null; modelTotal: number | null; marketTotal: number | null;
  t10MoneylinePick?: string | null;                                       // 已套新規則的 T-10 正式獨贏
  t10Policy: "strict" | "lenient"; variant?: "official" | "challenger";
}): { rec: Rec; decision_code: string | null; blocked: boolean };
```

正式函式和後台回算都呼叫同一個 `applyRulesV3`，各自只負責資料格式轉換。

### 4-2 `basketball-analysis/index.ts`（T-10）

- `buildFixedRecommendations`：`marketHomeLine`（約第 515 行）在獨贏判斷（約第 565 行 `moneylineQualified`）之前就已經算好，**不需要搬動區塊**。
- 大小分的門檻在約 677～680 行（`>= 4.5` 且信心 ≥ 58），之後接著套 `applyRulesV3`。
- 輸出區（約 777～837 行）要同步更新：正式的 `pick`、`official_pick_is_qualified`、`signal_level`、`reason`、`decision_code`（獨贏約 788～790 行、大小分約 828～832 行），新增 `pre_rule`、`rule_version`。`display_*` 欄位不動，和正式推薦分開。

### 4-3 `nba-v2-stage-runner/index.ts`（T-2／T-15）

- `stageResult`（約第 460 行）：第 466 行的共用 `pick()` 算出的結果當作 `pre_rule`，再交給 `applyRulesV3` 處理，第 472 行輸出正式推薦。
- T-10 正式獨贏：從 `s.prediction_data` 讀取（備援路徑和查詢 01 相同）。
- `STAGE_REVISION`（第 371 行）要更新。

### 4-4 前台 `analysis.html`（R4，**需要修改**）

- 約 4317～4321 行的 `noPickReasonLabel` 目前是用文字正則分類，「與 T-10 方向相反」會被顯示成「與莊家方向相反」，「盤口冷門」和「差距過大」會被顯示成「未取得盤口」。
- 改成優先依 `decision_code` 對應標籤：
  - `underdog_pick` →「冷門方向」
  - `favorite_unknown` →「無法判斷熱門」
  - `conflict_with_t10` →「與 T-10 方向相反」
  - `t10_not_qualified` →「T-10 未推薦」
  - `edge_too_large` →「差距過大」
  - `gap_unknown` →「缺少總分資料」
  - `low_confidence` →「模型優勢不足」
- 舊快照沒有 `decision_code`，維持原本的文字判斷當備援。
- 單場、批次、免費重看都讀同一份正式快照，三種情況都要測。

### 4-5 後台比較頁

`admin-nba-v2-compare/index.ts`、`admin.html`（約第 1860 行）、`admin-nba-v2.js`（第 34 行 `loadNbaResearch`、第 193 行 `renderNbaResearch`）。見第 5 節。

---

## 5. 後台「NBA 規則比較」改版

- **三套規則**，用同一批賽事、同樣的有效資料條件比較：
  - 舊規則＝`pre_rule`
  - 新規則＝正式輸出
  - 挑戰規則＝只把 T-2／T-15 大小分改成 `gap < 3`，只在後台顯示
  - Q2 決定前，獨贏另外列出嚴格和寬鬆兩種結果
- **兩段**：
  - 回測（啟用前）：從快照裡已存的推薦、盤口、模型總分，用 `applyRulesV3` 算出新規則。缺少完整基準的歷史快照標示「不可比較」，不憑空補出推薦。
  - 上線後：直接讀 `pre_rule` 和正式輸出。
- **母體**：T-2／T-15 只收 `scheduled`，補抓的另外一區顯示。唯一賽事數和階段 × 玩法的紀錄數分開列。
- **欄位**：保留數、勝、負、走水、無推薦、缺資料、命中率、被擋下的贏／輸。另有逐場明細，可以只篩被擋下的場次。
- 賽果只在結算步驟使用。後台仍然需要管理員 session。兩週後是檢查點，不會自動轉正。

---

## 6. 測試（R7）

- 現有的 `dry_run` 只會列出候選賽事，沒有執行 `stageResult`，**不能拿來當規則測試**。
- 新增 `tests/nba-rules-v3.test.cjs`（或 Deno 測試），直接測 `_shared/nba-rules.ts`，涵蓋第 7 節驗收清單的邊界情況：
  - 主隊盤口為負、正、0、缺值、無效值
  - 主客盤口不一致
  - gap 剛好是 3、4.5、6，以及兩側的值
  - 信心 69 和 70
  - 機率 45% 和 55%
  - 日期在啟用時間之前、剛好等於、之後，以及無法解析的日期
  - null 值不會被放行
  - 原本暫不推薦的不會變成推薦
- 再加一組固定快照測試：同一筆輸入分別經過正式輸出轉換和後台回算轉換，`decision_code`、`pick`、`line` 都要一致。
- 測試不寫入資料庫，不覆寫既有的 ready 快照，也不覆寫會員已經領取的結果。

## 7. 實作順序

1. ✅ 修正這份規格，並新增查詢 03。
2. 使用者在 Supabase 執行查詢 03，回傳 CSV，同時決定 Q2（嚴格或寬鬆）。
3. Claude 實作共用規則、`pre_rule`／`rule_version`、前台原因標籤和離線測試，提交但不部署。
4. GPT 複審程式差異和測試結果。
5. Claude 一步一步帶使用者部署三個函式（包含同版本的 `_shared`），之後提交後台比較頁。
6. 上線後兩週檢查舊／新／挑戰三套規則的對照結果。挑戰規則的門檻在這段期間固定不改。

## 8. GPT 審查修正對照

| GPT | 修正 |
|---|---|
| Q1 熱門定義 | 第 1-2 節：同場、同階段、主客一致，不向後補 |
| Q2 T-10 沒推 | 列為待使用者決定，查詢 03 兩種方案都算 |
| Q3 方案 A | 第 0 節標示為待驗證規則 |
| Q4 共用檔 | 第 4-1 節 |
| 信心口徑 | 第 1-4 節 |
| R1 錯階段盤口 | 查詢 03 各階段用自己的盤口；第 3 節撤回舊數字 |
| R2 交集下限 | 撤回，改為逐筆回算 |
| R3 母體 | 查詢 03 只收 scheduled |
| R4 前台標籤 | 第 4-4 節 |
| R5 原始推薦 | 第 1-6 節 `pre_rule` |
| R6 T-10 基準 | 第 2 節，用新規則的 T-10 |
| R7 dry_run | 第 6 節 |
| 行號 | 第 4 節已更正（大小分 677～680、admin-nba-v2.js） |
| B 方案比例 | 14/105＝13.3%（第一版寫約 1/4 是錯的） |
