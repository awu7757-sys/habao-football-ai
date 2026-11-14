-- 足球 T-2／T-15 沒產生的原因（唯讀，2026-11-15）
-- 依聯賽、階段、最後狀態與原因代碼統計近 21 天的擷取稽核紀錄。
begin transaction read only;

with f as (
  select distinct on (fixture_id) fixture_id, league_id
  from public.football_v2_shadow_feature_snapshots
  where kickoff_at >= now() - interval '21 days'
  order by fixture_id, captured_at desc
)
select f.league_id, a.stage, a.status, a.reason_code, a.terminal,
       count(*) as 場次,
       max(a.attempts) as 最多嘗試次數,
       left(min(a.detail::text), 300) as 範例細節
from f
join public.football_v2_shadow_stage_audit a on a.fixture_id = f.fixture_id
where a.stage in ('t2','t15')
group by f.league_id, a.stage, a.status, a.reason_code, a.terminal
order by f.league_id, a.stage, 場次 desc;

commit;
