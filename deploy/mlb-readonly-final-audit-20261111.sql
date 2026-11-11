-- MLB final backend audit. One SELECT; no writes, HTTP calls, quota changes or secrets.
WITH
s AS (
  SELECT game_id, kickoff_at, analysis,
         NULLIF(analysis->>'as_of','')::timestamptz AS captured_at
  FROM public.baseball_t10_snapshots
),
v AS (
  SELECT game_id, home_score, away_score, to_jsonb(r) AS data
  FROM public.baseball_verified_results r
),
p AS (
  SELECT s.game_id, m.market, m.pick,
         CASE WHEN m.line ~ '^[+-]?[0-9]+([.][0-9]+)?$'
              THEN m.line::numeric ELSE NULL END AS line,
         lower(m.result) AS actual_result, v.home_score AS h, v.away_score AS a
  FROM s JOIN v USING(game_id)
  CROSS JOIN LATERAL (VALUES
    ('moneyline', s.analysis#>>'{model,markets,moneyline,pick}', '0',
      v.data->>'moneyline_result'),
    ('spread', s.analysis#>>'{model,markets,spread,pick}',
      s.analysis#>>'{model,markets,spread,market_home_spread}',
      v.data->>'handicap_result'),
    ('totals', s.analysis#>>'{model,markets,totals,pick}',
      s.analysis#>>'{model,markets,totals,market_line}',
      COALESCE(v.data->>'totals_result',v.data->>'over_under_result'))
  ) m(market,pick,line,result)
),
d AS (
  SELECT *, CASE
    WHEN market='moneyline' AND pick IN ('home','away')
      THEN (h-a)*CASE WHEN pick='home' THEN 1 ELSE -1 END
    WHEN market='spread' AND pick IN ('home','away') AND line IS NOT NULL
      THEN (h-a+line)*CASE WHEN pick='home' THEN 1 ELSE -1 END
    WHEN market='totals' AND pick IN ('over','under') AND line IS NOT NULL
      THEN (h+a-line)*CASE WHEN pick='over' THEN 1 ELSE -1 END
    ELSE NULL END AS delta
  FROM p WHERE h IS NOT NULL AND a IS NOT NULL
),
settlement AS (
  SELECT *, CASE WHEN delta=0 THEN 'push' WHEN delta>0 THEN 'win'
                WHEN delta<0 THEN 'loss' ELSE NULL END AS expected_result
  FROM d
),
jobs AS (
  SELECT j.jobid,j.jobname,j.schedule,j.active,r.status,r.start_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT status,start_time FROM cron.job_run_details
    WHERE jobid=j.jobid ORDER BY start_time DESC LIMIT 1
  ) r ON true
  WHERE j.jobname ILIKE '%baseball%' OR j.jobname ILIKE '%mlb%'
     OR j.command LIKE '%/functions/v1/baseball-%'
),
member_schema AS (
  SELECT table_name,string_agg(column_name,', ' ORDER BY ordinal_position) AS columns
  FROM information_schema.columns WHERE table_schema='public'
    AND (table_name LIKE 'baseball_member%' OR table_name LIKE 'baseball%history%')
  GROUP BY table_name
),
report AS (
 SELECT 10 AS ord,'正式快照總數' AS item,'INFO' AS status,count(*)::text AS detail FROM s
 UNION ALL SELECT 20,'同場正式快照重複',
   CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 組重複 game_id'
   FROM (SELECT game_id FROM s GROUP BY game_id HAVING count(*)>1) x
 UNION ALL SELECT 30,'賽前封存時間',
   CASE WHEN count(*) FILTER(WHERE captured_at IS NULL OR captured_at>=kickoff_at)=0
        THEN 'PASS' ELSE 'CHECK' END,
   count(*) FILTER(WHERE captured_at IS NULL OR captured_at>=kickoff_at)||' 筆缺失或晚於開賽'
   FROM s
 UNION ALL SELECT 40,'T-10 時間範圍',
   CASE WHEN count(*) FILTER(WHERE captured_at<kickoff_at-interval '10 hours'
                  OR captured_at>kickoff_at-interval '10 hours'+interval '20 minutes')=0
        THEN 'PASS' ELSE 'CHECK' END,
   '容許排程延遲20分鐘；超出範圍 '||count(*) FILTER(
     WHERE captured_at<kickoff_at-interval '10 hours'
        OR captured_at>kickoff_at-interval '10 hours'+interval '20 minutes')||' 筆'
   FROM s
 UNION ALL SELECT 50,'同場驗證結果重複',
   CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 組重複 game_id'
   FROM (SELECT game_id FROM v GROUP BY game_id HAVING count(*)>1) x
 UNION ALL SELECT 60,'驗證比分完整性',
   CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆缺失或負比分'
   FROM v WHERE home_score IS NULL OR away_score IS NULL OR home_score<0 OR away_score<0
 UNION ALL SELECT 70,'賽果對應正式快照',
   CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 筆找不到正式快照'
   FROM v WHERE NOT EXISTS(SELECT 1 FROM s WHERE s.game_id=v.game_id)
 UNION ALL SELECT 80,'依正式盤口重算結算',
   CASE WHEN count(*) FILTER(WHERE expected_result IS DISTINCT FROM actual_result)=0
        THEN 'PASS' ELSE 'CHECK' END,
   '可重算 '||count(*)||' 項；不一致 '||count(*) FILTER(
     WHERE expected_result IS DISTINCT FROM actual_result)||' 項'
   FROM settlement WHERE expected_result IS NOT NULL
 UNION ALL SELECT 90,'球隊快取重複',
   CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,count(*)||' 組重複球隊/球季'
   FROM (SELECT team_id,season FROM public.baseball_team_stats_cache
         GROUP BY team_id,season HAVING count(*)>1) x
 UNION ALL SELECT 100,'球隊快取概況','INFO',
   '共 '||count(*)||' 筆；24小時內 '||count(*) FILTER(WHERE fetched_at>=now()-interval '24 hours')
   ||' 筆；無新賽事時，快取過期不單獨判定故障'
   FROM public.baseball_team_stats_cache
 UNION ALL SELECT 110,'V2 真實影子快照','INFO',count(*)||' 筆；不包含歷史回測'
   FROM public.baseball_v2_shadow_snapshots
 UNION ALL SELECT 120,'排程 #'||jobid||' '||jobname,
   CASE WHEN NOT active THEN 'DISABLED' WHEN status='succeeded' THEN 'SQL_OK' ELSE 'CHECK' END,
   schedule||'；最近 '||COALESCE(to_char(start_time AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD HH24:MI:SS'),'無紀錄')
     ||' 台灣時間；'||COALESCE(status,'無執行紀錄')||'（SQL成功不等於HTTP成功）'
   FROM jobs
 UNION ALL SELECT 130,'會員表結構（供核對）','INFO',
   COALESCE(string_agg(table_name||' ['||columns||']',' / '),'未找到相關會員表')
   FROM member_schema
)
SELECT item,status,detail FROM report ORDER BY ord,item;
