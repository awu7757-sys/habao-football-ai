# Public performance and home statistics

Scope: performance.html, home-v2.html, and home-sports-stats.js. LINE URLs, admin.html, stored predictions, credits and backend deployments are unchanged.

- Both performance filters initially select 30 days, including after changing sport.
- Verification records independently request 30 days and exclude invalid, future and older-than-30-day kickoff timestamps. Expanding records cannot escape that window. Switching the chart to 7 days does not narrow verification records.
- Home verified count sums the three existing public API summary.verified_matches fields (existing all-time API scope; this is not the 30-day detail table). No rate averaging or market-count summation.
- Home member history reads the same three history endpoints and NBA/MLB stage history endpoints as My Analyses, with the actual member JWT. Count by sport + game ID, retaining the existing visibility period (kickoff + 8 hours). Missing/failed responses are not treated as zero.
- Home available games loads today/tomorrow in Taipei for football/NBA/MLB, deduplicates IDs per sport, applies the existing football league allowlist, excludes NBA non-NBA competitions and cancelled/postponed games, then uses shared HabaoStageCore and read-only member stage status for the same primary-button availability. Claimed stages waiting for the next opening do not count as currently actionable. No claim/capture/model/credit requests.
- The focus-match section retains its existing football content; only the three counters are in scope.

## Validation

Run `node deploy/public-home-20261115/tests.cjs` (9 checks) and `node deploy/public-home-20261115/performance-tests.cjs` (4 checks). Requests are mocked; no live Supabase connection is made. One intentional API 503 logs an expected error during the failure test.

Browser visual script: `node deploy/public-home-20261115/browser-tests.cjs`. Not completed in the authoring environment: Chromium process creation was blocked by socket permissions. DOM tests cover desktop/mobile record markup, but are not screenshots or visual sign-off. Set CHROMIUM_PATH for another local Chromium installation.

After Pages deployment, refresh the home and performance pages. Check all three sports start at 30D, switch chart to 7D, expand verification records and ensure they remain within 30 days. Home totals require all source APIs to respond successfully; `--` means incomplete evidence, not no games.

## Backend: user-run only

Open Supabase SQL Editor, paste `01_daily_verification_readonly.sql` and run. Export each result table. It only reads cron execution metadata and table column metadata; no API calls, jobs, deployments, billing or credentials are modified/read. The third result identifies exact current verification columns before a follow-up per-sport latest-settlement/backlog audit is prepared.

Cron `succeeded` can mean an HTTP request was queued, not that the Edge Function or settlement succeeded. Daily settlement health remains UNVERIFIED until live job, HTTP response and final-result evidence can be correlated. No schedule change should be made based only on this code review.
