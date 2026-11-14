-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: release_football_v2_stage_capture_lease(bigint,text,uuid)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.release_football_v2_stage_capture_lease(p_fixture_id bigint, p_stage text, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE removed integer;
BEGIN
  DELETE FROM public.football_v2_stage_capture_leases
  WHERE fixture_id = p_fixture_id AND stage = p_stage AND lease_token = p_lease_token;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed = 1;
END;
$function$;
