-- HABAO｜NBA T-2／T-15 推薦命中率 × 信心分組（只讀，2026-11-16）
--
-- 目的：NBA T-2／T-15 的「信心」= 模型機率 max(p,1-p)×100，目前 ≥55 就推薦（獨贏、讓分、大小同一門檻）；
--       T-10 的「信心」是另一套綜合分數（獨贏 ≥70 且勝率 ≥55 才推）。先用已完賽資料看 T-2／T-15 各信心區間的實際命中率，
--       再決定階段門檻要怎麼統一。只讀取，不修改任何資料。
-- 用法：Supabase → SQL Editor 貼上 Run → Export CSV 回傳。
-- 比分取自 T-10 正式快照（basketball_prediction_snapshots.final_score，格式「主-客」）；只算準時擷取（scheduled）的階段快照。

with games as (
  select b.game_id,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[1]::int as hs,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[2]::int as as_
  from public.basketball_prediction_snapshots b
  where b.status = 'verified' and b.final_score ~ '\d+\D+\d+'
),
recs as (
  select s.game_id, s.stage, s.fixture_time, g.hs, g.as_, m.market,
         s.result_data->'analysis'->'recommendations'->m.market->>'pick' as pick,
         nullif(s.result_data->'analysis'->'recommendations'->m.market->>'line', '')::numeric as line,
         nullif(s.result_data->'analysis'->'recommendations'->m.market->>'confidence', '')::numeric as conf
  from public.basketball_v2_stage_snapshots s
  join games g on g.game_id = s.game_id
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(market)
  where s.status = 'ready' and s.result_data is not null
    and coalesce(s.source_meta->>'capture_mode', 'scheduled') = 'scheduled'
),
graded as (
  select *,
    case
      when pick is null or pick = '暫不推薦' then null
      when market = 'moneyline' then case when (pick = '主隊' and hs > as_) or (pick = '客隊' and as_ > hs) then 1 else 0 end
      when market = 'handicap' and line is not null then
        case sign(case when pick = '主隊' then hs + line - as_ else as_ + line - hs end) when 1 then 1 when -1 then 0 end
      when market = 'over_under' and line is not null then
        case sign(case when pick = '大' then hs + as_ - line else line - hs - as_ end) when 1 then 1 when -1 then 0 end
    end as hit,
    case when conf >= 70 then '70+' when conf >= 65 then '65-69' when conf >= 60 then '60-64' when conf >= 55 then '55-59' else '<55' end as bucket
  from recs
)
select case stage when 't2' then 'T-2' else 'T-15' end as 階段,
       case market when 'moneyline' then '獨贏' when 'handicap' then '讓分' else '大小' end as 玩法,
       bucket as 信心區間,
       count(*) filter (where hit is not null) as 推薦場數,
       round(100.0 * avg(hit) filter (where hit is not null), 1) as 命中率,
       count(*) filter (where pick = '暫不推薦') as 暫不推薦場數,
       to_char(min(fixture_time) at time zone 'Asia/Taipei', 'MM/DD') || '–' || to_char(max(fixture_time) at time zone 'Asia/Taipei', 'MM/DD') as 日期範圍
from graded
group by stage, market, bucket
order by stage desc, case market when 'moneyline' then 1 when 'handicap' then 2 else 3 end, bucket;
