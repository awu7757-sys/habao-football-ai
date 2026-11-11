# Football V2 stage rollout and recovery

This package includes the T-2 and T-15 member analysis flow, admin rollout/public-stage settings, and recovery safeguards for missing snapshots. T-10 remains on the existing official analysis flow.

## Deploy order

1. `01_rollout_tables.sql` and `02_stage_recovery_leases.sql` were already applied. In Supabase SQL Editor, run `03_player_impact.sql` if not already applied, then run `04_atomic_stage_claim.sql` before deploying the updated member function. It adds the player-stat cache and snapshot adjustment evidence column.
2. Replace and deploy `football-v2-shadow-stage-runner/index.ts`. Keep its existing **Verify JWT OFF** setting, once-per-minute scheduled invocation, and `FOOTBALL_V2_STAGE_CRON_KEY`. The function still uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY`, odds key, and daily API-call cap.
3. Replace and deploy `football-v2-stage-member/index.ts`. Keep **Verify JWT OFF**, as in the existing setup. The function verifies Supabase Auth identity for OAuth-backed accounts, including the pilot Google account. When a member selects T-2 or T-15 and its snapshot is missing, it asks the runner to recover it. It acquires the same database lock before calling the football data API, so concurrent clicks do not duplicate recovery calls. It charges no analysis credit unless a snapshot is available and the claim succeeds.
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
- The member page changes the T-2/T-15 button locally as kickoff approaches; the 15-second UI refresh does not call Supabase or the football API. T-2 is blue and T-15 is purple, with compact labels and the arrow retained.
- The admin coverage table lists on-time captures separately from late recovery captures; late recovery is not counted in the official comparison or public record.
- T-2 and T-15 use injury and confirmed lineup data in the player-impact calculation when player statistics are available. The research-only model compares actual/projected XI goal-involvement and defensive-action rates with the team regular XI; it also adjusts opponent xG when the goalkeeper changes. If key data is missing, it records the reason and leaves the base prediction intact. The provisional player-effect rule is not yet historically calibrated.
- GPT/Claude shadow calls remain disabled; no model API key or recurring LLM spend is introduced.

## Files

- `01_rollout_tables.sql` — previously applied rollout schema.
- `02_stage_recovery_leases.sql` — previously applied stage lease migration.
- `03_player_impact.sql` — new player cache and snapshot schema migration.
- `supabase/functions/football-v2-shadow-stage-runner/index.ts`
- `supabase/functions/football-v2-stage-member/index.ts`
- `supabase/functions/admin-football-v2-stage-compare/index.ts`
- `supabase/functions/ai-performance/index.ts`
- Player statistics are cached per team/league/season for 24 hours. On a cold cache, only the first 20-player page is requested (at most one extra API-Football call per team); if the team roster spans pages, the snapshot records partial coverage. T-15 generally reuses the T-2 cache. All football API calls still pass through the configured daily-call cap. GPT/Claude shadow calls remain disabled.
- `supabase/functions/member-analysis-history/index.ts` and `supabase/functions/admin-center/index.ts` — unchanged companion functions for reference.


## 2026-11-11 functional audit follow-up

Read [the functional audit and deployment steps](../football-functional-audit-20261111/README.md) before retesting. Member claims now commit the debit and saved result atomically. Existing saved T-2 can be claimed in the T-15 window. Capture completion times and public settings failures are handled explicitly. The read-only audit also flags an older settlement-direction mismatch for fixture 1557418; no historical snapshot or settlement is rewritten by this release.
