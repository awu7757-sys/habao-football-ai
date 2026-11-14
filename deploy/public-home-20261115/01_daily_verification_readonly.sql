-- Run manually in Supabase SQL Editor. Read-only; no jobs/functions/API calls.
-- Do not export cron command text: it can contain credentials.
BEGIN TRANSACTION READ ONLY;

WITH jobs AS (
  SELECT jobid,jobname,schedule,active
  FROM cron.job
  WHERE coalesce(jobname,'') ~* 'verif|settle|result|score|football|basket|nba|baseball|mlb'
     OR command ~* 'verif|settle|result|score|football|basket|nba|baseball|mlb'
)
SELECT j.jobid,j.jobname,j.schedule,j.active,
  latest.start_time AT TIME ZONE 'Asia/Taipei' AS latest_start_taipei,
  latest.end_time AT TIME ZONE 'Asia/Taipei' AS latest_end_taipei,
  latest.status AS latest_cron_status,
  (SELECT count(*) FROM cron.job_run_details r WHERE r.jobid=j.jobid AND r.start_time>=now()-interval '24 hours') AS runs_24h,
  (SELECT count(*) FROM cron.job_run_details r WHERE r.jobid=j.jobid AND r.start_time>=now()-interval '24 hours' AND r.status='failed') AS failures_24h
FROM jobs j LEFT JOIN LATERAL (
  SELECT start_time,end_time,status FROM cron.job_run_details r
  WHERE r.jobid=j.jobid ORDER BY start_time DESC LIMIT 1
) latest ON true ORDER BY j.jobid;

-- Daily execution evidence. A successful HTTP-queue cron is NOT proof of settlement.
SELECT j.jobname,(r.start_time AT TIME ZONE 'Asia/Taipei')::date AS run_date_taipei,
  r.status,count(*) AS run_count
FROM cron.job j JOIN cron.job_run_details r USING(jobid)
WHERE r.start_time>=now()-interval '7 days'
  AND (coalesce(j.jobname,'') ~* 'verif|settle|result|score' OR j.command ~* 'verif|settle|result|score')
GROUP BY 1,2,3 ORDER BY 2 DESC,1,3;

-- Discover exact live verification tables/columns before writing the next audit.
-- Metadata only; no member rows, keys, command bodies, or credentials.
SELECT table_name,jsonb_agg(jsonb_build_object('column',column_name,'type',data_type) ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name ~* '(prediction_snapshot|t10_snapshot|verification|settlement|public.*result|public.*stage|stage.*snapshot)'
GROUP BY table_name ORDER BY table_name;

COMMIT;
