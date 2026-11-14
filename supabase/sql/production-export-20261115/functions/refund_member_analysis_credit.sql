-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: refund_member_analysis_credit(text,text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.refund_member_analysis_credit(p_account text, p_credit_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin

  if p_credit_type = 'daily' then
    update public.members
    set daily_free_credits =
      least(coalesce(daily_free_credits, 0) + 1, 2)
    where account = p_account;

    return found;
  end if;

  if p_credit_type = 'paid' then
    update public.members
    set analysis_credits =
      coalesce(analysis_credits, 0) + 1
    where account = p_account;

    return found;
  end if;

  return false;
end;
$function$;
