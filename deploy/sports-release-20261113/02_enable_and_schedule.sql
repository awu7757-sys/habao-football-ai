BEGIN;
UPDATE public.football_v2_rollout_settings SET all_members_enabled=true,pilot_account='' WHERE id=true;
UPDATE public.basketball_v2_stage_settings SET all_members_enabled=true,pilot_account='' WHERE id=true;
UPDATE public.baseball_v2_stage_settings SET all_members_enabled=true,pilot_account='' WHERE id=true;
CREATE TABLE IF NOT EXISTS public.sports_source_probe_requests(request_id bigint PRIMARY KEY,sport text NOT NULL,queued_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.sports_source_probe_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sports_source_probe_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.sports_source_probe_requests TO service_role;
CREATE TABLE IF NOT EXISTS public.sports_source_probe_runs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sport text NOT NULL,game_id bigint NOT NULL,checked_at timestamptz NOT NULL DEFAULT now(),result_data jsonb NOT NULL);
ALTER TABLE public.sports_source_probe_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sports_source_probe_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.sports_source_probe_runs TO service_role;
GRANT USAGE ON SEQUENCE public.sports_source_probe_runs_id_seq TO service_role;
DO $setup$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key') THEN RAISE EXCEPTION 'existing nba_v2_cron_key missing'; END IF;
 PERFORM cron.schedule('habao-mlb-v2-stages-every-minute','* * * * *',$job$SELECT net.http_post(url:='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/baseball-v2-stage-runner',headers:=jsonb_build_object('Content-Type','application/json','x-habao-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key' LIMIT 1)),body:='{"action":"run"}'::jsonb,timeout_milliseconds:=90000);$job$);
END $setup$;
UPDATE public.sports_release_settings SET revision='sports-release-20261113-1',enabled=true WHERE id=true;
COMMIT;
SELECT 'football' sport,all_members_enabled FROM public.football_v2_rollout_settings WHERE id=true
UNION ALL SELECT 'basketball',all_members_enabled FROM public.basketball_v2_stage_settings WHERE id=true
UNION ALL SELECT 'baseball',all_members_enabled FROM public.baseball_v2_stage_settings WHERE id=true;
