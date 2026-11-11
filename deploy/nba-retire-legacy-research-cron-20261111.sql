-- 保留設定與研究資料，只停用三個舊 NBA 研究排程。
-- 核對統合 V2 已啟用才執行；可重複執行。
DO $cleanup$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname='habao-nba-v2-unified-15min' AND active
  ) THEN
    RAISE EXCEPTION '統合 V2 排程未啟用，未停用任何舊排程';
  END IF;

  PERFORM cron.alter_job(jobid, active := false)
  FROM cron.job
  WHERE jobname IN (
    'habao-nba-v2-shadow-15min',
    'habao-nba-v3-efficiency-15min',
    'habao-nba-v3-player-timing-5min'
  );
END
$cleanup$;

SELECT jobid,jobname,active,schedule
FROM cron.job
WHERE jobname IN (
  'habao-nba-v2-shadow-15min',
  'habao-nba-v3-efficiency-15min',
  'habao-nba-v3-player-timing-5min',
  'habao-nba-v2-unified-15min',
  'habao-basketball-t10-every-15m',
  'habao-basketball-result-every-30m'
)
ORDER BY jobid;
