-- 足球 T-2／T-15 依開賽日期統計（唯讀，2026-11-15）
-- 前一份查詢顯示：沒有 T-2／T-15 的場次「完全沒有擷取紀錄」，代表程式根本沒處理那些場次。
-- 本查詢依台灣日期列出：每天有特徵的場次、有擷取紀錄的場次、有 T-2／T-15 的場次，
-- 用來判斷是「上線前的舊比賽」還是「上線後漏抓」。
begin transaction read only;

with f as (
  select distinct on (fixture_id) fixture_id, league_id, kickoff_at
  from public.football_v2_shadow_feature_snapshots
  where kickoff_at >= now() - interval '21 days'
  order by fixture_id, captured_at desc
)
select (f.kickoff_at at time zone 'Asia/Taipei')::date as 開賽日_台灣,
       count(*) as 有特徵,
       count(*) filter (where exists (select 1 from public.football_v2_shadow_stage_audit a where a.fixture_id = f.fixture_id and a.stage in ('t2','t15'))) as 有擷取紀錄,
       count(*) filter (where exists (select 1 from public.football_v2_shadow_stage_snapshots s where s.fixture_id = f.fixture_id and s.stage = 't2')) as 有T2,
       count(*) filter (where exists (select 1 from public.football_v2_shadow_stage_snapshots s where s.fixture_id = f.fixture_id and s.stage = 't15')) as 有T15,
       string_agg(distinct f.league_id::text, ',') as 聯賽
from f
group by 1
order by 1;

commit;
