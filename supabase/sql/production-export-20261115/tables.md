# Production public tables & columns (exported 2026-11-15, read-only)

Column defaults shown as exported. Indexes, constraints, triggers and RLS are not included.

## `admin_login_attempts`

```text
attempt_key text
failed_count integer default 0
first_failed_at timestamp with time zone default now()
last_failed_at timestamp with time zone default now()
locked_until timestamp with time zone
```

## `admin_sessions`

```text
id uuid default gen_random_uuid()
token_hash text
admin_user_id bigint
is_super_admin boolean default false
expires_at timestamp with time zone
revoked_at timestamp with time zone
created_at timestamp with time zone default now()
last_seen_at timestamp with time zone default now()
```

## `admin_users`

```text
id bigint
username text
display_name text default ''::text
password_hash text
password_salt text
password_iterations integer default 210000
permissions ARRAY default '{}'::text[]
is_active boolean default true
created_by text default 'super-admin'::text
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
last_login_at timestamp with time zone
```

## `ai_backtest_summary`

```text
id bigint
sport text default 'football'::text
active boolean default true
sample_matches integer default 0
moneyline jsonb default '{"win": 0, "loss": 0, "push": 0, "total": 0, "half_win": 0, "half_loss": 0}'::jsonb
over_under jsonb default '{"win": 0, "loss": 0, "push": 0, "total": 0, "half_win": 0, "half_loss": 0}'::jsonb
btts jsonb default '{"win": 0, "loss": 0, "push": 0, "total": 0, "half_win": 0, "half_loss": 0}'::jsonb
range_start date
range_end date
updated_at timestamp with time zone default now()
sample_kind text default 'historical_backtest'::text
sample_note text
```

## `ai_prediction_snapshots`

```text
id bigint
created_at timestamp with time zone default now()
fixture_id bigint
kickoff_at timestamp with time zone
league_name text
home_team text
away_team text
prediction jsonb
locked_at timestamp with time zone default now()
status text default '''pending'''::text
home_score integer
away_score integer
finished_at timestamp with time zone
settlement jsonb
verified_at timestamp with time zone
excluded_from_public boolean default false
excluded_at timestamp with time zone
exclusion_note text
```

## `analysis_jobs`

```text
id uuid default gen_random_uuid()
account text
job_type text
fixture_ids ARRAY
status text default 'queued'::text
total_count integer default 0
completed_count integer default 0
failed_count integer default 0
current_fixture_id bigint
results jsonb default '[]'::jsonb
failures jsonb default '[]'::jsonb
error_message text
created_at timestamp with time zone default now()
started_at timestamp with time zone
completed_at timestamp with time zone
updated_at timestamp with time zone default now()
```

## `analysis_usage`

```text
id bigint
created_at timestamp with time zone default now()
account text
fixture_id bigint
usage_date date default CURRENT_DATE
```

## `api_usage`

```text
id bigint
created_at timestamp with time zone default now()
source text
endpoint text
usage_date date
```

## `baseball_member_daily_usage`

```text
id bigint
account text
game_id bigint
local_day date
used_at timestamp with time zone default now()
```

## `baseball_member_refresh_state`

```text
account text
game_id bigint
last_rerun_at timestamp with time zone default now()
rerun_count integer default 1
```

## `baseball_opening_lines`

```text
game_id bigint
odds_event_id text
kickoff_at timestamp with time zone
home_team text
away_team text
observed_at timestamp with time zone
captured_at timestamp with time zone default now()
origin text
bookmakers_count integer
lines jsonb
provider text default 'the_odds_api_v4'::text
```

## `baseball_stats_health_cache`

```text
cache_key text
fetched_at timestamp with time zone default now()
expires_at timestamp with time zone
payload jsonb
http_status integer default 200
```

## `baseball_t10_snapshots`

