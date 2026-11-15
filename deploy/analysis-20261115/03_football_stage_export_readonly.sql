-- HABAO｜足球階段快照匯出（只讀，2026-11-15）
-- 用途：匯出已完賽場次的階段快照（xG、機率、當時盤口與賠率）與最終比分，
--       由 Claude 在本機用與會員端相同的程式重算推薦，比較「我們的推薦」與「跟著莊家看好的一邊」。
-- 只讀取，不修改任何資料。Supabase → SQL Editor 貼上 Run → Export CSV 回傳。

select s.fixture_id, s.stage, s.model_version,
       to_char(s.kickoff_at at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') as kickoff_tw,
       s.home_xg, s.away_xg, s.probabilities::text as probabilities, s.market_context::text as market_context,
       coalesce(s.source_meta->>'capture_mode', 'scheduled') as capture_mode,
       p.home_score, p.away_score
from public.football_v2_shadow_stage_snapshots s
join public.ai_prediction_snapshots p on p.fixture_id = s.fixture_id
where p.status = 'verified'
  and p.home_score is not null and p.away_score is not null
  and s.kickoff_at >= now() - interval '90 days'
order by s.kickoff_at, s.fixture_id, s.stage;
