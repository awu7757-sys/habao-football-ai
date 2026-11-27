-- HABAO｜NBA 新規則（V3）上線後命中率（只讀，2026-11-27，Claude）
-- 範圍：2026-11-24 00:00（台灣時間）以後開賽、已驗證、未排除的比賽。
-- 新規則 = 會員實際看到的正式推薦；舊規則 = 同一場的 pre_rule（假設沒改規則會推什麼）。
-- T-2／T-15 只算準時封存（scheduled）的快照。命中率不計走水。NBA 沒有四分之一盤，用比分直接結算。
-- 使用方式：Supabase → SQL Editor 整段貼上 → Run → Export CSV。不修改任何資料。

with since as (select timestamptz '2026-11-24 00:00:00+08' as f),
games as (
  select b.game_id, b.final_home::int as h, b.final_away::int as a, b.prediction_data as pd
  from public.basketball_prediction_snapshots b, since
  where b.fixture_time >= since.f and b.status = 'verified' and coalesce(b.excluded_from_public, false) = false
    and b.final_home is not null and b.final_away is not null and b.final_home <> b.final_away
),
recs as (
  select 'T-10'::text as stage, 1 as so, g.game_id, g.h, g.a, m.k as market,
         coalesce(g.pd->'analysis'->'recommendations', g.pd->'recommendations') -> m.k as rec
  from games g cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(k)
  union all
  select case s.stage when 't2' then 'T-2' else 'T-15' end, case s.stage when 't2' then 2 else 3 end, g.game_id, g.h, g.a, m.k,
         s.result_data->'analysis'->'recommendations'->m.k
  from public.basketball_v2_stage_snapshots s
  join games g on g.game_id = s.game_id
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(k)
  where s.status = 'ready' and s.stage in ('t2', 't15')
    and coalesce(s.source_meta->>'capture_mode', s.result_data->'stage_capture'->>'capture_mode') = 'scheduled'
),
two as (
  select stage, so, market, game_id, h, a, 'new' as r, rec->>'pick' as pick, rec->>'line' as line from recs where rec is not null
  union all
  select stage, so, market, game_id, h, a, 'old', coalesce(rec->'pre_rule'->>'pick', rec->>'pick'), coalesce(rec->'pre_rule'->>'line', rec->>'line')
  from recs where rec is not null
),
graded as (
  select t.*,
    case
      when pick is null or pick = '暫不推薦' then null
      when market = 'moneyline' then case when (pick = '主隊' and h > a) or (pick = '客隊' and a > h) then 'W' else 'L' end
      when line is null or line !~ '^-?[0-9]+(\.[0-9]+)?$' then null
      when market = 'handicap' then case sign(case when pick = '主隊' then h + line::numeric - a else a + line::numeric - h end) when 1 then 'W' when -1 then 'L' else 'P' end
      else case sign(case when pick = '大' then h + a - line::numeric else line::numeric - h - a end) when 1 then 'W' when -1 then 'L' else 'P' end
    end as res
  from two t
),
paired as (
  select n.stage, n.so, n.market, n.res as new_res, o.res as old_res
  from graded n join graded o on o.stage = n.stage and o.market = n.market and o.game_id = n.game_id and o.r = 'old'
  where n.r = 'new'
)
select stage as 階段,
       case market when 'handicap' then '讓分' when 'over_under' then '大小分' else '獨贏' end as 玩法,
       count(*) filter (where new_res = 'W') as 新_勝,
       count(*) filter (where new_res = 'L') as 新_負,
       count(*) filter (where new_res = 'P') as 新_走,
       round(100.0 * count(*) filter (where new_res = 'W') / nullif(count(*) filter (where new_res in ('W','L')), 0), 1) as 新_命中率,
       count(*) filter (where old_res = 'W') as 舊_勝,
       count(*) filter (where old_res = 'L') as 舊_負,
       round(100.0 * count(*) filter (where old_res = 'W') / nullif(count(*) filter (where old_res in ('W','L')), 0), 1) as 舊_命中率,
       count(*) filter (where old_res = 'W' and new_res is null) as 擋下_原本贏,
       count(*) filter (where old_res = 'L' and new_res is null) as 擋下_原本輸
from paired
group by stage, so, market
order by so, case market when 'handicap' then 1 when 'over_under' then 2 else 3 end;
