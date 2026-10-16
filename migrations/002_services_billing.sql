-- 002: категории, услуги, планове, абонаменти, плащания, настройки.
create extension if not exists pg_trgm;

create table categories (
  id serial primary key,
  slug text not null unique,
  name text not null unique,
  sort int not null default 0
);
insert into categories(slug, name, sort) values
 ('remonti','Ремонти',1),('vik','ВиК',2),('elektro','Електроуслуги',3),('pochistvane','Почистване',4),('transport','Транспорт',5),
 ('avto','Автоуслуги',6),('krasota','Красота',7),('uroci','Уроци',8),('digital','Дигитални услуги',9),('schetovodstvo','Счетоводство',10),('subitiya','Събития',11);

create table plans (
  id text primary key,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  active_limit int not null check (active_limit > 0),
  is_active boolean not null default true
);
insert into plans values ('start','Start',990,1,true),('pro','Pro',2490,10,true),('business','Business',4990,50,true);

create table credit_packages (
  id text primary key,
  credits int not null check (credits > 0),
  price_cents int not null check (price_cents > 0),
  is_active boolean not null default true
);
insert into credit_packages values ('k50',50,590,true),('k150',150,1490,true),('k350',350,2990,true),('k800',800,5990,true);

create table app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into app_settings values ('bids','{"app_cost":10,"min_boost":5,"step":1,"slots":3}');

create table service_listings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references users(id),
  category_id int not null references categories(id),
  title text not null check (char_length(title) between 6 and 100),
  description text not null check (char_length(description) between 10 and 2000),
  price_type text not null check (price_type in ('fixed','from','negotiable')),
  price_cents int check (price_cents is null or price_cents >= 0),
  city text not null,
  remote boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))) stored
);
create index listings_filter_idx on service_listings (category_id, city, status);
create index listings_search_idx on service_listings using gin (search);
create index listings_title_trgm on service_listings using gin (title gin_trgm_ops);
create index listings_provider_idx on service_listings (provider_id, status);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references users(id),
  plan_id text not null references plans(id),
  status text not null check (status in ('active','canceled','expired')),
  period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  provider_subscription_id text unique,
  created_at timestamptz not null default now()
);
create unique index one_active_sub on subscriptions (provider_id) where status = 'active';

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('subscription','credits')),
  ref text not null,                       -- plan id или package id
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'EUR',
  provider text not null default 'mock',
  provider_payment_id text unique,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index payments_user_idx on payments (user_id, created_at desc);

-- Всеки webhook събитие се обработва най-много веднъж.
create table payment_events (
  provider_event_id text primary key,
  payment_id uuid references payments(id),
  type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table invoices (
  id bigserial primary key,
  payment_id uuid not null unique references payments(id),
  number text not null unique,
  amount_cents int not null,
  vat_cents int not null default 0,   -- ДДС се определя по приложимите правила (решение за потвърждение)
  issued_at timestamptz not null default now()
);
create sequence invoice_seq;
