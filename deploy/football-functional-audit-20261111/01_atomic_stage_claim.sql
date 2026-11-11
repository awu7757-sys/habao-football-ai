-- Football V2 only: commit stage result and its one credit debit together.
-- Apply after existing rollout migrations 01-03. No existing snapshots or claims are rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_football_v2_stage_analysis_atomic(
  p_account text, p_fixture_id bigint, p_stage text, p_result_data jsonb,
  p_fixture_data jsonb, p_model_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $claim$
DECLARE
  member_row public.members%ROWTYPE;
  existing public.football_v2_stage_member_claims%ROWTYPE;
  snapshot public.football_v2_shadow_stage_snapshots%ROWTYPE;
  rollout public.football_v2_rollout_settings%ROWTYPE;
  credit jsonb;
BEGIN
  IF p_account IS NULL OR btrim(p_account)='' OR p_fixture_id IS NULL OR p_fixture_id<=0
     OR p_stage IS NULL OR p_stage NOT IN ('t2','t15') OR p_model_version IS NULL THEN
    RAISE EXCEPTION 'invalid_stage_claim';
  END IF;
  IF p_result_data IS NULL OR jsonb_typeof(p_result_data)<>'object'
     OR p_result_data->>'success' IS DISTINCT FROM 'true'
     OR p_result_data->>'v2_stage' IS DISTINCT FROM p_stage
     OR p_result_data#>>'{fixture,id}' IS DISTINCT FROM p_fixture_id::text THEN
    RAISE EXCEPTION 'invalid_stage_result';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_account,p_fixture_id,p_stage)::text,0));
  SELECT * INTO rollout FROM public.football_v2_rollout_settings WHERE id=true;
  IF rollout.all_members_enabled IS DISTINCT FROM true AND p_account IS DISTINCT FROM coalesce(rollout.pilot_account,'google_2d3cef6b6e2d') THEN
    RAISE EXCEPTION 'stage_access_disabled';
  END IF;
  SELECT * INTO member_row FROM public.members WHERE account=p_account FOR UPDATE;
  IF NOT FOUND OR member_row.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'member_inactive';
  END IF;
  SELECT * INTO existing FROM public.football_v2_stage_member_claims
    WHERE account=p_account AND fixture_id=p_fixture_id AND stage=p_stage;
  IF FOUND THEN
    IF existing.claim_state='claimed' AND existing.result_data IS NOT NULL THEN
      RETURN jsonb_build_object('success',true,'already_claimed',true,'result',existing.result_data);
    END IF;
    -- Old two-request processing rows have unknown debit state. Never guess or debit again.
    RAISE EXCEPTION 'legacy_stage_claim_requires_reconciliation';
  END IF;
  SELECT * INTO snapshot FROM public.football_v2_shadow_stage_snapshots
    WHERE fixture_id=p_fixture_id AND stage=p_stage AND model_version=p_model_version AND research_only=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage_snapshot_not_ready'; END IF;
  IF snapshot.captured_at IS NULL OR snapshot.captured_at>=snapshot.kickoff_at THEN
    RAISE EXCEPTION 'invalid_stage_snapshot_time';
  END IF;
  IF clock_timestamp()>=snapshot.kickoff_at THEN RAISE EXCEPTION 'match_already_started'; END IF;
  IF clock_timestamp()<snapshot.kickoff_at-(CASE WHEN p_stage='t2' THEN interval '120 minutes' ELSE interval '15 minutes' END) THEN
    RAISE EXCEPTION 'stage_not_open';
  END IF;
  -- T-2 already saved before its window closed may be claimed during T-15.
  IF member_row.analysis_unlimited IS DISTINCT FROM true THEN
    SELECT to_jsonb(c) INTO credit FROM public.consume_member_analysis_credit(p_account) c;
    IF credit IS NULL OR credit->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'analysis_credits_empty';
    END IF;
  END IF;
  INSERT INTO public.football_v2_stage_member_claims
    (account,fixture_id,stage,claim_state,fixture_data,result_data,model_version,claimed_at)
  VALUES (p_account,p_fixture_id,p_stage,'claimed',coalesce(p_fixture_data,'{}'::jsonb),p_result_data,p_model_version,clock_timestamp());
  RETURN jsonb_build_object('success',true,'already_claimed',false,'result',p_result_data,
    'member_access',coalesce(credit,'{}'::jsonb)||jsonb_build_object('analysis_unlimited',member_row.analysis_unlimited IS TRUE));
END;
$claim$;
REVOKE ALL ON FUNCTION public.claim_football_v2_stage_analysis_atomic(text,bigint,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_football_v2_stage_analysis_atomic(text,bigint,text,jsonb,jsonb,text) TO service_role;
COMMIT;
