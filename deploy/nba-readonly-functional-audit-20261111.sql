-- HABAO NBA 功能稽核；只執行 SELECT，不修改正式快照、會員點數、研究資料或排程。
-- 整份貼入 Supabase SQL Editor 執行。表不存在會顯示 CHECK，不會因缺表而中斷。
-- 每表最多檢查最新 2,000 筆；cron SQL 成功不等於 Edge Function 業務成功。
WITH wanted(name) AS (
  VALUES ('basketball_prediction_snapshots'),('basketball_v2_unified_snapshots'),('basketball_v2_box_cache')
), rels AS (
  SELECT name,to_regclass(format('public.%I',name)) AS rel FROM wanted
), loaded AS MATERIALIZED (
  SELECT r.name,r.rel,coalesce(x.payload::jsonb,'[]'::jsonb) AS rows
  FROM rels r
  CROSS JOIN LATERAL XMLTABLE('/table/row'
    PASSING query_to_xml(
      CASE WHEN r.rel IS NULL THEN 'SELECT ''[]''::text AS payload'
      ELSE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb)::text AS payload FROM (SELECT * FROM %s ORDER BY game_id DESC LIMIT 2000) t',r.rel)
      END,false,false,'')
    COLUMNS payload text PATH 'payload') x
), v1 AS MATERIALIZED (
  SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='basketball_prediction_snapshots'
), v2 AS MATERIALIZED (
  SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='basketball_v2_unified_snapshots'
), box AS MATERIALIZED (
  SELECT s FROM loaded CROSS JOIN LATERAL jsonb_array_elements(rows) s WHERE name='basketball_v2_box_cache'
), counts AS (
  SELECT (SELECT count(*) FROM v1) AS n1,(SELECT count(*) FROM v2) AS n2
), report AS (
  SELECT 1 AS sort,'資料表 '||name AS item,CASE WHEN rel IS NULL THEN 'CHECK' ELSE 'PASS' END AS status,
    CASE WHEN rel IS NULL THEN '資料表尚未建立' ELSE '存在；本次取樣 '||jsonb_array_length(rows)||' 筆' END AS detail FROM loaded
  UNION ALL SELECT 10,'V1 快照總覽','INFO','本次檢查 '||n1||' 筆；來源分布見下方' FROM counts
  UNION ALL SELECT 11,'V1 來源 '||coalesce(s->>'source','未標示'),'INFO',count(*)::text||' 筆' FROM v1 GROUP BY s->>'source'
  UNION ALL SELECT 20,'V1 同場重複',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 組重複 game_id'
    FROM (SELECT s->>'game_id' FROM v1 GROUP BY s->>'game_id' HAVING count(*)>1) t
  UNION ALL SELECT 30,'V1 賽前封存',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆缺少時間或非賽前生成'
    FROM v1 WHERE nullif(s->>'generated_at','') IS NULL OR nullif(s->>'fixture_time','') IS NULL
      OR (s->>'generated_at')::timestamptz >= (s->>'fixture_time')::timestamptz
  UNION ALL SELECT 40,'V1 可供統合 V2 使用的 T-10 範圍',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,
    count(*)::text||' 筆不在開賽前 10.5～8 小時；須確認是否舊資料或其他快照來源'
    FROM v1 WHERE (s->>'generated_at')::timestamptz NOT BETWEEN (s->>'fixture_time')::timestamptz-interval '10 hours 30 minutes' AND (s->>'fixture_time')::timestamptz-interval '8 hours'
  UNION ALL SELECT 50,'已驗證 NBA 比分',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆缺少有效正整數比分或完賽平手'
    FROM v1 WHERE s->>'status'='verified' AND coalesce(s->>'excluded_from_public','false')<>'true' AND
      (coalesce(s->>'final_home','')!~'^[1-9][0-9]*$' OR coalesce(s->>'final_away','')!~'^[1-9][0-9]*$' OR s->>'final_home'=s->>'final_away')
  UNION ALL SELECT 60,'V2 狀態 '||coalesce(s->>'status','未標示'),'INFO',count(*)::text||' 筆' FROM v2 GROUP BY s->>'status'
  UNION ALL SELECT 61,'V2 沒有資料',CASE WHEN n2=0 THEN 'INFO' ELSE 'PASS' END,
    CASE WHEN n2=0 THEN '尚未取得統合 V2 快照；不能據此判定模型或排程成功' ELSE n2||' 筆統合 V2 快照' END FROM counts
  UNION ALL SELECT 70,'V2 來源與正式快照一致',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆來源缺失或時間不一致'
    FROM v2 u LEFT JOIN v1 b ON b.s->>'game_id'=u.s->>'game_id'
    WHERE b.s IS NULL OR (u.s->>'source_snapshot_at')::timestamptz IS DISTINCT FROM (b.s->>'generated_at')::timestamptz
      OR (u.s->>'fixture_time')::timestamptz IS DISTINCT FROM (b.s->>'fixture_time')::timestamptz
  UNION ALL SELECT 75,'V2 賽前產生與 T-10 來源',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆缺少來源時間、來源不在 T-10 範圍或 ready 建立於開賽後'
    FROM v2 WHERE nullif(s->>'source_snapshot_at','') IS NULL OR nullif(s->>'fixture_time','') IS NULL
      OR (s->>'source_snapshot_at')::timestamptz NOT BETWEEN (s->>'fixture_time')::timestamptz-interval '10 hours 30 minutes' AND (s->>'fixture_time')::timestamptz-interval '8 hours'
      OR (s->>'status'='ready' AND (s->>'created_at')::timestamptz >= (s->>'fixture_time')::timestamptz)
  UNION ALL SELECT 80,'V2 僅限研究',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆缺少研究標記或宣告為正式推薦'
    FROM v2 WHERE coalesce(s->>'research_only','false')<>'true' OR s#>>'{model_output,formal_recommendation}'='true'
  UNION ALL SELECT 90,'V2 ready 輸出完整性',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆 ready 缺少數值比分、總分或勝率'
    FROM v2 WHERE s->>'status'='ready' AND (
      coalesce(jsonb_typeof(s#>'{model_output,expected_home_points}'),'null')<>'number'
      OR coalesce(jsonb_typeof(s#>'{model_output,expected_away_points}'),'null')<>'number'
      OR coalesce(jsonb_typeof(s#>'{model_output,expected_total}'),'null')<>'number'
      OR coalesce(jsonb_typeof(s#>'{model_output,home_win_probability}'),'null')<>'number')
  UNION ALL SELECT 91,'V2 機率與 API 預算',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆勝率超界或單場 API 超過 10 次'
    FROM v2 WHERE (CASE WHEN jsonb_typeof(s#>'{model_output,home_win_probability}')='number' THEN (s#>>'{model_output,home_win_probability}')::numeric NOT BETWEEN 0 AND 1 ELSE false END)
      OR (CASE WHEN jsonb_typeof(s#>'{source_meta,api_requests}')='number' THEN (s#>>'{source_meta,api_requests}')::numeric>10 ELSE false END)
  UNION ALL SELECT 100,'V2 來源錯誤／處理逾時',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 筆 source_error 或 processing 超過 30 分鐘；過期賽事不會補寫正式影子快照'
    FROM v2 WHERE s->>'status'='source_error' OR (s->>'status'='processing' AND (s->>'updated_at')::timestamptz<now()-interval '30 minutes')
  UNION ALL SELECT 110,'Box 快取重複',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)::text||' 組重複 game_id'
    FROM (SELECT s->>'game_id' FROM box GROUP BY s->>'game_id' HAVING count(*)>1) t
  UNION ALL SELECT 111,'Box 快取有效狀態','INFO',coalesce(s->>'status','未標示')||'：'||count(*)||' 筆' FROM box GROUP BY s->>'status'
  UNION ALL SELECT 120,'研究表 RLS 與會員寫入限制',CASE WHEN count(*)=2 AND bool_and(c.relrowsecurity) AND bool_and(NOT has_table_privilege('anon',c.oid,'INSERT') AND NOT has_table_privilege('authenticated',c.oid,'INSERT') AND NOT has_table_privilege('anon',c.oid,'UPDATE') AND NOT has_table_privilege('authenticated',c.oid,'UPDATE')) THEN 'PASS' ELSE 'CHECK' END,
    '核對兩張研究表的 RLS 與 anon／authenticated 寫入權限'
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('basketball_v2_unified_snapshots','basketball_v2_box_cache')
  UNION ALL SELECT 130,'排程 #'||j.jobid||' '||j.jobname,
    CASE WHEN NOT j.active THEN 'DISABLED' WHEN r.status='succeeded' THEN 'SQL_OK' ELSE 'CHECK' END,
    j.schedule||'；函式 '||coalesce(substring(j.command FROM '/functions/v1/([a-zA-Z0-9_-]+)'),'未直接指定，需查核')||'；最近 '||coalesce(r.start_time::text,'尚無紀錄')||'；'||coalesce(r.status,'尚無紀錄')||'（只證明 SQL，不代表 API 已成功）'
    FROM cron.job j LEFT JOIN LATERAL (SELECT status,start_time FROM cron.job_run_details WHERE jobid=j.jobid ORDER BY start_time DESC LIMIT 1) r ON true
    WHERE j.jobname ILIKE '%nba%' OR j.jobname ILIKE '%basketball%'
  UNION ALL SELECT 140,'統合 V2 排程',CASE WHEN count(*)=1 AND bool_and(active) THEN 'PASS' ELSE 'CHECK' END,
    count(*)::text||' 個 habao-nba-v2-unified-15min；應為一個啟用中的排程'
    FROM cron.job WHERE jobname='habao-nba-v2-unified-15min'
  UNION ALL SELECT 150,'會員資料表結構（供扣點驗收）','INFO',t.table_name||' ['||string_agg(c.column_name,', ' ORDER BY c.ordinal_position)||']'
    FROM information_schema.tables t JOIN information_schema.columns c USING(table_schema,table_name)
    WHERE t.table_schema='public' AND t.table_name LIKE 'basketball%'
      AND (t.table_name ILIKE '%member%' OR t.table_name ILIKE '%usage%') GROUP BY t.table_name
)
SELECT item,status,detail FROM report ORDER BY sort,item;
