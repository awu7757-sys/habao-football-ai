# NBA 三階段會員模式（2026/11/13）

會員前台採 T-10／T-2／T-15 三階段，不顯示測試或研究版標籤、不限制特定帳號。

## 不等賽事的模板重播

入口：根目錄 `qa/nba-stages.html`。這是獨立頁面，不在正式會員入口加入測試開關。可切換 T-10 前／T-10／等待 T-2／T-2／等待 T-15／T-15／全領取／開賽後／額度不足；單場、批次、結果分頁、同場三階段歷史與手機寬度沿用正式模板和階段腳本。

- 時鐘、來源、扣點與 Storage 全在 sandbox 內模擬；禁止同源存取、外部網路、表單和正式導航。不讀登入資訊，不呼叫 Supabase，不影響會員點數或快照。
- 預設數字是明示的合成球隊基準與歷史球員名單重播，不能冒稱正式分析結果。先用它檢查全部 UI 分支。
- 要核對今天保存的真實數字，執行 [11_export_saved_replay.sql](11_export_saved_replay.sql)，Export JSON 後在重播頁匯入。資料只留瀏覽器記憶體。頁面核對 T-2／T-15 的分差、總分、常態分布機率、推薦盤線、信心及會員領取與快照一致性。
- T-10 僅顯示保存結果，不假裝用新 V2 模型重算正式 V1；完整模型回算仍須原始輸入。重播不驗證當時 API 可用性、實際資料庫扣點、隊徽來源持續可用性或預測準確率。
- 產生方式：`node lab/generate-demo.cjs`、`python3 lab/build.py`；模板 SHA-256 顯示在頁面。來源為 `football.html`／`analysis.html`／`nba-stages.js`，只替換隔離導航與資料介面。

## 傷停／確認先發更新

已完成舊版三階段部署的專案，此次只需將 **[nba-v2-stage-runner.index.txt](nba-v2-stage-runner.index.txt)** 全文覆蓋同名 Supabase Edge Function 的 `index.ts`，再按 Deploy updates。版本為 `nba-stages-player-context-20261113-1`；沿用現有 Secrets、JWT OFF、排程、會員開放設定及扣點函式，不需重新執行 01／02／07。

GitHub 前台 `analysis.html` 會同步更新名單與來源顯示。函式部署後，可執行 **[09_probe_player_context.sql](09_probe_player_context.sql)**，再執行 **[10_check_player_context.sql](10_check_player_context.sql)** 匯出完整 JSON。09 只排入來源核對請求，不領取、不扣會員點數、不新增／覆寫階段快照。沒有下一場 T-10 快照時回傳 WAIT；等新快照出現再核對。10 是唯讀查詢；QUEUED 只代表請求排入佇列，不能當成來源成功。

- 傷停取自 ESPN 單場 NBA 資料，先核對雙方球隊、主客、日期時間與賽季；保存球員、狀態、原回報時間、實際取得時間及來源。空名單不等於確認全員健康。
- 確認先發取自 NBA 官方當日名單。每隊需有五名不同球員、五個有效位置、Active，且每人都明確標為 Confirmed。Expected 保留為「預估、尚未確認」，不套用先發修正。新鮮度與美東夏令／標準時間均檢查。
- 確認缺陣採 Out／停賽，或 NBA 確認的 Inactive；Questionable／Probable 不猜出賽機率。NBA 已確認 Active 與 ESPN 缺陣衝突時，保留差異並排除該筆缺陣修正。
- 球員影響以兩隊近五場已完賽球員上場時間及正負值，估計目前缺陣／確認先發造成的輪替差異。需至少三場有效資料，檢查球隊、時間、賽季、上場分鐘與正負值；不足時沿用原球隊模型並標明未套用。
- 估算採球員上場分鐘對 450 分鐘先驗縮減、相對隊內基準的 on-court 正負值及 240 分鐘輪替重分配；每隊分差修正上限 1.5 分，兩隊合計上限 3 分。新確認先發最多增加 6×(1−近期先發率) 分鐘，轉替補則減少 6×近期先發率分鐘，再重新正規化。長期缺陣且近期沒有出場的球員不再重扣影響。
- 這是保守的輪替估算，未經賽後準確度校準，不代表因果 on/off 或 RAPM。**目前只調整分差／獨贏與讓分機率；球員對總分的修正尚未估計，大小分保留原球隊模型結果。**所有計算與基準會保存供賽後核對。
- 每階段新增最多 13 次公開來源請求（當日賽程、單場資料、官方先發、兩隊各最多五場已完賽球員 box score）；每次逾時 8 秒、資料上限 2 MB。暖執行個體最多保留 48 筆快取，當前資料 TTL 45 秒、歷史資料 TTL 24 小時。不新增付費 API 或會員扣點；原有 API-NBA／盤口配額上限不變。公開來源可用性須在正式 Supabase 執行環境以 09／10 實際核對，無法取得時明示缺資料。
- 只影響部署後尚未封存的 T-2／T-15。舊 ready 快照、既有會員領取結果、T-10 與公開戰績來源保留，不以賽後資料補造賽前結果。
- `source_meta.player_context_features` 保存當時的正規化來源資料，`model_output.player_context_adjustment` 保存估算及每位受影響球員的計算；會員結果保留來源、名單與實際套用狀態。來源顯示已開賽時拒絕封存。

驗證檔案：`player-context-tests.cjs` 與 `fixtures/player-context-pregame-20261113.json`。樣本由當時 08:51–08:55 取得的賽前來源及已完賽資料縮減而成；重播驗證不代表在 Supabase 已部署或已產生新版正式快照。需要退回時，以 commit `d27d6ad14cddf4ec979ddaca09bd6baa9ca2724d` 的 runner 覆蓋同名函式，保留所有快照及會員領取。