```text
id bigint
game_id bigint
season integer
kickoff_at timestamp with time zone
home_team text
away_team text
analysis jsonb
model_version text
created_at timestamp with time zone default now()
scheduled_t10_at timestamp with time zone
analyzed_at timestamp with time zone
analysis_delay_seconds integer
record_source text default 'SYSTEM_AUTO'::text
```

## `baseball_team_stats_cache`

```text
team_id bigint
season integer
stats jsonb
fetched_at timestamp with time zone default now()
source text default 'MLB Stats API'::text
```

## `baseball_v2_shadow_snapshots`

```text
id bigint
game_id bigint
snapshot_stage text
season integer
kickoff_at timestamp with time zone
as_of timestamp with time zone
model_version text
home_team text
away_team text
status text
inputs jsonb default '{}'::jsonb
prediction jsonb
quality jsonb default '{}'::jsonb
created_at timestamp with time zone default now()
```

## `baseball_v2_stage_api_budget`

```text
usage_date date
provider text
used_count integer default 0
```

## `baseball_v2_stage_claims`

```text
account text
game_id bigint
stage text
fixture_time timestamp with time zone
result_data jsonb
claimed_at timestamp with time zone default now()
```

## `baseball_v2_stage_settings`

```text
id boolean default true
pilot_account text default ''::text
all_members_enabled boolean default true
```

## `baseball_v2_stage_snapshots`

```text
game_id bigint
stage text
fixture_time timestamp with time zone
source_snapshot_at timestamp with time zone
model_version text
status text
captured_at timestamp with time zone
model_output jsonb
result_data jsonb
source_meta jsonb default '{}'::jsonb
research_only boolean default true
lease_token text
attempts integer default 1
updated_at timestamp with time zone default now()
```

## `baseball_verified_results`

```text
id bigint
game_id bigint
kickoff_at timestamp with time zone
home_team text
away_team text
home_score integer
away_score integer
final_status text default 'Final'::text
moneyline_result text
totals_result text
handicap_result text
snapshot_id bigint
verified_at timestamp with time zone default now()
verifier_version text default 'mlb-result-v1'::text
```

## `basketball_analysis_cache`

```text
id uuid default gen_random_uuid()
game_id bigint
fixture_time timestamp with time zone
league text default 'NBA'::text
season integer
stage integer
home_team text
away_team text
home_team_id bigint
away_team_id bigint
model_version text
analysis_data jsonb
generated_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
source text default 't10_auto'::text
status text default 'ready'::text
```

## `basketball_analysis_usage`

```text
id uuid default gen_random_uuid()
account text
game_id bigint
usage_date date
created_at timestamp with time zone default now()
```

## `basketball_api_usage_daily`

```text
usage_date date
used_count integer default 0
remaining_count integer
daily_limit integer default 7500
source_fetched_at timestamp with time zone
updated_at timestamp with time zone default now()
```

## `basketball_external_feed_cache`

```text
source_key text
provider text
payload jsonb default '{}'::jsonb
fetched_at timestamp with time zone default now()
expires_at timestamp with time zone
meta jsonb
last_error text
```

## `basketball_fixture_cache`

```text
fixture_date date
fixtures jsonb default '[]'::jsonb
total integer default 0
counts jsonb
quota jsonb
fetched_at timestamp with time zone default now()
source text default 'basketball-t10-job'::text
```

## `basketball_prediction_snapshots`

```text
id uuid default gen_random_uuid()
game_id bigint
fixture_time timestamp with time zone
home_team text
away_team text
model_version text
prediction_data jsonb
generated_at timestamp with time zone default now()
source text default 't10_auto'::text
league_name text default 'NBA'::text
status text default 'pending'::text
final_home integer
final_away integer
final_score text
game_status text
settlement jsonb
verified_at timestamp with time zone
verification_error text
excluded_from_public boolean default false
excluded_at timestamp with time zone
```

## `basketball_v2_box_cache`

```text
game_id bigint
status text
box_data jsonb
reason text
updated_at timestamp with time zone default now()
```

## `basketball_v2_shadow_models`

