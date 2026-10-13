-- HABAO 一般公告｜新增跑馬燈開關
-- Supabase > SQL Editor 執行一次即可

alter table public.site_settings
add column if not exists normal_marquee_enabled boolean not null default false;
