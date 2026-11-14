-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_cleanup_admin_data()
-- EXECUTE granted to: anon, authenticated, postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_cleanup_admin_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  history_deleted integer := 0;
  jobs_deleted integer := 0;
begin
  delete from public.member_analysis_history
  where updated_at < now() - interval '7 days';
  get diagnostics history_deleted = row_count;

  delete from public.analysis_jobs
  where status in ('completed','failed','partial')
    and coalesce(completed_at, updated_at, created_at) < now() - interval '7 days';
  get diagnostics jobs_deleted = row_count;

  return jsonb_build_object(
    'success', true,
    'member_analysis_history_deleted', history_deleted,
    'analysis_jobs_deleted', jobs_deleted,
    'executed_at', now()
  );
end;
$function$;
