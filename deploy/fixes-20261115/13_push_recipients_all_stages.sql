-- HABAO｜NBA／MLB 比分推播收件人改為三階段都算（2026-11-15，使用者同意）
--
-- 修改前：只有 T-10 會員分析紀錄（member_basketball_analysis_history／member_baseball_analysis_history）
--         的會員收得到比分推播；只領 T-2 或 T-15 的會員收不到。
-- 修改後：T-10、T-2、T-15 任一階段有分析的會員都算（另查 basketball_v2_stage_claims／baseball_v2_stage_claims）。
--
-- 其他不變：仍需會員啟用中＋有推播訂閱；仍只有後台手動「開啟推播」的場次才會送。
-- CREATE OR REPLACE 會保留原本的執行權限（postgres、service_role）。
-- 在 Supabase → SQL Editor 整段貼上執行一次即可。

CREATE OR REPLACE FUNCTION public.habao_sport_push_recipients(p_sport text, p_game_id bigint)
 RETURNS TABLE(subscription_id text, member_username text, endpoint text, p256dh text, auth text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_sport NOT IN ('basketball','baseball') OR p_game_id IS NULL OR p_game_id <= 0 THEN
    RAISE EXCEPTION 'invalid sport/game id';
  END IF;
  IF p_sport='basketball' THEN
    RETURN QUERY SELECT s.id::text,s.member_username,s.endpoint,s.p256dh,s.auth
    FROM public.push_subscriptions s JOIN public.members m ON m.account=s.member_username
    WHERE m.is_active=true AND (
      EXISTS (SELECT 1 FROM public.member_basketball_analysis_history h
              WHERE h.game_id=p_game_id AND h.account=m.account)
      OR EXISTS (SELECT 1 FROM public.basketball_v2_stage_claims c
              WHERE c.game_id=p_game_id AND c.account=m.account)
    );
  ELSE
    RETURN QUERY SELECT s.id::text,s.member_username,s.endpoint,s.p256dh,s.auth
    FROM public.push_subscriptions s JOIN public.members m ON m.account=s.member_username
    WHERE m.is_active=true AND (
      EXISTS (SELECT 1 FROM public.member_baseball_analysis_history h
              WHERE h.game_id=p_game_id AND h.account=m.account)
      OR EXISTS (SELECT 1 FROM public.baseball_v2_stage_claims c
              WHERE c.game_id=p_game_id AND c.account=m.account)
    );
  END IF;
END;
$function$;

-- 執行後驗證（只讀）：今天 NBA 17126（熱火 vs 活塞）你只領了 T-2／T-15，應該會出現你的帳號。
-- select member_username, count(*) as 裝置數 from public.habao_sport_push_recipients('basketball', 17126) group by 1;
