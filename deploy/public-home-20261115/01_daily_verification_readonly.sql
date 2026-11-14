-- Manual Supabase SQL Editor audit. Reads only; no HTTP calls or writes.
-- Commands and return_message are deliberately omitted (may contain credentials).
BEGIN TRANSACTION READ ONLY;
WITH jobs AS (
  SELECT jobid,jobname,schedule,active
  FROM cron.job
  WHERE coalesce(jobname,'') ~* 'verif|settle|result|score|football|basket|nba|baseball|mlb'
     OR command ~* 'verif|settle|result|score|football|basket|nba|baseball|mlb'
), latest AS (
  SELECT j.jobid,j.jobname,j.schedule,j.active,
    r.start_time AT TIME ZONE 'Asia/Taipei' AS latest_start_taipei,
    r.end_time AT TIME ZONE 'Asia/Taipei' AS latest_end_taipei,
    r.status AS latest_cron_status,
    (SELECT count(*) FROM cron.job_run_details x WHERE x.jobid=j.jobid AND x.start_time>=now()-interval '24 hours') AS runs_24h,
    (SELECT count(*) FROM cron.job_run_details x WHERE x.jobid=j.jobid AND x.start_time>=now()-interval '24 hours' AND x.status='failed') AS failures_24h
  FROM jobs j LEFT JOIN LATERAL (
    SELECT start_time,end_time,status FROM cron.job_run_details x
    WHERE x.jobid=j.jobid ORDER BY start_time DESC LIMIT 1
  ) r ON true
), daily AS (
  SELECT j.jobname,(r.start_time AT TIME ZONE 'Asia/Taipei')::date AS run_date_taipei,
    r.status,count(*) AS run_count
  FROM jobs j JOIN cron.job_run_details r USING(jobid)
  WHERE r.start_time>=now()-interval '7 days'
  GROUP BY 1,2,3
), columns AS (
  SELECT table_name,jsonb_agg(jsonb_build_object('column',column_name,'type',data_type) ORDER BY ordinal_position) AS columns
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name ~* '(prediction_snapshot|t10_snapshot|verification|settlement|public.*result|public.*stage|stage.*snapshot)'
  GROUP BY table_name
)
SELECT '1_latest_jobs' AS item,coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY jobid) FROM latest x),'[]'::jsonb) AS detail
UNION ALL
SELECT '2_daily_runs',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY run_date_taipei DESC,jobname,status) FROM daily x),'[]'::jsonb)
UNION ALL
SELECT '3_verification_columns',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name) FROM columns x),'[]'::jsonb)
UNION ALL
SELECT '4_interpretation',to_jsonb('Cron succeeded may mean only HTTP queue submission. It does not prove the Edge Function or settlement succeeded. Next: correlate HTTP outcomes and actual verification dates/backlog for each sport using the discovered columns.'::text);
COMMIT;
