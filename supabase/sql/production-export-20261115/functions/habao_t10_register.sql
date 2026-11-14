-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_t10_register(jsonb)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_t10_register(p_fixtures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF coalesce(auth.role()::text, '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF jsonb_typeof(p_fixtures) <> 'array' THEN
    RAISE EXCEPTION 'fixtures_array_required';
  END IF;
  WITH entries AS (
    SELECT DISTINCT ON (x.fixture_id)
      x.fixture_id, x.kickoff_at, x.fixture_data
    FROM jsonb_to_recordset(p_fixtures)
         AS x(fixture_id bigint, kickoff_at timestamptz, fixture_data jsonb)
    WHERE x.fixture_id > 0 AND x.kickoff_at > clock_timestamp()
    ORDER BY x.fixture_id, x.kickoff_at ASC
  )
  INSERT INTO public.habao_t10_retry_queue AS q
    (fixture_id, kickoff_at, first_due_at, fixture_data, next_attempt_at)
  SELECT fixture_id,
         kickoff_at,
         kickoff_at - interval '10 hours',
         coalesce(fixture_data, '{}'::jsonb),
         kickoff_at - interval '10 hours'
  FROM entries
  ON CONFLICT (fixture_id) DO UPDATE SET
    kickoff_at = EXCLUDED.kickoff_at,
    first_due_at = EXCLUDED.first_due_at,
    next_attempt_at = EXCLUDED.next_attempt_at,
    fixture_data = EXCLUDED.fixture_data,
    updated_at = now()
  WHERE q.attempts = 0
    AND q.state = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_prediction_snapshots s
      WHERE s.fixture_id = q.fixture_id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;
