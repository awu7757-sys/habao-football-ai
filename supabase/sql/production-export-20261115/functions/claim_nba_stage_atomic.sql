-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: claim_nba_stage_atomic(text,bigint,text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.claim_nba_stage_atomic(p_account text, p_game_id bigint, p_stage text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.members%ROWTYPE; s public.basketball_v2_stage_snapshots%ROWTYPE;
 c public.basketball_v2_stage_claims%ROWTYPE; settings public.basketball_v2_stage_settings%ROWTYPE; credit jsonb;
BEGIN
 IF p_account IS NULL OR btrim(p_account)='' OR p_game_id IS NULL OR p_game_id<=0 OR p_stage IS NULL OR p_stage NOT IN('t2','t15') THEN RAISE EXCEPTION 'invalid_stage_claim'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_account,p_game_id,p_stage)::text,0));
 SELECT * INTO settings FROM public.basketball_v2_stage_settings WHERE id=true;
 IF NOT FOUND OR (settings.all_members_enabled IS DISTINCT FROM true AND p_account IS DISTINCT FROM settings.pilot_account) THEN RAISE EXCEPTION 'stage_access_disabled'; END IF;
 SELECT * INTO m FROM public.members WHERE account=p_account FOR UPDATE;
 IF NOT FOUND OR m.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'member_inactive'; END IF;
 SELECT * INTO c FROM public.basketball_v2_stage_claims WHERE account=p_account AND game_id=p_game_id AND stage=p_stage;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'already_claimed',true,'result',c.result_data); END IF;
 SELECT * INTO s FROM public.basketball_v2_stage_snapshots WHERE game_id=p_game_id AND stage=p_stage AND status='ready';
 IF NOT FOUND THEN RAISE EXCEPTION 'stage_snapshot_not_ready'; END IF;
 IF s.captured_at IS NULL OR s.captured_at>=s.fixture_time OR s.result_data->>'success' IS DISTINCT FROM 'true'
 OR s.result_data->>'v2_stage' IS DISTINCT FROM p_stage OR s.result_data->>'game_id' IS DISTINCT FROM p_game_id::text THEN RAISE EXCEPTION 'invalid_stage_result'; END IF;
 IF clock_timestamp()>=s.fixture_time THEN RAISE EXCEPTION 'match_already_started'; END IF;
 IF clock_timestamp()<s.fixture_time-(CASE WHEN p_stage='t2' THEN interval '2 hours' ELSE interval '15 minutes' END) THEN RAISE EXCEPTION 'stage_not_open'; END IF;
 IF m.analysis_unlimited IS DISTINCT FROM true THEN
  SELECT to_jsonb(x) INTO credit FROM public.consume_member_analysis_credit(p_account) x;
  IF credit IS NULL OR credit->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'analysis_credits_empty'; END IF;
 END IF;
 INSERT INTO public.basketball_v2_stage_claims(account,game_id,stage,fixture_time,result_data)
 VALUES(p_account,p_game_id,p_stage,s.fixture_time,s.result_data);
 RETURN jsonb_build_object('success',true,'already_claimed',false,'result',s.result_data,
 'member_access',coalesce(credit,'{}'::jsonb)||jsonb_build_object('analysis_unlimited',m.analysis_unlimited IS TRUE));
END $function$;
