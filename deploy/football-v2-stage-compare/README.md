# Football V2 three-stage shadow comparison

This is a read-only, admin-only comparison for `football_v2_shadow_stage_snapshots` at T-10 hours, T-2 hours, and T-15 minutes.

## Included changes

- The admin Football V2 page displays same-fixture, verified-result accuracy for 1X2 and BTTS.
- It compares Over/Under at 2.5, 3, and 4 goals.
- It compares standard Asian handicap lines from the home team's perspective: -1.5, -1, -0.5, 0, +0.5, +1, and +1.5.
- Each stage requires a snapshot for the same fixture. Integer-total and integer-handicap pushes are excluded from the accuracy denominator.
- O/U and handicap probabilities are recomputed from each saved stage's xG using the same independent Poisson score grid and 0–18 truncation as model version `football-v2-poisson-shrinkage-0.2.1`.
- The comparison makes no Football API calls and writes no database rows.
- It does not change member analysis, the official T-10 snapshot, or public performance/standings.

The handicap comparison uses fixed research lines because the stage snapshot does not save a separate book handicap quote at each of the three capture times. It measures model score-distribution accuracy at those lines; it is not a comparison of live bookmaker prices.

## Supabase manual deployment

1. In the Supabase Dashboard, open Edge Functions and create `admin-football-v2-stage-compare`.
2. Paste `supabase/functions/admin-football-v2-stage-compare/index.ts` into the function's `index.ts` editor.
3. Turn **Verify JWT** off. The function checks `x-admin-session` by calling `admin-center` with `action: auth_me`, and allows super admins or admins with the `performance` permission.
4. Deploy the function. It uses existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no new secret, table, or migration is required.
5. After the website update is published, open Admin → 足球 V1／V2 模型比較 → V2 三階段影子準確率.

## Interpretation

When fewer than 30 fixtures have paired, verified results, treat the percentages as early research observations. The endpoint only compares fixtures with all three stage snapshots and a verified final score.
