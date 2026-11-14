-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: refund_basketball_analysis_quota(text,bigint)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.refund_basketball_analysis_quota(p_account text, p_game_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_date date :=
    (now() at time zone 'Asia/Taipei')::date;

  v_deleted integer := 0;
begin
  delete from public.basketball_analysis_usage
  where account = trim(p_account)
    and game_id = p_game_id
    and usage_date = v_date;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted', v_deleted,
    'usage_date', v_date
  );
end;
$function$;
