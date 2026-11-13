-- MLB T-2/T-15. All active members. Existing T-10 and public records stay immutable.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sports_release_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),revision text NOT NULL,enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.sports_release_settings(id,revision,enabled) VALUES(true,'sports-release-20261113-1',false) ON CONFLICT DO NOTHING;
ALTER TABLE public.sports_release_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sports_release_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sports_release_settings TO service_role;

CREATE OR REPLACE VIEW public.sports_mlb_t10_source AS
SELECT game_id,kickoff_at AS fixture_time,(analysis->>'as_of')::timestamptz AS generated_at,
analysis AS prediction_data FROM public.baseball_t10_snapshots;
REVOKE ALL ON public.sports_mlb_t10_source FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sports_mlb_t10_source TO service_role;

CREATE TABLE IF NOT EXISTS public.baseball_v2_stage_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 pilot_account text NOT NULL DEFAULT '',
 all_members_enabled boolean NOT NULL DEFAULT true
);
INSERT INTO public.baseball_v2_stage_settings(id,pilot_account,all_members_enabled) VALUES(true,'',true) ON CONFLICT(id) DO UPDATE SET all_members_enabled=true,pilot_account='';
CREATE TABLE IF NOT EXISTS public.baseball_v2_stage_snapshots (
 game_id bigint NOT NULL, stage text NOT NULL CHECK(stage IN('t2','t15')),
 fixture_time timestamptz NOT NULL, source_snapshot_at timestamptz NOT NULL,
 model_version text NOT NULL, status text NOT NULL CHECK(status IN('processing','ready','source_error','insufficient_data')),
 captured_at timestamptz, model_output jsonb, result_data jsonb,
 source_meta jsonb NOT NULL DEFAULT '{}', research_only boolean NOT NULL DEFAULT true CHECK(research_only),
 lease_token text, attempts integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(game_id,stage),
 CHECK(source_snapshot_at<fixture_time),
 CHECK(status<>'ready' OR (captured_at IS NOT NULL AND captured_at<fixture_time AND model_output IS NOT NULL AND result_data IS NOT NULL)),
 CHECK(status<>'ready' OR (captured_at>=fixture_time-(CASE WHEN stage='t2' THEN interval '2 hours' ELSE interval '15 minutes' END)
 AND (stage<>'t2' OR captured_at<fixture_time-interval '15 minutes')))
);
CREATE TABLE IF NOT EXISTS public.baseball_v2_stage_claims (
 account text NOT NULL, game_id bigint NOT NULL, stage text NOT NULL CHECK(stage IN('t2','t15')),
 fixture_time timestamptz NOT NULL, result_data jsonb NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account,game_id,stage)
);
CREATE INDEX IF NOT EXISTS baseball_v2_stage_claims_account_time ON public.baseball_v2_stage_claims(account,fixture_time DESC);
CREATE TABLE IF NOT EXISTS public.baseball_v2_stage_api_budget (
 usage_date date NOT NULL, provider text NOT NULL CHECK(provider IN('mlb','odds')),
 used_count integer NOT NULL DEFAULT 0 CHECK(used_count>=0), PRIMARY KEY(usage_date,provider)
);
DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['baseball_v2_stage_settings','baseball_v2_stage_snapshots','baseball_v2_stage_claims','baseball_v2_stage_api_budget'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $rls$;

CREATE OR REPLACE FUNCTION public.reserve_mlb_stage_api(p_provider text,p_cost integer,p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE n integer; day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_provider NOT IN('mlb','odds') OR p_cost IS NULL OR p_limit IS NULL OR p_cost<1 OR p_limit<1 OR p_cost>p_limit THEN RETURN false; END IF;
 INSERT INTO public.baseball_v2_stage_api_budget(usage_date,provider) VALUES(day,p_provider) ON CONFLICT DO NOTHING;
 UPDATE public.baseball_v2_stage_api_budget SET used_count=used_count+p_cost
 WHERE usage_date=day AND provider=p_provider AND used_count+p_cost<=p_limit RETURNING used_count INTO n;
 RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION public.acquire_mlb_stage_capture(p_game_id bigint,p_stage text,p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE s public.sports_mlb_t10_source%ROWTYPE; n integer; now_at timestamptz:=clock_timestamp();
BEGIN
 IF p_game_id IS NULL OR p_game_id<=0 OR p_stage IS NULL OR p_stage NOT IN('t2','t15') OR coalesce(length(p_token),0)<10 THEN RETURN false; END IF;
 SELECT * INTO s FROM public.sports_mlb_t10_source WHERE game_id=p_game_id;
 IF NOT FOUND OR s.fixture_time IS NULL OR s.generated_at IS NULL OR s.generated_at>=s.fixture_time
 OR now_at>=s.fixture_time OR now_at<s.fixture_time-(CASE WHEN p_stage='t2' THEN interval '2 hours' ELSE interval '15 minutes' END)
 OR (p_stage='t2' AND now_at>=s.fixture_time-interval '15 minutes') THEN RETURN false; END IF;
 IF s.generated_at<s.fixture_time-interval '10 hours 30 minutes' OR s.generated_at>s.fixture_time-interval '8 hours' THEN RETURN false; END IF;
 INSERT INTO public.baseball_v2_stage_snapshots(game_id,stage,fixture_time,source_snapshot_at,model_version,status,lease_token,updated_at)
 VALUES(p_game_id,p_stage,s.fixture_time,s.generated_at,'mlb-stages-season-recent-starters-v0.3','processing',p_token,now_at)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=1 THEN RETURN true; END IF;
 UPDATE public.baseball_v2_stage_snapshots SET status='processing',lease_token=p_token,attempts=attempts+1,updated_at=now_at
 WHERE game_id=p_game_id AND stage=p_stage AND attempts<4 AND
 ((status IN('source_error','insufficient_data') AND updated_at<now_at-interval '2 minutes') OR
 (status='processing' AND updated_at<now_at-interval '5 minutes'));
 RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION public.claim_mlb_stage_atomic(p_account text,p_game_id bigint,p_stage text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE m public.members%ROWTYPE; s public.baseball_v2_stage_snapshots%ROWTYPE;
 c public.baseball_v2_stage_claims%ROWTYPE; settings public.baseball_v2_stage_settings%ROWTYPE; credit jsonb;
BEGIN
 IF p_account IS NULL OR btrim(p_account)='' OR p_game_id IS NULL OR p_game_id<=0 OR p_stage IS NULL OR p_stage NOT IN('t2','t15') THEN RAISE EXCEPTION 'invalid_stage_claim'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_account,p_game_id,p_stage)::text,0));
 SELECT * INTO settings FROM public.baseball_v2_stage_settings WHERE id=true;
 IF NOT FOUND OR (settings.all_members_enabled IS DISTINCT FROM true AND p_account IS DISTINCT FROM settings.pilot_account) THEN RAISE EXCEPTION 'stage_access_disabled'; END IF;
 SELECT * INTO m FROM public.members WHERE account=p_account FOR UPDATE;
 IF NOT FOUND OR m.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'member_inactive'; END IF;
 SELECT * INTO c FROM public.baseball_v2_stage_claims WHERE account=p_account AND game_id=p_game_id AND stage=p_stage;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'already_claimed',true,'result',c.result_data); END IF;
 SELECT * INTO s FROM public.baseball_v2_stage_snapshots WHERE game_id=p_game_id AND stage=p_stage AND status='ready';
 IF NOT FOUND THEN RAISE EXCEPTION 'stage_snapshot_not_ready'; END IF;
 IF s.captured_at IS NULL OR s.captured_at>=s.fixture_time OR s.result_data->>'success' IS DISTINCT FROM 'true'
 OR s.result_data->>'v2_stage' IS DISTINCT FROM p_stage OR s.result_data->>'game_id' IS DISTINCT FROM p_game_id::text THEN RAISE EXCEPTION 'invalid_stage_result'; END IF;
 IF clock_timestamp()>=s.fixture_time THEN RAISE EXCEPTION 'match_already_started'; END IF;
 IF clock_timestamp()<s.fixture_time-(CASE WHEN p_stage='t2' THEN interval '2 hours' ELSE interval '15 minutes' END) THEN RAISE EXCEPTION 'stage_not_open'; END IF;
 IF m.analysis_unlimited IS DISTINCT FROM true THEN
  SELECT to_jsonb(x) INTO credit FROM public.consume_member_analysis_credit(p_account) x;
  IF credit IS NULL OR credit->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'analysis_credits_empty'; END IF;
 END IF;
 INSERT INTO public.baseball_v2_stage_claims(account,game_id,stage,fixture_time,result_data)
 VALUES(p_account,p_game_id,p_stage,s.fixture_time,s.result_data);
 RETURN jsonb_build_object('success',true,'already_claimed',false,'result',s.result_data,
 'member_access',coalesce(credit,'{}'::jsonb)||jsonb_build_object('analysis_unlimited',m.analysis_unlimited IS TRUE));
END $fn$;
REVOKE ALL ON FUNCTION public.reserve_mlb_stage_api(text,integer,integer),public.acquire_mlb_stage_capture(bigint,text,text),public.claim_mlb_stage_atomic(text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_mlb_stage_api(text,integer,integer),public.acquire_mlb_stage_capture(bigint,text,text),public.claim_mlb_stage_atomic(text,bigint,text) TO service_role;
COMMIT;
