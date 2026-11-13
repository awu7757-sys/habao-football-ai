-- Exact queued request IDs preserve both successful and failed responses.
SELECT 'saved_source_probes' item,to_jsonb(p) detail FROM (SELECT sport,game_id,checked_at AT TIME ZONE 'Asia/Taipei' checked_at_taipei,result_data FROM public.sports_source_probe_runs ORDER BY checked_at DESC LIMIT 6) p
UNION ALL
SELECT 'probe_http_responses',to_jsonb(r) FROM (
 SELECT q.sport,q.request_id,q.queued_at AT TIME ZONE 'Asia/Taipei' queued_at_taipei,
 h.status_code,h.timed_out,h.error_msg,h.content response_body,
 CASE WHEN h.id IS NULL THEN 'PENDING' WHEN h.status_code BETWEEN 200 AND 299 THEN 'RETURNED' ELSE 'CHECK' END transport_status
 FROM public.sports_source_probe_requests q LEFT JOIN net._http_response h ON h.id=q.request_id
 WHERE q.queued_at>clock_timestamp()-interval '2 hours' ORDER BY q.queued_at DESC LIMIT 9
) r;
