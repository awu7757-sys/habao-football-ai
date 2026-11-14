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

**重要事實：很多核心後端只存在線上，不在 repo。** 2026-11-15 已匯出全部資料庫函式（32 個）、排程（23 個）與資料表欄位（94 張）到 `supabase/sql/production-export-20261115/`；Edge Function 原始碼仍有部分缺，見 §12。

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
| `analysis_credits` | 付費／贈送點數。**欄位預設值 3＝註冊送的 3 點** | 【線上】 |
| `daily_free_credits` | 每日免費點數，只有 VIP 會有 | 【線上】【使用者】 |
| `daily_free_credits_date` | 上次補每日點數的台灣日期 | 【線上】 |
| `vip_ever_activated` | 曾經升級過 VIP（推測用來擋 `VIP_REUPGRADE_BLOCKED`） | 【線上】欄位；用法【缺】 |
| `expire_at` | 會員到期時間；**目前只有 MLB 的領取程序會檢查** | 【線上】 |
| `daily_analysis_limit`／`daily_analysis_unlimited` | 舊「每日可分析場數」，預設 3；現在只做統計，不擋領取 | 【線上】 |
| `auth_user_id`／`auth_provider`／`email` | Supabase Auth 對應 | 【線上】 |
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

每日補點由資料庫函式 `refresh_vip_daily_credits(account)` 執行【線上】：

1. 以台灣日期為準；鎖住會員列。
2. 非 VIP → 不發點，直接回傳 0。
3. VIP 且 `daily_free_credits_date` 不是今天 → **直接把每日點數設成 2**（昨天剩的不累積），並記下今天日期。
4. 今天已補過 → 不變。

沒有排程呼叫它，所以是**會員當天第一次觸發時才補**（推測在 `oauth-member-login` 登入時呼叫；呼叫端【缺】）。
註冊送 3 點來自 `members.analysis_credits` 欄位預設值 3。【線上】

### 3.2 升級 VIP【程式 `home-v2.html` 約 9090 行；後端【缺】】

- 前台 POST `upgrade-vip`，帶 `platform_account`、`platform_slug` 與會員 JWT。
- 錯誤碼：`PLATFORM_ACCOUNT_USED`（此平台帳號已被別人綁）、`VIP_REUPGRADE_BLOCKED`（不可重複升級）。
- 成功回傳新的 member 物件，前台覆寫 `sessionStorage.habao_member`。

### 3.3 扣點核心 `consume_member_analysis_credit(p_account)`【線上 2026-11-15】

備份：`supabase/sql/production-export-20261115/functions/consume_member_analysis_credit.sql`。

1. `SELECT … FOR UPDATE` 鎖住該會員列。找不到 → `success=false`。
2. `member_level='vip'` 且 `daily_free_credits>0` → 扣 1 日點，`consumed_type='daily'`。
3. 否則 `analysis_credits>0` → 扣 1 付費點，`consumed_type='paid'`。
4. 都沒有 → `success=false, consumed_type='none'`。
5. 無限會員不經過這裡（呼叫端先判斷 `analysis_unlimited`）。
6. 執行權限只有 `postgres`、`service_role`。【線上】

退點函式【線上】：`refund_member_analysis_credit(account, 'daily'|'paid')`，每日點退回時上限 2；`refund_member_credit`／`consume_member_credit` 是只處理付費點的舊版，是否仍有程式呼叫【缺】。

### 3.4 管理員改點數【程式 `admin.html`、`supabase/functions/admin-members/index.ts`（線上匯出 2026-11-15）】

- 2026-11-15 起前台送 `adjust_credits`（差額 `delta`），後端呼叫 RPC `admin_adjust_member_credits`，由資料庫在同一行 UPDATE 內加減，扣除後不可小於 0。
- 舊 action `update_credits`（直接覆寫總數）仍保留；前台只在後端回「無效的管理操作」（新版尚未部署）時退回使用。
- 已於 2026-11-15 部署並實測正常。
- 其他 action：`list`、`create`（殘留碼，後台已無入口；會員一律自行註冊）、`set_active`、`update_member_level`（降為一般會員會清空每日點數；升 VIP 會設 `vip_ever_activated`）、`update_platform_binding`（同平台同帳號不可重複綁定）。
- 管理員權限：需 `members` 權限，或 legacy 超級管理員密碼（`ADMIN_LEGACY_PASSWORD_FALLBACK` 預設開啟）。

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
| 足球 | `match-analysis` | Edge Function【缺】；會用 `consume_analysis_quota` 記每日使用（只做統計，不擋） | 【線上】函式 |
| NBA | `basketball-member-analysis` | Edge Function【缺】；會用 `consume_basketball_analysis_quota`（只做統計）、`refund_basketball_analysis_quota` | 【線上】函式 |
| MLB | `baseball-member-analysis` → `baseball_claim_member_snapshot` | 同一交易內呼叫 `consume_member_analysis_credit` | 【線上】完整 |

