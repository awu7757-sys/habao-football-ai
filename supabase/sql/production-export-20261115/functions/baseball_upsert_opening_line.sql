-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: baseball_upsert_opening_line(jsonb)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.baseball_upsert_opening_line(p_record jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE changed integer;
BEGIN
 IF current_user NOT IN ('postgres','service_role') AND session_user NOT IN ('postgres','service_role') THEN
  -- RPC callers normally enter as service_role; only that API role has EXECUTE.
  RAISE EXCEPTION 'not_authorized';
 END IF;
 INSERT INTO public.baseball_opening_lines
 (game_id,odds_event_id,kickoff_at,home_team,away_team,observed_at,origin,bookmakers_count,lines)
 VALUES (
   (p_record->>'game_id')::bigint, p_record->>'odds_event_id',
   (p_record->>'kickoff_at')::timestamptz,p_record->>'home_team',p_record->>'away_team',
   (p_record->>'observed_at')::timestamptz,p_record->>'origin',
   (p_record->>'bookmakers_count')::integer,p_record->'lines'
 )
 ON CONFLICT(game_id) DO UPDATE SET
   odds_event_id=excluded.odds_event_id,
   observed_at=excluded.observed_at,
   origin=excluded.origin,
   bookmakers_count=excluded.bookmakers_count,
   lines=excluded.lines,
   captured_at=now()
 WHERE excluded.observed_at < public.baseball_opening_lines.observed_at
   AND excluded.kickoff_at=public.baseball_opening_lines.kickoff_at;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN CASE WHEN changed=0 THEN 'unchanged_existing_earlier' ELSE 'inserted_or_earlier_recorded' END;
END $function$;
