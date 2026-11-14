-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: acquire_mlb_stage_capture(bigint,text,text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.acquire_mlb_stage_capture(p_game_id bigint, p_stage text, p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
END $function$;
