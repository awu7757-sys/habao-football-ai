-- 2026-11-15 待辦第 5 項：管理員增減點數改成「原子加減差額」
-- 原本：後台用畫面上的舊餘額算新總數，再整個覆寫；會員同時用點時會被補回。
-- 現在：資料庫在同一行 UPDATE 內加減，扣除時餘額不足直接拒絕。
-- 只新增函式，不修改任何既有資料或函式。執行後再部署新版 admin-members。
begin;

create or replace function public.admin_adjust_member_credits(p_member_id bigint, p_delta integer)
 returns table(success boolean, error text, member_id bigint, account text, analysis_credits integer)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_account text;
  v_credits integer;
begin
  if p_member_id is null or p_member_id <= 0 or p_delta is null or p_delta = 0
     or abs(p_delta) > 100000 then
    return query select false, 'invalid_request'::text, p_member_id, null::text, null::integer;
    return;
  end if;

  update public.members m
     set analysis_credits = coalesce(m.analysis_credits, 0) + p_delta
   where m.id = p_member_id
     and coalesce(m.analysis_credits, 0) + p_delta >= 0
  returning m.account, m.analysis_credits into v_account, v_credits;

  if found then
    return query select true, null::text, p_member_id, v_account, v_credits;
    return;
  end if;

  select x.account, coalesce(x.analysis_credits, 0) into v_account, v_credits
    from public.members x where x.id = p_member_id;

  if found then
    return query select false, 'insufficient_credits'::text, p_member_id, v_account, v_credits;
  else
    return query select false, 'member_not_found'::text, p_member_id, null::text, null::integer;
  end if;
end;
$function$;

revoke execute on function public.admin_adjust_member_credits(bigint, integer) from public, anon, authenticated;
grant execute on function public.admin_adjust_member_credits(bigint, integer) to service_role;

commit;

-- 驗證（唯讀）：應只看到 postgres, service_role
select routine_name, string_agg(distinct grantee::text, ', ') as grantees
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'admin_adjust_member_credits'
group by routine_name;
