-- 007: платени промоции (реклами). Плащат се с кредити, обозначават се „Спонсорирано“ и не влияят на рейтинга.
alter table credit_transactions drop constraint credit_transactions_type_check;
alter table credit_transactions add constraint credit_transactions_type_check check (type in
  ('purchase','debit_application','hold_boost','release_boost','settle_boost','refund','admin_adjustment','debit_promotion','promo_refund'));

create table ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references users(id),
  listing_id uuid not null references service_listings(id),
  placement text not null check (placement in ('search','category','home')),
  starts_on date not null,
  ends_on date not null,
  cost_credits int not null check (cost_credits > 0),
  status text not null default 'pending_review' check (status in ('pending_review','active','paused','cancelled','rejected')),
  impressions int not null default 0,
  clicks int not null default 0,
  review_note text,
  reviewed_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index ad_serving_idx on ad_campaigns (placement, status, starts_on, ends_on);
create index ad_provider_idx on ad_campaigns (provider_id);

-- Дедупликация срещу измами: един зрител се брои най-много веднъж на час за кампания и вид събитие.
create table ad_events (
  id bigserial primary key,
  campaign_id uuid not null references ad_campaigns(id),
  kind text not null check (kind in ('impression','click')),
  viewer_hash bytea not null,
  bucket timestamptz not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, kind, viewer_hash, bucket)
);
insert into app_settings values ('ads','{"search_per_day":3,"category_per_day":5,"home_per_day":10,"slots":3,"max_days":30}');
