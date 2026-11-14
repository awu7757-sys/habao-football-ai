-- 流量（Egress）來源嫌疑檢查（唯讀，2026-11-15）
-- 足球兩個每分鐘排程（feature runner、stage runner）每次執行都會讀 3 天份的賽程快取。
-- 這份快取存的是 API-Football「全世界」當天所有比賽，不只 12 個支援聯賽。
-- 本查詢列出每天快取的大小，並估算兩個排程每天因此讀出的流量。
begin transaction read only;

select calendar_date,
       jsonb_array_length(fixtures) as 全部場次,
       (select count(*) from jsonb_array_elements(fixtures) e
         where (e#>>'{league,id}')::int in (39,140,78,135,61,2,3,88,98,292,169,71)) as 支援聯賽場次,
       round(octet_length(fixtures::text) / 1024.0 / 1024.0, 2) as 大小_MB,
       round(octet_length(fixtures::text) / 1024.0 / 1024.0 * 2 * 1440 / 1024.0, 2) as 估計每日讀取_GB_若兩排程每分鐘都讀
from public.football_v2_shadow_fixture_calendar
where calendar_date >= current_date - 1
order by calendar_date;

commit;