```text
game_id bigint
fixture_time timestamp with time zone
source_snapshot_at timestamp with time zone
home_team text default ''::text
away_team text default ''::text
model_version text
status text
source_meta jsonb default '{}'::jsonb
model_output jsonb
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
research_only boolean default true
```

## `basketball_v2_stage_api_budget`

```text
usage_date date
provider text
used_count integer default 0
```

## `basketball_v2_stage_claims`

```text
account text
game_id bigint
stage text
fixture_time timestamp with time zone
result_data jsonb
claimed_at timestamp with time zone default now()
```

## `basketball_v2_stage_settings`

```text
id boolean default true
pilot_account text default 'google_2d3cef6b6e2d'::text
all_members_enabled boolean default false
```

## `basketball_v2_stage_snapshots`

```text
game_id bigint
stage text
fixture_time timestamp with time zone
source_snapshot_at timestamp with time zone
model_version text
status text
captured_at timestamp with time zone
model_output jsonb
result_data jsonb
source_meta jsonb default '{}'::jsonb
research_only boolean default true
lease_token text
attempts integer default 1
updated_at timestamp with time zone default now()
```

## `basketball_v2_unified_snapshots`

```text
game_id bigint
fixture_time timestamp with time zone
source_snapshot_at timestamp with time zone
home_team text default ''::text
away_team text default ''::text
model_version text
status text
source_meta jsonb default '{}'::jsonb
model_output jsonb
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
research_only boolean default true
```

## `benefits`

```text
id bigint
created_at timestamp with time zone default now()
title text
image_url text
link_url text
is_active boolean default true
sort_order integer default 0
updated_at timestamp with time zone default now()
```

## `fixture_cache`

```text
fixture_date date
fixtures jsonb default '[]'::jsonb
raw_total integer default 0
total integer default 0
fetched_at timestamp with time zone default now()
pre_match_refreshed boolean default false
pre_match_refreshed_at timestamp with time zone
categories jsonb default '{}'::jsonb
```

## `football_settlement_correction_log`

```text
correction_key text
fixture_id bigint
before_settlement jsonb
after_settlement jsonb
original_prediction jsonb
final_home integer
final_away integer
reason text
corrected_at timestamp with time zone default now()
```

## `football_v21_shadow_probs`

```text
fixture_id bigint
kickoff_at timestamp with time zone
captured_at timestamp with time zone
model_version text
model_status text
home_samples integer
away_samples integer
home_venue_samples integer
away_venue_samples integer
data_quality text
capture_mode text
expected_home_goals numeric
expected_away_goals numeric
home_win_probability numeric
draw_probability numeric
away_win_probability numeric
btts_yes_probability numeric
over_2_5_reference_probability numeric
over_3_5_reference_probability numeric
reference_line_notice text
research_only boolean
```

## `football_v2_capture_audit`

```text
fixture_id bigint
kickoff_at timestamp with time zone
state text
reason_code text
detail jsonb default '{}'::jsonb
attempts integer default 0
next_retry_at timestamp with time zone
terminal boolean default false
updated_at timestamp with time zone default now()
```

## `football_v2_market_repair_audit`

```text
fixture_id bigint
kickoff_at timestamp with time zone
status text
reason_code text
attempts integer default 0
next_retry_at timestamp with time zone
terminal boolean default false
detail jsonb default '{}'::jsonb
updated_at timestamp with time zone default now()
```

## `football_v2_player_impact_cache`

```text
team_id bigint
league_id bigint
season integer
players jsonb default '[]'::jsonb
roster_complete boolean default false
cached_at timestamp with time zone default now()
source text default 'api_football_players_team_league_season'::text
```

## `football_v2_public_stage_history`

```text
id bigint
stage text
effective_at timestamp with time zone default now()
created_at timestamp with time zone default now()
```

## `football_v2_rollout_settings`

