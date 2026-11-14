-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: consume_basketball_analysis_quota(text,bigint)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.consume_basketball_analysis_quota(p_account text, p_game_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_date date :=
    (now() at time zone 'Asia/Taipei')::date;

  v_limit integer;
  v_unlimited boolean;
  v_used integer := 0;
  v_exists boolean := false;
begin
  if coalesce(trim(p_account), '') = '' or p_game_id is null or p_game_id <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'already_used', false,
      'error', 'invalid_request'
    );
  end if;

  -- Serialize same-account quota consumption within the same Taiwan day.
  perform pg_advisory_xact_lock(
    hashtextextended(
      trim(p_account) || ':' || v_date::text,
      0
    )
  );

  select
    coalesce(daily_analysis_limit, 3),
    coalesce(daily_analysis_unlimited, false)
  into
    v_limit,
    v_unlimited
  from public.members
  where account = trim(p_account)
    and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'already_used', false,
      'error', 'member_not_found'
    );
  end if;

  select exists(
    select 1
    from public.basketball_analysis_usage
    where account = trim(p_account)
      and game_id = p_game_id
      and usage_date = v_date
  )
  into v_exists;

  select count(*)
  into v_used
  from public.basketball_analysis_usage
  where account = trim(p_account)
    and usage_date = v_date;

  if v_exists then
    return jsonb_build_object(
      'allowed', true,
      'already_used', true,
      'used', v_used,
      'limit', case when v_unlimited then null else v_limit end,
      'usage_date', v_date
    );
  end if;

  -- Daily usage remains recorded; paid credits can still be used after the daily limit.
  -- The credit RPC later decides whether sufficient balance remains.

  insert into public.basketball_analysis_usage (
    account,
    game_id,
    usage_date
  )
  values (
    trim(p_account),
    p_game_id,
    v_date
  )
  on conflict (account, game_id, usage_date)
  do nothing;

  select count(*)
  into v_used
  from public.basketball_analysis_usage
  where account = trim(p_account)
    and usage_date = v_date;

  return jsonb_build_object(
    'allowed', true,
    'already_used', false,
    'used', v_used,
    'limit', case when v_unlimited then null else v_limit end,
    'remaining',
      case
        when v_unlimited then null
        else greatest(v_limit - v_used, 0)
      end,
    'usage_date', v_date
  );
end;
$function$;
