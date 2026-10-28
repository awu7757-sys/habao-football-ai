-- Shadow-only odds recovery. Does not modify football_v2_shadow_inputs or V1.
CREATE TABLE IF NOT EXISTS public.football_v2_market_repair_audit (
  fixture_id bigint PRIMARY KEY,
  kickoff_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','captured','no_market','failed','unsupported_league','exhausted')),
  reason_code text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at timestamptz,
  terminal boolean NOT NULL DEFAULT false,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS football_v2_market_repair_retry_idx
  ON public.football_v2_market_repair_audit(next_retry_at)
  WHERE terminal = false;

-- Append-only market quotes, separate from the original immutable input snapshot.
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_market_quotes (
  fixture_id bigint NOT NULL,
  kickoff_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  capture_slot timestamptz NOT NULL,
  provider text NOT NULL,
  market_key text NOT NULL CHECK (market_key = 'totals'),
  total_line numeric NOT NULL,
  over_odds numeric NOT NULL,
  under_odds numeric NOT NULL,
  bookmaker_count integer NOT NULL DEFAULT 0,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  research_only boolean NOT NULL DEFAULT true,
  PRIMARY KEY (fixture_id, capture_slot)
);
CREATE INDEX IF NOT EXISTS football_v2_shadow_market_quotes_latest_idx
  ON public.football_v2_shadow_market_quotes(fixture_id, captured_at DESC);
ALTER TABLE public.football_v2_market_repair_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_market_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.football_v2_market_repair_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.football_v2_shadow_market_quotes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.football_v2_market_repair_audit TO service_role;
GRANT SELECT, INSERT ON public.football_v2_shadow_market_quotes TO service_role;
COMMENT ON TABLE public.football_v2_market_repair_audit IS
  'Tracks bounded, shadow-only retries for missing market quotes without changing immutable inputs.';
COMMENT ON TABLE public.football_v2_shadow_market_quotes IS
  'Append-only actual pre-match market quotes; captured_at records when the quote was observed.';
