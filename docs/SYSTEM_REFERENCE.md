# SYSTEM_REFERENCE — HABAO 系統運作手冊

> 建立：2026-11-15（Claude，依 main `4d3be72` 程式碼逐檔整理）。
> 用途：說明「每個功能實際怎麼運算、資料從哪來、寫到哪裡」，讓 Claude、GPT 或工程師隔很久再接手也能照同一套理解。
> 與 `PROJECT_NOTES.md` 的分工：PROJECT_NOTES 記**規則、決策、進度、待辦**；本檔記**運作機制**。模型公式細節仍以 PROJECT_NOTES §3 為主，本檔不重複。

## 0. 怎麼讀這份文件

每一段標註證據等級：

| 標記 | 意思 |
|---|---|
| 【程式】 | 已讀 repo 內程式碼，附路徑。代表 repo 版本，不保證與線上 Supabase 同版 |
| 【線上】 | 使用者從正式 Supabase 匯出或查詢確認，附日期 |
| 【使用者】 | 專案負責人口頭說明的設計意圖 |
| 【缺】 | 程式只在線上、repo 沒有原始碼。只能從前台呼叫方式推測，**不可當成已確認** |

**重要事實：很多核心後端只存在線上，不在 repo。** 見 §12 清單；補齊方式見 `deploy/system-reference-20261115/`。

---

## 1. 系統地圖

```text
會員瀏覽器（GitHub Pages 靜態頁）
  │  Supabase Auth（Google／LINE OAuth）取得 JWT
  ▼
Edge Functions（Supabase）──►  Postgres（members、快照、領取、設定）
  ▲                               ▲
  │ pg_cron 每分鐘／定時呼叫       │ RPC（原子領取、扣點、租約、預算）
  └── runner 擷取外部 API（API-Football、API-NBA、The Odds、ESPN、NBA 官方、MLB Stats）
```

- 前台全部是靜態 HTML／原生 JS，網址常數直接寫在各頁（Supabase URL `https://oqtbsbohcfeghgnykwxy.supabase.co`）。【程式】
- 會員看到的分析**一律來自系統預先產生的快照**；會員按按鈕只是「領取」快照並扣點，不會重新跑模型（例外：當前窗口內缺快照時可觸發一次受控補抓，見 §5.4）。【程式】

---

## 2. 會員與登入

### 2.1 登入流程【程式 `index.html`】

1. 會員在 `index.html` 用 Google 或 LINE 走 Supabase OAuth。
2. 取得 session 後呼叫 `oauth-member-login`【缺】，由伺服器端驗證 JWT 並建立／讀取 `members` 列。
3. 回應可能帶 `signup_bonus`（新會員登入禮點數），前台存入 `sessionStorage.habao_signup_bonus` 並在首頁顯示一次。
4. 會員資料存 `sessionStorage.habao_member`，然後導向 `home-v2.html?lang=…`。
5. `home.html` 是舊首頁：目前沒有任何頁面導向它。`index.html` 約 5013 行註解說「之後升級回 home.html」已過時。

`member-login`（舊帳密登入）仍被 `home.html`、`home-v2.html` 引用，屬殘留路徑。【程式】

### 2.2 會員身分欄位（`public.members`）

| 欄位 | 意思 | 證據 |
|---|---|---|
| `account` | 會員唯一帳號（例 `google_xxxx`），所有領取／扣點以此為鍵 | 【程式】 |
| `is_active` | false＝停權；三個 stage 領取 RPC 會拒絕 | 【程式】 |
| `member_level` | `normal` 或 `vip` | 【線上】 |
| `analysis_credits` | 付費／贈送點數（推測含註冊送的 3 點） | 【線上】欄位存在；3 點存放位置【缺】 |
| `daily_free_credits` | 每日免費點數，只有 VIP 會有 | 【線上】【使用者】 |
| `analysis_unlimited` | true＝無限分析，不扣點 | 【程式】 |
| `platform_name`／`platform_account` | 綁定的合作平台與帳號 | 【程式】 |
| `last_login_at` | 最後登入 | 【程式】 |