## 已完成前面部署的專案：只做這一步

在 Supabase SQL Editor 執行 **[07_enable_all_members.sql](07_enable_all_members.sql)**。

此 SQL 開啟 `all_members_enabled=true` 並清空舊的單一帳號例外。GitHub 更新不會自動改變 Supabase 設定；執行 SQL 後，全會員開放才真正生效。這次不需重新部署兩個 Edge Functions。

前台更新後重新整理。會員沿用現有 Google／LINE 登入、帳號有效狀態與積分規則。

## 新專案完整部署順序

1. 執行 [01_nba_stages.sql](01_nba_stages.sql) 建立隔離的階段資料與原子扣點函式。
2. 新增 Edge Function `nba-v2-stage-runner`，使用 [完整 runner 程式](nba-v2-stage-runner.index.txt)。
3. 新增 Edge Function `nba-v2-stage-member`，使用 [完整會員程式](nba-v2-stage-member.index.txt)。
4. 兩個新函式的 legacy JWT verification 關閉；runner 自行核對排程金鑰，member 經 oauth-member-login 核對會員 access token 與帳號。
5. 執行 [02_schedule_and_check.sql](02_schedule_and_check.sql) 建立每分鐘掃描；再執行 [07_enable_all_members.sql](07_enable_all_members.sql)。
6. 執行 [03_readonly_audit.sql](03_readonly_audit.sql) 核對實際狀態。SQL 排程成功不等於上游 API 或快照成功。

## Secrets 沿用

- `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（或 `SUPABASE_SECRET_KEY`）。
- `API_NBA_KEY`（或既有 `API_FOOTBALL_KEY`）。
- `BASKETBALL_T10_CRON_KEY`，與 Vault `nba_v2_cron_key` 一致。
- 盤口：`THE_ODDS_API_KEY` 或 `ODDS_API_KEY`。缺少有效盤線時明示缺資料，不改用舊盤冒充本階段。

## 會員流程

以 08:00 開賽、台灣時間為例：

| 時點／狀態 | 按鈕／操作 |
|---|---|
| 前一天 22:00 前 | 賽前 10 小時開放，不可點 |
| 22:00 後，尚未領 T-10 | 金色「開始分析」；成功領取扣 1 點 |
| 已領 T-10，尚未 06:00 | 淡藍色「深度分析・06:00 開放」 |
| 06:00–07:45，尚未領 T-2 | 藍色「深度分析」；成功領取扣 1 點 |
| 已領 T-2，尚未 07:45 | 淡紫色「最終分析・07:45 開放」 |
| 07:45–08:00，尚未領 T-15 | 紫色「最終分析」；成功領取扣 1 點 |
| 已領 T-15 | 已領取最終分析；不再新增領取 |
| 08:00 起 | 分析已截止；既有結果從我的分析重看 |

- 同會員／同場／同階段只扣一次；快速連點、跨分頁與重看仍由資料庫唯一鍵與原子交易保護。寫入失敗會回滾扣點。
- 每位會員讀取同一場、同階段已封存的結果。會員點擊不會任意改動既有結果。
- 批次依勾選時的階段分別領取；T-10／T-2／T-15 可混合選取。時間跨階段時必須重新選取，不會默默變更扣點階段。
- 我的分析同場只顯示一張卡，卡內金／藍／紫三個入口重看已領取階段；未領取為灰色。資料仍分階段獨立保留。
- 沿用開賽後 8 小時的歷史顯示期限；資料庫不刪除紀錄。
- 缺少先前封存的 T-2 時，不在 T-15 補造過去快照；已封存而未領的 T-2 可在賽前補領。

## 計算與資料紀錄

- T-10 沿用既有正式 V1；T-2／T-15 使用統合 V2，在各階段重新擷取賽前狀態、市場與已完賽歷史，使用效率模型與貝氏縮減備援計算。
- 欠缺可驗證傷停或先發來源時，會員頁會明示資料未取得，且不套用球員修正。
- 實際完成時間超出目標 90 秒時標為賽前補抓，不冒充準時資料。
- 既有快照中的研究來源與校準旗標保留作稽核；會員開放由會員設定控制。前台不顯示研究版／測試標籤。公開戰績資料仍由既有正式來源處理。
- 每階段最多 9 次 NBA 請求與 1 次盤口請求；盤口預留 2 credits。新增階段日上限預設 NBA 300 次、盤口 60 credits，可用既有環境變數調整；與其他排程總用量分開計算。
- 每分鐘最多擷取 1 場，T-15 優先；來源錯誤隔 2 分鐘、逾時隔 5 分鐘可重試，單階段最多 4 次且限當前賽前窗口。

## 核對資料

- [08_readonly_credit_audit.sql](08_readonly_credit_audit.sql)：針對 2026-11-13 批次兩場疑似扣三點，列出指定會員餘額、當日 T-10／T-2／T-15 領取時間、正式扣點與階段領取函式定義、相關觸發器及既有流水表結構。唯讀，不呼叫扣點函式、不補扣或退款；領取筆數與目前餘額不能單獨還原當時扣點差額。
- [05_verify_stage_results.sql](05_verify_stage_results.sql)：唯讀核對模型輸出、原始盤口、保存推薦與會員領取結果；`claim_snapshot_mismatches` 應為 0。
- `04_retry_odds_format_fix.sql` 只處理當時指定兩場的舊錯誤，不需在正常運作時重跑。
- 程式驗證紀錄見 `validation-production.log`；涵蓋一般會員、身分核對、停權、單次扣點、重看、混合階段批次與歷史分組。實機畫面持續由實際登入的會員流程確認。
