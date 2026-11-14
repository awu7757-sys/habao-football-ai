-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_usage_storage_size_gb()
-- EXECUTE granted to: anon, authenticated, postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_usage_storage_size_gb()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'storage'
AS $function$
  select round(
    coalesce(
      sum(
        case
          when metadata ? 'size'
           and coalesce(metadata ->> 'size', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (metadata ->> 'size')::numeric
          else 0
        end
      ),
      0
    ) / 1000000000,
    6
  )
  from storage.objects;
$function$;
