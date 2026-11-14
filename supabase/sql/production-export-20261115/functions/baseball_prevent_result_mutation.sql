-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: baseball_prevent_result_mutation()
-- EXECUTE granted to: PUBLIC, anon, authenticated, postgres, service_role

CREATE OR REPLACE FUNCTION public.baseball_prevent_result_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN RAISE EXCEPTION 'MLB_VERIFIED_RESULT_IMMUTABLE'; END;
$function$;
