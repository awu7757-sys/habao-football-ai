-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: consume_member_credit(text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.consume_member_credit(p_account text)
 RETURNS TABLE(success boolean, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update public.members
  set analysis_credits = analysis_credits - 1
  where account = p_account
    and analysis_credits > 0
  returning true, analysis_credits
  into success, remaining;

  if not found then
    success := false;

    select coalesce(analysis_credits, 0)
    into remaining
    from public.members
    where account = p_account
    limit 1;

    remaining := coalesce(remaining, 0);
  end if;

  return next;
end;
$function$;
