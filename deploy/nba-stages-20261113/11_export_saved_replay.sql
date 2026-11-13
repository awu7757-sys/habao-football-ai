-- Read-only export for today's already saved NBA snapshots. No API call or billing RPC.
WITH chosen AS (
 SELECT s.* FROM public.basketball_prediction_snapshots s
 WHERE s.fixture_time>=timestamptz '2026-11-13 00:00:00+08'
 AND s.fixture_time<timestamptz '2026-11-14 00:00:00+08'
 ORDER BY s.fixture_time,s.game_id LIMIT 10
), games AS (
 SELECT s.game_id,s.fixture_time,s.home_team,s.away_team,
  jsonb_build_object('t10',s.prediction_data)||coalesce((
   SELECT jsonb_object_agg(v.stage,v.result_data)
   FROM public.basketball_v2_stage_snapshots v WHERE v.game_id=s.game_id AND v.status='ready'
  ),'{}'::jsonb) AS results,
  coalesce((SELECT jsonb_object_agg(v.stage,v.model_output) FROM public.basketball_v2_stage_snapshots v
   WHERE v.game_id=s.game_id AND v.status='ready'),'{}'::jsonb) AS models,
  coalesce((SELECT jsonb_object_agg(v.stage,v.source_meta) FROM public.basketball_v2_stage_snapshots v
   WHERE v.game_id=s.game_id AND v.status='ready'),'{}'::jsonb) AS metas,
  coalesce((SELECT jsonb_object_agg(x.stage,x.checks) FROM (
   SELECT c.stage,jsonb_agg(jsonb_build_object('claimed_at',c.claimed_at,
    'result_matches_snapshot',c.result_data=v.result_data) ORDER BY c.claimed_at) AS checks
   FROM public.basketball_v2_stage_claims c JOIN public.basketball_v2_stage_snapshots v
    ON v.game_id=c.game_id AND v.stage=c.stage
   WHERE c.game_id=s.game_id AND c.account='google_2d3cef6b6e2d'
   GROUP BY c.stage) x),'{}'::jsonb) AS claim_checks
 FROM chosen s
)
SELECT 'nba_replay_bundle' AS item,jsonb_build_object(
 'schema','habao-nba-replay-v1','origin','supabase_saved_snapshots','exported_at',clock_timestamp(),
 'description','正式已保存快照的唯讀副本。重播只驗證畫面及數值一致性，不重建過去傷停或改寫原始預測。',
 'games',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.fixture_time,g.game_id) FROM games g),'[]'::jsonb)
) AS detail;