```text
id boolean default true
pilot_account text default 'google_2d3cef6b6e2d'::text
all_members_enabled boolean default false
public_stage text default 't10'::text
public_stage_effective_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `football_v2_shadow_api_budget`

```text
usage_date date
calls_used integer default 0
updated_at timestamp with time zone default now()
```

## `football_v2_shadow_compare_v01`

```text
fixture_id bigint
kickoff_at timestamp with time zone
captured_at timestamp with time zone
model_version text
model_status text
expected_home_goals numeric
expected_away_goals numeric
home_win_probability numeric
draw_probability numeric
away_win_probability numeric
btts_yes_probability numeric
captured_total_line double precision
captured_over_odds double precision
captured_under_odds double precision
over_expected_return_per_unit numeric
under_expected_return_per_unit numeric
official_status text
official_v1_over_under_pick text
official_v1_over_under_line text
official_over_under_result text
home_score integer
away_score integer
actual_total_goals integer
research_only boolean
```

## `football_v2_shadow_feature_audit`

```text
fixture_id bigint
stage text
kickoff_at timestamp with time zone
status text
reason_code text
attempts integer default 0
next_retry_at timestamp with time zone
terminal boolean default false
detail jsonb default '{}'::jsonb
updated_at timestamp with time zone default now()
```

## `football_v2_shadow_feature_audit_backup_20261105`

```text
fixture_id bigint
stage text
kickoff_at timestamp with time zone
status text
reason_code text
attempts integer
next_retry_at timestamp with time zone
terminal boolean
detail jsonb
updated_at timestamp with time zone
```

## `football_v2_shadow_feature_snapshots`

```text
fixture_id bigint
stage text
kickoff_at timestamp with time zone
captured_at timestamp with time zone
league_id integer
season integer
home_team_id bigint
away_team_id bigint
home_features jsonb
away_features jsonb
league_baseline jsonb
data_quality text
source_meta jsonb default '{}'::jsonb
model_version text default 'football-v2-features-0.1'::text
research_only boolean default true
```

## `football_v2_shadow_feature_snapshots_backup_20261105`

```text
fixture_id bigint
stage text
kickoff_at timestamp with time zone
captured_at timestamp with time zone
league_id integer
season integer
home_team_id bigint
away_team_id bigint
home_features jsonb
away_features jsonb
league_baseline jsonb
data_quality text
source_meta jsonb
model_version text
research_only boolean
```

## `football_v2_shadow_fixture_calendar`

```text
calendar_date date
fetched_at timestamp with time zone
fixtures jsonb
source_meta jsonb default '{}'::jsonb
```

## `football_v2_shadow_inputs`

```text
fixture_id bigint
kickoff_at timestamp with time zone
captured_at timestamp with time zone
model_version text default 'v2-input-0.1'::text
home_recent_metrics jsonb
away_recent_metrics jsonb
market jsonb default '{}'::jsonb
source_meta jsonb default '{}'::jsonb
research_only boolean default true
created_at timestamp with time zone default now()
```

## `football_v2_shadow_market_quotes`

```text
fixture_id bigint
kickoff_at timestamp with time zone
captured_at timestamp with time zone
capture_slot timestamp with time zone
provider text
market_key text
total_line numeric
over_odds numeric
under_odds numeric
bookmaker_count integer default 0
source_meta jsonb default '{}'::jsonb
research_only boolean default true
```

## `football_v2_shadow_probs_v01`

```text
fixture_id bigint
kickoff_at timestamp with time zone
captured_at timestamp with time zone
input_version text
model_version text
model_status text
expected_home_goals numeric
expected_away_goals numeric
home_win_probability numeric
draw_probability numeric
away_win_probability numeric
btts_yes_probability numeric
btts_no_probability numeric
captured_total_line double precision
captured_over_odds double precision
captured_under_odds double precision
over_expected_return_per_unit numeric
under_expected_return_per_unit numeric
poisson_truncation_mass numeric
research_only boolean
```

## `football_v2_shadow_stage_audit`

```text
fixture_id bigint
stage text
kickoff_at timestamp with time zone
status text
reason_code text
attempts integer default 0
terminal boolean default false
detail jsonb default '{}'::jsonb
updated_at timestamp with time zone default now()
```

## `football_v2_shadow_stage_snapshots`

```text
fixture_id bigint
stage text
kickoff_at timestamp with time zone
captured_at timestamp with time zone
home_team_id bigint
away_team_id bigint
home_xg numeric
away_xg numeric
probabilities jsonb
fair_odds jsonb
market_context jsonb default '{}'::jsonb
availability_evidence jsonb default '{}'::jsonb
lineup_evidence jsonb default '{}'::jsonb
data_quality text
source_meta jsonb default '{}'::jsonb
model_version text
research_only boolean default true
player_adjustment jsonb
```

## `football_v2_shadow_standings_cache`

```text
league_id integer
season integer
fetched_at timestamp with time zone
standings jsonb
source_meta jsonb default '{}'::jsonb
```

## `football_v2_shadow_team_history_cache`

```text
league_id integer
season integer
team_id bigint
fetched_at timestamp with time zone
matches jsonb
source_meta jsonb default '{}'::jsonb
```

## `football_v2_stage_capture_leases`

```text
fixture_id bigint
stage text
lease_token uuid
lease_until timestamp with time zone
updated_at timestamp with time zone default now()
```

## `football_v2_stage_member_claims`

```text
id bigint
account text
fixture_id bigint
stage text
claim_state text default 'processing'::text
fixture_data jsonb default '{}'::jsonb
result_data jsonb
model_version text
created_at timestamp with time zone default now()
claimed_at timestamp with time zone
```

## `fund_beta_bets`

```text
id uuid default gen_random_uuid()
account text
month_key text
history_id bigint
fixture_id bigint
fixture_time timestamp with time zone
league_name text
home_team text
away_team text
market_key text
market_label text
pick text
line text
confidence integer default 0
stake numeric
odds numeric
odds_source text default 'panda'::text
odds_captured_at timestamp with time zone
status text default 'pending'::text
pnl numeric default 0
settled_at timestamp with time zone
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
suggested_stake numeric default 0
ai_pick text
ai_line text
is_ai_recommended boolean default false
```

## `fund_beta_plans`

```text
id uuid default gen_random_uuid()
account text
month_key text
start_capital numeric default 30000
risk_mode text default 'balanced'::text
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `habao_api_response_cache`

