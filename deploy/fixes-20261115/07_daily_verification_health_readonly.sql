-- 三球類公開驗證每日更新健康檢查（唯讀，2026-11-15）
-- 每列一個球類：最後驗證時間、近 7 天每天驗證場次、已完賽超過 6 小時仍未驗證的場次，
-- 以及結算排程近 3 天的執行結果（不輸出排程指令內容）。
begin transaction read only;

with fb as (
  select 'football' as sport,
         max(verified_at) as last_verified,
         count(*) filter (where verified_at >= now() - interval '7 days') as verified_7d,
         count(*) filter (where verified_at is null and kickoff_at < now() - interval '6 hours'
                            and kickoff_at > now() - interval '14 days' and coalesce(excluded_from_public,false) = false) as overdue
  from public.ai_prediction_snapshots
), nba as (
  select 'basketball',
         max(verified_at),
         count(*) filter (where verified_at >= now() - interval '7 days'),
         count(*) filter (where verified_at is null and fixture_time < now() - interval '6 hours'
                            and fixture_time > now() - interval '14 days' and coalesce(excluded_from_public,false) = false)
  from public.basketball_prediction_snapshots
), mlb as (
  select 'baseball',
         (select max(verified_at) from public.baseball_verified_results),
         (select count(*) from public.baseball_verified_results where verified_at >= now() - interval '7 days'),
         (select count(*) from public.baseball_t10_snapshots t
           where t.kickoff_at < now() - interval '6 hours' and t.kickoff_at > now() - interval '14 days'
             and not exists (select 1 from public.baseball_verified_results v where v.game_id = t.game_id))
), runs as (
  select j.jobname,
         count(*) as runs_3d,
         count(*) filter (where d.status = 'succeeded') as succeeded_3d,
         max(d.start_time) as last_run,
         max(d.start_time) filter (where d.status = 'succeeded') as last_success
  from cron.job j
  left join cron.job_run_details d on d.jobid = j.jobid and d.start_time >= now() - interval '3 days'
  where j.jobname in ('habao-football-verify-hourly','public-prediction-runner-hourly',
                      'habao-basketball-result-every-30m','habao-baseball-results-every-30m')
  group by j.jobname
)
select '驗證資料' as 類別, sport as 名稱,
       jsonb_build_object('最後驗證_台灣', to_char(last_verified at time zone 'Asia/Taipei','MM-DD HH24:MI'),
                          '近7天驗證場次', verified_7d,
                          '完賽超過6小時仍未驗證_近14天', overdue) as 結果
from (select * from fb union all select * from nba union all select * from mlb) x
union all
select '結算排程', jobname,
       jsonb_build_object('近3天執行', runs_3d, '近3天成功', succeeded_3d,
                          '最後執行_台灣', to_char(last_run at time zone 'Asia/Taipei','MM-DD HH24:MI'),
                          '最後成功_台灣', to_char(last_success at time zone 'Asia/Taipei','MM-DD HH24:MI'))
from runs;

commit;
