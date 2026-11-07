-- Prevent concurrent cron runs and member-triggered recovery from generating
-- duplicate T-2/T-15 snapshots or spending API calls at the same time.
CREATE TABLE IF NOT EXISTS public.football_v2_stage_capture_leases (
  fixture_id bigint NOT NULL,
  stage text NOT NULL CHECK (stage IN ('t2', 't15')),
  lease_token uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, stage)
);

ALTER TABLE public.football_v2_stage_capture_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.football_v2_stage_capture_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.football_v2_stage_capture_leases TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_football_v2_stage_capture_lease(
  p_fixture_id bigint,
  p_stage text,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 120
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE acquired boolean := false;
BEGIN
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 OR p_stage NOT IN ('t2', 't15')
     OR p_lease_token IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid_stage_capture_lease_parameters';
  END IF;

  INSERT INTO public.football_v2_stage_capture_leases (fixture_id, stage, lease_token, lease_until, updated_at)
  VALUES (p_fixture_id, p_stage, p_lease_token, now() + make_interval(secs => p_lease_seconds), now())
  ON CONFLICT (fixture_id, stage) DO UPDATE
    SET lease_token = EXCLUDED.lease_token,
        lease_until = EXCLUDED.lease_until,
        updated_at = now()
    WHERE public.football_v2_stage_capture_leases.lease_until < now()
  RETURNING true INTO acquired;

  RETURN COALESCE(acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_football_v2_stage_capture_lease(
  p_fixture_id bigint,
  p_stage text,
  p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM public.football_v2_stage_capture_leases
  WHERE fixture_id = p_fixture_id AND stage = p_stage AND lease_token = p_lease_token;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_football_v2_stage_capture_lease(bigint, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_football_v2_stage_capture_lease(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_football_v2_stage_capture_lease(bigint, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_football_v2_stage_capture_lease(bigint, text, uuid) TO service_role;
