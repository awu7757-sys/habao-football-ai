-- SNAPSHOT ONLY — DO NOT DEPLOY FROM THIS FILE.
-- Exported read-only from production Supabase (oqtbsbohcfeghgnykwxy) by the project owner on 2026-11-15 (Asia/Taipei)
-- via deploy/system-reference-20261115/01_export_backend_readonly.sql.
-- Signature: update_football_v2_rollout_settings(boolean,text)
-- EXECUTE granted to: postgres, service_role

CREATE OR REPLACE FUNCTION public.update_football_v2_rollout_settings(p_all_members_enabled boolean DEFAULT NULL::boolean, p_public_stage text DEFAULT NULL::text)
 RETURNS SETOF football_v2_rollout_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_row public.football_v2_rollout_settings%ROWTYPE;
  changed_at timestamptz := now();
BEGIN
  IF p_public_stage IS NOT NULL AND p_public_stage NOT IN ('t10', 't2', 't15') THEN
    RAISE EXCEPTION 'invalid_public_stage';
  END IF;

  SELECT * INTO current_row
  FROM public.football_v2_rollout_settings
  WHERE id = true
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.football_v2_rollout_settings (id)
    VALUES (true)
    RETURNING * INTO current_row;
  END IF;

  IF p_public_stage IS NOT NULL AND p_public_stage <> current_row.public_stage THEN
    INSERT INTO public.football_v2_public_stage_history (stage, effective_at)
    VALUES (p_public_stage, changed_at);
  END IF;

  UPDATE public.football_v2_rollout_settings
  SET all_members_enabled = COALESCE(p_all_members_enabled, all_members_enabled),
      public_stage = COALESCE(p_public_stage, public_stage),
      public_stage_effective_at = CASE
        WHEN p_public_stage IS NOT NULL AND p_public_stage <> current_row.public_stage
          THEN changed_at
        ELSE public_stage_effective_at
      END,
      updated_at = changed_at
  WHERE id = true
  RETURNING * INTO current_row;

  RETURN NEXT current_row;
END;
$function$;
