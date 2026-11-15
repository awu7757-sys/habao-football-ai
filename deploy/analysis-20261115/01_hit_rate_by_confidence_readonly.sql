-- HABAO｜公開戰績 T-10 命中率 × 信心門檻分析（只讀，2026-11-15）
--
-- 目的：看「信心不夠高就不推薦」能讓命中率提高多少、推薦場數少多少。
-- 只讀取，不修改任何資料。在 Supabase → SQL Editor 整段貼上按 Run，把結果截圖（或 Export CSV）回傳。
--
-- 資料：三球類已驗證、未排除的 T-10 公開快照（足球 ai_prediction_snapshots、
--       NBA basketball_prediction_snapshots、MLB baseball_verified_results＋baseball_t10_snapshots）。
-- 命中率算法與後台相同：贏 1、贏半 0.5、輸半 0、輸 0；走盤不計。
-- 「期間」：全部／較舊一半／較新一半。門檻要在較舊一半看起來有效、較新一半也有效，才算可信。
-- T-2／T-15 上線不久、樣本太少，本次不比較階段。

with fb as (
  select 'football'::text as sport, s.kickoff_at, s.settlement as st,
         coalesce(s.prediction->'analysis'->'recommendations', s.prediction->'recommendations',
                  s.prediction->'prediction'->'analysis'->'recommendations') as rec
  from public.ai_prediction_snapshots s
  where s.status = 'verified' and coalesce(s.excluded_from_public, false) = false
),
nba as (
  select 'basketball'::text, b.fixture_time, b.settlement,
         coalesce(b.prediction_data->'analysis'->'recommendations', b.prediction_data->'recommendations',
                  b.prediction_data->'prediction'->'analysis'->'recommendations')
  from public.basketball_prediction_snapshots b
  where b.status = 'verified' and coalesce(b.excluded_from_public, false) = false
),
fb_nba_picks as (
  select x.sport, x.kickoff_at, m.market,
         case when jsonb_typeof(x.st->m.market) = 'object' then
                case when x.st->m.market->>'decided' = 'false' then null
                     else lower(coalesce(x.st->m.market->>'result', x.st->m.market->>'status')) end
              when jsonb_typeof(x.st->m.market) = 'string' then lower(x.st->>m.market) end as res,
         x.rec->m.market->>'confidence' as conf_raw
  from (select * from fb union all select * from nba) x
  cross join (values ('moneyline'), ('over_under'), ('handicap'), ('btts')) as m(market)
),
mlb_picks as (
  select 'baseball'::text as sport, r.kickoff_at, m.market,
         lower(case m.market when 'moneyline' then r.moneyline_result
                             when 'over_under' then r.totals_result
                             else r.handicap_result end) as res,
         coalesce(t.analysis->'model'->'markets'->m.src->>'confidence',
                  t.analysis->'model'->'markets'->m.src->>'probability',
                  t.analysis->'model'->'markets'->m.src->>'model_probability',
                  t.analysis->'model'->'markets'->m.src->>'win_probability') as conf_raw
  from public.baseball_verified_results r
  left join public.baseball_t10_snapshots t on t.id = r.snapshot_id
  cross join (values ('moneyline','moneyline'), ('over_under','totals'), ('handicap','spread')) as m(market, src)
  where coalesce(r.excluded_from_public, false) = false and r.deleted_at is null
),
picks as (
  select sport, kickoff_at, market, res,
         case when conf_raw ~ '^[0-9]+(\.[0-9]+)?$' then
                case when conf_raw::numeric <= 1 then conf_raw::numeric * 100 else conf_raw::numeric end
         end as conf
  from (select * from fb_nba_picks union all select * from mlb_picks) u
  where res in ('win', 'loss', 'half_win', 'half_loss')
),
periods as (
  select p.*, '全部'::text as period from picks p
  union all
  select p.*, case when ntile(2) over (partition by sport, market order by kickoff_at) = 1
                   then '較舊一半' else '較新一半' end
  from picks p
)
select
  case sport when 'football' then '足球' when 'basketball' then 'NBA' else 'MLB' end as 球類,
  case market when 'moneyline' then '獨贏' when 'over_under' then '大小' when 'handicap' then '讓分' else 'BTTS' end as 玩法,
  period as 期間,
  to_char(min(kickoff_at) at time zone 'Asia/Taipei', 'MM/DD') || '–' ||
  to_char(max(kickoff_at) at time zone 'Asia/Taipei', 'MM/DD') as 日期範圍,
  count(*) as 場數,
  round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) / count(*), 1) as 命中率,
  count(conf) as 有信心值,
  count(*) filter (where conf >= 55) as 信心55以上_場數,
  round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) filter (where conf >= 55)
        / nullif(count(*) filter (where conf >= 55), 0), 1) as 信心55以上_命中率,
  count(*) filter (where conf >= 60) as 信心60以上_場數,
  round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) filter (where conf >= 60)
        / nullif(count(*) filter (where conf >= 60), 0), 1) as 信心60以上_命中率,
  count(*) filter (where conf >= 65) as 信心65以上_場數,
  round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) filter (where conf >= 65)
        / nullif(count(*) filter (where conf >= 65), 0), 1) as 信心65以上_命中率,
  count(*) filter (where conf >= 70) as 信心70以上_場數,
  round(100.0 * sum(case res when 'win' then 1 when 'half_win' then 0.5 else 0 end) filter (where conf >= 70)
        / nullif(count(*) filter (where conf >= 70), 0), 1) as 信心70以上_命中率
from periods
group by sport, market, period
order by case sport when 'football' then 1 when 'basketball' then 2 else 3 end,
         case market when 'moneyline' then 1 when 'over_under' then 2 when 'handicap' then 3 else 4 end,
         case period when '全部' then 1 when '較舊一半' then 2 else 3 end;
