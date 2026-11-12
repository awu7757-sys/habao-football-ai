# NBA T-2／T-15 測試部署（2026/11/13）

本次前台已加入測試帳號三階段流程；Supabase 必須另行部署以下檔案，GitHub 更新不會自動部署 Supabase。

## 部署順序

1. Supabase SQL Editor 執行 **[01_nba_stages.sql](01_nba_stages.sql)**。
2. Edge Functions 新增 **`nba-v2-stage-runner`**，以 **[nba-v2-stage-runner.index.txt](nba-v2-stage-runner.index.txt)** 全文覆蓋 `index.ts`，按 Deploy updates。
3. Edge Functions 新增 **`nba-v2-stage-member`**，以 **[nba-v2-stage-member.index.txt](nba-v2-stage-member.index.txt)** 全文覆蓋 `index.ts`，按 Deploy updates。
4. **兩個新函式的 Verify JWT／legacy JWT verification 均關閉**。runner 自行核對既有排程金鑰或內部 service role；member 自行透過 oauth-member-login 驗證會員 access token。不要更改其他函式設定。
5. SQL Editor 執行 **[02_schedule_and_check.sql](02_schedule_and_check.sql)**，建立每分鐘掃描並立即觸發一次。
6. 執行 **[03_readonly_audit.sql](03_readonly_audit.sql)**，核對實際快照狀態與原因；SQL 排程成功不等於 API 已成功。
7. 前台重新整理並使用 `google_2d3cef6b6e2d` 測試。

## 既有 Secrets 沿用

