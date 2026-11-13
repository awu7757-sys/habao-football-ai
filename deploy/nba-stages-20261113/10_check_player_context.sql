-- Read-only. Inspect the probe HTTP response and future new-revision captures.
-- A missing response may mean the queued request has not completed yet.
WITH probe AS (
 SELECT id,status_code,timed_out,error_msg,
        content AS response_body,
        created AT TIME ZONE 'Asia/Taipei' AS received_at_taipei
 FROM net._http_response
 WHERE created>clock_timestamp()-interval '2 hours'
 AND content LIKE '%nba-stages-player-context-20261113-1%'
 ORDER BY created DESC LIMIT 5
), captures AS (
 SELECT game_id,stage,status,fixture_time AT TIME ZONE 'Asia/Taipei' AS kickoff_taipei,
  captured_at AT TIME ZONE 'Asia/Taipei' AS captured_at_taipei,
  source_meta->>'runner_revision' AS runner_revision,
  source_meta->>'availability_status' AS availability_status,
  source_meta->>'lineup_status' AS lineup_status,
  source_meta->'injury_adjustment_applied' AS injury_adjustment_applied,
  source_meta->'lineup_adjustment_applied' AS lineup_adjustment_applied,
  model_output->'player_context_adjustment' AS player_adjustment,
  source_meta->>'reason' AS reason
 FROM public.basketball_v2_stage_snapshots
 WHERE source_meta->>'runner_revision'='nba-stages-player-context-20261113-1'
 ORDER BY fixture_time DESC,stage LIMIT 20
)
SELECT 'probe_responses' AS item,coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM probe p),'[]'::jsonb) AS detail
UNION ALL
SELECT 'new_revision_captures',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM captures c),'[]'::jsonb)
UNION ALL
SELECT 'meaning',to_jsonb('probe 只核對來源，不代表已產生階段快照。先發 expected 仍是預估；data_returned 表示雙方已確認。applied／partial 表示已評估相應球員影響；實際調整值及原因看 player_adjustment。舊 ready 快照及已領取結果不覆寫。'::text);