### 2.3 維護模式【程式 `home-v2.html` 約 7730–7900 行】

- 首頁呼叫 `admin-benefits` 的 `get_public_settings` 讀公告與 `maintenance_enabled`。
- 維護模式開啟時會員看到維護畫面；**唯一例外帳號寫死在前台**：`HABAO_MAINTENANCE_BYPASS_ACCOUNT = "google_2d3cef6b6e2d"`。換管理帳號時要改這裡。

---

## 3. 點數、VIP 與扣點

### 3.1 會員等級設計【使用者 2026-11-15】

| 等級 | 怎麼取得 | 點數 |
|---|---|---|
| 一般會員 | 首次註冊登入 | 註冊送 3 點，**沒有每日免費點數** |
| VIP | 綁定任一合作平台帳號（免費） | 每日登入補充 2 點，**不累積**；每日點數優先扣 |

「每日 2 點、不累積、優先扣除」來自首頁 VIP 卡片文案。【程式 `home-v2.html` 約 7627 行】實際發點由哪支程式在何時執行【缺】，推測在 `oauth-member-login` 或排程。

### 3.2 升級 VIP【程式 `home-v2.html` 約 9090 行；後端【缺】】

- 前台 POST `upgrade-vip`，帶 `platform_account`、`platform_slug` 與會員 JWT。
- 錯誤碼：`PLATFORM_ACCOUNT_USED`（此平台帳號已被別人綁）、`VIP_REUPGRADE_BLOCKED`（不可重複升級）。
- 成功回傳新的 member 物件，前台覆寫 `sessionStorage.habao_member`。

### 3.3 扣點核心 `consume_member_analysis_credit(p_account)`【線上 2026-11-15】

備份：`supabase/sql/consume_member_analysis_credit.snapshot.sql`。

1. `SELECT … FOR UPDATE` 鎖住該會員列。找不到 → `success=false`。
2. `member_level='vip'` 且 `daily_free_credits>0` → 扣 1 日點，`consumed_type='daily'`。
3. 否則 `analysis_credits>0` → 扣 1 付費點，`consumed_type='paid'`。
4. 都沒有 → `success=false, consumed_type='none'`。
5. 無限會員不經過這裡（呼叫端先判斷 `analysis_unlimited`）。
6. 執行權限只有 `postgres`、`service_role`。【線上】

### 3.4 管理員改點數【程式 `admin.html` 約 3150 行；後端 `admin-members`【缺】】

- 管理員輸入增加／扣除數量，**前台用畫面上的舊餘額算出新總數**，送 `update_credits` 帶 `analysis_credits: 新總數`。
- 風險：如果會員在管理員開視窗後剛好用掉一點，送出時會把那一點「補回來」。要修需改後端成「加減差額」，屬後端改動。
- 其他會員管理 action：`list`、`set_active`（停權／恢復）、`update_member_level`、`update_platform_binding`。

---

## 4. 三階段領取流程

### 4.1 時間窗【程式 `sports-stage-core.js` 第 12 行】

```text
距開賽分鐘 m：
  m > 600 或 m ≤ 0  → 不可領取（null）
  120 < m ≤ 600     → t10
  15  < m ≤ 120     → t2
  0   < m ≤ 15      → t15
```

按鈕文字與「等待下一階段」狀態也在同檔 `decision()`。前台、首頁統計、驗證頁共用這支。

### 4.2 T-2／T-15：原子領取 RPC【程式】

三球類邏輯相同，以 NBA 為例（`deploy/nba-stages-20261113/01_nba_stages.sql`）：

