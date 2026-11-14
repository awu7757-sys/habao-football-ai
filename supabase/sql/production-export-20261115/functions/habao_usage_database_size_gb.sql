-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_usage_database_size_gb()
-- EXECUTE granted to: anon, authenticated, postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_usage_database_size_gb()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select round(
    pg_database_size(current_database())::numeric / 1000000000,
    6
  );
$function$;
