-- HABAO｜NBA 大小分：模型總分與盤口差距 × 命中率（只讀，2026-11-22，Claude）
--
-- 目的：大小分「信心越高越不準」。看模型總分與盤口差幾分時最準、差多少開始不可靠，
--       以決定「差距太大就不推」或「把模型總分往盤口拉近」的門檻。
-- 期間：2026-11-13 起已驗證比賽。命中：贏 1、輸 0；走盤、暫不推薦不計。只讀取。

with win as (select timestamptz '2026-11-13 00:00:00+08' as f),
games as (
  select b.game_id, b.prediction_data as pd,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[1]::int + (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[2]::int as total_pts
  from public.basketball_prediction_snapshots b, win
  where b.status = 'verified' and coalesce(b.excluded_from_public, false) = false
    and b.final_score ~ '\d+\D+\d+' and b.fixture_time >= win.f
),
picks as (
  select 'T-10'::text as stage, g.total_pts,
         coalesce(g.pd->'analysis'->'recommendations', g.pd->'recommendations', g.pd->'prediction'->'analysis'->'recommendations')->'over_under'->>'pick' as pick,
         nullif(coalesce(g.pd->'analysis'->'recommendations', g.pd->'recommendations', g.pd->'prediction'->'analysis'->'recommendations')->'over_under'->>'line', '')::numeric as line,
         coalesce(nullif(g.pd->'model'->>'expected_total',''), nullif(g.pd->'model'->>'fair_total',''),
                  nullif(g.pd->'prediction'->'model'->>'expected_total',''))::numeric as model_total
  from games g
  union all
  select case s.stage when 't2' then 'T-2' else 'T-15' end, g.total_pts,
         s.result_data->'analysis'->'recommendations'->'over_under'->>'pick',
         nullif(s.result_data->'analysis'->'recommendations'->'over_under'->>'line', '')::numeric,
         coalesce(nullif(s.result_data->'model'->>'expected_total',''), nullif(s.result_data->'model'->>'fair_total',''))::numeric
  from public.basketball_v2_stage_snapshots s join games g on g.game_id = s.game_id
  where s.status = 'ready' and s.stage in ('t2','t15') and s.result_data is not null
),
graded as (
  select stage, abs(model_total - line) as gap,
         case when (pick = '大' and total_pts > line) or (pick = '小' and total_pts < line) then 1
              when total_pts = line then null else 0 end as hit
  from picks
  where pick in ('大','小') and line is not null
)
select stage as 階段,
       case when gap is null then '無模型總分'
            when gap < 3 then '0-3 分' when gap < 6 then '3-6 分' when gap < 10 then '6-10 分'
            when gap < 15 then '10-15 分' else '15 分以上' end as 模型與盤口差距,
       count(hit) as 場數, sum(hit) as 命中, round(100.0 * sum(hit) / nullif(count(hit), 0), 1) as 命中率
from graded
group by 1, 2
order by case stage when 'T-10' then 1 when 'T-2' then 2 else 3 end, min(coalesce(gap, 999));
