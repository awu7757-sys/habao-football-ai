-- Works without an upcoming game: reads provider data for a saved game.
-- Historical source responses are labelled source-only; no member credits or snapshots are changed.
WITH queued AS (
SELECT sport,net.http_post(
 url:='https://oqtbsbohcfeghgnykwxy.supabase.co/functions/v1/sports-release-verify',
 headers:=jsonb_build_object('Content-Type','application/json','x-habao-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='nba_v2_cron_key' LIMIT 1)),
 body:=jsonb_build_object('action','source_probe','sport',sport),timeout_milliseconds:=90000) AS request_id
FROM (VALUES('football'),('basketball'),('baseball')) s(sport)
)
INSERT INTO public.sports_source_probe_requests(request_id,sport) SELECT request_id,sport FROM queued RETURNING sport,request_id;
