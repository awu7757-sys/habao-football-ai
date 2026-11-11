# 足球三階段功能驗收｜2026-11-11

這次檢查功能、資料與扣點一致性。模型仍為 football-v2-poisson-player-impact-0.3.0，未調整權重。預測準確率繼續影子觀察。

## 這次測了什麼

- 線上 9 項唯讀／未授權檢查：跨域、缺參數、測試帳號缺身份憑證、管理權限、排程權限、公開 API 與資料表存取限制。
- PostgreSQL 相容引擎 PGlite：18 項資料庫測試，包括交易回滾、每階段只扣一次、補領、重看、額度不足與角色權限。這不是 Supabase 正式會員扣點的實場驗收。
- 30 項後端模擬測試：階段窗口、缺資料、補抓、時間邊界、盤口與四分之一盤結算、公開階段切換與錯誤處理。
- 17 項前台狀態測試：三階段按鈕、箭頭、補領、已領取、快速連點、錯場回應與帳號切換。手機實際版面仍需使用者驗收。
- 公開 API 回傳 554 場實際紀錄，重算 1,776 個有原始推薦與盤口的項目；發現一筆舊大小球結算方向不一致。原有 300 場模擬展示未當成實際樣本重算。

## 部署順序

1. Supabase SQL Editor 執行 [01_atomic_stage_claim.sql](01_atomic_stage_claim.sql)。需要已套用舊套件的 01～03 遷移；本次新增原子領取函式，不改會員開放或公開階段設定。
2. Supabase Edge Functions 依下表整份覆蓋 Code，再按 Deploy updates。
3. SQL Editor 執行 [02_readonly_audit.sql](02_readonly_audit.sql)，提供完整結果。
4. GitHub 前台由助手更新後，再以測試帳號實測下方項目。

| Supabase 函式 | 完整程式文字檔 |
|---|---|
| football-v2-stage-member | [football-v2-stage-member.index.txt](football-v2-stage-member.index.txt) |
| football-v2-shadow-stage-runner | [football-v2-shadow-stage-runner.index.txt](football-v2-shadow-stage-runner.index.txt) |
| ai-performance | [ai-performance.index.txt](ai-performance.index.txt) |
| admin-football-v2-stage-compare | [admin-football-v2-stage-compare.index.txt](admin-football-v2-stage-compare.index.txt) |

沿用現有 JWT、Secrets 與排程設定。本次不開放全會員、不切換公開階段。GitHub 檔案更新不等於 Supabase 已部署。

## 修正內容

- 已保存的 T-2 快照可在 T-15 補領；沒有過去快照時明確顯示缺資料，不用現在資料重建過去快照。
- 會員每場每階段的扣點與結果保存改成同一個資料庫交易；保存失敗會連同扣點回滾。同階段重試會讀回原結果。
- 舊 processing 紀錄的扣點狀態不明時，停止自動處理並列入稽核，不猜測補扣或免費轉成功。
- 主按鈕顯示目前階段，提供前階段補領入口；已領取的主按鈕停用。重看可從「我的分析」進入。
- 同階段連點防重；等待請求時，15 秒本機計時器不會把按鈕重新啟用。
- 關閉開放範圍或讀取失敗時還原原有按鈕；較舊帳號的狀態回應不能替另一帳號開啟按鈕。
- 盤口空值、無效四分之一線、讓分正負不相對時不產生虛構盤口。
- 擷取完成已過階段窗口或開賽時，不保存過期階段；準時／補抓分類以實際完成時間判定。
- 公開設定或切換歷史讀取失敗時回報錯誤，避免默默退回 T-10；選用階段缺快照時不借用其他階段。

## 舊紀錄待核對

賽事 1557418：公開 API 原推薦「小 2」，實際比分 2–2，保存結算卻為 side=over、result=win。已列入唯讀 SQL；本次未修改其歷史快照或結算。需先核對資料庫原始值，再修正結算。

## SQL 後的前台實測

1. 測試帳號 google_2d3cef6b6e2d 登入，核對一般會員仍無新增階段按鈕。
2. 記下有限額測試帳號餘額；T-10／T-2／T-15 每階段成功首次領取各扣一次。
3. 已進 T-15 時，分別測補領已保存的 T-2，以及直接領取 T-15。
4. 重看、連點、兩個分頁同時領同一階段，核對只扣一次且結果一致。
5. 沒快照／額度不足／停權／請求失敗時，核對提示、點數與歷史。
6. 傷停及先發確認來源狀態：有資料顯示內容，缺資料要說明，不能把空名單當作已確認無傷停。
7. 比對後台同場三階段盤口與賽果。公開階段設定維持現值，正式切換要另用可控測試環境驗證，避免影響正式公開紀錄。
8. 手機實際確認金／藍／紫按鈕、箭頭、補領、文字與結果頁切換。

尚未有對應實際賽事的項目標示待實場，不算通過。

## 重跑本機測試

```sh
npm install --prefix runtime @electric-sql/pglite
node tests/football-atomic.test.cjs
node tests/football-functional.test.cjs
node tests/football-ui.test.cjs
```

原子交易測試在本機建測試資料庫，不接觸正式會員。