1. 參數檢查：stage 只接受 `t2`、`t15`。
2. `pg_advisory_xact_lock(帳號,場次,階段)`：同一人同場同階段同時只有一個請求能進來。
3. 讀開放設定（NBA／MLB 為 `*_v2_stage_settings`，足球為 `football_v2_rollout_settings`）：`all_members_enabled=true`，或帳號等於 `pilot_account` 才可領（足球 pilot 預設為 `google_2d3cef6b6e2d`）。
4. 鎖會員列；停權 → `member_inactive`。
5. **已領過 → 直接回傳舊結果，不扣點**（`already_claimed=true`）。
6. 讀 `status='ready'` 的快照；不存在 → `stage_snapshot_not_ready`。
7. 快照必須在開賽前完成、`success=true`、階段與場次相符。
8. 現在已開賽 → `match_already_started`；未到窗口 → `stage_not_open`。（註：只檢查「已到開放時間」，所以 T-15 時仍可補領已存在的 T-2。）
9. 非無限會員呼叫 `consume_member_analysis_credit`；失敗 → `analysis_credits_empty`，整筆交易回滾。
10. 寫入 `*_stage_claims`（含完整 `result_data` 複本）並回傳。

| 球類 | RPC | 會員端 Edge Function | 快照表／領取表 |
|---|---|---|---|
| 足球 | `claim_football_v2_stage_analysis_atomic` | `football-v2-stage-member` | `football_v2_shadow_stage_snapshots`／`football_v2_stage_member_claims` |
| NBA | `claim_nba_stage_atomic` | `nba-v2-stage-member` | `basketball_v2_stage_snapshots`／`basketball_v2_stage_claims` |
| MLB | `claim_mlb_stage_atomic` | `baseball-v2-stage-member` | `baseball_v2_stage_snapshots`／`baseball_v2_stage_claims` |

RPC 權限：已 REVOKE PUBLIC／anon／authenticated，只給 `service_role`。【程式】

### 4.3 T-10：各球類舊路徑（未統一）

| 球類 | 會員端 | 扣點方式 | 證據 |
|---|---|---|---|
| 足球 | `match-analysis` | 【缺】 | 原始碼不在 repo |
| NBA | `basketball-member-analysis` | 【缺】 | 原始碼不在 repo |
| MLB | `baseball-member-analysis` → RPC `baseball_claim_member_snapshot`、`baseball_rerun_member_snapshot` | RPC 本體【缺】 | 【程式】`deploy/sports-release-20261113/baseball-member-analysis.index.txt`；需 `HABAO_MLB_MEMBER_WRITE_ENABLED=true` |

T-10 扣點邏輯不在 repo，是目前最大的盲點之一。

### 4.4 前台 controller【程式】

- `sports-stages.js`：包裝舊頁面函式，統一單場／批次／我的分析的按鈕與領取呼叫。
- `sports-analysis-contract.js`：單場與批次都走同一個領取入口（契約測試第 1 項驗證）。
- `nba-stages.js`：舊 NBA 相容層，不可與共用 controller 同時觸發。

---

## 5. 快照擷取（runner）

### 5.1 足球【程式 `supabase/functions/football-v2-shadow-stage-runner/index.ts`】

- 由 pg_cron 每分鐘呼叫，需 header 帶 `FOOTBALL_V2_STAGE_CRON_KEY`。
- 擷取 T-15、T-10、T-2 三個時間點（`STAGES`）；T-10 另確保正式 T-10 快照（呼叫 `match-analysis` 路徑）。
- 只處理 `SPORTS` 內聯賽：`[39,140,78,135,61,2,3,88,40,253,262,848]`。
- 每場每階段先用 `reserve_football_v2_stage_capture_lease` 取得租約，避免重複擷取。
- API-Football 每日呼叫上限：環境變數 `FOOTBALL_V2_FEATURE_DAILY_CALL_CAP`（未設定 → runner 直接回 `daily_api_cap_not_configured`），每次呼叫前 `reserve_football_v2_shadow_api_call` 計數。
- 寫入使用 `resolution=ignore-duplicates`：**已存在的快照不會被覆蓋**。
- `capture_mode`：完成時間與目標時間差 ≤1.5 分鐘為 `scheduled`，否則 `late_pre_match_recovery`（晚補抓，公開戰績會排除）。
- 球員資料只抓 API-Football `/players` 第 1 頁，多頁時標 `partial`。

