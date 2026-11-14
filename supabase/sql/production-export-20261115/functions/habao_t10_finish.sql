-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_t10_finish(bigint,uuid,text,text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_t10_finish(p_fixture_id bigint, p_lease_id uuid, p_result text, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  IF coalesce(auth.role()::text, '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  UPDATE public.habao_t10_retry_queue q
  SET state = CASE
        WHEN EXISTS (SELECT 1 FROM public.ai_prediction_snapshots s WHERE s.fixture_id=q.fixture_id)
          THEN 'done'
        WHEN q.kickoff_at <= clock_timestamp() THEN 'expired'
        ELSE 'pending'
      END,
      lease_id = NULL,
      lease_expires_at = NULL,
      last_result = left(coalesce(p_result, 'unknown'), 120),
      last_error = left(coalesce(p_error, ''), 600),
      next_attempt_at = GREATEST(q.next_attempt_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE q.fixture_id = p_fixture_id
    AND q.state = 'running'
    AND q.lease_id = p_lease_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $function$;
