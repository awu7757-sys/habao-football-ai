-- HABAO｜足球 T-10 公開戰績 10 月下旬後下滑原因（只讀，2026-11-15）
--
-- 只讀取，不修改任何資料。Supabase → SQL Editor 整段貼上按 Run，Export CSV 回傳。
-- 一次輸出一張表，「拆法」欄說明這列是用什麼方式拆開：
--   1 週別：每週各玩法命中率（看從哪一週開始掉）
--   2 模型版本：各版本各玩法命中率
--   3 大小方向：前期／後期，推薦「大」與「小」各自的命中率與比例
--   4 大小盤口：前期／後期，各盤口（2.5、2.75…）的命中率
--   5 聯賽：前期／後期，各聯賽大小命中率（場數 ≥ 5）
-- 前期＝台灣時間 10/22 以前開賽；後期＝10/22 起。命中率：贏 1、贏半 0.5，走盤不計。

with base as (
  select s.kickoff_at,
         case when (s.kickoff_at at time zone 'Asia/Taipei')::date < date '2026-10-22' then '前期' else '後期' end as period,
         coalesce(s.prediction->'analysis'->>'model_version', s.prediction->>'model_version',
                  s.prediction->'prediction'->'analysis'->>'model_version', '（未記錄）') as model_version,
         coalesce(nullif(s.league_name, ''), '（未記錄）') as league,
         s.settlement as st,
         coalesce(s.prediction->'analysis'->'recommendations', s.prediction->'recommendations',
                  s.prediction->'prediction'->'analysis'->'recommendations') as rec
  from public.ai_prediction_snapshots s
  where s.status = 'verified' and coalesce(s.excluded_from_public, false) = false
),
picks as (
  select b.*, m.market,
         case when jsonb_typeof(b.st->m.market) = 'object' then
                case when b.st->m.market->>'decided' = 'false' then null
                     else lower(coalesce(b.st->m.market->>'result', b.st->m.market->>'status')) end
              when jsonb_typeof(b.st->m.market) = 'string' then lower(b.st->>m.market) end as res,
         b.rec->m.market->>'pick' as pick,
         b.rec->m.market->>'line' as line
  from base b
  cross join (values ('moneyline'), ('over_under'), ('handicap'), ('btts')) as m(market)
),
decided as (
  select *,
         case market when 'moneyline' then '獨贏' when 'over_under' then '大小' when 'handicap' then '讓分' else 'BTTS' end as market_zh,
         case when pick ilike '%大%' or pick ilike 'over%' then '大'
              when pick ilike '%小%' or pick ilike 'under%' then '小' else '其他' end as ou_side,
         case res when 'win' then 1.0 when 'half_win' then 0.5 else 0 end as pts
  from picks
  where res in ('win', 'loss', 'half_win', 'half_loss')
),
rows as (
  select 1 as o1, '1 週別' as 拆法,
         to_char(date_trunc('week', kickoff_at at time zone 'Asia/Taipei'), 'MM/DD') || ' 週' as 分組,
         market_zh as 玩法, count(*) as 場數, round(100 * sum(pts) / count(*), 1) as 命中率,
         min(kickoff_at) as k
  from decided group by 3, 4
  union all
  select 2, '2 模型版本', model_version || '（' || to_char(min(kickoff_at) at time zone 'Asia/Taipei', 'MM/DD') || '–' ||
         to_char(max(kickoff_at) at time zone 'Asia/Taipei', 'MM/DD') || '）',
         market_zh, count(*), round(100 * sum(pts) / count(*), 1), min(kickoff_at)
  from decided group by model_version, market_zh
  union all
  select 3, '3 大小方向', period || '・推薦' || ou_side, '大小', count(*), round(100 * sum(pts) / count(*), 1), min(kickoff_at)
  from decided where market = 'over_under' group by period, ou_side
  union all
  select 4, '4 大小盤口', period || '・盤口 ' || coalesce(line, '（無）'), '大小', count(*), round(100 * sum(pts) / count(*), 1), min(kickoff_at)
  from decided where market = 'over_under' group by period, line
  union all
  select 5, '5 聯賽', period || '・' || league, '大小', count(*), round(100 * sum(pts) / count(*), 1), min(kickoff_at)
  from decided where market = 'over_under' group by period, league having count(*) >= 5
)
select 拆法, 分組, 玩法, 場數, 命中率
from rows
order by o1, 分組,
         case 玩法 when '獨贏' then 1 when '大小' then 2 when '讓分' then 3 else 4 end;
