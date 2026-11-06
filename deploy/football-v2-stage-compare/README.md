# Football V2 stage and AI shadow comparison

## What this adds

- Keeps the official/member-facing V2 snapshot at T-10 hours. The public performance record continues to use only that official T-10 snapshot.
- Captures separate research snapshots at T-10 hours, T-2 hours, and T-15 minutes.
- Captures all available paired totals and spread/Asian handicap lines from The Odds API, including their two prices and bookmaker counts. It does not substitute fixed totals such as 2.5, 3.0, or 4.0.
- Scores the deterministic Poisson V2 choices line by line using each snapshot's actual quote, expected return, and verified final score.
- Gives GPT and Claude the same frozen feature snapshot, V2 probabilities/xG/fair odds, and that stage's market quotes. They independently return shadow picks, disagreements, concerns, and evidence checks. They cannot alter V2 output.
- The admin-only V2 comparison page shows the three stage results, line-level totals and handicap results, and GPT/Claude results. None of these shadow comparisons enter public performance data.
- The AI shadow runner writes only the `source_meta.llm_shadow` JSON metadata on the research snapshot. It does not update the official prediction or public results.
- No database migration is needed: quote data already uses `market_context` JSON, and AI review data uses `source_meta` JSON.
- Historical snapshots do not contain the new full line set or GPT/Claude reviews. Those comparisons accumulate from new captures after deployment.

## Manual Supabase deployment

Supabase is managed by the project owner. Apply these steps in the Supabase project for the production branch.

1. **Update the market capture function.** In Supabase Dashboard → Edge Functions, update `football-v2-shadow-stage-runner` from `supabase/functions/football-v2-shadow-stage-runner/index.ts`. Confirm the existing Odds API secret is named `THE_ODDS_API_KEY` or `ODDS_API_KEY`. The runner uses either name.
2. **Update the comparison function.** Deploy `admin-football-v2-stage-compare` from `supabase/functions/admin-football-v2-stage-compare/index.ts`. Set **Verify JWT** off; the function validates the admin session with `admin-center`. It needs the existing Supabase URL and service-role environment.
3. **Add the independent AI runner.** Deploy `football-v2-llm-shadow-runner` from `supabase/functions/football-v2-llm-shadow-runner/index.ts`, with **Verify JWT** off. Its own cron-key check protects the endpoint.
4. In Supabase → Edge Functions → Secrets, add:
   - `FOOTBALL_V2_LLM_SHADOW_ENABLED=true`
   - `OPENAI_API_KEY` (an OpenAI API key)
   - `ANTHROPIC_API_KEY` (an Anthropic API key)
   - Optionally `FOOTBALL_V2_GPT_MODEL` and `FOOTBALL_V2_CLAUDE_MODEL`; defaults are `gpt-5-mini` and `claude-sonnet-4-5`.
   
   The LLM runner also reads the existing `FOOTBALL_V2_STAGE_CRON_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep all secret values in Supabase Secrets; do not put them in GitHub or chat. Claude web/app subscription is separate from Anthropic API billing.
5. **Schedule the LLM runner every minute.** In Supabase Cron, create a separate recurring Edge Function invocation for `football-v2-llm-shadow-runner` at `* * * * *`. Send a POST request with header `x-habao-cron-key` set from the existing `FOOTBALL_V2_STAGE_CRON_KEY`. Keep the existing stage-runner cron unchanged. The runner processes two pending snapshots per invocation to stay within function time limits.
6. Publish the updated `admin-football-v2.js` in the admin page. Open Admin → 足球 V1／V2 模型比較 → **V2 與 GPT／Claude 三階段影子比較**.

The stage runner can make up to three The Odds API requests per match (one at each research stage). Quote capture is optional and does not block V2 predictions. OpenAI and Anthropic API usage is billed by those providers.

## Reading the comparison

- T-10 means ten hours before kickoff; T-2 means two hours; T-15 means fifteen minutes.
- Each stage is scored against the exact market lines and prices captured at that stage. Individual lines appear separately; fixtures can have different lines.
- Totals and handicap summaries include line-level breakdowns. Pushes are excluded from hit-rate denominators; mean return includes pushes and half settlements.
- GPT and Claude are scored separately from V2. Missing or invalid provider output is shown as unavailable. These are research observations, not member recommendations.
- Treat percentages as early observations until each market/model has a reasonable sample; the admin page flags small matched samples.
