# HB 賽事預測 AI｜NBA V3 修正複審通過交接
日期：2026-11-22（台灣）
交接對象：Claude／後續維護工程師
審查者：ChatGPT
Repo：awu7757-sys/habao-football-ai
審查 commit：03d67b4b004b272b259160b4142c5b3051b72941

## 1. 結論

**本輪程式複審通過。上一輪兩項必修均已解決；在本次審查範圍內，未發現新的必修問題。**

ChatGPT 已自行重跑：
- node tests/nba-rules-v3.test.cjs：18 項通過、0 項失敗。
- node scripts/sync-nba-rules-v3.cjs --check：T-10 與階段 runner 均與正本一致；後台比較入口明確列為待辦。

可依既定流程進入部署與正式環境驗證。這是指定 commit 的程式審查結論，並非已完成部署、正式環境驗證或證明預測成效提升。

本次沒有修改 repo、沒有讀寫 Supabase、沒有部署，沒有呼叫真實 OpenAI 或盤口 API。

## 2. 上一輪必修問題的結案

| 問題 | 本次實作與核對 | 結論 |
| --- | --- | --- |
| T-10 固定拒絕原因被 AI 文案覆蓋 | 正本新增 nbaRulesV3Blocked、nbaRulesV3MergeNarrative。createNarrative 的三種玩法均經由此合併；被 V3 擋下時保留原固定原因與欄位。測試直接執行 createNarrative，涵蓋相反 AI 文案、API 失敗及無金鑰 fallback。 | 已解決 |
| 階段異常機率仍產生推薦 | pick 先處理 null／undefined，再檢查正規化數值及0～1範圍。NaN、Infinity、範圍外、空字串、非數字字串、boolean 被擋；數字字串明確正規化。 | 已解決 |
| 缺盤線仍產生讓分／大小分推薦 | 讓分與大小分入口傳入 needLine=true，缺少有效數字盤線即暫不推薦；獨贏不要求 line。 | 已解決 |
| 0 讓分可能被誤當缺值 | 使用明確 null 判斷，0可作有效讓分盤；獨贏熱門判定仍將0視為無法判斷熱門。 | 已解決 |

重要語意：
- 機率／必要盤線防守在新產生的結果中不受 V3 啟用日期限制，屬修正異常輸入；規格第4-0節已明確說明。
- 不會因此重算或覆寫已封存的舊快照。
- 正常規則的日期切換仍依開賽時間判定。

## 3. 定案規則確認

| 項目 | 狀態 |
| --- | --- |
| 三階段獨贏僅保留本階段讓分盤熱門 | 維持 |
| T-10有正式方向時，後續獨贏不能反向 | 維持 |
| T-10沒推時，後續採寬鬆、自行依條件判斷 | 維持 |
| 正式大小分新增 gap <6 的篩選 | 維持 |
| 背景挑戰規則只對 T-2／T-15 大小分採 gap <3 | 維持，未套進會員正式入口 |
| T-2／T-15讓分採取整後機率 >=70 | 維持 |
| 45%、55%本身可以推薦 | 維持 |
| T-10原有55%／70／58／4.5門檻 | 維持 |
| pre_rule、rule_version及display欄位分離 | 維持 |
| 原本無推薦不因新增過濾而產生新方向 | 維持 |

啟用時間目前為 **2026-11-24 00:00，Asia/Taipei（UTC+8）**。若部署安排改變，應修改正本時間、同步入口並重跑測試，而不是只修改其中一份嵌入版本。

## 4. 已執行測試

### 4.1 NBA V3 專用測試
指令：node tests/nba-rules-v3.test.cjs
結果：18 passed，0 failed；程序正常結束。

包含：
- 兩個入口與正本同步一致。
- 啟用前、等於、之後及非法日期。
- 熱門方向負／正／零／缺值／無效值。
- 原本暫不推薦者不會轉成推薦。
- 寬鬆／嚴格分支及T-10反向處理。
- 讓分信心69／70、缺值。
- 大小分gap及背景挑戰規則邊界。
- pre_rule與正式欄位保存。
- 前台decision_code優先及舊原因文字備援。
- 實際執行stageResult的異常機率、缺盤線與0盤案例。
- 實際執行buildFixedRecommendations的gap與盤口備援案例。
- 實際執行createNarrative的AI相反文案、API失敗、無金鑰案例。

已驗證的重要邊界：
- T-10：gap 4.49不推、4.5／5.99可推、6擋下。
- primary主客盤不一致時退回consensus。
- 階段大小分：0.45、0.55本身可推；0.45001屬中間區間而不推。
- 階段讓分：0.6949擋下、0.695保留；客隊對稱0.305保留、0.3051擋下。
- 缺讓分盤時，即使機率70%也不推。
- 0讓分可保留讓分推薦，同時獨贏以favorite_unknown擋下。

測試使用離線固定輸入與mock，不是正式比賽資料或實際外部API回應。

### 4.2 同步檢查
指令：node scripts/sync-nba-rules-v3.cjs --check

