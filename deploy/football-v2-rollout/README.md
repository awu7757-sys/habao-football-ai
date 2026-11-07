# Football V2 stage rollout and recovery

This package includes the T-2 and T-15 member analysis flow, admin rollout/public-stage settings, and recovery safeguards for missing snapshots. T-10 remains on the existing official analysis flow.

## Deploy order

1. In Supabase SQL Editor, run `02_stage_recovery_leases.sql`. It creates the restricted lease table and atomic reserve/release functions that prevent cron and member recovery from duplicating a stage capture. `01_rollout_tables.sql` was already applied earlier and does not need to be rerun.
2. Replace and deploy `football-v2-shadow-stage-runner/index.ts`. Keep its existing **Verify JWT OFF** setting, once-per-minute scheduled invocation, and `FOOTBALL_V2_STAGE_CRON_KEY`. The function still uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY`, odds key, and daily API-call cap.
3. Replace and deploy `football-v2-stage-member/index.ts`. Keep **Verify JWT OFF**, as in the existing setup. When a member selects T-2 or T-15 and its snapshot is missing, it asks the runner to recover it. It charges no analysis credit unless a snapshot is available and the claim succeeds.
4. Replace and deploy `ai-performance/index.ts` and `admin-football-v2-stage-compare/index.ts`. Public results and official paired-stage metrics ignore late recovery snapshots. The admin coverage row reports them separately as `late_recovery_snapshots`.

## Recovery behavior

- Cron checks T-2 throughout its active window (120 to 15 minutes before kickoff) and T-15 throughout its active window (15 minutes to kickoff). It captures each stage once; retries missing features or transient errors at most once every five minutes until that stage closes.
- Captures made within about 90 seconds of the scheduled T-2/T-15 point are marked `scheduled`. Later captures inside that stage's active window are marked `late_pre_match_recovery`, with their actual `captured_at`, planned target time, and capture lag. No capture is made after kickoff.
- A late recovery can support a member's analysis when cron missed the snapshot, but it is explicitly identified as a recovery and excluded from official stage comparison and public performance. It never claims to be an on-time T-2/T-15 sample.
- If the stage data still cannot be obtained, the UI receives `stage_snapshot_not_ready` and may retry. No credit is consumed. The admin audit records the latest retry status and reason.
- If the minute schedule itself is disabled or down, no automatic process can run during the outage; a member click can still request a one-time recovery while the stage is open. After kickoff, recovery is intentionally closed.

## Existing product settings

- Pilot account: `google_2d3cef6b6e2d`; all-member rollout remains controlled from Admin → 足球 V2 三階段比對.
- Public stage remains selected prospectively from the admin page. Late recovery is never eligible for the public results.
- T-2 and T-15 continue collecting injury and lineup evidence when the provider has it. The model does not invent player-impact weights; `model_adjustment_applied` remains false.
- GPT/Claude shadow calls remain disabled; no model API key or recurring LLM spend is introduced.

## Files

- `01_rollout_tables.sql` — previously applied rollout schema.
- `02_stage_recovery_leases.sql` — new required lease migration.
- `supabase/functions/football-v2-shadow-stage-runner/index.ts`
- `supabase/functions/football-v2-stage-member/index.ts`
- `supabase/functions/admin-football-v2-stage-compare/index.ts`
- `supabase/functions/ai-performance/index.ts`
- `supabase/functions/member-analysis-history/index.ts` and `supabase/functions/admin-center/index.ts` — unchanged companion functions for reference.
