-- 三球類 T-10／T-2／T-15 快照「準時度」與「遺漏」盤點（唯讀，2026-11-15）
-- 目的：確認系統是否都能自己準時建立快照，以及有多少場是晚建、靠會員補位或完全沒建。
-- 範圍：足球、NBA 近 14 天；MLB 因休賽改看近 60 天。
begin transaction read only;

with
fb_t10 as (
  select extract(epoch from (kickoff_at - created_at)) / 3600.0 as h
  from public.ai_prediction_snapshots
  where kickoff_at >= now() - interval '14 days' and kickoff_at < now()
),
nba_t10 as (
  select extract(epoch from (fixture_time - generated_at)) / 3600.0 as h, source
  from public.basketball_prediction_snapshots
  where fixture_time >= now() - interval '14 days' and fixture_time < now()
),
mlb_t10 as (
  select extract(epoch from (kickoff_at - coalesce(analyzed_at, created_at))) / 3600.0 as h, record_source
  from public.baseball_t10_snapshots
  where kickoff_at >= now() - interval '60 days' and kickoff_at < now()
),
nba_games as (
  select distinct coalesce(e->>'id', e#>>'{game,id}', e#>>'{fixture,id}') as gid
  from public.basketball_fixture_cache c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.fixtures) = 'array' then c.fixtures else '[]'::jsonb end) e
  where c.fixture_date >= (now() - interval '14 days')::date and c.fixture_date < now()::date
)
select '足球' as 球類, 'T-10 建立時間（距開賽）' as 項目,
  jsonb_build_object('總數', count(*),
    '準時_9.5到10.5小時', count(*) filter (where h between 9.5 and 10.5),
    '偏晚_2到9.5小時', count(*) filter (where h >= 2 and h < 9.5),
    '很晚_少於2小時', count(*) filter (where h < 2),
    '早於10.5小時', count(*) filter (where h > 10.5)) as 結果
from fb_t10
union all
select '足球', 'T-10 補抓佇列狀態（近14天開賽）',
  coalesce((select jsonb_object_agg(state, n) from (
    select state, count(*) n from public.habao_t10_retry_queue
    where kickoff_at >= now() - interval '14 days' and kickoff_at < now() group by state) q), '{}'::jsonb)
union all
select '足球', 'T-2／T-15 擷取方式',
  coalesce((select jsonb_object_agg(k, n) from (
    select stage || ':' || coalesce(source_meta->>'capture_mode','unknown') as k, count(*) n
    from public.football_v2_shadow_stage_snapshots
    where kickoff_at >= now() - interval '14 days' and kickoff_at < now() group by 1) q), '{}'::jsonb)
union all
select 'NBA', 'T-10 建立時間（距開賽）',
  jsonb_build_object('總數', count(*),
    '準時_9.5到10.5小時', count(*) filter (where h between 9.5 and 10.5),
    '偏晚_8到9.5小時', count(*) filter (where h >= 8 and h < 9.5),
    '太晚_少於8小時_會讓T2T15無法建立', count(*) filter (where h < 8),
    '早於10.5小時', count(*) filter (where h > 10.5),
    '來源', (select jsonb_object_agg(coalesce(source,'null'), n) from (select source, count(*) n from nba_t10 group by source) s))
from nba_t10
union all
select 'NBA', '賽程場次 vs 有 T-10 的場次（近14天）',
  jsonb_build_object('賽程快取場次', (select count(*) from nba_games where gid is not null),
    '有T10', (select count(*) from nba_t10))
union all
select 'NBA', 'T-2／T-15 狀態與準時度',
  coalesce((select jsonb_object_agg(k, n) from (
    select stage || ':' || status || ':' ||
      case when captured_at is null then 'no_capture'
           when stage='t2'  and extract(epoch from (fixture_time - captured_at))/60 between 110 and 121 then 'on_time'
           when stage='t15' and extract(epoch from (fixture_time - captured_at))/60 between 5 and 16 then 'on_time'
           else 'late_or_early' end as k, count(*) n
    from public.basketball_v2_stage_snapshots
    where fixture_time >= now() - interval '14 days' and fixture_time < now() group by 1) q), '{}'::jsonb)
union all
select 'MLB', 'T-10 建立時間（距開賽，近60天）',
  jsonb_build_object('總數', count(*),
    '準時_9.5到10.5小時', count(*) filter (where h between 9.5 and 10.5),
    '偏晚_8到9.5小時', count(*) filter (where h >= 8 and h < 9.5),
    '太晚_少於8小時', count(*) filter (where h < 8),
    '早於10.5小時', count(*) filter (where h > 10.5),
    '來源', (select jsonb_object_agg(coalesce(record_source,'null'), n) from (select record_source, count(*) n from mlb_t10 group by record_source) s))
from mlb_t10
union all
select 'MLB', 'T-2／T-15 狀態（近60天）',
  coalesce((select jsonb_object_agg(k, n) from (
    select stage || ':' || status as k, count(*) n
    from public.baseball_v2_stage_snapshots
    where fixture_time >= now() - interval '60 days' and fixture_time < now() group by 1) q), '{}'::jsonb);

commit;
