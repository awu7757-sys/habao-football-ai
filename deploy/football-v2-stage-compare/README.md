# Football V2 stage comparison

## What this adds

- Keeps the official/member-facing V2 snapshot and public performance record at T-10 hours.
- Captures separate research snapshots at T-10 hours, T-2 hours, and T-15 minutes.
- Captures all available totals and spread/Asian handicap lines from The Odds API, including both prices and bookmaker counts. Lines are collected from the market; the model does not assume fixed totals such as 2.5, 3.0, or 4.0.
- Scores the V2 Poisson choices against each stage's captured lines and verified final scores.
- The admin-only comparison shows four markets side by side: match winner, totals, handicap, and BTTS. Shadow results never enter public performance data.
- No database migration is needed; captured market details use the existing JSON fields.
- Historical snapshots may not contain all three stages or the full market-line data. Complete comparisons build up from new captures.

## Manual Supabase deployment

The project owner manages Supabase. The stage capture runner and the read-only comparison function are separate from the optional GPT/Claude review.

1. Update `football-v2-shadow-stage-runner` from `supabase/functions/football-v2-shadow-stage-runner/index.ts`. Keep its existing one-minute stage-runner cron and current secrets. The runner uses `THE_ODDS_API_KEY` or `ODDS_API_KEY` for market quotes.
2. Deploy `admin-football-v2-stage-compare` from `supabase/functions/admin-football-v2-stage-compare/index.ts`. Set **Verify JWT** off; it validates the admin session through `admin-center`. It uses the existing Supabase URL and service-role environment.
3. Publish the updated `admin-football-v2.js` after merging the UI change.

**GPT/Claude review is deferred.** Do not add API keys, enable `FOOTBALL_V2_LLM_SHADOW_ENABLED`, or create a cron for `football-v2-llm-shadow-runner` now. This does not block official T-10 predictions or the three-stage V2 comparison.

The stage runner may make up to three Odds API requests per match, one per snapshot stage. Market quote capture is optional and does not block V2 predictions.

## Reading the comparison

- T-10, T-2, and T-15 mean ten hours, two hours, and fifteen minutes before kickoff.
- The summary table compares the four requested markets side by side.
- Match-winner and BTTS rates count matches. Totals and handicap rates count individual quoted lines; each match may contribute multiple lines, and the page labels the denominator accordingly.
- Each line is settled using that stage's actual saved quote and the final score. Pushes are excluded from hit-rate denominators.
- Small samples are marked for caution. The panel also shows how many fixtures had quotes at all three stages.
- These are research comparisons only; public performance continues to use the official T-10 snapshot.
