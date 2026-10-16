-- 004: директни заявки, поръчки, чат, ревюта, известия, сигнали.
create table service_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references service_listings(id),
  client_id uuid not null references users(id),
  provider_id uuid not null references users(id),
  message text not null check (char_length(message) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);
create index requests_provider_idx on service_requests (provider_id, status);
create index requests_client_idx on service_requests (client_id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  proposal_id uuid unique references proposals(id),
  request_id uuid unique references service_requests(id),
  client_id uuid not null references users(id),
  provider_id uuid not null references users(id),
  price_cents int,
  status text not null default 'accepted' check (status in ('accepted','scheduled','in_progress','delivered','completed','cancelled','disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((proposal_id is not null) <> (request_id is not null))
);
create index orders_client_idx on orders (client_id);
create index orders_provider_idx on orders (provider_id);
create table order_events (
  id bigserial primary key,
  order_id uuid not null references orders(id),
  actor_id uuid,
  from_status text,
  to_status text not null,
  created_at timestamptz not null default now()
);

create table messages (
  id bigserial primary key,
  order_id uuid references orders(id),
  request_id uuid references service_requests(id),
  sender_id uuid not null references users(id),
  body text not null check (char_length(body) between 1 and 2000),
  system boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((order_id is not null) <> (request_id is not null))
);
create index messages_order_idx on messages (order_id, id);
create index messages_request_idx on messages (request_id, id);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),   -- най-много едно ревю за поръчка
  reviewer_id uuid not null references users(id),
  provider_id uuid not null references users(id),
  rating int not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 5 and 1000),
  reply text,
  created_at timestamptz not null default now()
);
create index reviews_provider_idx on reviews (provider_id);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, read_at, id desc);

create table reports (
  id bigserial primary key,
  reporter_id uuid not null references users(id),
  target_type text not null check (target_type in ('listing','job','user','review','message')),
  target_id text not null,
  reason text not null check (char_length(reason) between 5 and 1000),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution text,
  created_at timestamptz not null default now()
);