MLB T-10 領取 `baseball_claim_member_snapshot`【線上】：
1. 鎖會員列；停權或 `expire_at` 已過 → 拒絕。
2. 快照必須存在、已到 T-10、內容為棒球且場次相符。
3. 已領過 → 回傳舊結果，不扣點（開賽後仍可重看）。
4. 開賽後不可新領。
5. 非無限會員扣 1 點；扣不到 → `MLB_NO_MEMBER_CREDITS`。
6. 寫 `member_baseball_analysis_history`（含 `credit_charged`、`consumed_credit_type`）與 `baseball_member_daily_usage`。

`baseball_rerun_member_snapshot`：已領過的會員每 6 小時可「重跑」一次，但**只是回傳同一份快照、不扣點**（舊六小時重分析機制的殘留）。

足球、NBA 的 T-10 扣點程式在 Edge Function 裡，仍【缺】。

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
- 租約 `acquire_nba_stage_capture`【線上】：只在該階段窗口內、開賽前取得；**T-10 快照必須產生於開賽前 10.5～8 小時之間**，否則這場不會產生 T-2／T-15；失敗（`source_error`／`insufficient_data`）2 分鐘後可重試、處理中逾 5 分鐘可接手，**最多 4 次**。MLB 的 `acquire_mlb_stage_capture` 規則相同。
- 成本預算 `reserve_nba_stage_api`，記在 `basketball_v2_stage_api_budget(usage_date, provider)`；日期以 **UTC** 計（台灣早上 8 點換日）。
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

**兩份必須同步修改**，否則會員看到的推薦與公開戰績結算的推薦會不同。

自動檢查：`node tests/football-recommendation-parity.test.cjs`（2026-11-15 新增）。直接從兩個原始檔抽出算法，用 3000 筆合成快照比對獨贏、大小、讓分、BTTS 的選項與盤線；任何一邊單獨修改就會失敗。修改任一檔後必跑。

已知的邊界差異（正常資料不會觸發，測試未涵蓋）：
- 會員端拒絕 xG ≤0 或 >8 的快照；公開戰績端只要求是數字。
- `probabilities` 部分欄位缺失時：會員端三項（主／和／客）要齊全且總和≈1 才採用，否則全部改用比分網格；公開戰績端逐項採用。

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
8. T-10 的 `ai_prediction_snapshots` 由 `public-prediction-runner` 結算（排程 `habao-football-verify-hourly` 每小時 :20）【程式本體缺】；管理後台可手動觸發。
9. 足球 T-10 快照補抓佇列 `habao_t10_retry_queue`【線上】：賽程登記後於 T-10 起可領，每次最多 2 場、租約 3 分鐘、失敗 5 分鐘後重試；已有正式快照即標 done，開賽仍無快照標 expired。

### 7.2 NBA、MLB【缺】

- 結算排程【線上】：NBA `basketball-result-runner`、MLB `baseball-result-runner`，都是每 30 分鐘。程式本體【缺】。
- NBA 結算寫回 `basketball_prediction_snapshots`（`settlement`、`verified_at`、`verification_error`、`excluded_from_public`）。
- MLB 結算寫 `baseball_verified_results`（`moneyline_result`、`totals_result`、`handicap_result`），**有觸發器禁止修改**（`MLB_VERIFIED_RESULT_IMMUTABLE`）；`baseball_t10_snapshots` 也有觸發器禁止修改。
- 戰績 API `basketball-performance-api`、`baseball-performance-api` 本體【缺】。

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
| `admin-members`【程式】 | list、create、adjust_credits、update_credits（舊）、update_member_level、update_platform_binding、set_active |
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

## 11. 排程總表【線上 2026-11-15】

完整清單：`supabase/sql/production-export-20261115/cron_jobs.md`（時間為 UTC）。重點：