### 5.2 NBA【程式 `deploy/nba-stages-20261113/`】

- 排程 `habao-nba-v2-stages-every-minute`（`* * * * *`），Vault 金鑰 `nba_v2_cron_key`。
- 租約 `acquire_nba_stage_capture`；成本預算 `reserve_nba_stage_api`，記在 `basketball_v2_stage_api_budget(usage_date, provider)`。
- 每日上限：`NBA_STAGE_DAILY_NBA_LIMIT`（預設 300）、`NBA_STAGE_DAILY_ODDS_LIMIT`（預設 60）。超過 → `*_stage_daily_budget_exhausted`。
- 球員情境：ESPN 傷停＋NBA 官方 daily lineups（`nba-stage-context.ts`）。

### 5.3 MLB【程式 `deploy/sports-release-20261113/`】

- 排程 `habao-mlb-v2-stages-every-minute`（`* * * * *`），**共用 `nba_v2_cron_key`**。
- T-10 來源：`baseball_t10_snapshots`（透過視圖 `sports_mlb_t10_source`）；T-10 本身由 `baseball-t10-job`／`baseball-analysis` 產生【缺／部分程式】。
- The Odds 每日上限 `MLB_STAGE_DAILY_ODDS_LIMIT`（預設 24，最高 300）。
- 球員修正共用 `mlb-player-adjustment.js`。

### 5.4 會員觸發補抓

當前窗口內快照尚未產生時，會員端函式可觸發一次 runner 補抓（受租約與預算限制）；完成時間必須早於開賽，否則不能當賽前快照。【程式，細節見各 stage-member／runner】

---

## 6. 模型

公式與參數見 `PROJECT_NOTES.md` §3（已於 2026-11-15 對照程式核對）。本檔只補一個機制：

**足球 T-2／T-15 推薦是「讀取時轉換」，不是存好的推薦。** 快照只存 xG、機率、盤口；推薦（獨贏取三者最高機率、BTTS ≥0.5、大小／讓分取 EV 最高盤線、四分之一盤拆半）在兩個地方各寫了一份：

- 會員看的：`supabase/functions/football-v2-stage-member/index.ts`（約 48–150 行）
- 公開戰績：`supabase/functions/ai-performance/index.ts`（約 189–262 行）

**兩份必須同步修改**，否則會員看到的推薦與公開戰績結算的推薦會不同。這是目前最需要注意的重複邏輯。

---

## 7. 結算與公開戰績

### 7.1 足球【程式 `supabase/functions/ai-performance/index.ts`】

1. 讀 `ai_prediction_snapshots`：`status=verified`、`excluded_from_public=false`、有 `settlement` 與 `verified_at`，依開賽時間倒序，**上限 1000 筆**。`days=7|30` 時另加時間篩選，否則為全期間。
2. 讀 `football_v2_rollout_settings.public_stage` 與 `football_v2_public_stage_history`：**每場用「開賽當時生效」的公開階段**。
3. 公開階段是 T-2／T-15 時：找對應快照；`late_pre_match_recovery` 或 `eligible_for_stage_metrics=false` 的排除；**找不到就整場不列，不會偷偷退回 T-10**。
4. 用快照 xG 重建比分網格，算推薦並以正式比分結算：
   - 獨贏、BTTS：win／loss。
   - 大小、讓分：四分之一盤拆成兩半各自比較 → win、half_win、push、half_loss、loss。
5. 命中率 = 有效勝 ÷（有效勝＋有效負），半贏／半輸各算 0.5，走盤不計入分母。
6. 單場總評：各市場 win=1、half_win=0.5、loss=−1、half_loss=−0.5 加總，>0 勝、<0 負、=0 和。
7. 全期間且從未切過非 T-10 階段時，會另外顯示 `ai_backtest_summary`（回測彙總，須區分真實／模擬）。
8. T-10 的 `ai_prediction_snapshots` 由誰結算：`public-prediction-runner`（`mode: validate_overdue`）【缺】；管理後台可手動觸發。

