-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: baseball_claim_member_snapshot(text,bigint,bigint)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.baseball_claim_member_snapshot(p_account text, p_game_id bigint, p_snapshot_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_member public.members%ROWTYPE;
  v_snapshot public.baseball_t10_snapshots%ROWTYPE;
  v_existing public.member_baseball_analysis_history%ROWTYPE;
  v_day date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_used integer := 0;
  v_limit integer := 0;
  v_unlimited_daily boolean := false;
  v_charge jsonb := NULL;
  v_charged boolean := false;
  v_credit_type text := NULL;
BEGIN
  IF p_account IS NULL OR length(btrim(p_account)) = 0 OR p_game_id IS NULL OR p_game_id <= 0 OR p_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'MLB_INVALID_REQUEST';
  END IF;

  -- Serialize all member balance/history claims for this account to prevent duplicate charges.
  SELECT * INTO v_member FROM public.members
    WHERE account = p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MLB_MEMBER_NOT_FOUND'; END IF;
  IF v_member.is_active IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'MLB_MEMBER_INACTIVE'; END IF;
  IF v_member.expire_at IS NOT NULL AND v_member.expire_at <= now() THEN
    RAISE EXCEPTION 'MLB_MEMBER_EXPIRED';
  END IF;

  SELECT * INTO v_snapshot FROM public.baseball_t10_snapshots
   WHERE id = p_snapshot_id AND game_id = p_game_id;
  IF NOT FOUND OR v_snapshot.analysis IS NULL THEN
    RAISE EXCEPTION 'MLB_OFFICIAL_SNAPSHOT_MISSING';
  END IF;
  IF now() < v_snapshot.kickoff_at - interval '10 hours' THEN
    RAISE EXCEPTION 'MLB_BEFORE_T10';
  END IF;

  SELECT * INTO v_existing FROM public.member_baseball_analysis_history
    WHERE account = p_account AND game_id = p_game_id;
  IF FOUND THEN
    IF v_existing.snapshot_id <> p_snapshot_id THEN RAISE EXCEPTION 'MLB_HISTORY_SNAPSHOT_MISMATCH'; END IF;
    IF v_existing.status <> 'completed' OR v_existing.result_data IS NULL THEN RAISE EXCEPTION 'MLB_HISTORY_INCOMPLETE'; END IF;
    RETURN jsonb_build_object('success',true,'first_view',false,'credit_charged',false,
      'history_id',v_existing.id,'snapshot_id',p_snapshot_id);
  END IF;

  -- Existing completed histories remain viewable after kickoff (handled above).
  -- A NEW first-view must never be charged after the scheduled first pitch.
  IF now() >= v_snapshot.kickoff_at THEN
    RAISE EXCEPTION 'MLB_MATCH_STARTED';
  END IF;

  -- Defense in depth: reject invalid/inconsistent official snapshots before credits.
  IF v_snapshot.analysis->>'sport' IS DISTINCT FROM 'baseball'
     OR (v_snapshot.analysis#>>'{fixture,game_id}')::text IS DISTINCT FROM p_game_id::text
     OR v_snapshot.analysis#>>'{model,status}' IS DISTINCT FROM 'candidate_projection_available'
  THEN
    RAISE EXCEPTION 'MLB_OFFICIAL_SNAPSHOT_INVALID';
  END IF;

  v_unlimited_daily := COALESCE(v_member.daily_analysis_unlimited,false);
  v_limit := GREATEST(0,COALESCE(v_member.daily_analysis_limit,0));
  SELECT COUNT(*)::integer INTO v_used FROM public.baseball_member_daily_usage
    WHERE account=p_account AND local_day=v_day;
  -- Daily usage remains recorded; do not reject before the atomic member-credit RPC.
  -- That RPC rejects only if both free and paid balances are exhausted.

  -- Use the existing shared football/NBA member-credit RPC INSIDE this transaction.
  -- If any later INSERT fails, PostgreSQL rolls back the RPC's balance changes too.
  IF COALESCE(v_member.analysis_unlimited,false) IS NOT TRUE THEN
    SELECT to_jsonb(charged) INTO v_charge
      FROM public.consume_member_analysis_credit(p_account) AS charged LIMIT 1;
    IF COALESCE((v_charge->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'MLB_NO_MEMBER_CREDITS';
    END IF;
    v_charged := true;
    v_credit_type := NULLIF(btrim(v_charge->>'consumed_type'), '');
    IF v_credit_type IS NULL THEN
      -- Refund is automatic because the whole database transaction rolls back.
      RAISE EXCEPTION 'MLB_CREDIT_TYPE_MISSING';
    END IF;
  END IF;

  INSERT INTO public.member_baseball_analysis_history
    (account,game_id,snapshot_id,fixture_time,home_team,away_team,league_name,
     match_status,result_data,status,credit_charged,consumed_credit_type)
  VALUES
    (p_account,p_game_id,p_snapshot_id,v_snapshot.kickoff_at,v_snapshot.home_team,v_snapshot.away_team,
     'MLB','scheduled',v_snapshot.analysis,'completed',v_charged,v_credit_type);

  INSERT INTO public.baseball_member_daily_usage(account,game_id,local_day)
    VALUES (p_account,p_game_id,v_day);

  RETURN jsonb_build_object('success',true,'first_view',true,'credit_charged',v_charged,
    'consumed_credit_type',v_credit_type,'snapshot_id',p_snapshot_id,'used',v_used+1,
    'limit',CASE WHEN v_unlimited_daily THEN NULL ELSE v_limit END,
    'remaining',CASE WHEN v_unlimited_daily THEN NULL ELSE GREATEST(0,v_limit-v_used-1) END);
END;
$function$;