```text
cache_key text
response_data jsonb
expires_at timestamp with time zone
updated_at timestamp with time zone default now()
```

## `habao_market_shadow_snapshots`

```text
id bigint
sport text
fixture_id text
odds_sport_key text
odds_event_id text
official_kickoff_at timestamp with time zone
official_recommendations jsonb
market_lines jsonb
comparison jsonb
collected_at timestamp with time zone default now()
```

## `habao_nba_member_test_backup`

```text
account text
member_snapshot jsonb
created_at timestamp with time zone default now()
```

## `habao_sport_push_state`

```text
sport text
game_id bigint
home_score integer
away_score integer
match_status text
period text default ''::text
last_event_key text
last_notified_at timestamp with time zone
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `habao_sport_push_targets`

```text
sport text
game_id bigint
enabled boolean default false
game_date date
kickoff_at timestamp with time zone
league_name text
home_team text
away_team text
enabled_by text
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `habao_t10_retry_queue`

```text
fixture_id bigint
kickoff_at timestamp with time zone
first_due_at timestamp with time zone
fixture_data jsonb default '{}'::jsonb
state text default 'pending'::text
attempts integer default 0
next_attempt_at timestamp with time zone
lease_id uuid
lease_expires_at timestamp with time zone
last_result text
last_error text
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `live_score_push_state`

```text
fixture_id bigint
fixture_date date
kickoff_at timestamp with time zone
league_id integer
league_name text
home_team_id bigint
home_team text
away_team_id bigint
away_team text
home_score integer default 0
away_score integer default 0
match_status text
elapsed integer
last_event_key text
last_push_type text
last_pushed_at timestamp with time zone
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `live_score_push_targets`

