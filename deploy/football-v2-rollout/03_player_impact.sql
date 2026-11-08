-- Football V2 player impact: cached team/league/season player statistics and snapshot evidence.
ALTER TABLE public.football_v2_shadow_stage_snapshots
  ADD COLUMN IF NOT EXISTS player_adjustment jsonb;

CREATE TABLE IF NOT EXISTS public.football_v2_player_impact_cache (
  team_id bigint NOT NULL,
  league_id bigint NOT NULL,
  season integer NOT NULL,
  players jsonb NOT NULL DEFAULT '[]'::jsonb,
  roster_complete boolean NOT NULL DEFAULT false,
  cached_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'api_football_players_team_league_season',
  CONSTRAINT football_v2_player_impact_cache_pkey PRIMARY KEY (team_id, league_id, season)
);

CREATE INDEX IF NOT EXISTS football_v2_player_impact_cache_cached_at_idx
  ON public.football_v2_player_impact_cache (cached_at DESC);

ALTER TABLE public.football_v2_player_impact_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.football_v2_player_impact_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.football_v2_player_impact_cache TO service_role;
