-- Run AFTER replacing nba-v2-stage-runner with the new full file.
-- Queues a source-only probe for the next existing, unstarted T-10 snapshot.
-- No member credit RPC is called; no stage snapshot is created or replaced.
WITH candidate AS (
 SELECT game_id,fixture_time,home_team,away_team
 FROM public.basketball_prediction_snapshots
 WHERE fixture_time>clock_timestamp() AND fixture_time<=clock_timestamp()+interval '36 hours'
 ORDER BY fixture_time,game_id LIMIT 1
), request AS (
 SELECT c.*,net.http_post(
  url:='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-v2-stage-runner',
  headers:=jsonb_build_object('Content-Type','application/json','x-habao-cron-key',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key' LIMIT 1)),
  body:=jsonb_build_object('action','probe_context','game_id',c.game_id),
  timeout_milliseconds:=90000) AS request_id
 FROM candidate c
)
SELECT 'QUEUED'::text AS status,game_id,fixture_time AT TIME ZONE 'Asia/Taipei' AS kickoff_taipei,
 home_team,away_team,request_id,'稍後執行 10_check_player_context.sql，核對 HTTP 回應；排入佇列不代表資料已成功取得。'::text AS detail
FROM request
UNION ALL
SELECT 'WAIT',NULL::bigint,NULL::timestamp,NULL::text,NULL::text,NULL::bigint,
 '目前沒有未開賽的 T-10 快照可核對；下一場產生 T-10 快照後再執行。已開賽的場次不補抓成賽前資料。'
WHERE NOT EXISTS(SELECT 1 FROM candidate);
