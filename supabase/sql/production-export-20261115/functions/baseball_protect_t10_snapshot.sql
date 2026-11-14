-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: baseball_protect_t10_snapshot()
-- EXECUTE granted to: PUBLIC, anon, authenticated, postgres, service_role

CREATE OR REPLACE FUNCTION public.baseball_protect_t10_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'MLB T-10 snapshot is immutable';
END;
$function$;
