-- Shadow-only feature preparation. All capture rows are immutable by fixture + stage.
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_fixture_calendar (
  calendar_date date PRIMARY KEY,
  fetched_at timestamptz NOT NULL,
  fixtures jsonb NOT NULL,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_team_history_cache (
  league_id integer NOT NULL,
  season integer NOT NULL,
  team_id bigint NOT NULL,
  fetched_at timestamptz NOT NULL,
  matches jsonb NOT NULL,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (league_id, season, team_id)
);
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_standings_cache (
  league_id integer NOT NULL,
  season integer NOT NULL,
  fetched_at timestamptz NOT NULL,
  standings jsonb NOT NULL,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (league_id, season)
);
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_feature_audit (
  fixture_id bigint NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prep_t48','prep_t24')),
  kickoff_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','ready','insufficient_data','failed','expired')),
  reason_code text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  terminal boolean NOT NULL DEFAULT false,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, stage)
);
CREATE INDEX IF NOT EXISTS football_v2_shadow_feature_audit_retry_idx
  ON public.football_v2_shadow_feature_audit(next_retry_at)
  WHERE terminal = false;
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_feature_snapshots (
  fixture_id bigint NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prep_t48','prep_t24')),
  kickoff_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  home_team_id bigint NOT NULL,
  away_team_id bigint NOT NULL,
  home_features jsonb NOT NULL,
  away_features jsonb NOT NULL,
  data_quality text NOT NULL,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text NOT NULL DEFAULT 'football-v2-features-0.1',
  research_only boolean NOT NULL DEFAULT true,
  PRIMARY KEY (fixture_id, stage)
);
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_api_budget (
  usage_date date PRIMARY KEY,
  calls_used integer NOT NULL DEFAULT 0 CHECK (calls_used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.reserve_football_v2_shadow_api_call(p_daily_cap integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_reserved integer;
BEGIN
  IF p_daily_cap IS NULL OR p_daily_cap < 1 THEN RETURN false; END IF;
  INSERT INTO public.football_v2_shadow_api_budget(usage_date,calls_used,updated_at)
  VALUES ((now() AT TIME ZONE 'UTC')::date,1,now())
  ON CONFLICT (usage_date) DO UPDATE
    SET calls_used = public.football_v2_shadow_api_budget.calls_used + 1, updated_at = now()
    WHERE public.football_v2_shadow_api_budget.calls_used < p_daily_cap
  RETURNING calls_used INTO v_reserved;
  RETURN v_reserved IS NOT NULL;
END;
$$;
ALTER TABLE public.football_v2_shadow_fixture_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_team_history_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_standings_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_feature_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_feature_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_api_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.football_v2_shadow_fixture_calendar, public.football_v2_shadow_team_history_cache,
  public.football_v2_shadow_standings_cache, public.football_v2_shadow_feature_audit,
  public.football_v2_shadow_feature_snapshots, public.football_v2_shadow_api_budget FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.football_v2_shadow_fixture_calendar,
  public.football_v2_shadow_team_history_cache, public.football_v2_shadow_standings_cache,
  public.football_v2_shadow_feature_audit TO service_role;
GRANT SELECT, INSERT ON public.football_v2_shadow_feature_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.football_v2_shadow_api_budget TO service_role;
REVOKE ALL ON FUNCTION public.reserve_football_v2_shadow_api_call(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_football_v2_shadow_api_call(integer) TO service_role;
COMMENT ON TABLE public.football_v2_shadow_feature_snapshots IS
  'Immutable pre-match V2 research features. Prep captures are distinct from T-10/T-2/T-15 prediction snapshots.';
