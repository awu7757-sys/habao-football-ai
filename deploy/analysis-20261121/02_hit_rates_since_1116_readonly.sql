-- HABAO｜11/16 起各球類 × 階段 × 玩法命中率（只讀，2026-11-21）
-- 包含：足球 T-10（正式公開快照結算）、NBA T-10（正式公開快照結算）、NBA T-2／T-15（階段快照推薦 × 最終比分）。
-- 足球 T-2／T-15 的推薦是在會員領取時才計算，需另跑 deploy/analysis-20261115/03 匯出後由 Claude 重算。
-- 命中率：贏 1、贏半 0.5、輸半／輸 0；走盤與暫不推薦不計入。只讀取，不修改任何資料。

with win as (select timestamptz '2026-11-16 00:00:00+08' as f),
t10 as (
  select '足球' as sport, s.settlement as st from public.ai_prediction_snapshots s, win
  where s.status = 'verified' and coalesce(s.excluded_from_public, false) = false and s.kickoff_at >= win.f
  union all
  select 'NBA', b.settlement from public.basketball_prediction_snapshots b, win
  where b.status = 'verified' and coalesce(b.excluded_from_public, false) = false and b.fixture_time >= win.f
),
t10_res as (
  select sport, 'T-10' as stage, m.market,
         case when jsonb_typeof(st->m.market) = 'object' then
                case when st->m.market->>'decided' = 'false' then 'no_pick'
                     else lower(coalesce(st->m.market->>'result', st->m.market->>'status')) end
              when jsonb_typeof(st->m.market) = 'string' then lower(st->>m.market) end as res
  from t10 cross join (values ('moneyline'), ('handicap'), ('over_under'), ('btts')) as m(market)
),
games as (
  select b.game_id,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[1]::int as hs,
         (regexp_match(b.final_score, '(\d+)\D+(\d+)'))[2]::int as as_
  from public.basketball_prediction_snapshots b, win
  where b.status = 'verified' and b.final_score ~ '\d+\D+\d+' and b.fixture_time >= win.f
),
nba_stage as (
  select case s.stage when 't2' then 'T-2' else 'T-15' end as stage, m.market, g.hs, g.as_,
         s.result_data->'analysis'->'recommendations'->m.market->>'pick' as pick,
         nullif(s.result_data->'analysis'->'recommendations'->m.market->>'line', '')::numeric as line
  from public.basketball_v2_stage_snapshots s
  join games g on g.game_id = s.game_id
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(market)
  where s.status = 'ready' and s.stage in ('t2', 't15') and s.result_data is not null
),
nba_stage_res as (
  select 'NBA' as sport, stage, market,
    case
      when pick is null or pick = '暫不推薦' then 'no_pick'
      when market = 'moneyline' then case when (pick = '主隊' and hs > as_) or (pick = '客隊' and as_ > hs) then 'win' else 'loss' end
      when line is null then 'no_pick'
      when market = 'handicap' then case sign(case when pick = '主隊' then hs + line - as_ else as_ + line - hs end) when 1 then 'win' when -1 then 'loss' else 'push' end
      else case sign(case when pick = '大' then hs + as_ - line else line - hs - as_ end) when 1 then 'win' when -1 then 'loss' else 'push' end
    end as res
  from nba_stage
),
allres as (select * from t10_res union all select * from nba_stage_res)
select sport as 球類, stage as 階段,
       case market when 'moneyline' then '獨贏' when 'handicap' then '讓分' when 'over_under' then '大小分' else 'BTTS' end as 玩法,
       count(*) filter (where res in ('win','half_win','loss','half_loss')) as 推薦場數,
       sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) as 命中,
       round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end)
             / nullif(count(*) filter (where res in ('win','half_win','loss','half_loss')), 0), 1) as 命中率,
       count(*) filter (where res = 'push') as 走盤,
       count(*) filter (where res is null or res not in ('win','half_win','loss','half_loss','push')) as 暫不推薦或未結算
from allres
where not (sport = 'NBA' and market = 'btts')
group by sport, stage, market
order by sport desc, case stage when 'T-10' then 1 when 'T-2' then 2 else 3 end,
         case market when 'moneyline' then 1 when 'handicap' then 2 when 'over_under' then 3 else 4 end;
