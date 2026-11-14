-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: refund_member_credit(text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.refund_member_credit(p_account text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  new_remaining integer;
begin
  update public.members
  set analysis_credits = analysis_credits + 1
  where account = p_account
  returning analysis_credits into new_remaining;

  return coalesce(new_remaining, 0);
end;
$function$;
