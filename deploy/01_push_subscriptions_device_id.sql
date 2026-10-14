-- HABAO｜Push subscription device_id migration
-- 同一個瀏覽器 / PWA 只保留一筆訂閱，不因重新登入或重新允許通知而一直 +1

alter table public.push_subscriptions
  add column if not exists device_id text;

create unique index if not exists push_subscriptions_device_id_unique
  on public.push_subscriptions (device_id)
  where device_id is not null and device_id <> '';

create index if not exists push_subscriptions_member_username_idx
  on public.push_subscriptions (member_username);

create index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);
