-- 足球各聯賽 T-10／T-2／T-15 覆蓋情況（唯讀，2026-11-15）
-- 目的：確認正式支援的 12 個聯賽中，哪些實際有產生特徵與 T-2／T-15 快照，
--       以及哪些不在支援清單的聯賽仍在消耗 API。
begin transaction read only;

with f as (
  select distinct on (fixture_id) fixture_id, league_id, kickoff_at
  from public.football_v2_shadow_feature_snapshots
  where kickoff_at >= now() - interval '21 days'
  order by fixture_id, captured_at desc
)
select
  f.league_id,
  case when f.league_id in (39,140,78,135,61,2,3,98,292,169,88,71) then '正式支援' else '不在清單' end as 清單,
  count(*) as 有特徵的場次,
  count(*) filter (where exists (select 1 from public.football_v2_shadow_stage_snapshots s where s.fixture_id = f.fixture_id and s.stage = 't2')) as 有T2,
  count(*) filter (where exists (select 1 from public.football_v2_shadow_stage_snapshots s where s.fixture_id = f.fixture_id and s.stage = 't15')) as 有T15,
  count(*) filter (where exists (select 1 from public.ai_prediction_snapshots a where a.fixture_id = f.fixture_id)) as 有正式T10
from f
group by f.league_id
order by 清單, f.league_id;

commit;
