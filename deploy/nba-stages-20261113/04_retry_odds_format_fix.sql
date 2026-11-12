-- Run ONLY AFTER redeploying nba-v2-stage-runner from this directory.
-- Reopen the two observed failures once. Ready rows, claims and API usage are preserved.
WITH retried AS (
 UPDATE public.basketball_v2_stage_snapshots
 SET attempts=0,lease_token=NULL,updated_at=clock_timestamp()-interval '3 minutes',
 source_meta=source_meta||jsonb_build_object('retry_reset_at',clock_timestamp(),'previous_attempts',attempts,'retry_patch','odds-format-20261113-1')
 WHERE game_id IN(17111,17112) AND stage='t2' AND status='source_error'
 AND source_meta->>'reason'='current_odds_source_unavailable'
 AND source_meta->>'retry_patch' IS DISTINCT FROM 'odds-format-20261113-1'
 AND fixture_time>clock_timestamp()+interval '15 minutes'
 AND fixture_time<=clock_timestamp()+interval '2 hours'
 RETURNING game_id,stage
)
SELECT game_id,stage,net.http_post(
 url:='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-v2-stage-runner',
 headers:=jsonb_build_object('Content-Type','application/json','x-habao-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key' LIMIT 1)),
 body:=jsonb_build_object('action','capture','game_id',game_id,'stage',stage),timeout_milliseconds:=90000
) AS request_id FROM retried;
