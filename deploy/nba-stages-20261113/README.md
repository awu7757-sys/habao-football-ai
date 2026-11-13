# NBA 三階段會員模式（2026/11/13）

會員前台採 T-10／T-2／T-15 三階段，不顯示測試或研究版標籤、不限制特定帳號。

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

- [05_verify_stage_results.sql](05_verify_stage_results.sql)：唯讀核對模型輸出、原始盤口、保存推薦與會員領取結果；`claim_snapshot_mismatches` 應為 0。
- `04_retry_odds_format_fix.sql` 只處理當時指定兩場的舊錯誤，不需在正常運作時重跑。
- 程式驗證紀錄見 `validation-production.log`；涵蓋一般會員、身分核對、停權、單次扣點、重看、混合階段批次與歷史分組。實機畫面持續由實際登入的會員流程確認。
