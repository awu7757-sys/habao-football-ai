-- HABAO｜MLB 公開戰績「排除／刪除」（2026-11-15，使用者同意）
--
-- 在 baseball_verified_results 加三個欄位，與足球／NBA 的排除做法一致：
--   excluded_from_public：排除後不計入公開戰績，後台仍看得到、可恢復。
--   excluded_at：排除時間。
--   deleted_at：後台按「刪除」時寫入（軟刪除）。前台與後台都不再顯示。
--     不直接刪掉資料列，因為 baseball-result-runner 每 30 分鐘會把「沒有驗證結果」的場次補回來；
--     保留資料列並標記刪除，才不會被自動補回。
--
-- 只新增欄位、預設值不影響現有資料；在 Supabase → SQL Editor 整段執行一次。
-- 必須先執行本 SQL，再部署 baseball-performance-api 與 admin-baseball。

alter table public.baseball_verified_results
  add column if not exists excluded_from_public boolean not null default false,
  add column if not exists excluded_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- 驗證（只讀）：三個欄位都應出現，且目前排除／刪除筆數都是 0。
-- select count(*) as 總筆數,
--        count(*) filter (where excluded_from_public) as 已排除,
--        count(*) filter (where deleted_at is not null) as 已刪除
-- from public.baseball_verified_results;