輸出：
- 一致：supabase/functions/basketball-analysis/index.ts
- 一致：supabase/functions/nba-v2-stage-runner/index.ts
- 待辦（尚未嵌入）：supabase/functions/admin-nba-v2-compare/index.ts

REQUIRED已包含兩個完成入口；缺檔或缺少BEGIN區段會令檢查失敗。後台入口仍在PENDING，符合目前實作狀態。

### 4.3 其他既有測試
使用者／Claude提供的結果：
- nba-functional：31通過／0失敗。
- nba-batch：2通過／4失敗。
- nba-frontend：12通過／1失敗。
- 據回報，數字與修改前相同。

**本輪ChatGPT未自行重跑以上三套，也未另比對其修改前基準。**因此這些結果列為交接資訊，不能解讀成全部既有測試已通過。既有失敗仍應另列待辦，不是本次兩項修正尚未解決的證據。

## 5. 前台與文件核對

- analysis.html與mlb-analysis.html均新增invalid_probability →「模型資料異常」。
- 既有V3原因標籤維持decision_code優先。
- null／undefined機率目前回傳market_unavailable，前台顯示「未取得盤口」；其他無效機率使用invalid_probability。兩者均不產生推薦。
- 規格pre_rule欄位已統一為official_pick_is_qualified。
- 測試名稱已改為「已完成的兩個入口」，不再誤稱三個入口都完成。
- 後台比較頁仍清楚標示未完成。

## 6. 可之後再做（不阻擋本輪通過）

1. 缺少獨贏機率時，market_unavailable／「未取得盤口」的說明略不精確；可之後細分為模型機率缺失與盤口缺失，維持不推薦即可。
2. 本次只鎖定各玩法的V3拒絕reason；AI的自由summary仍沿用原設計。如未來要讓所有自由文字也有一致性保護，可另開工作項目，不擴大本次修正範圍。
3. 後台比較完成後，將其入口由PENDING移入REQUIRED，加入正式輸出與後台回算的固定資料一致性測試。
4. 既有nba-batch／nba-frontend失敗應另行追蹤，避免長期讓回歸測試失去辨識能力。

## 7. 尚未完成與部署交接

### 尚未完成
- admin-nba-v2-compare後台比較API。
- admin.html／admin-nba-v2.js比較頁。
- 正式環境排程、封存與會員端端到端驗證。
- 新規則上線後的成效觀察。

### 接手步驟
1. 使用本次通過commit的basketball-analysis及nba-v2-stage-runner部署內容，遵循使用者既定部署流程。
2. 部署前確認啟用時間；有變更就改正本、同步、重跑18項測試與--check。
3. 部署後確認兩個函式版本與預期一致；不覆寫既有ready快照或會員已領結果。
4. 取得新產生且符合啟用條件的快照後，核對正式推薦、decision_code、pre_rule、rule_version。
5. 核對單場、批次與免費重看讀同一結果；前台拒絕標籤一致。
6. 後台比較頁另做、另測；使用各階段封存盤口、統一比較母體，缺資料不補未來資料。
7. 現有dry_run僅列候選，不能替代真正規則測試或正式快照驗證。

## 8. 給 Claude 的簡短結論

GPT已複審03d67b4b004b272b259160b4142c5b3051b72941，本輪通過。
上一輪「AI覆蓋V3拒絕原因」及「異常機率／缺盤線仍出推薦」均已修正。
GPT重跑NBA V3測試18/0，兩個入口同步檢查一致。
未發現新的必修問題，不需再重做已定案規則。
接下來依既定流程部署與驗證；後台比較頁仍是獨立待辦。
本次通過不代表已部署，也不代表尚未完成的後台或正式環境驗證已通過。

## 9. 固定版本來源
- [本次commit](https://github.com/awu7757-sys/habao-football-ai/commit/03d67b4b004b272b259160b4142c5b3051b72941)
- [規則正本](https://github.com/awu7757-sys/habao-football-ai/blob/03d67b4b004b272b259160b4142c5b3051b72941/supabase/functions/_shared/nba-rules-v3.js)
- [T-10入口](https://github.com/awu7757-sys/habao-football-ai/blob/03d67b4b004b272b259160b4142c5b3051b72941/supabase/functions/basketball-analysis/index.ts)
- [階段runner](https://github.com/awu7757-sys/habao-football-ai/blob/03d67b4b004b272b259160b4142c5b3051b72941/supabase/functions/nba-v2-stage-runner/index.ts)
- [測試](https://github.com/awu7757-sys/habao-football-ai/blob/03d67b4b004b272b259160b4142c5b3051b72941/tests/nba-rules-v3.test.cjs)
- [同步腳本](https://github.com/awu7757-sys/habao-football-ai/blob/03d67b4b004b272b259160b4142c5b3051b72941/scripts/sync-nba-rules-v3.cjs)
- [規格](https://github.com/awu7757-sys/habao-football-ai/blob/03d67b4b004b272b259160b4142c5b3051b72941/deploy/nba-rules-20261122/NBA_RULES_CHANGE_SPEC.md)

