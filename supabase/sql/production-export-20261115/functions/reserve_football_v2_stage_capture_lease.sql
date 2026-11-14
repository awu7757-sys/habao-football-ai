-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: reserve_football_v2_stage_capture_lease(bigint,text,uuid,integer)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.reserve_football_v2_stage_capture_lease(p_fixture_id bigint, p_stage text, p_lease_token uuid, p_lease_seconds integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE acquired boolean := false;
BEGIN
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 OR p_stage NOT IN ('t2', 't15')
     OR p_lease_token IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid_stage_capture_lease_parameters';
  END IF;

  INSERT INTO public.football_v2_stage_capture_leases (fixture_id, stage, lease_token, lease_until, updated_at)
  VALUES (p_fixture_id, p_stage, p_lease_token, now() + make_interval(secs => p_lease_seconds), now())
  ON CONFLICT (fixture_id, stage) DO UPDATE
    SET lease_token = EXCLUDED.lease_token,
        lease_until = EXCLUDED.lease_until,
        updated_at = now()
    WHERE public.football_v2_stage_capture_leases.lease_until < now()
  RETURNING true INTO acquired;

  RETURN COALESCE(acquired, false);
END;
$function$;
