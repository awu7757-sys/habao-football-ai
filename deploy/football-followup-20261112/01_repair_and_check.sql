-- 本檔會修正已確認的單筆舊結算，再唯讀檢查擷取失敗／缺特徵。
-- 只限 #1557418：原推薦小2、比分2-2、保存 side=over/result=win。
-- 保留修正前值；推薦、模型、比分、封存時間、會員點數均不修改。
BEGIN;
CREATE TABLE IF NOT EXISTS public.football_settlement_correction_log (
  correction_key text PRIMARY KEY,
  fixture_id bigint NOT NULL,
  before_settlement jsonb NOT NULL,
  after_settlement jsonb NOT NULL,
  original_prediction jsonb NOT NULL,
  final_home integer NOT NULL,
  final_away integer NOT NULL,
  reason text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.football_settlement_correction_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.football_settlement_correction_log FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.football_settlement_correction_log TO service_role;

DO $repair$
DECLARE
  original public.ai_prediction_snapshots%ROWTYPE;
  checked public.ai_prediction_snapshots%ROWTYPE;
  original_pick text;
  updated_settlement jsonb;
BEGIN
  SELECT * INTO STRICT original FROM public.ai_prediction_snapshots
  WHERE fixture_id=1557418 FOR UPDATE;
  original_pick:=regexp_replace(lower(coalesce(
    original.prediction#>>'{analysis,recommendations,over_under,pick}',
    original.prediction#>>'{recommendations,over_under,pick}','')),'[[:space:]]','','g');
  IF original_pick NOT IN ('小2','小2.0','小2.00','under2','under2.0','under2.00')
     OR original.home_score IS DISTINCT FROM 2 OR original.away_score IS DISTINCT FROM 2
     OR original.status IS DISTINCT FROM 'verified' OR original.verified_at IS NULL THEN
    RAISE EXCEPTION '1557418 原始推薦／比分／驗證狀態與已確認條件不同，未修改';
  END IF;
  IF jsonb_typeof(original.settlement->'over_under') IS DISTINCT FROM 'object'
     OR jsonb_typeof(original.settlement#>'{over_under,line}') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION '1557418 保存結算缺少有效數字盤口，未修改';
  END IF;
  IF (original.settlement#>>'{over_under,line}')::numeric<>2 THEN
    RAISE EXCEPTION '1557418 保存盤口不是2，未修改';
  END IF;
  IF original.settlement#>>'{over_under,side}'='under' AND original.settlement#>>'{over_under,result}'='loss' THEN
    RAISE NOTICE '1557418 已為正確的小2未中，不重複修改';
    RETURN;
  END IF;
  IF original.settlement#>>'{over_under,side}' IS DISTINCT FROM 'over'
     OR original.settlement#>>'{over_under,result}' IS DISTINCT FROM 'win' THEN
    RAISE EXCEPTION '1557418 現有結算與已確認錯誤不同，未修改';
  END IF;
  updated_settlement:=jsonb_set(original.settlement,'{over_under}',
    (original.settlement->'over_under')||jsonb_build_object('side','under','result','loss'),false);
  INSERT INTO public.football_settlement_correction_log
    (correction_key,fixture_id,before_settlement,after_settlement,original_prediction,final_home,final_away,reason)
  VALUES ('football-1557418-under2-20261112',1557418,original.settlement,updated_settlement,original.prediction,2,2,
    '原推薦小2，總進球4，應為under/loss；修正保存結算的方向與結果。')
  ON CONFLICT(correction_key) DO NOTHING;
  UPDATE public.ai_prediction_snapshots SET settlement=updated_settlement WHERE fixture_id=1557418;
  SELECT * INTO STRICT checked FROM public.ai_prediction_snapshots WHERE fixture_id=1557418;
  IF (to_jsonb(checked)-'settlement') IS DISTINCT FROM (to_jsonb(original)-'settlement') THEN
    RAISE EXCEPTION '發現結算以外的欄位被修改，整筆交易已取消';
  END IF;
END;
$repair$;
COMMIT;

WITH problems AS MATERIALIZED (
 SELECT a.*,round(extract(epoch FROM (a.kickoff_at-now()))/60,2) AS minutes_to_kickoff,
   CASE
    WHEN EXISTS(SELECT 1 FROM public.football_v2_shadow_stage_snapshots s
       WHERE s.fixture_id=a.fixture_id AND s.stage=a.stage AND s.model_version='football-v2-poisson-player-impact-0.3.0') THEN '已有新版快照，核對殘留稽核狀態'
    WHEN a.kickoff_at<=now() THEN '歷史已開賽紀錄，不補造過去快照'
    WHEN (a.stage='t10' AND a.kickoff_at-now()<interval '598 minutes 30 seconds')
      OR (a.stage='t2' AND a.kickoff_at-now()<=interval '15 minutes') THEN '該階段已關閉，不補造過去快照'
    WHEN (a.stage='t10' AND a.kickoff_at-now()>interval '601 minutes 30 seconds')
      OR (a.stage='t2' AND a.kickoff_at-now()>interval '120 minutes')
      OR (a.stage='t15' AND a.kickoff_at-now()>interval '15 minutes') THEN '尚未進入該階段窗口'
    ELSE '目前窗口內待處理'
   END AS category
 FROM public.football_v2_shadow_stage_audit a
 WHERE a.status IN ('failed','missing_features')
), report AS (
 SELECT 1 AS sort,'舊結算修正 #1557418' AS item,
 CASE WHEN settlement#>>'{over_under,side}'='under' AND settlement#>>'{over_under,result}'='loss' THEN 'PASS' ELSE 'CHECK' END AS status,
 '原推薦小2；比分2-2；目前結算 '||(settlement->'over_under')::text AS detail
 FROM public.ai_prediction_snapshots WHERE fixture_id=1557418
 UNION ALL SELECT 2,'修正前結算備份','INFO',count(*)||' 筆；備份原推薦、比分與修正前後結算'
 FROM public.football_settlement_correction_log WHERE correction_key='football-1557418-under2-20261112'
 UNION ALL SELECT 10,'擷取問題｜'||category,
 CASE WHEN category='目前窗口內待處理' THEN 'CHECK' ELSE 'INFO' END,
 count(*)||' 筆；failed='||count(*) FILTER(WHERE status='failed')||'；missing_features='||count(*) FILTER(WHERE status='missing_features')
 FROM problems GROUP BY category
 UNION ALL SELECT 11,'目前窗口內問題總數',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'CHECK' END,
 count(*)||' 筆；此處才是目前窗口仍需追查的 failed／missing_features'
 FROM problems WHERE category='目前窗口內待處理'
 UNION ALL SELECT 12,'問題原因｜'||coalesce(reason_code,'未標示'),'INFO',count(*)||' 筆；最近更新（台灣）'||to_char(max(updated_at) AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD HH24:MI:SS')
 FROM problems GROUP BY reason_code
 UNION ALL SELECT 20,'待處理 #'||fixture_id||'／'||stage,'CHECK',
 '距開賽 '||minutes_to_kickoff||' 分鐘；狀態 '||status||'；原因 '||coalesce(reason_code,'未標示')||'；嘗試 '||attempts||' 次；terminal='||coalesce(terminal::text,'null')
 FROM problems WHERE category='目前窗口內待處理'
 UNION ALL SELECT 30,'新版階段快照 '||stage,'INFO',count(*)||' 筆'
 FROM public.football_v2_shadow_stage_snapshots WHERE model_version='football-v2-poisson-player-impact-0.3.0' GROUP BY stage
 UNION ALL SELECT 40,'會員階段領取','INFO',claim_state||'：'||count(*)||' 筆'
 FROM public.football_v2_stage_member_claims GROUP BY claim_state
 UNION ALL SELECT 41,'會員階段領取實測',CASE WHEN count(*)=0 THEN 'PENDING' ELSE 'INFO' END,
 CASE WHEN count(*)=0 THEN '目前0筆，首次扣點／重看／雙分頁仍待測試帳號實測' ELSE count(*)||' 筆已領取；仍需核對同階段只扣一次' END
 FROM public.football_v2_stage_member_claims WHERE claim_state='claimed'
)
SELECT item,status,detail FROM report ORDER BY sort,item;
