-- HABAO 後端唯讀匯出（2026-11-15）
-- 目的：把只存在線上 Supabase、repo 沒有的資料庫函式、排程與資料表欄位匯出，
--       存進 repo 補齊 docs/SYSTEM_REFERENCE.md 標記【缺】的部分。
-- 安全：整段在 READ ONLY 交易中執行；不呼叫分析、不扣點、不排 HTTP。
--       排程只輸出名稱、頻率、啟用狀態與被呼叫的 Edge Function 名稱，不輸出 command 原文（可能含金鑰）。
-- 用法：Supabase → SQL Editor → New query → 貼上全部 → Run → 結果區 Export → Download CSV。

begin transaction read only;

select kind, name, detail
from (
  -- 1. public schema 內所有自訂函式（排除擴充套件附帶的）
  select 1 as ord, 'db_function' as kind,
         p.oid::regprocedure::text as name,
         pg_get_functiondef(p.oid) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend d
                    where d.objid = p.oid and d.deptype = 'e')

  union all
  -- 2. 函式執行權限
  select 2, 'db_function_grants',
         routine_name::text,
         string_agg(distinct grantee::text, ', ')
  from information_schema.routine_privileges
  where routine_schema = 'public' and privilege_type = 'EXECUTE'
  group by routine_name

  union all
  -- 3. 排程（不含 command 原文）
  select 3, 'cron_job',
         j.jobname::text,
         concat('schedule=', j.schedule,
                ' | active=', j.active,
                ' | calls=', coalesce((regexp_match(j.command, 'functions/v1/([a-zA-Z0-9_-]+)'))[1],
                                      case when j.command ~* 'select\s+public\.' then 'sql:' || (regexp_match(j.command, 'public\.([a-zA-Z0-9_]+)'))[1]
                                           else 'other' end))
  from cron.job j

  union all
  -- 4. 資料表欄位（public schema）
  select 4, 'table_columns',
         c.table_name::text,
         string_agg(c.column_name || ' ' || c.data_type
                    || coalesce(' default ' || c.column_default, ''), E'\n' order by c.ordinal_position)
  from information_schema.columns c
  where c.table_schema = 'public'
  group by c.table_name
) x
order by ord, name;

commit;
