-- 單場核對：後台正式 T-10 快照 vs 會員領取的階段結果（唯讀，2026-11-15）
-- 範例：巴甲 沙佩科恩斯 vs 瓦斯科達伽馬（台灣 11/15 07:30 開賽）。換場次只改 params。
begin transaction read only;

with params as (
  select timestamptz '2026-11-15 07:30:00+08' as kickoff, '%chapecoense%'::text as home_like
), fx as (
  select a.fixture_id from public.ai_prediction_snapshots a, params p
  where a.kickoff_at = p.kickoff and a.home_team ilike p.home_like
  union
  select s.fixture_id from public.football_v2_shadow_stage_snapshots s, params p
  where s.kickoff_at = p.kickoff
)
select 'T-10 正式快照（後台）' as 來源, a.fixture_id, null::text as 階段,
       to_char(a.created_at at time zone 'Asia/Taipei','MM-DD HH24:MI') as 建立_台灣,
       a.prediction #> '{analysis,recommendations}' as 推薦
from public.ai_prediction_snapshots a where a.fixture_id in (select fixture_id from fx)
union all
select '階段快照 ' || s.stage, s.fixture_id, coalesce(s.source_meta->>'capture_mode','unknown'),
       to_char(s.captured_at at time zone 'Asia/Taipei','MM-DD HH24:MI'),
       jsonb_build_object('handicaps', s.market_context->'handicaps', 'totals', s.market_context->'totals',
                          'home_xg', s.home_xg, 'away_xg', s.away_xg)
from public.football_v2_shadow_stage_snapshots s where s.fixture_id in (select fixture_id from fx)
union all
select '會員領取 ' || c.stage, c.fixture_id, c.account,
       to_char(c.claimed_at at time zone 'Asia/Taipei','MM-DD HH24:MI'),
       c.result_data #> '{analysis,recommendations}'
from public.football_v2_stage_member_claims c where c.fixture_id in (select fixture_id from fx)
union all
select '會員 T-10 歷史', h.fixture_id, h.account,
       to_char(h.created_at at time zone 'Asia/Taipei','MM-DD HH24:MI'),
       h.result_data #> '{analysis,recommendations}'
from public.member_analysis_history h where h.fixture_id in (select fixture_id from fx)
order by 1;

commit;
