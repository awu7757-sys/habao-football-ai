-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: habao_sport_push_observe(text,bigint,integer,integer,text,text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.habao_sport_push_observe(p_sport text, p_game_id bigint, p_home_score integer, p_away_score integer, p_status text, p_period text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  oldrow public.habao_sport_push_state%ROWTYPE;
  had_previous boolean;
  event_type text := null;
  event_key text := null;
  is_finished boolean := (p_status = 'final');
  now_at timestamptz := clock_timestamp();
  last_notify_age interval;
  delta integer;
BEGIN
  IF p_sport NOT IN ('basketball','baseball') OR p_game_id IS NULL OR p_game_id <= 0
      OR p_home_score IS NULL OR p_away_score IS NULL
      OR p_home_score < 0 OR p_away_score < 0
      OR p_status NOT IN ('scheduled','live','intermission','final','postponed','cancelled') THEN
    RAISE EXCEPTION 'invalid sport score observation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('habao_score_push:' || p_sport || ':' || p_game_id::text, 0));
  SELECT * INTO oldrow FROM public.habao_sport_push_state
  WHERE sport = p_sport AND game_id = p_game_id FOR UPDATE;
  had_previous := FOUND;

  IF NOT had_previous THEN
    INSERT INTO public.habao_sport_push_state
      (sport,game_id,home_score,away_score,match_status,period,updated_at)
    VALUES
      (p_sport,p_game_id,p_home_score,p_away_score,p_status,COALESCE(p_period,''),now_at);
    IF is_finished THEN
      UPDATE public.habao_sport_push_targets SET enabled=false,updated_at=now_at
      WHERE sport=p_sport AND game_id=p_game_id;
    END IF;
    RETURN jsonb_build_object('baseline',true,'notify',false,'finished',is_finished);
  END IF;

  IF oldrow.match_status = 'final' THEN
    UPDATE public.habao_sport_push_targets SET enabled=false,updated_at=now_at
    WHERE sport=p_sport AND game_id=p_game_id AND enabled;
    RETURN jsonb_build_object('baseline',false,'notify',false,'finished',true);
  END IF;

  last_notify_age := now_at-COALESCE(oldrow.last_notified_at,now_at-interval '365 days');
  delta := ABS(p_home_score-oldrow.home_score)+ABS(p_away_score-oldrow.away_score);

  IF is_finished AND oldrow.match_status <> 'final' THEN
    event_type := 'full_time';
  ELSIF p_status = 'live' AND oldrow.match_status IN ('live','intermission')
    AND p_sport='basketball' AND COALESCE(p_period,'')<>''
    AND COALESCE(oldrow.period,'')<>'' AND p_period<>oldrow.period THEN
    event_type := 'period';
  ELSIF p_status IN ('live','intermission') AND oldrow.match_status IN ('live','intermission')
    AND delta>0 THEN
    IF p_sport='baseball' AND last_notify_age >= interval '2 minutes' THEN
      event_type := 'score';
    ELSIF p_sport='basketball' AND delta>=8 AND last_notify_age >= interval '10 minutes' THEN
      event_type := 'score';
    END IF;
  END IF;

  IF event_type IS NOT NULL THEN
    event_key := event_type || '_' || p_status || '_' || COALESCE(p_period,'') || '_'
      || p_home_score::text || '_' || p_away_score::text;
    IF oldrow.last_event_key IS NOT DISTINCT FROM event_key THEN
      event_type := null;
    END IF;
  END IF;

  UPDATE public.habao_sport_push_state SET
    home_score=p_home_score,away_score=p_away_score,match_status=p_status,
    period=COALESCE(p_period,''),
    last_event_key=CASE WHEN event_type IS NOT NULL THEN event_key ELSE oldrow.last_event_key END,
    last_notified_at=CASE WHEN event_type IS NOT NULL THEN now_at ELSE oldrow.last_notified_at END,
    updated_at=now_at
  WHERE sport=p_sport AND game_id=p_game_id;

  IF is_finished OR p_status='cancelled' THEN
    UPDATE public.habao_sport_push_targets SET enabled=false,updated_at=now_at
    WHERE sport=p_sport AND game_id=p_game_id;
  END IF;

  RETURN jsonb_build_object('baseline',false,'notify',event_type IS NOT NULL,
    'event_type',event_type,'event_key',event_key,'finished',is_finished);
END;
$function$;
