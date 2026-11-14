-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: reserve_football_v2_shadow_api_call(integer)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.reserve_football_v2_shadow_api_call(p_daily_cap integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_reserved integer;
BEGIN
  IF p_daily_cap IS NULL OR p_daily_cap < 1 THEN RETURN false; END IF;
  INSERT INTO public.football_v2_shadow_api_budget(usage_date,calls_used,updated_at)
  VALUES ((now() AT TIME ZONE 'UTC')::date,1,now())
  ON CONFLICT (usage_date) DO UPDATE
    SET calls_used = public.football_v2_shadow_api_budget.calls_used + 1, updated_at = now()
    WHERE public.football_v2_shadow_api_budget.calls_used < p_daily_cap
  RETURNING calls_used INTO v_reserved;
  RETURN v_reserved IS NOT NULL;
END;
$function$;
