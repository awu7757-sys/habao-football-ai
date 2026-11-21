-- HABAO｜NBA 命中率 × 信心區間 × 推薦方向（只讀，2026-11-22，Claude）
--
-- 回答三個問題：
--   A. 信心越高，命中率是否越高？（T-10／T-2／T-15 × 獨贏／讓分／大小分 × 信心區間）
--   B. 獨贏推「熱門」與推「冷門」的命中率差多少？（熱門＝本階段封存盤口讓分較多的一方）
--   C. T-2／T-15 獨贏跟 T-10 同方向 vs 反方向，命中率差多少？
--
-- 期間：2026-11-13（T-2／T-15 上線）起、已驗證的比賽。
-- 命中：贏 1、贏半 0.5、輸半／輸 0；走盤、暫不推薦不計。只讀取，不修改任何資料。
-- 使用方式：Supabase → SQL Editor 整段貼上按 Run，把結果截圖或 Export CSV 回傳。

with win as (select timestamptz '2026-11-13 00:00:00+08' as f),
games as (
  select b.game_id, b.settlement,
         coalesce(b.prediction_data->'analysis'->'recommendations', b.prediction_data->'recommendations',
                  b.prediction_data->'prediction'->'analysis'->'recommendations') as t10rec,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[1]::int as hs,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[2]::int as as_
  from public.basketball_prediction_snapshots b, win
  where b.status = 'verified' and coalesce(b.excluded_from_public, false) = false
    and b.final_score ~ '\d+\D+\d+' and b.fixture_time >= win.f
),
-- 熱門方向：取該場 T-2 快照封存的盤口讓分（沒有就用 T-15）
fav as (
  select distinct on (s.game_id) s.game_id,
         nullif(s.result_data->'market_data'->'market'->'consensus'->>'home_spread', '')::numeric as home_spread
  from public.basketball_v2_stage_snapshots s
  where s.status = 'ready' and s.result_data is not null
  order by s.game_id, case s.stage when 't2' then 1 else 2 end
),
t10 as (
  select 'T-10'::text as stage, g.game_id, m.market, g.hs, g.as_,
         g.t10rec->m.market->>'pick' as pick,
         g.t10rec->m.market->>'confidence' as conf_raw,
         case when jsonb_typeof(g.settlement->m.market) = 'object' then
                case when g.settlement->m.market->>'decided' = 'false' then 'no_pick'
                     else lower(coalesce(g.settlement->m.market->>'result', g.settlement->m.market->>'status')) end
              when jsonb_typeof(g.settlement->m.market) = 'string' then lower(g.settlement->>m.market) end as res
  from games g cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(market)
),
stg as (
  select case s.stage when 't2' then 'T-2' else 'T-15' end as stage, g.game_id, m.market, g.hs, g.as_,
         s.result_data->'analysis'->'recommendations'->m.market->>'pick' as pick,
         s.result_data->'analysis'->'recommendations'->m.market->>'confidence' as conf_raw,
         nullif(s.result_data->'analysis'->'recommendations'->m.market->>'line', '')::numeric as line
  from public.basketball_v2_stage_snapshots s
  join games g on g.game_id = s.game_id
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(market)
  where s.status = 'ready' and s.stage in ('t2', 't15') and s.result_data is not null
),
stg_res as (
  select stage, game_id, market, pick, conf_raw,
    case
      when pick is null or pick = '暫不推薦' then 'no_pick'
      when market = 'moneyline' then case when (pick = '主隊' and hs > as_) or (pick = '客隊' and as_ > hs) then 'win' else 'loss' end
      when line is null then 'no_pick'
      when market = 'handicap' then case sign(case when pick = '主隊' then hs + line - as_ else as_ + line - hs end) when 1 then 'win' when -1 then 'loss' else 'push' end
      else case sign(case when pick = '大' then hs + as_ - line else line - hs - as_ end) when 1 then 'win' when -1 then 'loss' else 'push' end
    end as res
  from stg
),
allp as (
  select stage, game_id, market, pick, conf_raw, res from t10
  union all
  select stage, game_id, market, pick, conf_raw, res from stg_res
),
p as (
  select a.*,
         case when a.conf_raw ~ '^[0-9]+(\.[0-9]+)?$' then
                case when a.conf_raw::numeric <= 1 then a.conf_raw::numeric * 100 else a.conf_raw::numeric end end as conf,
         case when a.pick ~ '主' then 'home' when a.pick ~ '客' then 'away' end as side,
         case when a.res = 'win' then 1 when a.res = 'half_win' then 0.5 when a.res in ('loss','half_loss') then 0 end as pts,
         f.home_spread
  from allp a left join fav f on f.game_id = a.game_id
  where a.res in ('win','half_win','loss','half_loss')
),
t10side as (select game_id, side as t10_side from p where stage = 'T-10' and market = 'moneyline'),
r_all as (
  -- A. 信心區間
  select 'A 信心區間'::text as 分析, stage, market,
         case when conf is null then '無信心值' when conf < 55 then '<55' when conf < 60 then '55-59'
              when conf < 65 then '60-64' when conf < 70 then '65-69' when conf < 75 then '70-74' else '75+' end as 分組,
         pts
  from p
  union all
  -- B. 獨贏推熱門 vs 冷門
  select 'B 熱門/冷門', stage, market,
         case when home_spread is null or side is null then '無盤口/方向不明'
              when home_spread = 0 then '平手盤'
              when (home_spread < 0 and side = 'home') or (home_spread > 0 and side = 'away') then '推熱門'
              else '推冷門' end,
         pts
  from p where market = 'moneyline'
  union all
  -- C. T-2／T-15 獨贏與 T-10 同向 vs 反向
  select 'C 與T-10方向', p.stage, p.market,
         case when t.t10_side is null or p.side is null then 'T-10無推薦/不明'
              when t.t10_side = p.side then '與T-10同向' else '與T-10反向' end,
         p.pts
  from p left join t10side t on t.game_id = p.game_id
  where p.market = 'moneyline' and p.stage in ('T-2','T-15')
)
select 分析, stage as 階段,
       case market when 'moneyline' then '獨贏' when 'handicap' then '讓分' else '大小分' end as 玩法,
       分組, count(*) as 場數, sum(pts) as 命中,
       round(100.0 * sum(pts) / nullif(count(*), 0), 1) as 命中率
from r_all
group by 分析, stage, market, 分組
order by 分析, case stage when 'T-10' then 1 when 'T-2' then 2 else 3 end,
         case market when 'moneyline' then 1 when 'handicap' then 2 else 3 end, 分組;