### 7.2 NBA、MLB【缺】

`basketball-performance-api`、`baseball-performance-api`、`baseball_verified_results` 的結算程式都不在 repo。前台只能確認回應包含 `summary.verified_matches`。

### 7.3 前台戰績頁【程式 `performance.html`】

- 進入或切球類預設 30D；驗證紀錄表另存 `recordsData`，固定近 30 天，切 7D 不影響。
- 非同步回應帶 `requestId` 防止舊回應覆蓋新畫面。

### 7.4 首頁三數字【程式 `home-sports-stats.js`】

| 數字 | 算法 |
|---|---|
| 可分析 | 今天＋明天（台灣日期）三球類賽程，排除取消／延期，用 `sports-stage-core` 判斷「現在主按鈕可按」的場次 |
| 已分析 | 足球 `member-analysis-history`＋NBA／MLB 歷史與 stage `history`，以 `球類:場次ID` 去重；開賽＋8 小時後的不計 |
| 公開驗證 | 三個戰績 API 的 `summary.verified_matches` 相加（全期間） |

任一來源失敗顯示 `--`。檔頭註明不做任何領取／扣點呼叫。足球聯賽白名單 `[2,3,39,140,78,135,61,98,292,88,169,71]` 與 runner 不同（見 PROJECT_NOTES §7 P1-2）。

---

## 8. 管理後台

### 8.1 登入與權限【程式 `supabase/functions/admin-center/index.ts`】

- 管理員帳號在 `admin_users`，密碼 PBKDF2-SHA256；登入後 token 雜湊存 `admin_sessions`。
- 每個 action 依 `permissions` 陣列檢查；`["*"]` 為全權。
- **還有一個 legacy 超級管理員**：環境變數 `ADMIN_PASSWORD` 符合即取得全權。換密碼或停用要改 Supabase Secrets。

### 8.2 各端點 action（從 `admin.html` 呼叫整理）

| 端點 | action |
|---|---|
| `admin-center`【程式】 | auth_me、auth_logout、overview、analysis_history、jobs、retry_job、health、fixtures、refresh_fixtures、fixture_live_push_toggle、performance、performance_toggle_excluded、**performance_delete**、validate_overdue_performance、run_public_runner、admin_users_*、partners、partner_save／toggle／delete、api_stats、clear_expired_locks |
| `admin-members`【缺】 | list、update_credits、update_member_level、update_platform_binding、set_active |
| `admin-benefits`【缺】 | get_settings、save_settings、get_api_settings、confirm_api_renewal、confirm_nba_api_renewal；會員端 get_public_settings |
| `admin-basketball`【缺】 | overview、analysis_history、fixtures、sync_fixture_scores、refresh_fixtures、api_usage、confirm_odds_renewal |
| `admin-basketball-performance`【缺】 | performance、performance_toggle_excluded、performance_delete |
| `admin-baseball`【缺】 | analysis_history、fixture_meta、readiness、verify_results |
| `push-send` | count、basketball_game_fixtures、basketball_game_count、send、logs |
| `toolbox-launch-settings`【缺】 | get_admin、save |

### 8.3 會改動公開戰績的管理動作（注意）

- `performance_toggle_excluded`：設定 `excluded_from_public` 與 `excluded_at`，該場從公開戰績消失。
- `performance_delete`：**直接刪除 `ai_prediction_snapshots` 該場資料，不可復原、沒有稽核紀錄**。
- 兩者都和「不能事後挑賽事」原則衝突，只應用於資料錯誤，並建議人工留紀錄（日期、場次、原因）。

---

## 9. API 用量與續費追蹤

- 各 runner 的每日預算見 §5。
- API 方案設定（PROJECT_NOTES 記為 `site_settings`；表名【缺】）：`api_daily_limit`（預設 7500）、`api_renewal_date`、`nba_api_plan`、`nba_api_daily_limit`、`nba_api_start_date`、`nba_api_renewal_date`。【程式，經 `admin-benefits get_api_settings` 讀取】
- 「確認已續費」按鈕只更新追蹤日期（今天＋一個月），**不是付款、也不會同步供應商實際到期日**。

