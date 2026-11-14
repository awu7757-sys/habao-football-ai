-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: reserve_nba_stage_api(text,integer,integer)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.reserve_nba_stage_api(p_provider text, p_cost integer, p_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE n integer; day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_provider NOT IN('nba','odds') OR p_cost IS NULL OR p_limit IS NULL OR p_cost<1 OR p_limit<1 OR p_cost>p_limit THEN RETURN false; END IF;
 INSERT INTO public.basketball_v2_stage_api_budget(usage_date,provider) VALUES(day,p_provider) ON CONFLICT DO NOTHING;
 UPDATE public.basketball_v2_stage_api_budget SET used_count=used_count+p_cost
 WHERE usage_date=day AND provider=p_provider AND used_count+p_cost<=p_limit RETURNING used_count INTO n;
 RETURN FOUND;
END $function$;
