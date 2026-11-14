-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: refresh_vip_daily_credits(text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.refresh_vip_daily_credits(p_account text)
 RETURNS TABLE(success boolean, daily_free_credits integer, daily_free_credits_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_level text;
  v_daily integer;
  v_date date;
  v_today date;
begin

  -- 台灣日期
  v_today := (now() at time zone 'Asia/Taipei')::date;

  select
    coalesce(member_level, 'normal'),
    coalesce(members.daily_free_credits, 0),
    members.daily_free_credits_date
  into
    v_level,
    v_daily,
    v_date
  from public.members
  where account = p_account
  for update;

  if not found then
    return query
    select false, 0, null::date;
    return;
  end if;

  -- 非 VIP 不發每日免費積分
  if v_level <> 'vip' then
    return query
    select true, 0, v_date;
    return;
  end if;

  -- 今天尚未補過：
  -- 直接重設為 2，不累積昨日剩餘點數
  if v_date is distinct from v_today then

    update public.members
    set
      daily_free_credits = 2,
      daily_free_credits_date = v_today
    where account = p_account;

    v_daily := 2;
    v_date := v_today;

  end if;

  return query
  select true, v_daily, v_date;

end;
$function$;
