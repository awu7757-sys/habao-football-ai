-- 2026-11-15 修正（使用者已同意待辦第 1、3、13 項）
-- 1. 每日清理不再刪除 member_analysis_history（足球 T-10 會員領取紀錄），只清 7 天前已結束的批次工作。
-- 3. 清理函式收回 anon／authenticated／PUBLIC 執行權限，只留 service_role（排程以 postgres 執行，不受影響）。
-- 13. 資料庫／儲存空間大小查詢函式同樣收回公開權限。
-- 原版定義備份：supabase/sql/production-export-20261115/functions/habao_cleanup_admin_data.sql
begin;

create or replace function public.habao_cleanup_admin_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  jobs_deleted integer := 0;
begin
  -- member_analysis_history 為會員領取／扣點證據，不再自動刪除（2026-11-15）。
  delete from public.analysis_jobs
  where status in ('completed','failed','partial')
    and coalesce(completed_at, updated_at, created_at) < now() - interval '7 days';
  get diagnostics jobs_deleted = row_count;

  return jsonb_build_object(
    'success', true,
    'member_analysis_history_deleted', 0,
    'analysis_jobs_deleted', jobs_deleted,
    'executed_at', now()
  );
end;
$function$;

revoke execute on function public.habao_cleanup_admin_data() from public, anon, authenticated;
revoke execute on function public.habao_usage_database_size_gb() from public, anon, authenticated;
revoke execute on function public.habao_usage_storage_size_gb() from public, anon, authenticated;
grant execute on function public.habao_cleanup_admin_data() to service_role;
grant execute on function public.habao_usage_database_size_gb() to service_role;
grant execute on function public.habao_usage_storage_size_gb() to service_role;

commit;

-- 驗證（唯讀）：三列都應只剩 postgres, service_role，且定義中不再有 member_analysis_history 的 delete。
select routine_name, string_agg(distinct grantee::text, ', ') as grantees
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('habao_cleanup_admin_data','habao_usage_database_size_gb','habao_usage_storage_size_gb')
group by routine_name;
