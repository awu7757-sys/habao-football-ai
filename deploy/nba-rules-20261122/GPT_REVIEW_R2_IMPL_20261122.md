# HB 賽事預測 AI｜NBA V3 實作複審交接
日期：2026-11-22（台灣）
交接對象：Claude／後續維護工程師
審查者：ChatGPT
審查版本：7c363f10f1391c14a2fa6136d9419c1ab03c3b60

## 1. 結論與下一步

主要規則符合定案，repo 既有 12 項 NBA V3 測試全部通過。另以實際函式進行離線補測，確認正常邊界行為。

仍有兩項需要補正：
1. T-10 被 V3 擋下的固定原因，可能被後續 AI 文案覆蓋。
2. 階段推薦對異常機率及缺少盤線的防守不足。

請 Claude 完成修正、加入回歸測試並提交新 commit，再交 GPT 複審；暫不部署。本文件是審查交接，不代表部署授權。

本次沒有修改 repo、沒有讀寫 Supabase、沒有呼叫真實 OpenAI 或盤口 API。異常重現使用離線模擬輸入，不代表正式資料已發生同樣問題。

## 2. 審查依據與範圍

Repo：awu7757-sys/habao-football-ai，GitHub main 為唯一正本。本文件記錄指定 commit 的結果，後續版本需重新核對。

已審查：
- deploy/nba-rules-20261122/NBA_RULES_CHANGE_SPEC.md，第0節定案、第4-0節實作狀態及相關規格。
- supabase/functions/_shared/nba-rules-v3.js
- supabase/functions/basketball-analysis/index.ts
- supabase/functions/nba-v2-stage-runner/index.ts
- analysis.html、mlb-analysis.html
- scripts/sync-nba-rules-v3.cjs
- tests/nba-rules-v3.test.cjs

後台比較頁尚未完成，不能標記為已完成或已驗證。

## 3. 已確認符合規格的項目

| 項目 | 核對結果 |
| --- | --- |
| 三階段獨贏只推讓分盤熱門 | 符合；使用各入口提供的本階段主隊盤線 |
| T-2／T-15 獨贏與 T-10 關係 | 符合寬鬆定案：有正式方向時擋反向；T-10 未推薦時可按自身條件判斷 |
| 正式大小分 | gap >=6 擋下，原有門檻保留 |
| 背景挑戰規則 | 只對 T-2／T-15 大小分採 gap <3，未套入會員正式入口 |
| 階段讓分 | 使用既有取整後模型機率 >=70 |
| 啟用日期 | 開賽時間早於啟用點維持原規則；等於或晚於啟用點套用；非法日期依定案保守套用 |
| 原始推薦保存 | pre_rule 保留原 pick、line、confidence、reason、資格及 decision_code；另存 rule_version |
| display_* | 沒有被新規則改成另一套正式推薦 |
| 共用規則同步 | T-10 與階段 runner 的嵌入內容與正本一致 |
| 前台原因標籤 | 優先讀 decision_code，舊資料仍有文字備援 |

此次實作採「單一正本＋同步嵌入」，符合第4-0節為網站貼上部署所定的工作方式。修改規則時只改正本，再同步兩個已完成入口；後台完成後再納入相同檢查。

## 4. 必修一：固定拒絕原因不能被 AI 文案覆蓋

### 位置
supabase/functions/basketball-analysis/index.ts
createNarrative()，本次版本約1819～1857行。

### 問題
buildFixedRecommendations() 已套用 V3，產生固定 reason 與 decision_code；但 createNarrative() 隨後仍以 OpenAI 回傳的各玩法 reason 覆蓋。

### 離線重現
輸入：模型總分226、市場總分220，gap=6，符合新規則擋下條件。
模擬 OpenAI 回傳大小分 reason：「模型看好大分，值得推薦」。

最後輸出可同時出現：
- pick：暫不推薦
- confidence：0
- decision_code：edge_too_large
- reason：模型看好大分，值得推薦

推薦方向與資格沒有被改回，但保存的完整原因與規則相矛盾。前台短標籤因讀 decision_code 已正確，不能因此忽略完整 reason 的矛盾。

### 建議修正
- 被 V3 規則擋下的推薦，固定保留規則 reason。
- 若需要 AI 補充解說，另存獨立欄位，不覆蓋規則拒絕原因。
- 未被擋下的推薦可依原有設計處理文案；不需為本次修正重做模型。

### 驗收
- [ ] 模擬 AI 回傳相反或推薦性文案，V3 拒絕 reason 仍不變。
- [ ] pick、line、confidence、decision_code、official_pick_is_qualified 不被 AI 改動。
- [ ] pre_rule 與 rule_version 保留。
- [ ] AI 呼叫失敗或無金鑰時，fallback 結果仍正確。
- [ ] 測試真正執行 createNarrative() 合併路徑，不能只檢查提示詞或原始碼字串。

## 5. 必修二：無效機率與缺盤線不得產生正式推薦

### 位置
supabase/functions/nba-v2-stage-runner/index.ts
stageResult() 內的 pick()，本次版本約557行起。

### 問題
目前只檢查 p === null，沒有完整檢查 undefined、NaN、Infinity、型別及0～1範圍。讓分／大小分也應在產生正式推薦前確認其必要盤線有效。

### 離線重現

| 異常輸入 | 現有輸出 |
| --- | --- |
| over_probability=undefined；模型總分與市場總分仍有值 | 推「小」，confidence 為 NaN，JSON 序列化後是 null |
| home_cover_probability=0.70；home_spread=null | 推「主隊」，line=null，confidence=70 |

