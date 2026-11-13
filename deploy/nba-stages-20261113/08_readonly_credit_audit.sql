-- Read-only audit for the reported NBA batch on 2026-11-13 (Asia/Taipei).
-- This query never calls a billing RPC and never changes credits or claims.
-- Change ONLY the account below if the affected member is different.
WITH params AS (
 SELECT 'google_2d3cef6b6e2d'::text AS account,
        timestamptz '2026-11-13 00:00:00+08' AS from_at,
        timestamptz '2026-11-14 00:00:00+08' AS until_at
), stage_claims AS (
 SELECT c.game_id,c.stage,
        c.claimed_at AT TIME ZONE 'Asia/Taipei' AS claimed_at_taipei,
        c.fixture_time AT TIME ZONE 'Asia/Taipei' AS kickoff_taipei,
        c.result_data #>> '{fixture,home,name}' AS home_team,
        c.result_data #>> '{fixture,away,name}' AS away_team
 FROM public.basketball_v2_stage_claims c CROSS JOIN params p
 WHERE c.account=p.account AND c.claimed_at>=p.from_at AND c.claimed_at<p.until_at
), legacy_claims AS (
 SELECT u.game_id,u.created_at AT TIME ZONE 'Asia/Taipei' AS recorded_at_taipei
 FROM public.basketball_analysis_usage u CROSS JOIN params p
 WHERE u.account=p.account AND u.created_at>=p.from_at AND u.created_at<p.until_at
), member_balance AS (
 SELECT jsonb_build_object(
  'account',m.account,'is_active',to_jsonb(m)->'is_active',
  'member_level',to_jsonb(m)->'member_level',
  'analysis_unlimited',to_jsonb(m)->'analysis_unlimited',
  'analysis_credits',to_jsonb(m)->'analysis_credits',
  'daily_free_credits',to_jsonb(m)->'daily_free_credits') AS value
 FROM public.members m JOIN params p ON m.account=p.account
), report AS (
 SELECT 1 AS sort,'目前帳號與餘額'::text AS item,'INFO'::text AS status,
        coalesce((SELECT value FROM member_balance),'null'::jsonb) AS detail
 UNION ALL
 SELECT 2,'當日 T-2／T-15 領取時間（不是扣點流水）','INFO',
        coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.claimed_at_taipei,c.game_id,c.stage) FROM stage_claims c),'[]'::jsonb)
 UNION ALL
 SELECT 3,'當日 T-10 使用紀錄（不是扣點流水）','INFO',
        coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.recorded_at_taipei,c.game_id) FROM legacy_claims c),'[]'::jsonb)
 UNION ALL
 SELECT 4,'正式扣點函式：只讀定義、不執行','REVIEW',
        coalesce((SELECT jsonb_agg(jsonb_build_object(
         'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='consume_member_analysis_credit' AND p.prokind='f'),'[]'::jsonb)
 UNION ALL
 SELECT 5,'正式階段領取函式：只讀定義、不執行','REVIEW',
        coalesce((SELECT jsonb_agg(jsonb_build_object(
         'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='claim_nba_stage_atomic' AND p.prokind='f'),'[]'::jsonb)
 UNION ALL
 SELECT 6,'會員與 NBA 領取表的觸發器','REVIEW',
        coalesce((SELECT jsonb_agg(jsonb_build_object(
         'table',t.tgrelid::regclass::text,'name',t.tgname,
         'enabled',t.tgenabled::text,'definition',pg_get_triggerdef(t.oid),
         'function',t.tgfoid::regprocedure::text) ORDER BY t.tgrelid,t.tgname)
         FROM pg_trigger t
         WHERE NOT t.tgisinternal AND t.tgrelid IN (
          'public.members'::regclass,'public.basketball_v2_stage_claims'::regclass,
          'public.basketball_analysis_usage'::regclass)),'[]'::jsonb)
 UNION ALL
 SELECT 7,'可核對的扣點／使用紀錄表欄位（只列結構）','INFO',
        coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name) FROM (
         SELECT c.table_name,jsonb_agg(jsonb_build_object('column',c.column_name,'type',c.data_type)
                ORDER BY c.ordinal_position) AS columns
         FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name ~* '(credit|transaction|usage|analysis_log|audit)'
         GROUP BY c.table_name) x),'[]'::jsonb)
 UNION ALL
 SELECT 8,'判讀限制','INFO',to_jsonb('領取筆數與目前餘額不能單獨證明當時扣點差額；需核對領取時間、正式扣點函式與既有扣點流水。不在本查詢補扣或退款。'::text)
)
SELECT item,status,detail FROM report ORDER BY sort;
