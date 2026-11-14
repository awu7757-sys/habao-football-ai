-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_sport_push_recipients(text,bigint)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_sport_push_recipients(p_sport text, p_game_id bigint)
 RETURNS TABLE(subscription_id text, member_username text, endpoint text, p256dh text, auth text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_sport NOT IN ('basketball','baseball') OR p_game_id IS NULL OR p_game_id <= 0 THEN
    RAISE EXCEPTION 'invalid sport/game id';
  END IF;
  IF p_sport='basketball' THEN
    RETURN QUERY SELECT s.id::text,s.member_username,s.endpoint,s.p256dh,s.auth
    FROM public.push_subscriptions s JOIN public.members m ON m.account=s.member_username
    WHERE m.is_active=true AND EXISTS (
      SELECT 1 FROM public.member_basketball_analysis_history h
      WHERE h.game_id=p_game_id AND h.account=m.account
    );
  ELSE
    RETURN QUERY SELECT s.id::text,s.member_username,s.endpoint,s.p256dh,s.auth
    FROM public.push_subscriptions s JOIN public.members m ON m.account=s.member_username
    WHERE m.is_active=true AND EXISTS (
      SELECT 1 FROM public.member_baseball_analysis_history h
      WHERE h.game_id=p_game_id AND h.account=m.account
    );
  END IF;
END;
$function$;