| 用途 | job | 頻率 |
|---|---|---|
| 足球特徵準備 | `football-v2-shadow-feature-prep` | 每分鐘 |
| 足球 T-2／T-10／T-15 擷取 | `football-v2-shadow-stage-temp` | 每分鐘（名稱有 temp 但是正式在用） |
| 足球 T-10 補抓 | `habao-football-t10-rescue-every-5m` | 每 5 分鐘 |
| 足球市場修補 | `habao-football-v2-repair-15min` | 每 15 分鐘 |
| 足球公開 runner | `public-prediction-runner-hourly`（:00）、`habao-football-verify-hourly`（:20） | 每小時兩次 |
| NBA T-10 | `habao-basketball-t10-every-15m` | 每 15 分鐘 |
| NBA T-2／T-15 | `habao-nba-v2-stages-every-minute` | 每分鐘 |
| NBA 研究模型 | `habao-nba-v2-unified-15min` | 每 15 分鐘（研究用，會用 API 額度） |
| NBA 結算 | `habao-basketball-result-every-30m` | 每 30 分鐘 |
| MLB T-10 | `habao-baseball-t10-every-15m` | 每 15 分鐘 |
| MLB T-2／T-15 | `habao-mlb-v2-stages-every-minute` | 每分鐘 |
| MLB 研究模型 | `habao-baseball-v2-shadow-15min` | 每 15 分鐘（研究用） |
| MLB 結算 | `habao-baseball-results-every-30m` | 每 30 分鐘 |
| MLB 開盤線、球隊統計 | `habao-baseball-opening-every-6h`、`habao-baseball-team-stats-every-6h` | 每 6 小時 |
| NBA／MLB 比分推播 | `habao-sport-score-push-3min` | 每 3 分鐘 |
| 用量快照 | `habao-usage-snapshot-every-6-hours` | 每 6 小時 |
| 每日清理 | `habao-v3-daily-cleanup` → `habao_cleanup_admin_data()` | 每天 20:10 UTC（台灣 04:10） |

已停用：`habao-live-score-push-every-2-minutes`（足球比分推播）、`habao-nba-v2-shadow-15min`、`habao-nba-v3-efficiency-15min`、`habao-nba-v3-player-timing-5min`。

每日清理【線上 2026-11-15 修改後】：只刪除完成／失敗超過 7 天的 `analysis_jobs`。**不再刪除 `member_analysis_history`**（修改前會刪 7 天前的足球 T-10 會員領取紀錄）。SQL：`deploy/fixes-20261115/02_cleanup_retention_and_grants.sql`。

---

## 12. 不在 repo 的後端（仍待補）

資料庫函式、排程、資料表已於 2026-11-15 全部匯出（`supabase/sql/production-export-20261115/`）。仍缺的是 **Edge Function 原始碼**：

| 名稱 | 影響 |
|---|---|
| `oauth-member-login`、`member-login`、`upgrade-vip` | 登入、建立會員、呼叫每日補點、VIP 升級 |
| `admin-benefits`、`admin-basketball`、`admin-basketball-performance`、`admin-baseball`、`toolbox-launch-settings` | 管理後台 |
| `match-analysis`、`basketball-member-analysis`、`basketball-analysis`、`basketball-t10-job`、`baseball-t10-job` | T-10 擷取與足球／NBA 領取扣點 |
| `public-prediction-runner`、`basketball-result-runner`、`baseball-result-runner`、`basketball-performance-api`、`baseball-performance-api` | 結算與公開戰績 |
| `football-v2-shadow-feature-runner`、`football-v2-repair-runner`、`baseball-v2-shadow`、`baseball-opening-capture`、`baseball-team-stats-cache`、`habao-sport-score-push`、`usage-snapshot` | 排程任務 |

補齊方式：Supabase → Edge Functions → 點函式 → Code，複製後交給 Claude 存到 `supabase/functions/<名稱>/index.ts`，註明「線上匯出＋日期」。

---

## 13. 已知風險摘要（2026-11-15）

1. 足球推薦轉換邏輯有兩份（§6），修改時必須同步。
2. `performance_delete` 可永久刪除公開戰績，沒有稽核（§8.3）。
3. ~~管理員改點數覆寫總數~~：2026-11-15 已改為原子差額並上線（§3.4）。
4. T-10 扣點、每日發點、賽後結算程式不在 repo（§12）。
5. MLB 與 NBA 排程共用同一把 cron 金鑰（§5.3），換金鑰要兩邊一起改。
6. 維護模式例外帳號寫死在前台（§2.3）。
7. 球員資料只抓第 1 頁（§5.1）。
8. ~~清理函式開放給 anon~~：2026-11-15 已收回，線上確認只剩 postgres、service_role。
9. ~~每日清理刪 7 天前足球 T-10 領取紀錄~~：2026-11-15 已停止。
10. ~~兩個大小查詢函式開放給 anon~~：2026-11-15 已收回。
10a. **系統沒有扣點流水表**：扣點只改餘額，事後無法逐筆對帳（見 PROJECT_NOTES 11/13 調查）。
11. NBA／MLB 階段若 T-10 快照不在開賽前 10.5～8 小時之間產生，該場就不會有 T-2／T-15（§5.2）。
12. API 預算以 UTC 換日，與介面的台灣日期不同。
13. 有舊備份表與測試表殘留：`football_v2_shadow_feature_*_backup_20261105`、`habao_nba_member_test_backup`。

---

## 14. 維護這份文件的規則

- 改到本檔描述的機制時，同一個 Commit 更新對應段落與證據標記。
- 從線上匯出補齊【缺】的部分後，把標記改成【線上 日期】並附 repo 路徑。
- 不寫任何金鑰、密碼、會員個資。
