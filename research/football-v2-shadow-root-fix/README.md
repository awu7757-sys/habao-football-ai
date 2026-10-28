# HABAO 足球 V2 影子版修正草稿

依 2026-10-29 唯讀稽核結果整理，僅供隔離研究與審查；未部署、未啟用排程、未改 V1。

## 已整理的修正

- **盤口重試**：獨立追蹤缺盤與重試；實際取得的盤口附加寫入新表，保留來源與取得時間，不覆蓋舊 V2 輸入。
- **歷史資料準備**：以 API-Football 賽程作獨立清單，使用賽程日期快取，取每隊近 12 場同聯賽完賽記錄，保留比分、主客場、對手、排名和來源；近期權重採 120 天半衰期。缺樣本會明確標記，不無限往前找。
- **新模型**：把近 12 場近期攻守（60%）與整季攻守（40%）加權，調整對手強弱並向真實聯賽平均收縮；按主客場表現作有限修正，計算預期進球，再用 Poisson 分布產生勝和負、大小球、BTTS、最可能比分及公平賠率。這是未校準研究模型，不作正式推薦。
- **T-15/T-10/T-2 影子快照**：每個時間點獨立保存，抓取前重新核對官方賽程；錯過時間窗不補造。盤口只保存最近已取得的市場資料，不混入模型特徵。
- **球員資料**：T-15 試抓傷停，三個時間點記錄可取得的先發名單；無資料或 API 失敗會標記。現階段不把球員狀態換算成進球修正，避免沒有出賽時間／位置影響依據時臆測。
- **成本與隔離**：每次最多處理一場；dry-run 不呼叫外部 API；所有 API 呼叫走每日用量上限。SQL 僅新增影子表，完全不寫 V1、會員、公開戰績、T-10 正式快照或結算資料。

## 檔案

- SQL 順序：`sql/01_market_repair_tables.sql`、`sql/02_history_prep_tables.sql`、`sql/03_shadow_stage_model.sql`。
- Edge Functions：`football-v2-market-repair-runner`、`football-v2-shadow-feature-runner`、`football-v2-shadow-stage-runner`。
- 三個時間點建議各設每分鐘 Cron 呼叫 `football-v2-shadow-stage-runner`；市場與歷史準備函式需另設 Cron。**本草稿沒有建立或啟用任何正式排程。**

## 環境變數

- 市場修復：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`API_FOOTBALL_KEY`、`THE_ODDS_API_KEY`（或 `ODDS_API_KEY`）、`FOOTBALL_V2_MARKET_CRON_KEY`。
- 歷史準備：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`API_FOOTBALL_KEY`、`FOOTBALL_V2_FEATURE_CRON_KEY`、`FOOTBALL_V2_FEATURE_DAILY_CALL_CAP`。
- 三階段模型：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`API_FOOTBALL_KEY`、`FOOTBALL_V2_STAGE_CRON_KEY`、共用 `FOOTBALL_V2_FEATURE_DAILY_CALL_CAP`。

## 尚待驗收

這些 SQL／程式仍是未部署草稿。部署前需確認正式資料表實際欄位、SQL migration、API 回應格式、每日用量上限與排程頻率；部署後再做影子輸出與歷史回測、校準比較。通過驗收前不得切換 V1，也不應把未校準機率當正式推薦。Deno 執行環境目前不可用，因此這輪只完成程式碼審閱，沒有聲稱已編譯或執行驗證。
