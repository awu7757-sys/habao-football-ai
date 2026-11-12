-- Read-only evidence for checking the saved prediction and the exact result delivered to members.
SELECT
 s.game_id,s.stage,s.model_version,
 s.captured_at AT TIME ZONE 'Asia/Taipei' AS captured_tw,
 s.result_data#>>'{fixture,home,name}' AS home_team,
 s.result_data#>>'{fixture,away,name}' AS away_team,
 v.model_version AS t10_model_version,
 v.prediction_data#>'{analysis,recommendations}' AS t10_recommendations,
 s.model_output,
 s.source_meta,
 s.result_data#>'{analysis,recommendations}' AS frozen_stage_recommendations,
 (SELECT count(*) FROM public.basketball_v2_stage_claims c
  WHERE c.game_id=s.game_id AND c.stage=s.stage) AS successful_claims,
 (SELECT count(*) FROM public.basketball_v2_stage_claims c
  WHERE c.game_id=s.game_id AND c.stage=s.stage
  AND c.result_data IS DISTINCT FROM s.result_data) AS claim_snapshot_mismatches
FROM public.basketball_v2_stage_snapshots s
LEFT JOIN public.basketball_prediction_snapshots v ON v.game_id=s.game_id
WHERE s.status='ready' AND s.fixture_time>=now()-interval '8 hours'
ORDER BY s.fixture_time,s.game_id,s.stage
LIMIT 30;
