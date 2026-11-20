-- HABAO｜每日 T-10／T-2／T-15 快照覆蓋檢查（只讀，2026-11-21）
-- 範圍：11/16 00:00（台灣）起、已開賽的比賽。每列＝某球類某一天：總場數、各階段有資料的場數、缺漏的賽事 ID。
-- T-10：足球 ai_prediction_snapshots、NBA basketball_prediction_snapshots、MLB baseball_t10_snapshots。
-- T-2／T-15：各球類 v2 階段快照（NBA／MLB 只算 status=ready；足球階段表有列即算）。
-- 只讀取，不修改任何資料。Supabase → SQL Editor 貼上 Run → 截圖或 Export CSV。

with win as (select timestamptz '2026-11-16 00:00:00+08' as f, now() as t),
fb as (
  select fixture_id as id, kickoff_at as k, 't10' as stage from public.ai_prediction_snapshots, win where kickoff_at >= win.f and kickoff_at < win.t
  union all
  select fixture_id, kickoff_at, stage from public.football_v2_shadow_stage_snapshots, win where stage in ('t2','t15') and kickoff_at >= win.f and kickoff_at < win.t
),
nba as (
  select game_id as id, fixture_time as k, 't10' as stage from public.basketball_prediction_snapshots, win where fixture_time >= win.f and fixture_time < win.t
  union all
  select game_id, fixture_time, stage from public.basketball_v2_stage_snapshots, win where status = 'ready' and stage in ('t2','t15') and fixture_time >= win.f and fixture_time < win.t
),
mlb as (
  select game_id as id, kickoff_at as k, 't10' as stage from public.baseball_t10_snapshots, win where kickoff_at >= win.f and kickoff_at < win.t
  union all
  select game_id, fixture_time, stage from public.baseball_v2_stage_snapshots, win where status = 'ready' and stage in ('t2','t15') and fixture_time >= win.f and fixture_time < win.t
),
allrows as (
  select '足球' as sport, * from fb union all select 'NBA', * from nba union all select 'MLB', * from mlb
),
per_game as (
  select sport, id, (min(k) at time zone 'Asia/Taipei')::date as day,
         bool_or(stage = 't10') as t10, bool_or(stage = 't2') as t2, bool_or(stage = 't15') as t15
  from allrows group by sport, id
)
select sport as 球類, to_char(day, 'MM/DD') as 日期, count(*) as 總場數,
       count(*) filter (where t10) as 有T10, count(*) filter (where t2) as 有T2, count(*) filter (where t15) as 有T15,
       count(*) filter (where t10 and t2 and t15) as 三階段齊全,
       coalesce(string_agg(id::text || '缺' || concat_ws('/', case when not t10 then 'T10' end, case when not t2 then 'T2' end, case when not t15 then 'T15' end), '、')
                filter (where not (t10 and t2 and t15)), '—') as 缺漏賽事
from per_game
group by sport, day
order by sport, day;
