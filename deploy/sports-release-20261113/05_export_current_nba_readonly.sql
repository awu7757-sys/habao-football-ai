-- Read-only: Taiwan today and tomorrow, actual saved NBA snapshots.
-- No source requests, capture writes, claims, or credit deductions.
-- Future stages remain absent until their real snapshot exists.
WITH chosen AS (
 SELECT s.* FROM public.basketball_prediction_snapshots s
 WHERE s.fixture_time >= (date_trunc('day', current_timestamp AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')
 AND s.fixture_time < ((date_trunc('day', current_timestamp AT TIME ZONE 'Asia/Taipei') + interval '2 days') AT TIME ZONE 'Asia/Taipei')
 ORDER BY s.fixture_time,s.game_id LIMIT 30
), games AS (
 SELECT 'basketball'::text AS sport,s.game_id,s.fixture_time,s.home_team,s.away_team,
  jsonb_build_object('t10',s.prediction_data)||coalesce((
   SELECT jsonb_object_agg(v.stage,v.result_data)
   FROM public.basketball_v2_stage_snapshots v WHERE v.game_id=s.game_id AND v.status='ready'
  ),'{}'::jsonb) AS results,
  coalesce((SELECT jsonb_object_agg(v.stage,v.model_output) FROM public.basketball_v2_stage_snapshots v
   WHERE v.game_id=s.game_id AND v.status='ready'),'{}'::jsonb) AS models,
  coalesce((SELECT jsonb_object_agg(v.stage,v.source_meta) FROM public.basketball_v2_stage_snapshots v
   WHERE v.game_id=s.game_id AND v.status='ready'),'{}'::jsonb) AS metas,
  coalesce((SELECT jsonb_object_agg(x.stage,x.checks) FROM (
   SELECT c.stage,jsonb_build_object('claim_count',count(*),'matching_count',count(*) FILTER (WHERE c.result_data=v.result_data),'mismatching_count',count(*) FILTER (WHERE c.result_data IS DISTINCT FROM v.result_data)) AS checks
   FROM public.basketball_v2_stage_claims c JOIN public.basketball_v2_stage_snapshots v
    ON v.game_id=c.game_id AND v.stage=c.stage
   WHERE c.game_id=s.game_id
   GROUP BY c.stage) x),'{}'::jsonb) AS claim_checks
 FROM chosen s
)
SELECT 'nba_replay_bundle' AS item,jsonb_build_object(
 'schema','habao-nba-replay-v1','origin','supabase_saved_snapshots','exported_at',clock_timestamp(),
 'description','正式已保存快照的唯讀副本。重播只驗證畫面及數值一致性，不重建過去傷停或改寫原始預測。',
 'games',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.fixture_time,g.game_id) FROM games g),'[]'::jsonb)
) AS detail;
