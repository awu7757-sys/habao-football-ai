-- 2026-11-15：立即縮小足球賽程快取（可選）
-- 兩支 runner 部署新版後，快取會在 6 小時內自然縮小；執行本段可立刻生效。
-- 只刪除快取中「非 12 個支援聯賽」的比賽，不影響任何快照、會員或戰績資料。
begin;

update public.football_v2_shadow_fixture_calendar c
   set fixtures = coalesce((
         select jsonb_agg(e)
         from jsonb_array_elements(c.fixtures) e
         where (e#>>'{league,id}')::int in (39,140,78,135,61,2,3,88,98,292,169,71)
       ), '[]'::jsonb)
 where jsonb_typeof(c.fixtures) = 'array';

commit;

-- 驗證（唯讀）：大小應降到 0.01 MB 左右
select calendar_date, jsonb_array_length(fixtures) as 場次,
       round(octet_length(fixtures::text) / 1024.0 / 1024.0, 3) as 大小_MB
from public.football_v2_shadow_fixture_calendar
where calendar_date >= current_date - 1
order by calendar_date;