- `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（或 `SUPABASE_SECRET_KEY`）。
- `API_NBA_KEY`（或既有 `API_FOOTBALL_KEY`）。
- `BASKETBALL_T10_CRON_KEY`；必須與既有 Vault `nba_v2_cron_key` 一致。
- 盤口用 `THE_ODDS_API_KEY` 或 `ODDS_API_KEY`。未設定時會明示缺盤，讓分／大小分不捏造盤線、不拿 T-10 舊盤冒充本階段。
- 無須把金鑰貼入程式或 SQL。

## 08:00 場次如何驗收（台灣時間）

| 時點／已領取狀態 | 按鈕 | 操作 |
|---|---|---|
| 前一天 22:00 前 | 賽前 10 小時開放 | 不可點 |
| 22:00 後，未領 T-10 | 金色「開始分析」 | 原有 T-10；首次成功扣 1 點 |
| 已領 T-10、尚未 06:00 | 淡藍色「深度分析・06:00 開放」 | 等待，不可點 |
| 06:00–07:45，未領 T-2 | 藍色「深度分析」 | 獨立 T-2 固定快照；成功扣 1 點 |
| 已領 T-2、尚未 07:45 | 淡紫色「最終分析・07:45 開放」 | 等待，不可點 |
| 07:45–08:00，未領 T-15 | 紫色「最終分析」 | 獨立 T-15 固定快照；成功扣 1 點 |
| 已領 T-15 | 紫色「已領取最終分析」 | 不再新領；我的分析免費重看 |
| 08:00 起 | 分析已截止 | 禁止首次領取；既有結果仍可重看 |

- 到 T-2／T-15 不必先領前一階段。未領 T-10 可補領原固定結果；T-15 只可補領**先前已封存的 T-2**，不補造過去快照。
- 同會員／同場／同階段唯一；跨分頁、連點只成功扣一次。點數扣除與領取寫入在同一個 PostgreSQL 交易；寫入失敗回滾扣點。
- **我的分析**分別保留 T-10、T-2、T-15 紀錄。沿用原頁面「開賽後 8 小時」顯示期限；資料庫不刪紀錄。
- 批次分析依每張卡片勾選時的階段領取：T-10／T-2／T-15 可混合選取，每場結果保留自己的階段。已領取的目前階段會顯示「重看」，讀取相同封存結果不再扣點。跨階段時必須重新勾選，不會悄悄改成另一階段扣點。

## 擷取與模型

- T-10 正式快照與 NBA 公開戰績維持既有來源；新資料只寫獨立階段表與球員統計快取。
- T-2、T-15 重新取得賽前實際比賽狀態、市場盤線與已完賽歷史，使用現有統合效率／貝氏縮減核心；不是複製 T-10 後改標籤。
- 每分鐘處理最多 1 場；T-15 優先。若多場同時開賽，依序封存；實際完成時間超過目標 90 秒會標為賽前補抓，排除準時階段比較。
- 部署時若已超過 06:00，仍可在 07:45 前補抓 T-2，標明現在的時間；過了 07:45 才部署則不補造 T-2，只擷取 T-15。
- **目前傷停、確認先發沒有可驗證的來源，明示 not_available，未套用球員修正。**這版不能當成「已完成傷停與先發整合」驗收。
- 新階段每場最多 9 次 NBA 請求與 1 次盤口請求；盤口預留 2 個 credits。隔離日上限預設 NBA 300 次、盤口 60 credits；可用 `NBA_STAGE_DAILY_NBA_LIMIT`、`NBA_STAGE_DAILY_ODDS_LIMIT` 調整。這是新增階段的上限，不代表整個帳號所有既有排程總用量。
- 同階段固定結果不覆寫；來源錯誤可隔 2 分鐘重試、處理逾時隔 5 分鐘重試，總計最多 4 次，且只在當前賽前窗口。

## 暫停／退回

- 僅停新增階段掃描：`SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='habao-nba-v2-stages-every-minute';`
- 前台退回部署前 commit `ad27083f9d2fad155dc5c84fc999f3ce6945f1e8` 的 football.html 與 analysis.html；新表與領取紀錄保留，勿刪以免重複扣點。
- 保持 `all_members_enabled=false`；這次只開測試帳號。

測試程式與驗證紀錄一併保留在本部署目錄。實際 Supabase 部署結果與會員實場點擊仍須部署後確認。

## 06:48 盤口請求錯誤修補

針對畫面中的 `current_odds_source_unavailable`：時間篩選改為秒級 UTC 格式，API 失敗保留 HTTP 狀態與安全錯誤代碼。尚未從原錯誤得知上游實際原因，不先假定金鑰失效或配額不足。

1. 只重新部署本目錄 `nba-v2-stage-runner.index.txt` 至同名函式；member 與前台不需重部署。
2. 執行 `04_retry_odds_format_fix.sql`，只將 17111／17112 尚在 T-2 窗口且仍是舊錯誤的失敗快照重新排隊；不動 ready 快照、會員領取、API 用量。
3. 約 60 秒後查 `03_readonly_audit.sql`。若仍失敗，`reason` 會顯示如 `odds_http_401_INVALID_KEY`、`odds_http_422_INVALID_COMMENCE_TIME_FROM` 或 `odds_http_429_EXCEEDED_FREQ_LIMIT`。請提供代碼即可，不要提供 API 金鑰。

## 07:10 前台單場／批次一致性修補

本次只更新 GitHub 前台的 football.html、analysis.html、nba-stages.js；**不需重新部署 Supabase 函式或 SQL 遷移**。

- 修正舊批次仍呼叫 T-10 的問題；T-2／T-15 與單場共用同一個領取入口與結果驗證，完整保留伺服器回傳的固定結果。
- 等待按鈕顯示台灣時間的實際開放時刻；金色 T-10／藍色 T-2／紫色 T-15，等待狀態淡化。
- 「我的分析」與批次頁顯示各自階段，T-2／T-15 歷史按鈕同步配色。
- 單場載入改為「讀取深度分析／讀取最終分析」與小型轉圈。
- NBA 結果頁將原始資料狀態翻成中文；暫不推薦不再展示 50%／0% 的信心條，原始推薦 JSON 不修改。
- T-10 用既有正式 V1，T-2／T-15 用統合 V2，結果可能因模型和盤口不同而改變；此次不更改模型、既有快照或扣點紀錄。
- 要核對實際賽事，執行唯讀 `05_verify_stage_results.sql`，將完整 JSON 結果提供分析。`claim_snapshot_mismatches` 應為 0。此項只證明領取與封存結果一致，不代表勝率已經通過實證。

驗證：新增 stage-batch-tests.cjs 模擬階段切換、混合批次、單／批次完全相同、重看不扣點、跨階段不誤扣、會員切換、錯誤回傳。瀏覽器啟動受執行環境限制，未完成自動瀏覽器視覺驗收；實機前台由測試帳號繼續確認。
