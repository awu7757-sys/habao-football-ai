-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_t10_claim(integer)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_t10_claim(p_limit integer DEFAULT 2)
 RETURNS TABLE(fixture_id bigint, kickoff_at timestamp with time zone, fixture_data jsonb, lease_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role()::text, '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  -- Reconcile rows which were saved by match-analysis / other runner.
  UPDATE public.habao_t10_retry_queue q
     SET state = 'done', lease_id = NULL,
         lease_expires_at = NULL, last_result = 'official_snapshot_exists',
         updated_at = v_now
   WHERE q.state <> 'done'
     AND EXISTS (SELECT 1 FROM public.ai_prediction_snapshots s WHERE s.fixture_id=q.fixture_id);

  UPDATE public.habao_t10_retry_queue q
     SET state='expired', lease_id=NULL, lease_expires_at=NULL,
         last_result='kickoff_passed_without_snapshot', updated_at=v_now
   WHERE q.state IN ('pending','running')
     AND q.kickoff_at <= v_now
     AND NOT EXISTS (SELECT 1 FROM public.ai_prediction_snapshots s WHERE s.fixture_id=q.fixture_id);

  RETURN QUERY
  WITH due AS (
    SELECT q.fixture_id
    FROM public.habao_t10_retry_queue q
    WHERE q.first_due_at <= v_now
      AND q.next_attempt_at <= v_now
      AND q.kickoff_at > v_now + interval '30 seconds'
      AND (q.state = 'pending'
        OR (q.state = 'running' AND q.lease_expires_at < v_now))
      AND NOT EXISTS (SELECT 1 FROM public.ai_prediction_snapshots s WHERE s.fixture_id=q.fixture_id)
    ORDER BY q.kickoff_at ASC, q.fixture_id ASC
    FOR UPDATE OF q SKIP LOCKED
    LIMIT LEAST(GREATEST(coalesce(p_limit,2),0),2)
  )
  UPDATE public.habao_t10_retry_queue q
     SET state='running',
         attempts = q.attempts + 1,
         lease_id = gen_random_uuid(),
         lease_expires_at = v_now + interval '3 minutes',
         next_attempt_at = v_now + interval '5 minutes',
         last_error = NULL,
         last_result = 'claimed',
         updated_at = v_now
  FROM due
  WHERE q.fixture_id = due.fixture_id
  RETURNING q.fixture_id, q.kickoff_at, q.fixture_data, q.lease_id;
END $function$;
