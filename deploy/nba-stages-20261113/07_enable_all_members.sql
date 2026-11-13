-- Activate NBA member stages for all valid members. Billing, RLS and saved results are preserved.
BEGIN;
INSERT INTO public.basketball_v2_stage_settings(id,pilot_account,all_members_enabled)
VALUES(true,'',true)
ON CONFLICT(id) DO UPDATE SET all_members_enabled=true,pilot_account='';
COMMIT;

SELECT id,all_members_enabled,
 CASE WHEN all_members_enabled THEN 'NBA 三階段已開放全會員' ELSE '尚未開放全會員' END AS release_status
FROM public.basketball_v2_stage_settings WHERE id=true;
