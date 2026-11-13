-- Read-only NBA stage deployment check; a cron SQL success alone is not an API success.
SELECT '階段開放範圍' AS item,
 CASE WHEN count(*)=1 AND bool_and(all_members_enabled AND pilot_account='') THEN 'PASS' ELSE 'CHECK' END AS status,
 'NBA 三階段已開放全會員；沿用登入與會員權限' AS detail
FROM public.basketball_v2_stage_settings;
SELECT game_id,stage,status,fixture_time AT TIME ZONE 'Asia/Taipei' AS kickoff_tw,
 captured_at AT TIME ZONE 'Asia/Taipei' AS captured_tw,
 source_meta->>'capture_mode' AS capture_mode,source_meta->>'reason' AS reason,
 source_meta->>'nba_calls' AS nba_api_calls,source_meta->>'odds_calls' AS odds_api_calls,
 model_output->>'expected_home_points' AS expected_home,model_output->>'expected_away_points' AS expected_away
FROM public.basketball_v2_stage_snapshots ORDER BY fixture_time DESC,stage LIMIT 30;
SELECT '階段資料完整性' AS item,
 CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END AS status,count(*) AS problems
FROM public.basketball_v2_stage_snapshots WHERE status='ready' AND
 (captured_at IS NULL OR captured_at>=fixture_time OR result_data IS NULL OR model_output IS NULL
 OR result_data->>'v2_stage' IS DISTINCT FROM stage OR result_data->>'game_id' IS DISTINCT FROM game_id::text
 OR result_data->>'research_only' IS DISTINCT FROM 'true');
SELECT '目前窗口來源錯誤' AS item,CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END AS status,count(*) AS problems
FROM public.basketball_v2_stage_snapshots WHERE fixture_time>now() AND status='source_error';
SELECT stage,count(*) AS claimed FROM public.basketball_v2_stage_claims GROUP BY stage;
SELECT usage_date,provider,used_count FROM public.basketball_v2_stage_api_budget ORDER BY usage_date DESC,provider LIMIT 10;
SELECT jobname,active,schedule FROM cron.job WHERE jobname='habao-nba-v2-stages-every-minute';