這是原有 pick() 的防守缺口，不是 V3 新增的回歸。正常上游模型通常會提供一致資料；本次測試是確認輸出端遇到異常輸入時仍可能放行，不是在宣稱正式場次已出錯。

### 建議修正
- 機率必須為有效數字且介於0～1，否則暫不推薦。
- 輸入若需要支援數字字串，請明確正規化；不能讓空字串、boolean 或 null 被當成有效數字。
- 讓分與大小分必須有有效盤線；獨贏本來不需要 line，不能一併誤擋。
- 讓分0是有效平手盤；但用來判斷獨贏熱門時，0仍代表無法判斷熱門。
- 保留既定的45%、55%本身可推，以及取整後 >=70 的規則。
- 異常原因與 decision_code 應明確且能由前台正確顯示。

### 驗收
- [ ] null、undefined、NaN、Infinity及小於0／大於1的機率不產生推薦。
- [ ] 缺讓分盤，即使機率70%，仍暫不推薦。
- [ ] 缺大小分盤，即使機率通過門檻，仍暫不推薦。
- [ ] 合法0讓分盤不被當成缺值。
- [ ] 45%、55%邊界維持原行為。
- [ ] 不序列化出帶正式方向但 confidence=null 或必要 line=null 的結果。
- [ ] 測試直接執行 stageResult()，覆蓋原始推薦產生及 V3 包裝的完整路徑。

## 6. 已執行測試與證據限制

### repo 既有測試
執行：node tests/nba-rules-v3.test.cjs
結果：12項通過、0項失敗。

涵蓋共用規則、日期、熱門方向、寬鬆／嚴格分支、讓分門檻、大小分差距、pre_rule、階段接線與前台標籤等。

### 本次額外離線補測
抽出 repo 真正的 buildFixedRecommendations()、stageResult() 與 createNarrative() 執行，沒有另寫替代規則。TypeScript 使用 Node 內建去型別功能；外部文案回應以 mock 取代。

正常案例通過：
- T-10 gap 4.49不推、4.5可推、5.99可推、6擋下。
- primary主客盤不一致時退回consensus。
- 啟用日前保持原推薦。
- 階段大小分機率0.45推小、0.45001不推、0.54999不推、0.55推大。
- 階段讓分機率0.6949取整69而擋下；0.695取整70而保留。
- 客隊對稱邊界0.305保留、0.3051擋下。

另外重現第4、5節問題。

### 不包含
- Supabase正式部署、排程與資料庫寫入測試。
- 真實 OpenAI API 回應品質與真實盤口服務測試。
- 瀏覽器單場／批次／免費重看完整端到端操作。
- 所有既有 NBA 測試套件的全面回歸。
- 規格提及其他舊測試失敗是否確為改版前既有問題；本次沒有另行驗證該說法。
- 尚未實作的後台比較頁。

## 7. 文件與測試小修

1. 將「三份嵌入程式一致」測試名稱改成符合目前兩個已完成入口的描述。
2. 規格 pre_rule.qualified 與實作 pre_rule.official_pick_is_qualified 統一；建議文件跟實作一致，後台也讀同名欄位。
3. 將本次真正執行 T-10／stageResult 的邊界案例納入正式測試。現有 T-10 接線測試主要是原始碼字串比對。
4. sync --check 目前會略過缺檔或沒有標記的目標。後台完成後，將必要入口都列為不可略過；未完成入口應明確列為待辦。
5. 啟用時間程式暫定2026-11-24 00:00台灣時間，部署前須依使用者決定確認。若調整，改正本、同步嵌入並重跑日期測試。
6. 後台 admin-nba-v2-compare、admin.html、admin-nba-v2.js 比較頁仍另外處理，不得因本次規則通過就標記為完成。

## 8. 給 Claude 的執行摘要

請依本文件補正兩項，不重做已定案規則：
1. V3擋下的T-10推薦，固定reason不得被AI文案覆蓋。
2. stageResult/pick補上有效機率與必要盤線驗證，維持既有門檻及邊界。

再補實際入口回歸測試、統一pre_rule欄位文件與測試名稱。
修改後請提交但暫不部署，回傳：
- 新commit SHA。
- 修改檔案與修正摘要。
- 測試指令、通過／失敗數。
- 第4節與第5節各案例的測試結果。
- 規則正本與兩個嵌入入口一致的證據。
- 尚未完成項目與預定啟用時間。

## 9. 固定版本來源
- [本次commit](https://github.com/awu7757-sys/habao-football-ai/commit/7c363f10f1391c14a2fa6136d9419c1ab03c3b60)
- [規則正本](https://github.com/awu7757-sys/habao-football-ai/blob/7c363f10f1391c14a2fa6136d9419c1ab03c3b60/supabase/functions/_shared/nba-rules-v3.js)
- [定案規格](https://github.com/awu7757-sys/habao-football-ai/blob/7c363f10f1391c14a2fa6136d9419c1ab03c3b60/deploy/nba-rules-20261122/NBA_RULES_CHANGE_SPEC.md)
- [T-10文案合併位置](https://github.com/awu7757-sys/habao-football-ai/blob/7c363f10f1391c14a2fa6136d9419c1ab03c3b60/supabase/functions/basketball-analysis/index.ts#L1819)
- [階段輸出位置](https://github.com/awu7757-sys/habao-football-ai/blob/7c363f10f1391c14a2fa6136d9419c1ab03c3b60/supabase/functions/nba-v2-stage-runner/index.ts#L557)
- [測試](https://github.com/awu7757-sys/habao-football-ai/blob/7c363f10f1391c14a2fa6136d9419c1ab03c3b60/tests/nba-rules-v3.test.cjs)

