# Production cron jobs (exported 2026-11-15, read-only)

Command text intentionally not exported (may contain keys). `calls` = Edge Function name parsed from the command.

| job | schedule (UTC) | active | calls |
|---|---|---|---|
| `football-v2-shadow-feature-prep` | `* * * * *` | yes | `football-v2-shadow-feature-runner` |
| `football-v2-shadow-stage-temp` | `* * * * *` | yes | `football-v2-shadow-stage-runner` |
| `habao-baseball-opening-every-6h` | `5 */6 * * *` | yes | `baseball-opening-capture` |
| `habao-baseball-results-every-30m` | `*/30 * * * *` | yes | `baseball-result-runner` |
| `habao-baseball-t10-every-15m` | `*/15 * * * *` | yes | `baseball-t10-job` |
| `habao-baseball-team-stats-every-6h` | `10 */6 * * *` | yes | `baseball-team-stats-cache` |
| `habao-baseball-v2-shadow-15min` | `*/15 * * * *` | yes | `baseball-v2-shadow` |
| `habao-basketball-result-every-30m` | `*/30 * * * *` | yes | `basketball-result-runner` |
| `habao-basketball-t10-every-15m` | `*/15 * * * *` | yes | `basketball-t10-job` |
| `habao-football-t10-rescue-every-5m` | `*/5 * * * *` | yes | `public-prediction-runner` |
| `habao-football-v2-repair-15min` | `*/15 * * * *` | yes | `football-v2-repair-runner` |
| `habao-football-verify-hourly` | `20 * * * *` | yes | `public-prediction-runner` |
| `habao-live-score-push-every-2-minutes` | `*/2 * * * *` | **no** | `live-score-push` |
| `habao-mlb-v2-stages-every-minute` | `* * * * *` | yes | `baseball-v2-stage-runner` |
| `habao-nba-v2-shadow-15min` | `*/15 * * * *` | **no** | `nba-v2-shadow-runner` |
| `habao-nba-v2-stages-every-minute` | `* * * * *` | yes | `nba-v2-stage-runner` |
| `habao-nba-v2-unified-15min` | `*/15 * * * *` | yes | `nba-v2-unified-runner` |
| `habao-nba-v3-efficiency-15min` | `*/15 * * * *` | **no** | `nba-v3-efficiency-runner` |
| `habao-nba-v3-player-timing-5min` | `*/5 * * * *` | **no** | `nba-v3-player-timing-runner` |
| `habao-sport-score-push-3min` | `*/3 * * * *` | yes | `habao-sport-score-push` |
| `habao-usage-snapshot-every-6-hours` | `15 */6 * * *` | yes | `usage-snapshot` |
| `habao-v3-daily-cleanup` | `10 20 * * *` | yes | `sql:habao_cleanup_admin_data` |
| `public-prediction-runner-hourly` | `0 * * * *` | yes | `public-prediction-runner` |
