-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: consume_member_analysis_credit(text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.consume_member_analysis_credit(p_account text)
 RETURNS TABLE(success boolean, consumed_type text, daily_free_remaining integer, paid_remaining integer, total_remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_daily integer;
  v_paid integer;
  v_level text;
begin
  select
    coalesce(daily_free_credits, 0),
    coalesce(analysis_credits, 0),
    coalesce(member_level, 'normal')
  into
    v_daily,
    v_paid,
    v_level
  from public.members
  where account = p_account
  for update;

  if not found then
    return query
    select false, 'none'::text, 0, 0, 0;
    return;
  end if;

  -- VIP 優先扣每日免費積分
  if v_level = 'vip' and v_daily > 0 then

    update public.members
    set daily_free_credits = daily_free_credits - 1
    where account = p_account;

    v_daily := v_daily - 1;

    return query
    select
      true,
      'daily'::text,
      v_daily,
      v_paid,
      v_daily + v_paid;

    return;
  end if;

  -- 每日免費積分沒有後，再扣原有／儲值積分
  if v_paid > 0 then

    update public.members
    set analysis_credits = analysis_credits - 1
    where account = p_account;

    v_paid := v_paid - 1;

    return query
    select
      true,
      'paid'::text,
      v_daily,
      v_paid,
      v_daily + v_paid;

    return;
  end if;

  return query
  select
    false,
    'none'::text,
    v_daily,
    v_paid,
    v_daily + v_paid;
end;
$function$;
