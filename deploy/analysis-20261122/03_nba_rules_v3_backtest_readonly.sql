-- HABAO｜NBA 推薦規則 V3 逐場回算（只讀，2026-11-22，Claude；依 GPT 審查 R1～R3 修正）
--
-- 和 01／02 的差別：
--   R1 各階段只用「自己當時封存」的盤口判斷熱門；T-10 依正式程式 primary 優先、主客一致才用，否則退回 consensus；
--      缺盤口就標示無法判定，不向後補。
--   R2 逐筆套完整規則，直接算出保留的勝／負／走水，以及被擋掉的是贏還是輸，不再用上下限推估。
--   R3 T-2／T-15 只收 capture_mode = scheduled（補抓不列入）。所以數字不能和 01／02 的 CSV 當同一批比。
--
-- T-2／T-15 獨贏和 T-10 的關係，兩種方案都算出來（第 2 題尚待使用者決定）：
--   嚴格：T-10（套新規則後）沒有正式方向 → 也不推。
--   寬鬆：只有 T-10 有正式方向且相反時才擋；T-10 沒推 → 依自己的資格與熱門條件判斷。
-- T-10 方向一律用「套新規則後」的 T-10，和未來正式執行一致（R6）。
--
-- 盤口差距用未取整的值判斷。T-2／T-15 信心＝已存的取整模型機率（現行口徑），>=70。
-- NBA 盤線是 .5 或整數，沒有四分之一盤；整數盤剛好打平算走水。
-- 期間：2026-11-13 起已驗證。只讀取，不修改任何資料。
-- 使用方式：Supabase → SQL Editor 整段貼上按 Run → Export CSV 回傳。

