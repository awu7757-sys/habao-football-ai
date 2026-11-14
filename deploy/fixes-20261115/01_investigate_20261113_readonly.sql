-- 2026-11-13 疑似多扣點：唯讀證據匯出（2026-11-15 建立）
-- 只讀取，不扣點、不改任何資料。如受影響帳號不同，只改 params 的 account。
-- 注意：系統沒有扣點流水表；本查詢把當天所有「會造成扣點」的領取紀錄與批次工作結果
--       （results 內含每場回傳的剩餘點數）集中輸出，用來重建扣點順序。
-- 用法：SQL Editor 貼上 → Run → Export → Download CSV。
begin transaction read only;

with params as (
  select 'google_2d3cef6b6e2d'::text as account,
         timestamptz '2026-11-13 00:00:00+08' as from_at,
         timestamptz '2026-11-14 06:00:00+08' as until_at
)
select sort, item, detail from (
  select 1 as sort, '目前會員狀態與餘額' as item,
         (select to_jsonb(m) - 'email' from public.members m, params p where m.account = p.account) as detail
  union all
  select 2, '批次工作 analysis_jobs（results 內含每場扣點回應）',
         (select jsonb_agg(to_jsonb(j) order by j.created_at) from public.analysis_jobs j, params p
          where j.account = p.account and j.created_at >= p.from_at and j.created_at < p.until_at)
  union all
  select 3, 'NBA T-2/T-15 領取',
         (select jsonb_agg(to_jsonb(c) - 'result_data' order by c.claimed_at) from public.basketball_v2_stage_claims c, params p
          where c.account = p.account and c.claimed_at >= p.from_at and c.claimed_at < p.until_at)
  union all
  select 4, 'NBA T-10 使用紀錄 basketball_analysis_usage',
         (select jsonb_agg(to_jsonb(u) order by u.created_at) from public.basketball_analysis_usage u, params p
          where u.account = p.account and u.created_at >= p.from_at and u.created_at < p.until_at)
  union all
  select 5, 'NBA T-10 會員歷史 member_basketball_analysis_history',
         (select jsonb_agg(to_jsonb(h) - 'result_data' order by h.created_at) from public.member_basketball_analysis_history h, params p
          where h.account = p.account and h.created_at >= p.from_at and h.created_at < p.until_at)
  union all
  select 6, '足球 T-2/T-15 領取',
         (select jsonb_agg(to_jsonb(c) - 'result_data' - 'fixture_data' order by c.created_at) from public.football_v2_stage_member_claims c, params p
          where c.account = p.account and c.created_at >= p.from_at and c.created_at < p.until_at)
  union all
  select 7, '足球 T-10 會員歷史 member_analysis_history',
         (select jsonb_agg(to_jsonb(h) - 'result_data' order by h.created_at) from public.member_analysis_history h, params p
          where h.account = p.account and h.created_at >= p.from_at and h.created_at < p.until_at)
  union all
  select 8, '足球 T-10 使用紀錄 analysis_usage',
         (select jsonb_agg(to_jsonb(u) order by u.created_at) from public.analysis_usage u, params p
          where u.account = p.account and u.created_at >= p.from_at and u.created_at < p.until_at)
  union all
  select 9, 'MLB T-2/T-15 領取',
         (select jsonb_agg(to_jsonb(c) - 'result_data' order by c.claimed_at) from public.baseball_v2_stage_claims c, params p
          where c.account = p.account and c.claimed_at >= p.from_at and c.claimed_at < p.until_at)
  union all
  select 10, 'MLB T-10 會員歷史（含 credit_charged）',
         (select jsonb_agg(to_jsonb(h) - 'result_data' order by h.created_at) from public.member_baseball_analysis_history h, params p
          where h.account = p.account and h.created_at >= p.from_at and h.created_at < p.until_at)
) r
order by sort;

commit;