```text
fixture_id bigint
enabled boolean default false
fixture_date date
kickoff_at timestamp with time zone
league_name text
home_team text
away_team text
enabled_by text
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `match_analysis_cache`

```text
id bigint
created_at timestamp with time zone default now()
fixture_id bigint
analysis jsonb
expires_at timestamp with time zone
status text default 'ready'::text
```

## `member_analysis_history`

```text
id bigint
created_at timestamp with time zone default now()
account text
fixture_id bigint
analysis_id bigint
fixture_time timestamp with time zone
updated_at timestamp with time zone default now()
home_team text
away_team text
home_logo text
away_logo text
league_name text
league_logo text
match_status text
result_data jsonb
```

## `member_baseball_analysis_history`

```text
id uuid default gen_random_uuid()
account text
game_id bigint
snapshot_id bigint
analysis_id uuid
fixture_time timestamp with time zone
home_team text
away_team text
home_logo text
away_logo text
league_name text default 'MLB'::text
match_status text
result_data jsonb
status text default 'processing'::text
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
credit_charged boolean default false
consumed_credit_type text
```

## `member_basketball_analysis_history`

```text
id uuid default gen_random_uuid()
account text
game_id bigint
analysis_id uuid
fixture_time timestamp with time zone
home_team text
away_team text
home_logo text
away_logo text
league_name text default 'NBA'::text
match_status text
result_data jsonb
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `members`

```text
id bigint
created_at timestamp with time zone default now()
account text
expire_at timestamp with time zone
is_active boolean default true
analysis_credits integer default 3
daily_analysis_limit integer default 3
last_login_at timestamp with time zone
analysis_unlimited boolean default false
daily_analysis_unlimited boolean default false
auth_user_id uuid
auth_provider text
email text
member_level text default 'normal'::text
platform_account text
daily_free_credits integer default 0
daily_free_credits_date date
vip_ever_activated boolean default false
platform_name text
```

## `nba_v3_efficiency_snapshots`

```text
game_id bigint
fixture_time timestamp with time zone
source_snapshot_at timestamp with time zone
home_team text
away_team text
model_version text
status text
model_output jsonb
source_meta jsonb default '{}'::jsonb
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `nba_v3_player_game_cache`

```text
game_id bigint
season integer
game_start timestamp with time zone
home_team_id bigint
away_team_id bigint
players jsonb
fetched_at timestamp with time zone default now()
```

## `nba_v3_player_timing_snapshots`

```text
game_id bigint
phase text
fixture_time timestamp with time zone
source_snapshot_at timestamp with time zone
captured_at timestamp with time zone default now()
status text
model_version text
model_output jsonb
source_meta jsonb default '{}'::jsonb
updated_at timestamp with time zone default now()
```

## `panda_auth_state`

```text
id smallint default 1
status text default 'unknown'::text
requestid text
source text
last_refresh_at timestamp with time zone
last_success_at timestamp with time zone
last_error_code text
last_error_message text
updated_at timestamp with time zone default now()
```

## `panda_league_map`

```text
api_football_league_id bigint
api_name text
display_name_zh text
panda_tid text
status text default 'pending'::text
enabled boolean default true
notes text
updated_at timestamp with time zone default now()
```

## `panda_match_map`

```text
fixture_id bigint
panda_match_id text
panda_tid text
kickoff_at timestamp with time zone
home_team text
away_team text
panda_home text
panda_away text
confidence numeric
matched_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `partner_platforms`

```text
id bigint
slug text
name text
display_name text
logo_url text
bet_url text
register_url text
enabled boolean default true
sort_order integer default 0
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
show_when_disabled boolean default false
```

## `push_send_logs`

