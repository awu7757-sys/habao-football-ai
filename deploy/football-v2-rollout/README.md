# Football V2 stage rollout

This package adds the T-2 and T-15 member analysis buttons for the pilot account, an admin switch for all members, and an admin-selected stage for the public performance page. The existing T-10 member analysis stays on `match-analysis` and remains the default public stage. Totals and handicap compare one recommendation per match, selected from that stage’s actual quoted lines and settled against its chosen line; no fixed 2.5/3/4 line is assumed.

## Apply in Supabase

1. Run `01_rollout_tables.sql` in SQL Editor. It adds JSONB evidence columns to the existing stage snapshot table, then creates rollout settings, public-stage change history, idempotent stage-claim tables, and a transactional admin settings RPC. The initial state is pilot-only, with T-10 selected for public results.
2. Update `football-v2-shadow-stage-runner/index.ts`. It records injuries and separately requests the lineups endpoint at both T-2 and T-15. Each injuries and lineup request consumes the existing Football API daily budget. These evidence fields are shown in the member analysis. `model_adjustment_applied` remains false because this model has no historical player-impact calibration; the Poisson probabilities are not numerically adjusted for an injured player.
3. Deploy `football-v2-stage-member`. Set **Verify JWT** to OFF. It checks the member account, rollout setting, stage order, saved stage snapshot, and consumes the existing analysis-credit RPC once per newly claimed stage. Reopening an already claimed stage is free.
4. Update `member-analysis-history/index.ts` so My Analyses displays the latest successfully claimed V2 stage without overwriting the original T-10 history record.
5. Update `admin-center/index.ts` to add the rollout and public-stage settings actions. Keep its existing Verify JWT setting and admin-session authentication.
6. Update `ai-performance/index.ts` for the public-stage selection. It uses verified final scores with the selected stage's actual saved market lines. Switching stages affects fixtures kicking off after the selection time; older public results remain unchanged. A post-switch fixture without the selected-stage snapshot is left out rather than silently scored as T-10.
7. Publish the website changes in `football.html`, `analysis.html`, `performance.html`, and `admin-football-v2.js` from the GitHub pull request.

## Initial state and operation

- The pilot is `google_2d3cef6b6e2d`; other members do not receive T-2/T-15 buttons until an administrator selects **一鍵開放所有會員** in Admin → 足球 V2 三階段比對.
- Members must first have their existing T-10 analysis saved. Then T-2 becomes available when its research snapshot is ready; T-15 becomes available after T-2 has been claimed and the T-15 snapshot is ready.
- Public performance starts at T-10. After comparing the three stages, select T-10, T-2, or T-15 in the admin page and save. Each switch is prospective; the change history keeps results from earlier selected stages intact.
- Injury and lineup API calls consume the existing Football API daily budget. When those feeds have no data, the analysis says so; it does not infer that a player is available.
- Claude and OpenAI review remain disabled. No model API key or recurring LLM cost is introduced.

## Files in this package

- `01_rollout_tables.sql`
- `supabase/functions/football-v2-shadow-stage-runner/index.ts`
- `supabase/functions/football-v2-stage-member/index.ts`
- `supabase/functions/member-analysis-history/index.ts`
- `supabase/functions/admin-center/index.ts`
- `supabase/functions/ai-performance/index.ts`
