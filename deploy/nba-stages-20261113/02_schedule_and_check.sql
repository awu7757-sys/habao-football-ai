-- Run AFTER 01 and deploying both Edge Functions. Reuses the existing Vault cron key.
DO $setup$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key') THEN RAISE EXCEPTION 'Missing existing Vault secret nba_v2_cron_key'; END IF;
 PERFORM cron.schedule('habao-nba-v2-stages-every-minute','* * * * *',
 $job$ SELECT net.http_post(
 url:='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-v2-stage-runner',
 headers:=jsonb_build_object('Content-Type','application/json','x-habao-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key' LIMIT 1)),
 body:='{"action":"run"}'::jsonb,timeout_milliseconds:=90000); $job$);
END $setup$;
-- Immediate run: does not wait for the next minute. Only captures an open pre-match stage.
SELECT net.http_post(
 url:='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/nba-v2-stage-runner',
 headers:=jsonb_build_object('Content-Type','application/json','x-habao-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key' LIMIT 1)),
 body:='{"action":"run"}'::jsonb,timeout_milliseconds:=90000) AS request_id;
SELECT jobname,active,schedule FROM cron.job WHERE jobname='habao-nba-v2-stages-every-minute';
SELECT * FROM public.basketball_v2_stage_settings;