---

## 10. 推播、公告、合作平台、工具箱

- 推播：`push-subscribe`（會員訂閱）、`push-send`（管理員發送）；受眾 `member`（指定會員）或 `basketball_game`（某場 NBA 有分析的會員）。部署檔 `deploy/push-send-device-id-v4.index.ts`。【程式】
- 比分推播：`live_score_push_state`／`live_score_push_targets`，賽事列表可逐場開關（`fixture_live_push_toggle`）。【程式】
- 公告與維護模式：`admin-benefits save_settings`（一般公告、跑馬燈、維護公告、維護開關）。
- 合作平台：`partner_platforms`，前台 `partner-platforms` 讀取；VIP 綁定以平台 slug 對應。
- AI 工具箱上線卡：`toolbox-launch-settings`。

---

## 11. 排程總表（repo 可見）

| job 名稱 | 頻率 | 呼叫 | 證據 |
|---|---|---|---|
| `habao-nba-v2-stages-every-minute` | 每分鐘 | `nba-v2-stage-runner` | 【程式】SQL |
| `habao-mlb-v2-stages-every-minute` | 每分鐘 | `baseball-v2-stage-runner` | 【程式】SQL |
| 足球 stage runner | 每分鐘（文件） | `football-v2-shadow-stage-runner` | job 名稱【缺】 |
| T-10、賽後結算、每日發點等 | ? | ? | 【缺】 |

完整清單請用 §12 的匯出 SQL 取得。

---

## 12. 不在 repo 的後端（待匯出補齊）

| 類型 | 名稱 | 影響 |
|---|---|---|
| Edge Function | `oauth-member-login`、`member-login`、`upgrade-vip` | 註冊送點、每日發點、VIP 升級 |
| Edge Function | `admin-members`、`admin-benefits`、`admin-basketball`、`admin-basketball-performance`、`admin-baseball`、`toolbox-launch-settings` | 管理後台 |
| Edge Function | `match-analysis`、`basketball-member-analysis`、`basketball-analysis`、`baseball-t10-job` | T-10 擷取與領取扣點 |
| Edge Function | `public-prediction-runner`、`basketball-performance-api`、`baseball-performance-api` | 賽後結算與公開戰績 |
| DB 函式 | `baseball_claim_member_snapshot`、`baseball_rerun_member_snapshot`，以及其他未知函式 | MLB T-10 扣點 |
| 排程 | 全部 cron job 現況 | 每日運作 |

補齊方式：

- 資料庫函式、排程、資料表欄位：執行 `deploy/system-reference-20261115/01_export_backend_readonly.sql`（唯讀），匯出 CSV 交給 Claude 存進 repo。
- Edge Function 原始碼：Supabase → Edge Functions → 點函式 → Code，逐一複製；或用 CLI `supabase functions download <名稱>`。存到 `supabase/functions/<名稱>/index.ts`，提交時註明「線上匯出，日期」。

---

## 13. 已知風險摘要（2026-11-15）

1. 足球推薦轉換邏輯有兩份（§6），修改時必須同步。
2. `performance_delete` 可永久刪除公開戰績，沒有稽核（§8.3）。
3. 管理員改點數是覆寫總數，有競態（§3.4）。
4. T-10 扣點、每日發點、賽後結算程式不在 repo（§12）。
5. MLB 與 NBA 排程共用同一把 cron 金鑰（§5.3），換金鑰要兩邊一起改。
6. 維護模式例外帳號寫死在前台（§2.3）。
7. 球員資料只抓第 1 頁（§5.1）。

---

## 14. 維護這份文件的規則

- 改到本檔描述的機制時，同一個 Commit 更新對應段落與證據標記。
- 從線上匯出補齊【缺】的部分後，把標記改成【線上 日期】並附 repo 路徑。
- 不寫任何金鑰、密碼、會員個資。
