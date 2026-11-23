-- HABAO｜NBA 規則 V3 上線檢查（只讀，2026-11-23，Claude）
-- 檢查 2026-11-24 00:00（台灣）以後開賽的新快照有沒有真的套用 V3。
-- 正常結果：
--   缺少規則版本 = 0（每筆推薦都要有 rule_version）
--   異常 = 0（被擋下卻沒有原始推薦，或者正式推薦違反規則）
--   擋下原因只會出現：underdog_pick / favorite_unknown / conflict_with_t10 / edge_too_large / gap_unknown / low_confidence
-- 使用方式：Supabase → SQL Editor 整段貼上 → Run → Export CSV 回傳。不修改任何資料。

with since as (select timestamptz '2026-11-24 00:00:00+08' as f),
t10 as (
  select 'T-10'::text as stage, b.game_id, b.fixture_time, m.k as market,
         coalesce(b.prediction_data->'analysis'->'recommendations', b.prediction_data->'recommendations') -> m.k as rec,
         coalesce(b.prediction_data->'market_data'->'market'->'primary'->>'home_spread',
                  b.prediction_data->'market_data'->'market'->'consensus'->>'home_spread') as home_spread
  from public.basketball_prediction_snapshots b, since
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(k)
  where b.fixture_time >= since.f
),
stg as (
  select case s.stage when 't2' then 'T-2' else 'T-15' end, s.game_id, null::timestamptz, m.k,
         s.result_data->'analysis'->'recommendations'->m.k,
         s.result_data->'market_data'->'market'->'consensus'->>'home_spread'
  from public.basketball_v2_stage_snapshots s
  join public.basketball_prediction_snapshots b on b.game_id = s.game_id, since
  cross join (values ('moneyline'), ('handicap'), ('over_under')) as m(k)
  where b.fixture_time >= since.f and s.status = 'ready' and s.stage in ('t2', 't15')
),
allr as (select * from t10 union all select * from stg),
x as (
  select stage, market, rec,
         rec->>'pick' as pick, rec->>'decision_code' as code, rec->>'rule_version' as ver, rec->'pre_rule'->>'pick' as pre_pick,
         case when home_spread ~ '^-?[0-9.]+$' then home_spread::numeric end as hs
  from allr where rec is not null
)
select stage as 階段,
       case market when 'moneyline' then '獨贏' when 'handicap' then '讓分' else '大小分' end as 玩法,
       count(*) as 推薦欄位數,
       count(*) filter (where ver is null) as 缺少規則版本,
       count(*) filter (where pick is not null and pick <> '暫不推薦') as 正式推薦,
       count(*) filter (where pick = '暫不推薦' and pre_pick is not null and pre_pick <> '暫不推薦') as "被V3擋下",
       string_agg(distinct code, ' / ') filter (where pick = '暫不推薦' and pre_pick is not null and pre_pick <> '暫不推薦') as 擋下原因,
       count(*) filter (where
         (pick = '暫不推薦' and code in ('underdog_pick','favorite_unknown','conflict_with_t10','edge_too_large','gap_unknown','low_confidence')
            and (pre_pick is null or pre_pick = '暫不推薦'))
         or (market = 'moneyline' and pick in ('主隊','客隊') and ver is not null
            and not ((pick = '主隊' and hs < 0) or (pick = '客隊' and hs > 0)))
         or (market = 'handicap' and stage <> 'T-10' and pick in ('主隊','客隊') and ver is not null
            and coalesce((rec->>'confidence')::numeric, 0) < 70)
       ) as 異常
from x
group by stage, market
order by case stage when 'T-10' then 1 when 'T-2' then 2 else 3 end, 玩法;
