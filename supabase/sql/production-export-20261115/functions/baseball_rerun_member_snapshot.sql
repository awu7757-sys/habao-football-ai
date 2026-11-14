-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: baseball_rerun_member_snapshot(text,bigint,bigint)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.baseball_rerun_member_snapshot(p_account text, p_game_id bigint, p_snapshot_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_member public.members%ROWTYPE;
  v_history public.member_baseball_analysis_history%ROWTYPE;
  v_refresh public.baseball_member_refresh_state%ROWTYPE;
  v_previous timestamptz;
BEGIN
  IF p_account IS NULL OR btrim(p_account)='' OR p_game_id IS NULL OR p_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'MLB_INVALID_REQUEST';
  END IF;
  SELECT * INTO v_member FROM public.members WHERE account=p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MLB_MEMBER_NOT_FOUND'; END IF;
  IF v_member.is_active IS DISTINCT FROM TRUE OR (v_member.expire_at IS NOT NULL AND v_member.expire_at <= now()) THEN
    RAISE EXCEPTION 'MLB_MEMBER_INACTIVE';
  END IF;
  SELECT * INTO v_history FROM public.member_baseball_analysis_history
   WHERE account=p_account AND game_id=p_game_id;
  IF NOT FOUND OR v_history.status IS DISTINCT FROM 'completed' OR v_history.result_data IS NULL THEN
    RAISE EXCEPTION 'MLB_FIRST_VIEW_REQUIRED';
  END IF;
  IF v_history.snapshot_id <> p_snapshot_id THEN RAISE EXCEPTION 'MLB_HISTORY_SNAPSHOT_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.baseball_t10_snapshots s WHERE s.id=p_snapshot_id AND s.game_id=p_game_id) THEN
    RAISE EXCEPTION 'MLB_OFFICIAL_SNAPSHOT_MISSING';
  END IF;
  SELECT * INTO v_refresh FROM public.baseball_member_refresh_state
   WHERE account=p_account AND game_id=p_game_id;
  v_previous := COALESCE(v_refresh.last_rerun_at,v_history.created_at);
  IF now() < v_previous + interval '6 hours' THEN
    RETURN jsonb_build_object('success',false,'error','MLB_RERUN_COOLDOWN',
      'next_rerun_at',v_previous+interval '6 hours');
  END IF;
  INSERT INTO public.baseball_member_refresh_state(account,game_id,last_rerun_at,rerun_count)
    VALUES(p_account,p_game_id,now(),1)
    ON CONFLICT(account,game_id) DO UPDATE
      SET last_rerun_at=now(),rerun_count=public.baseball_member_refresh_state.rerun_count+1;
  RETURN jsonb_build_object('success',true,'rerun',true,'snapshot_id',p_snapshot_id,
    'credit_charged',false,'next_rerun_at',now()+interval '6 hours');
END;
$function$;
