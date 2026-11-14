-- 用量總覽（唯讀，2026-11-15）：Supabase 方案用量最新快照＋各外部 API 近 7 天每日用量
begin transaction read only;

select '1 Supabase 用量（最新）' as 類別,
       to_jsonb(u) - 'id' - 'created_at' as 結果
from (select * from public.supabase_usage_snapshots order by updated_at desc limit 1) u
union all
select '2 足球 API-Football 每日呼叫（feature+stage 共用）',
       coalesce((select jsonb_object_agg(usage_date, calls_used order by usage_date)
                 from public.football_v2_shadow_api_budget where usage_date >= current_date - 7), '{}'::jsonb)
union all
select '3 NBA 階段每日用量（nba／odds）',
       coalesce((select jsonb_object_agg(usage_date || ':' || provider, used_count order by usage_date)
                 from public.basketball_v2_stage_api_budget where usage_date >= current_date - 7), '{}'::jsonb)
union all
select '4 MLB 階段每日用量（mlb／odds）',
       coalesce((select jsonb_object_agg(usage_date || ':' || provider, used_count order by usage_date)
                 from public.baseball_v2_stage_api_budget where usage_date >= current_date - 7), '{}'::jsonb)
union all
select '5 API-NBA 每日總用量',
       coalesce((select jsonb_object_agg(usage_date, used_count order by usage_date)
                 from public.basketball_api_usage_daily where usage_date >= current_date - 7), '{}'::jsonb)
union all
select '6 api_usage 紀錄（依來源）',
       coalesce((select jsonb_object_agg(source, n) from (
         select coalesce(source,'null') as source, count(*) n from public.api_usage
         where usage_date >= current_date - 7 group by 1) s), '{}'::jsonb);

commit;
