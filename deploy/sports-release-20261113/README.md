# 三運動三階段上線包 — 2026-11-13

正式規則：T-10 小時／T-2 小時／T-15 分鐘。最後訊息中的 T-1 依同一對話既有規則視為 T-15；沒有建立 T-1 階段。

## 已完成的程式調整

- 足球、NBA、MLB 共用 `sports-stage-core.js` 的階段判斷及文字；金色 T-10、藍色 T-2、紫色 T-15。
- 單場與批次都呼叫 `sports-stages.js` 同一個 `claim`，使用相同端點、身份、賽事編號及階段；批次不另算推薦、不另存另一份結果。
- 結果頁共用同一份 `analysis.html`。`mlb-analysis.html` 位元組相同，保留舊入口相容性。
- 我的分析按球類＋賽事分組，同場保留各階段原始結果，各自免費重看。
- 修正足球歷史 API 以最新階段覆蓋列表中 T-10 的問題；保留每個已領取階段。OAuth 帳號的讀寫綁定登入身份。
- 修正結果頁因語言不一致重新呼叫 T-10、覆蓋 T-2／T-15 的問題。換語言只改呈現，沒有分析 API 呼叫。
- 移除足球結果的 BTTS 卡；三運動均保留獨贏、讓分、大小球／分。缺少信心值顯示「未提供信心值」，不補造 0% 或 50%。
- 足球確認先發需每隊恰好 11 個有效且不重複球員 ID；只取得部分球隊不標成雙方完整先發。
- MLB 新增系統獨立 T-2／T-15 封存、原子領取與每分鐘排程。T-10 使用原有端點與快照。

## 部署順序

前台程式可先發布；共用階段流程有啟用檢查，後端完成前保留既有流程。

1. Supabase SQL Editor 執行 **01_mlb_stages.sql**。建立 MLB 階段表、服務角色專用 RPC、T-10 來源檢視表及預設關閉的上線標記。
2. 依下表新增或完整覆蓋七支 Edge Functions。保持既有 Secrets；`baseball-v2-stage-*` 和 `sports-release-verify` 的 legacy JWT verification 設為 **OFF**，函式內已有各自的 JWT 身份驗證／排程密鑰驗證。
3. 全部函式部署成功後，執行 **02_enable_and_schedule.sql**。開放三運動給所有已授權會員、啟用 MLB 每分鐘排程，最後寫入正式啟用標記。
4. 開啟 `/qa/sports-release/` 進行畫面驗證；執行 **03_probe_sources_now.sql**，稍後執行 **04_check_source_probes.sql**，匯出 JSON 核對來源。

| Edge Function | 動作 | 完整檔案 |
|---|---|---|
| `baseball-v2-stage-runner` | 新增 | `baseball-v2-stage-runner.index.txt` |
| `baseball-v2-stage-member` | 新增 | `baseball-v2-stage-member.index.txt` |
| `football-v2-shadow-stage-runner` | 完整覆蓋既有函式 | `football-v2-shadow-stage-runner.index.txt` |
| `member-analysis-history` | 完整覆蓋既有函式 | `member-analysis-history.index.txt` |
| `nba-v2-stage-runner` | 覆蓋，修正來源請求標頭 | `nba-v2-stage-runner.index.txt` |
| `baseball-member-analysis` | 覆蓋，T-10 回傳資料庫最新餘額 | `baseball-member-analysis.index.txt` |
| `sports-release-verify` | 新增，最後部署 | `sports-release-verify.index.txt` |

`nba-v2-stage-runner` 已更新至 `nba-stages-player-context-20261113-2`：正式來源請求加入明確 Accept／User-Agent，修正實測 HTTP 403。`nba-v2-stage-member` 原子領取版維持不變。

## 沿用的設定

- `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`／`SUPABASE_SECRET_KEY`：既有資料庫存取。
- `SUPABASE_ANON_KEY`：既有登入身份核對。
- `API_FOOTBALL_KEY`、`FOOTBALL_V2_FEATURE_DAILY_CALL_CAP`：足球沿用既有額度限制；未設定額度不擅自提高。
- `BASKETBALL_T10_CRON_KEY`：新 MLB 排程與來源核對沿用現有排程密鑰；Vault 名稱沿用 `nba_v2_cron_key`。兩者必須是目前 NBA 已使用的相同值。
- `THE_ODDS_API_KEY`／`ODDS_API_KEY`：新 MLB 階段讀取當下盤口。`MLB_STAGE_DAILY_ODDS_LIMIT` 預設上限 24 次盤口請求／UTC 日；每次讀取讓分、大小分兩個市場，供應商實際扣額度依其計費。T-10 原有取價流程不變。

## 現在如何驗證

### 畫面與流程

1. 在驗證頁選球類與情境，按「重設情境」。
2. 點單場分析，確認階段標題、封存時間、三張推薦卡、資料狀態與名單。
3. 再重設同一情境，勾選兩場批次分析。第一場的內容應與剛才單場相同；按下一場確認切到第二個賽事編號。
4. 返回賽事中心，確認已領取與下一階段開放時間。進入我的分析，確認同場只有一張卡，三階段分別重看。
5. 驗證額度不足、快照未就緒、回傳階段錯誤，以及手機寬度。

頁面讀取整份正式 HTML，載入同一份正式資源並列出 SHA-256；沒有維護另一份簡化的卡片或推薦 renderer。驗證時將整份相同資源內嵌以隔離網路，僅替換 API、身份、時間、記憶體儲存及導航。

**「前台程式相同」不等於「虛擬登入與虛擬扣點是真實後端」。** 固定案例由部署函式及固定輸入建立。T-10 案例驗證呈現與單批次相同，不宣稱重跑全部原始 T-10 演算法；原始歷史特徵不完整時不捏造輸入。

### 來源

03 不要求有未開賽的 T-10 快照；選取已保存賽事讀取供應商資料。歷史賽事一律標示 `source_reachability_and_schema_only`，不重建成當時的賽前快照，不扣會員點數、不改已領取分析。足球會使用既有 API 額度。

04 使用 03 保存的確切 request ID 查 HTTP 回覆，包含 401、503、timeout 等錯誤，不再以版本文字過濾掉失敗回應。

- 足球：API-Football 傷停與先發。無資料、部分名單及來源失敗分開顯示。
- NBA：正式階段沿用 ESPN 出賽資訊＋NBA 官方先發；預估名單不當作確認名單。來源核對讀取已存賽事對應的 ESPN 資料；歷史 boxscore 的先發不冒充賽前名單。
- MLB：官方 game feed 的打線與預估先發投手、官方完整名冊中的傷兵狀態。預估投手仍標示「尚未確認」。本版模型沿用球隊＋近期戰績＋具足夠投球樣本的先發 ERA 修正；已讀取的打線、傷兵名單不宣稱已套用打者修正。

來源目前有回覆，不能證明未來每一場必定在 T-2 或 T-15 公布完整名單；系統應如實呈現來源狀態。這不妨礙在無賽事時驗證前台所有狀態與來源欄位解析。

## 變更邊界

舊 T-10／T-2／T-15 ready 快照與已領取結果不回寫、不退款、不重算；既有公開戰績口徑不改。每個新階段扣一次，同一會員同場同階段重看免費。MLB 新階段的 Poisson 機率研究欄位不作準確率保證。

驗證紀錄見 `validation.log`、`browser-validation.json`。後端函式與 SQL 必須由有權限的專案管理員部署；前台發佈不能代替這一步。
