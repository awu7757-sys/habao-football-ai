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
| 已領 T-10、尚未 06:00 | 藍色「深度分析（T-2 開放）」 | 等待，不可點 |
| 06:00–07:45，未領 T-2 | 藍色「深度分析」 | 獨立 T-2 固定快照；成功扣 1 點 |
| 已領 T-2、尚未 07:45 | 紫色「最終分析（T-15 開放）」 | 等待，不可點 |
| 07:45–08:00，未領 T-15 | 紫色「最終分析」 | 獨立 T-15 固定快照；成功扣 1 點 |
| 已領 T-15 | 紫色「已領取最終分析」 | 不再新領；我的分析免費重看 |
| 08:00 起 | 分析已截止 | 禁止首次領取；既有結果仍可重看 |

- 到 T-2／T-15 不必先領前一階段。未領 T-10 可補領原固定結果；T-15 只可補領**先前已封存的 T-2**，不補造過去快照。
- 同會員／同場／同階段唯一；跨分頁、連點只成功扣一次。點數扣除與領取寫入在同一個 PostgreSQL 交易；寫入失敗回滾扣點。
- **我的分析**分別保留 T-10、T-2、T-15 紀錄。沿用原頁面「開賽後 8 小時」顯示期限；資料庫不刪紀錄。
- 批次分析沿用 T-10；後期卡片會標成「加入 T-10 批次分析」，不混成 T-2／T-15 批次。

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