```text
id bigint
audience text
member_username text
title text
body text
target_url text
found_count integer default 0
accepted_count integer default 0
failed_count integer default 0
expired_count integer default 0
created_at timestamp with time zone default now()
```

## `push_subscriptions`

```text
id bigint
created_at timestamp with time zone default now()
endpoint text
p256dh text
auth text
member_username text
updated_at timestamp with time zone default now()
device_id text
```

## `pwa_login_handoffs`

```text
id uuid default gen_random_uuid()
handoff_token text
user_id uuid
provider text default 'line'::text
language text default 'zh-Hant'::text
created_at timestamp with time zone default now()
expires_at timestamp with time zone
consumed_at timestamp with time zone
request_secret_hash text
completed_at timestamp with time zone
encrypted_session text
```

## `site_settings`

```text
id bigint
created_at timestamp with time zone default now()
normal_announcement text
maintenance_announcement text
normal_enabled boolean default false
maintenance_enabled boolean default false
api_daily_limit integer default 7500
api_renewal_date date
updated_at timestamp with time zone default now()
normal_marquee_enabled boolean default false
nba_api_plan text
nba_api_daily_limit integer
nba_api_start_date date
nba_api_renewal_date date
odds_api_plan text default '20K'::text
odds_api_monthly_limit integer default 20000
odds_api_start_date date
odds_api_renewal_date date
```

## `sports_mlb_t10_source`

```text
game_id bigint
fixture_time timestamp with time zone
generated_at timestamp with time zone
prediction_data jsonb
```

## `sports_release_settings`

```text
id boolean default true
revision text
enabled boolean default false
```

## `sports_source_probe_requests`

```text
request_id bigint
sport text
queued_at timestamp with time zone default now()
```

## `sports_source_probe_runs`

```text
id bigint
sport text
game_id bigint
checked_at timestamp with time zone default now()
result_data jsonb
```

## `supabase_usage_snapshots`

```text
id bigint
usage_date date
billing_cycle_start date
billing_cycle_end date
edge_function_used bigint default 0
edge_function_quota bigint default 500000
database_used_gb numeric default 0
database_quota_gb numeric default 0.5
egress_used_gb numeric default 0
egress_quota_gb numeric default 5
cached_egress_used_gb numeric default 0
cached_egress_quota_gb numeric default 5
storage_used_gb numeric default 0
storage_quota_gb numeric default 1
log_ingestion_used_gb numeric default 0
log_ingestion_quota_gb numeric default 1
log_query_used_gb numeric default 0
log_query_quota_gb numeric default 100
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `team_identity_map`

```text
api_football_team_id bigint
league_id integer
api_name text
display_name_zh text
enabled boolean default true
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `team_provider_aliases`

```text
id bigint default nextval('team_provider_aliases_id_seq'::regclass)
api_football_team_id bigint
league_id integer
provider text
provider_team_name text
normalized_name text
status text default 'confirmed'::text
source text default 'auto_strict_similarity'::text
confidence numeric
last_seen_at timestamp with time zone default now()
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `team_provider_unresolved`

```text
id bigint default nextval('team_provider_unresolved_id_seq'::regclass)
provider text
fixture_id bigint
league_id integer
sport_key text
kickoff_at timestamp with time zone
home_team_id bigint
away_team_id bigint
home_api_name text
away_api_name text
candidate_events jsonb default '[]'::jsonb
status text default 'pending'::text
last_seen_at timestamp with time zone default now()
created_at timestamp with time zone default now()
updated_at timestamp with time zone default now()
```

## `team_translations`

```text
id bigint
created_at timestamp with time zone default now()
api_name text
zh_name text
team_id bigint
```

## `toolbox_launch_settings`

```text
id bigint
enabled boolean default false
badge_text text default 'NEW｜全新上線'::text
subtitle_text text default '全新 AI 工具現已開放'::text
campaign_version text default 'launch-1'::text
updated_at timestamp with time zone default now()
updated_by text
```
