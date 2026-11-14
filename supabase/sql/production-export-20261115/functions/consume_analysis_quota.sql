-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: consume_analysis_quota(text,bigint)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.consume_analysis_quota(p_account text, p_fixture_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$declare
  v_today date;
  v_used integer;
  v_exists boolean;
  v_limit integer;
begin
  -- 以台灣時間 UTC+8 計算日期
  v_today := (now() at time zone 'Asia/Taipei')::date;

  select coalesce(daily_analysis_limit, 3)
into v_limit
from public.members
where account = p_account;

  -- 避免同一帳號同時送多個請求造成超額
  perform pg_advisory_xact_lock(hashtext(p_account || v_today::text));

  -- 今天是否已分析過同一場
  select exists (
    select 1
    from public.analysis_usage
    where account = p_account
      and fixture_id = p_fixture_id
      and usage_date = v_today
  )
  into v_exists;

  if v_exists then
    select count(*)
    into v_used
    from public.analysis_usage
    where account = p_account
      and usage_date = v_today;

    return jsonb_build_object(
      'allowed', true,
      'already_used', true,
      'used', v_used,
      'limit', v_limit,
      'remaining', greatest(v_limit - v_used, 0)
    );
  end if;

  -- 計算今天已使用幾場
  select count(*)
  into v_used
  from public.analysis_usage
  where account = p_account
    and usage_date = v_today;

  -- Daily usage is for statistics only. The member credit RPC controls entitlement.
  -- Do not reject a member who still has daily or paid credits.

  -- 記錄這次新賽事
  insert into public.analysis_usage (
    account,
    fixture_id,
    usage_date
  )
  values (
    p_account,
    p_fixture_id,
    v_today
  )
  on conflict (account, fixture_id, usage_date)
  do nothing;

  return jsonb_build_object(
    'allowed', true,
    'already_used', false,
    'used', v_used + 1,
    'remaining', greatest(2 - v_used, 0)
  );
end;$function$;