with win as (select timestamptz '2026-11-13 00:00:00+08' as f),
num as (select '^-?[0-9]+(\.[0-9]+)?$'::text as re),
games as (
  select b.game_id, b.settlement, b.prediction_data as pd,
         coalesce(b.prediction_data->'analysis'->'recommendations', b.prediction_data->'recommendations',
                  b.prediction_data->'prediction'->'analysis'->'recommendations') as rec,
         coalesce(b.prediction_data->'market_data'->'market', b.prediction_data->'prediction'->'market_data'->'market') as mk,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[1]::int as hs,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[2]::int as as_
  from public.basketball_prediction_snapshots b, win
  where b.status = 'verified' and coalesce(b.excluded_from_public, false) = false
    and b.final_score ~ '\d+\D+\d+' and b.fixture_time >= win.f
),
-- T-10 自己的盤口（同 basketball-analysis buildFixedRecommendations：|讓分|<=60，主客一致，primary 優先）
t10mk as (
  select g.*,
    case when g.mk->'primary'->>'home_spread' ~ n.re and abs((g.mk->'primary'->>'home_spread')::numeric) <= 60 then (g.mk->'primary'->>'home_spread')::numeric end as ph,
    case when g.mk->'primary'->>'away_spread' ~ n.re and abs((g.mk->'primary'->>'away_spread')::numeric) <= 60 then (g.mk->'primary'->>'away_spread')::numeric end as pa,
    case when g.mk->'consensus'->>'home_spread' ~ n.re and abs((g.mk->'consensus'->>'home_spread')::numeric) <= 60 then (g.mk->'consensus'->>'home_spread')::numeric end as ch,
    case when g.mk->'consensus'->>'away_spread' ~ n.re and abs((g.mk->'consensus'->>'away_spread')::numeric) <= 60 then (g.mk->'consensus'->>'away_spread')::numeric end as ca,
    case when g.pd->'model'->>'fair_total' ~ n.re then (g.pd->'model'->>'fair_total')::numeric
         when g.pd->'prediction'->'model'->>'fair_total' ~ n.re then (g.pd->'prediction'->'model'->>'fair_total')::numeric end as model_total
  from games g, num n
),
t10 as (
  select 'T-10'::text as stage, 1 as stage_order, t.game_id, m.market, t.hs, t.as_,
         t.rec->m.market->>'pick' as pick,
         case when t.rec->m.market->>'line' ~ n.re then (t.rec->m.market->>'line')::numeric end as line,
         case when t.rec->m.market->>'confidence' ~ n.re then (t.rec->m.market->>'confidence')::numeric end as conf,
         case when (t.ph is not null or t.pa is not null) and (t.ph is null or t.pa is null or abs(t.ph + t.pa) <= 0.01)
                then coalesce(t.ph, -t.pa)
              when (t.ch is not null or t.ca is not null) and (t.ch is null or t.ca is null or abs(t.ch + t.ca) <= 0.01)
                then coalesce(t.ch, -t.ca) end as home_spread,
         t.model_total,
         case when jsonb_typeof(t.settlement->m.market) = 'object' then
                case when t.settlement->m.market->>'decided' = 'false' then 'no_pick'
                     else lower(coalesce(t.settlement->m.market->>'result', t.settlement->m.market->>'status')) end
              when jsonb_typeof(t.settlement->m.market) = 'string' then lower(t.settlement->>m.market) end as res
  from t10mk t cross join num n cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(market)
),
stg as (
  select case s.stage when 't2' then 'T-2' else 'T-15' end as stage, case s.stage when 't2' then 2 else 3 end as stage_order,
         g.game_id, m.market, g.hs, g.as_,
         r->m.market->>'pick' as pick,
         case when r->m.market->>'line' ~ n.re then (r->m.market->>'line')::numeric end as line,
         case when r->m.market->>'confidence' ~ n.re then (r->m.market->>'confidence')::numeric end as conf,
         case when s.result_data->'market_data'->'market'->'consensus'->>'home_spread' ~ n.re
              then (s.result_data->'market_data'->'market'->'consensus'->>'home_spread')::numeric end as home_spread,
         case when s.result_data->'model'->>'expected_total' ~ n.re then (s.result_data->'model'->>'expected_total')::numeric end as model_total
  from public.basketball_v2_stage_snapshots s
  join games g on g.game_id = s.game_id
  cross join num n
  cross join lateral (select s.result_data->'analysis'->'recommendations' as r) x
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(market)
  where s.status = 'ready' and s.stage in ('t2', 't15') and s.result_data is not null
    and coalesce(s.source_meta->>'capture_mode', s.result_data->'stage_capture'->>'capture_mode',
                 s.result_data->'analysis'->'v2_stage_evidence'->>'capture_mode') = 'scheduled'
),
stg_res as (
  select s.*,
    case
      when pick is null or pick = '暫不推薦' then 'no_pick'
      when market = 'moneyline' then case when (pick = '主隊' and hs > as_) or (pick = '客隊' and as_ > hs) then 'win' else 'loss' end
      when line is null then 'no_pick'
      when market = 'handicap' then case sign(case when pick = '主隊' then hs + line - as_ else as_ + line - hs end) when 1 then 'win' when -1 then 'loss' else 'push' end
      else case sign(case when pick = '大' then hs + as_ - line else line - hs - as_ end) when 1 then 'win' when -1 then 'loss' else 'push' end
    end as res
  from stg s
),
allp as (
  select stage, stage_order, game_id, market, pick, line, conf, home_spread, model_total, res from t10
  union all
  select stage, stage_order, game_id, market, pick, line, conf, home_spread, model_total, res from stg_res
),
p as (
  select a.*,
    case when a.pick ~ '主' then 'home' when a.pick ~ '客' then 'away' end as side,
    case when a.home_spread < 0 then 'home' when a.home_spread > 0 then 'away' end as fav_side,
    case when a.model_total is not null and a.line is not null then abs(a.model_total - a.line) end as gap
  from allp a
  where a.res in ('win','half_win','loss','half_loss','push')   -- 舊規則有正式推薦且已結算
),
-- 套新規則後的 T-10 獨贏方向（只看熱門條件）
t10new as (
  select game_id, case when fav_side is not null and side = fav_side then side end as t10_side
  from p where stage = 'T-10' and market = 'moneyline'
),
ruled as (
  select p.*, t.t10_side,
    -- 共同條件（兩種方案相同）：熱門、讓分信心、大小分差距
    case
      when p.market = 'moneyline' and p.fav_side is null then 'favorite_unknown'
      when p.market = 'moneyline' and p.side is distinct from p.fav_side then 'underdog_pick'
      when p.market = 'handicap' and p.stage <> 'T-10' and (p.conf is null or p.conf < 70) then 'low_confidence'
      when p.market = 'over_under' and p.gap is null then 'gap_unknown'
      when p.market = 'over_under' and p.gap >= 6 then 'edge_too_large'
    end as base_block,
    case when p.market = 'moneyline' and p.stage <> 'T-10' and t.t10_side is not null and t.t10_side <> p.side then 'conflict_with_t10' end as conflict_block,
    case when p.market = 'moneyline' and p.stage <> 'T-10' and t.t10_side is null then 't10_not_qualified' end as t10none_block
  from p left join t10new t on t.game_id = p.game_id
),
variants as (
  select stage, stage_order, game_id, market, res, '1 舊規則'::text as rule, null::text as block from ruled
  union all
  select stage, stage_order, game_id, market, res,
         case when market = 'moneyline' and stage <> 'T-10' then '2 新規則（嚴格：T-10 沒推也不推）' else '2 新規則' end,
         coalesce(base_block, conflict_block, t10none_block) from ruled
  union all
  select stage, stage_order, game_id, market, res, '3 新規則（寬鬆：T-10 沒推可獨立判斷）', coalesce(base_block, conflict_block)
  from ruled where market = 'moneyline' and stage <> 'T-10'
  union all
  select stage, stage_order, game_id, market, res, '4 挑戰規則（差距 < 3）',
         case when gap is null then 'gap_unknown' when gap >= 3 then 'challenger_gap' end
  from ruled where market = 'over_under' and stage <> 'T-10'
)
select stage as 階段,
       case market when 'moneyline' then '獨贏' when 'handicap' then '讓分' else '大小分' end as 玩法,
       rule as 規則,
       count(distinct game_id) filter (where block is null) as 保留賽事數,
       count(*) filter (where block is null and res in ('win','half_win')) as 勝,
       count(*) filter (where block is null and res in ('loss','half_loss')) as 負,
       count(*) filter (where block is null and res = 'push') as 走水,
       round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) filter (where block is null and res <> 'push')
             / nullif(count(*) filter (where block is null and res <> 'push'), 0), 1) as 命中率,
       count(*) filter (where block is not null and res in ('win','half_win')) as 被擋_原本贏,
       count(*) filter (where block is not null and res in ('loss','half_loss')) as 被擋_原本輸,
       string_agg(distinct block, ' / ') filter (where block is not null) as 擋下原因
from variants
group by stage, stage_order, market, rule
order by stage_order, case market when 'moneyline' then 1 when 'handicap' then 2 else 3 end, rule;
