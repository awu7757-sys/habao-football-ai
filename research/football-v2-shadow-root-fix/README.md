# HABAO Football V2 shadow odds recovery (draft)

This branch adds an isolated, shadow-only odds recovery path for upcoming fixtures. It is based on the 2026-10-29 read-only audit, which found existing V2 input rows with no total line and no explicit market status.

## What this addresses

- Existing inputs with missing odds are no longer treated as complete by the repair workflow.
- Each market retry records a reason, attempt count, and retry time.
- Real quotes are written to a separate append-only table with their actual capture time and source.
- The runner handles at most one fixture per invocation, one API-Football lookup and at most one Odds API request, and stops retrying after three attempts or inside the 30-minute kickoff guard.
- Existing `football_v2_shadow_inputs`, V1 snapshots, member records, public results, and historical odds remain untouched.

## Scope and status

This is a code draft for review on an isolated GitHub branch. It is not deployed. It only addresses odds recovery and auditability; it does not yet implement the full T-48/T-24 collector, expanded 12-match opponent-adjusted features, player/lineup source validation, calibrated V2.1, or T-10/T-2/T-15 snapshot orchestration.

## Required environment for the Edge Function

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `API_FOOTBALL_KEY`
- `THE_ODDS_API_KEY` (or `ODDS_API_KEY`)
- `FOOTBALL_V2_MARKET_CRON_KEY`

Do not put secret values in SQL, source control, or screenshots. Apply the SQL migration and deploy the function only after review and separate acceptance. No production cron is created by these files.
