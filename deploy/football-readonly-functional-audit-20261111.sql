-- 只讀足球正式／三階段資料與排程；不調整會員開放、公開階段或點數。
-- 每表最多最新 2,000 筆。缺表會顯示 CHECK；SQL_OK 不代表函式業務成功。
WITH wanted(name) AS (VALUES
 ('ai_prediction_snapshots'),('football_v2_shadow_stage_snapshots'),('football_v2_shadow_feature_snapshots'),
 ('football_v2_shadow_stage_audit'),('football_v2_rollout_settings'),('football_v2_public_stage_history'),
 ('football_v2_stage_member_claims'),('football_v2_stage_capture_leases'),('football_v2_player_impact_cache')
), rels AS (
 SELECT name,to_regclass(format('public.%I',name)) AS rel FROM wanted
), loaded AS MATERIALIZED (
 SELECT r.name,r.rel,coalesce(x.payload::jsonb,'[]'::jsonb) AS rows FROM rels r
 CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(
 CASE WHEN r.rel IS NULL THEN 'SELECT ''[]''::text AS payload'
 ELSE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb)::text AS payload FROM (SELECT * FROM %s src ORDER BY coalesce(to_jsonb(src)->>''kickoff_at'',to_jsonb(src)->>''created_at'',to_jsonb(src)->>''updated_at'',to_jsonb(src)->>''captured_at'','''') DESC LIMIT 2000) t',r.rel)
 END,false,false,'') COLUMNS payload text PATH 'payload') x
), formal AS MATERIALIZED (
 SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='ai_prediction_snapshots'
), snaps AS MATERIALIZED (
 SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='football_v2_shadow_stage_snapshots'
), current_snaps AS MATERIALIZED (
 SELECT s FROM snaps WHERE s->>'model_version'='football-v2-poisson-player-impact-0.3.0'
), claims AS MATERIALIZED (
 SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='football_v2_stage_member_claims'
), settings AS MATERIALIZED (
 SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='football_v2_rollout_settings'
), history AS MATERIALIZED (
 SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='football_v2_public_stage_history'
), audits AS MATERIALIZED (
 SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='football_v2_shadow_stage_audit'
), nums AS MATERIALIZED (
 SELECT s,
 CASE WHEN jsonb_typeof(s->'home_xg')='number' THEN (s->>'home_xg')::numeric END AS hxg,
 CASE WHEN jsonb_typeof(s->'away_xg')='number' THEN (s->>'away_xg')::numeric END AS axg,
 CASE WHEN jsonb_typeof(s#>'{probabilities,home_win}')='number' THEN (s#>>'{probabilities,home_win}')::numeric END AS hp,
 CASE WHEN jsonb_typeof(s#>'{probabilities,draw}')='number' THEN (s#>>'{probabilities,draw}')::numeric END AS dp,
 CASE WHEN jsonb_typeof(s#>'{probabilities,away_win}')='number' THEN (s#>>'{probabilities,away_win}')::numeric END AS ap
 FROM current_snaps
), report AS (
 SELECT 1 AS sort,'資料表 '||name AS item,CASE WHEN rel IS NULL THEN 'CHECK' ELSE 'PASS' END AS status,
 CASE WHEN rel IS NULL THEN '缺少資料表，先核對部署' ELSE '存在；取樣 '||jsonb_array_length(rows)||' 筆' END AS detail FROM loaded
 UNION ALL SELECT 5,'正式快照實際欄位','INFO',string_agg(column_name||' ('||data_type||')',', ' ORDER BY ordinal_position)
 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_prediction_snapshots'
 UNION ALL SELECT 10,'正式同場快照唯一',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 組重複 fixture_id'
 FROM (SELECT s->>'fixture_id' FROM formal GROUP BY s->>'fixture_id' HAVING count(*)>1) x
 UNION ALL SELECT 11,'正式模型 '||coalesce(s#>>'{prediction,model_version}',s->>'model_version','未標示'),'INFO',count(*)||' 筆'
 FROM formal GROUP BY coalesce(s#>>'{prediction,model_version}',s->>'model_version','未標示')
 UNION ALL SELECT 12,'正式已驗證比分',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆缺少有效非負整數比分'
 FROM formal WHERE (s->>'status'='verified' OR s->>'verified_at' IS NOT NULL) AND coalesce(s->>'excluded_from_public','false')<>'true'
 AND (coalesce(s->>'home_score','')!~'^(0|[1-9][0-9]*)$' OR coalesce(s->>'away_score','')!~'^(0|[1-9][0-9]*)$')
 UNION ALL SELECT 13,'正式大小球推薦與結算方向',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,
 count(*)||' 筆方向不一致；fixture_id='||coalesce(string_agg(s->>'fixture_id',', '),'無')
 FROM formal WHERE coalesce(s->>'excluded_from_public','false')<>'true' AND (
 (coalesce(s#>>'{prediction,analysis,recommendations,over_under,pick}',s#>>'{prediction,recommendations,over_under,pick}','')~*'^(小|under)' AND coalesce(s#>>'{settlement,over_under,side}',s#>>'{settlement,over_under,pick}','')~*'^(大|over)')
 OR (coalesce(s#>>'{prediction,analysis,recommendations,over_under,pick}',s#>>'{prediction,recommendations,over_under,pick}','')~*'^(大|over)' AND coalesce(s#>>'{settlement,over_under,side}',s#>>'{settlement,over_under,pick}','')~*'^(小|under)'))
 UNION ALL SELECT 14,'舊結算待核對 #1557418','INFO',
 '比分 '||coalesce(s->>'home_score','?')||'-'||coalesce(s->>'away_score','?')||'；原推薦 '||coalesce(s#>>'{prediction,analysis,recommendations,over_under,pick}',s#>>'{prediction,recommendations,over_under,pick}','未取得')||'；保存結算 '||coalesce((s#>'{settlement,over_under}')::text,'未取得')
 FROM formal WHERE s->>'fixture_id'='1557418'
 UNION ALL SELECT 20,'三階段快照唯一',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 組 fixture_id／stage 重複'
 FROM (SELECT s->>'fixture_id',s->>'stage' FROM snaps GROUP BY s->>'fixture_id',s->>'stage' HAVING count(*)>1) x
 UNION ALL SELECT 21,'快照 '||coalesce(s->>'stage','未標示')||'／'||coalesce(s->>'model_version','未標示'),'INFO',count(*)||' 筆'
 FROM snaps GROUP BY s->>'stage',s->>'model_version'
 UNION ALL SELECT 22,'三階段賽前封存',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆缺少時間或封存於開賽後'
 FROM snaps WHERE nullif(s->>'captured_at','') IS NULL OR nullif(s->>'kickoff_at','') IS NULL OR (s->>'captured_at')::timestamptz>=(s->>'kickoff_at')::timestamptz
 UNION ALL SELECT 23,'新版模型 xG 與勝和負機率',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆缺值、超界或機率總和不為 1'
 FROM nums WHERE hxg IS NULL OR axg IS NULL OR hxg<=0 OR axg<=0 OR hxg>8 OR axg>8 OR hp IS NULL OR dp IS NULL OR ap IS NULL OR hp NOT BETWEEN 0 AND 1 OR dp NOT BETWEEN 0 AND 1 OR ap NOT BETWEEN 0 AND 1 OR abs(hp+dp+ap-1)>.001
 UNION ALL SELECT 24,'準時快照時間標記',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆標示準時但與目標時間相差超過 90 秒'
 FROM current_snaps WHERE coalesce(s#>>'{source_meta,capture_mode}','scheduled')='scheduled'
 AND abs(extract(epoch FROM ((s->>'captured_at')::timestamptz-((s->>'kickoff_at')::timestamptz-CASE s->>'stage' WHEN 't10' THEN interval '10 hours' WHEN 't2' THEN interval '2 hours' ELSE interval '15 minutes' END))))>90
 UNION ALL SELECT 25,'補抓快照排除正式比較',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆補抓快照未明確排除正式階段統計'
 FROM current_snaps WHERE s#>>'{source_meta,capture_mode}'='late_pre_match_recovery' AND coalesce(s#>>'{source_meta,eligible_for_stage_metrics}','true')<>'false'
 UNION ALL SELECT 26,'特徵時間早於階段封存',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆缺少特徵時間或特徵晚於快照'
 FROM current_snaps WHERE nullif(s#>>'{source_meta,feature_captured_at}','') IS NULL OR (s#>>'{source_meta,feature_captured_at}')::timestamptz>(s->>'captured_at')::timestamptz
 UNION ALL SELECT 27,'傷停狀態 '||coalesce(s#>>'{availability_evidence,status}','未標示'),'INFO',count(*)||' 筆；缺資料應明示，不等同無傷停'
 FROM current_snaps WHERE s->>'stage' IN ('t2','t15') GROUP BY s#>>'{availability_evidence,status}'
 UNION ALL SELECT 28,'先發狀態 '||coalesce(s#>>'{lineup_evidence,status}','未標示'),'INFO',count(*)||' 筆；未公布先發不得當成已確認'
 FROM current_snaps WHERE s->>'stage' IN ('t2','t15') GROUP BY s#>>'{lineup_evidence,status}'
 UNION ALL SELECT 29,'排程擷取狀態 '||coalesce(s->>'status','未標示'),'INFO',count(*)||' 筆'
 FROM audits GROUP BY s->>'status'
 UNION ALL SELECT 30,'會員階段領取唯一',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 組同會員／同場／同階段重複'
 FROM (SELECT s->>'account',s->>'fixture_id',s->>'stage' FROM claims GROUP BY s->>'account',s->>'fixture_id',s->>'stage' HAVING count(*)>1) x
 UNION ALL SELECT 31,'已領取結果完整性',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆已領取但缺結果、錯場或錯階段'
 FROM claims WHERE s->>'claim_state'='claimed' AND (s#>>'{result_data,success}' IS DISTINCT FROM 'true' OR s#>>'{result_data,fixture,id}' IS DISTINCT FROM s->>'fixture_id' OR s#>>'{result_data,v2_stage}' IS DISTINCT FROM s->>'stage')
 UNION ALL SELECT 32,'舊流程 processing 領取紀錄',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆；必須先核對是否扣點，不可猜測補扣或免費轉成功'
 FROM claims WHERE s->>'claim_state'='processing'
 UNION ALL SELECT 33,'原有扣點 RPC','INFO',coalesce(string_agg(pg_get_function_identity_arguments(p.oid)||' → '||pg_get_function_result(p.oid),'; '),'未找到，須核對')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='consume_member_analysis_credit'
 UNION ALL SELECT 34,'原子領取 RPC',CASE WHEN to_regprocedure('public.claim_football_v2_stage_analysis_atomic(text,bigint,text,jsonb,jsonb,text)') IS NULL THEN 'CHECK' ELSE 'PASS' END,
 CASE WHEN to_regprocedure('public.claim_football_v2_stage_analysis_atomic(text,bigint,text,jsonb,jsonb,text)') IS NULL THEN '尚未執行 04_atomic_stage_claim.sql' ELSE '存在；實際扣點仍需測試會員驗收' END
 UNION ALL SELECT 40,'會員開放範圍','INFO','測試帳號 '||coalesce(s->>'pilot_account','未設定')||'；全會員開放 '||coalesce(s->>'all_members_enabled','未設定') FROM settings
 UNION ALL SELECT 41,'公開階段設定','INFO',coalesce(s->>'public_stage','未設定')||'；生效時間 '||coalesce(s->>'public_stage_effective_at','未設定') FROM settings
 UNION ALL SELECT 42,'公開階段歷史',CASE WHEN count(*)=0 THEN 'CHECK' ELSE 'PASS' END,count(*)||' 筆；超過 200 筆時另核對分頁讀取' FROM history
 UNION ALL SELECT 43,'公開設定與最新歷史一致',CASE WHEN count(*)=1 AND bool_and(a.s->>'public_stage'=b.s->>'stage' AND (a.s->>'public_stage_effective_at')::timestamptz=(b.s->>'effective_at')::timestamptz) THEN 'PASS' ELSE 'CHECK' END,
 '切換紀錄需與設定一致，舊賽事依當時階段結算' FROM settings a CROSS JOIN (SELECT s FROM history ORDER BY (s->>'effective_at')::timestamptz DESC LIMIT 1) b
 UNION ALL SELECT 50,'研究與領取資料表 RLS',CASE WHEN count(*)=8 AND bool_and(c.relrowsecurity) THEN 'PASS' ELSE 'CHECK' END,count(*)||' 張研究／設定／領取資料表'
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (SELECT name FROM wanted WHERE name<>'ai_prediction_snapshots')
 UNION ALL SELECT 60,'排程 #'||j.jobid||' '||j.jobname,CASE WHEN NOT j.active THEN 'DISABLED' WHEN r.status='succeeded' THEN 'SQL_OK' ELSE 'CHECK' END,
 j.schedule||'；函式 '||coalesce(substring(j.command FROM '/functions/v1/([a-zA-Z0-9_-]+)'),'未直接指定')||'；最近 '||coalesce(r.start_time::text,'尚無紀錄')||'；'||coalesce(r.status,'尚無紀錄')||'（只證明 SQL）'
 FROM cron.job j LEFT JOIN LATERAL (SELECT status,start_time FROM cron.job_run_details WHERE jobid=j.jobid ORDER BY start_time DESC LIMIT 1) r ON true
 WHERE j.jobname ILIKE '%football%' OR j.command LIKE '%football-v2-%' OR j.command LIKE '%/functions/v1/match-analysis%'
)
SELECT item,status,detail FROM report ORDER BY sort,item;
