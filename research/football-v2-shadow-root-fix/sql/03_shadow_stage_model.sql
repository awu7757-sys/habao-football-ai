-- Immutable V2 research predictions at T-15, T-10 and T-2. No production tables touched.
CREATE TABLE IF NOT EXISTS public.football_v2_shadow_stage_audit (
  fixture_id bigint NOT NULL,
  stage text NOT NULL CHECK (stage IN ('t15','t10','t2')),
  kickoff_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','ready','missing_features','expired','failed')),
  reason_code text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  terminal boolean NOT NULL DEFAULT false,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, stage)
);
CREATE INDEX IF NOT EXISTS football_v2_shadow_stage_audit_due_idx
  ON public.football_v2_shadow_stage_audit(kickoff_at, stage) WHERE terminal = false;

CREATE TABLE IF NOT EXISTS public.football_v2_shadow_stage_snapshots (
  fixture_id bigint NOT NULL,
  stage text NOT NULL CHECK (stage IN ('t15','t10','t2')),
  kickoff_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  home_team_id bigint NOT NULL,
  away_team_id bigint NOT NULL,
  home_xg numeric,
  away_xg numeric,
  probabilities jsonb NOT NULL,
  fair_odds jsonb NOT NULL,
  market_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  lineup_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_quality text NOT NULL,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text NOT NULL,
  research_only boolean NOT NULL DEFAULT true,
  PRIMARY KEY (fixture_id, stage)
);
CREATE INDEX IF NOT EXISTS football_v2_shadow_stage_snapshots_captured_idx
  ON public.football_v2_shadow_stage_snapshots(captured_at DESC);

ALTER TABLE public.football_v2_shadow_stage_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.football_v2_shadow_stage_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.football_v2_shadow_stage_audit, public.football_v2_shadow_stage_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.football_v2_shadow_stage_audit TO service_role;
GRANT SELECT, INSERT ON public.football_v2_shadow_stage_snapshots TO service_role;
COMMENT ON TABLE public.football_v2_shadow_stage_snapshots IS
  'Immutable and independent V2 research predictions captured near T-15/T-10/T-2. Never read as member/public predictions.';
