# Football V2 three-stage market comparison

This is an admin-only research comparison of V2 snapshots at T-10 hours, T-2 hours, and T-15 minutes. It does not alter the member-facing T-10 snapshot or public performance data.

## Included changes

- The admin Football V2 page compares paired, verified results for 1X2 and BTTS.
- Totals and Asian handicap use the actual line and both decimal prices captured for each fixture at each stage. Lines may differ by fixture and by stage; no fixed 2.5/3/4 totals or standard handicap lines are substituted.
- For each saved xG score grid, the endpoint chooses the side with the higher expected return at that stage's quote, then settles it against the verified score. Quarter lines are split into adjacent lines for settlement.
- A market's T-10/T-2/T-15 comparison uses only fixtures with valid quotes for that market at all three stages, so the three percentages use the same match set. Pushes are excluded from hit-rate denominators; average return per unit is shown alongside accuracy.
- The comparison endpoint makes no Football API or odds-provider calls and writes no database rows. The stage runner makes one The Odds API request per fixture-stage capture (up to three requests per match) to record totals and spreads.
- This does not change member analysis, the official T-10 snapshot, or public performance/standings.
- Older snapshots without stage-specific captured quotes cannot be backfilled into this market-line comparison. They remain eligible for 1X2/BTTS comparisons; market comparison coverage builds from new captures after deployment.

## Supabase manual deployment

The user operates Supabase deployment. No database migration is needed because the existing `football_v2_shadow_stage_snapshots.market_context` JSON field stores the quote.

1. In Supabase Dashboard → Edge Functions, open `football-v2-shadow-stage-runner` and update its `index.ts` from `supabase/functions/football-v2-shadow-stage-runner/index.ts`.
2. Confirm the project has an Odds API secret named `THE_ODDS_API_KEY` or `ODDS_API_KEY`. The runner uses either name. Do not paste the key into code or chat. If neither secret exists, add the Odds API key in Supabase Secrets before deploying.
3. Deploy the updated runner. Each eligible stage capture requests both totals and spreads from The Odds API. It can use up to three requests per fixture (T-15, T-10, T-2); account for the provider's quota. Missing/unavailable quotes do not block the V2 prediction snapshot, but that fixture-stage will not enter the matching market comparison.
4. Deploy/update `admin-football-v2-stage-compare` from `supabase/functions/admin-football-v2-stage-compare/index.ts`. Turn **Verify JWT** off. It authenticates the admin session through `admin-center` and allows super admins or admins with the `performance` permission. It uses existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
5. Publish `admin-football-v2.js` from this change. Open Admin → 足球 V1／V2 模型比較 → V2 三階段影子準確率.

## Interpretation

When fewer than 30 fixtures have paired, verified results for a market, treat its percentages as early research observations. The endpoint compares only fixtures with all three stage snapshots and a verified final score; totals and handicaps also require a valid quote in all three snapshots.
