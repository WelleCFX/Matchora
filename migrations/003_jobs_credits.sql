-- 003: задания, оферти, кредитен портфейл и ledger.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references users(id),
  category_id int not null references categories(id),
  title text not null check (char_length(title) between 8 and 120),
  description text not null check (char_length(description) between 20 and 3000),
  city text not null,
  remote boolean not null default false,
  budget_min_cents int check (budget_min_cents is null or budget_min_cents > 0),
  budget_max_cents int,
  deadline date not null,
  status text not null default 'open' check (status in ('pending_review','open','closed','cancelled')),
  moderation_note text,
  accepted_proposal_id uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (budget_max_cents is null or budget_min_cents is null or budget_max_cents >= budget_min_cents)
);
create index jobs_status_deadline on jobs (status, deadline);
create index jobs_client_idx on jobs (client_id);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  provider_id uuid not null references users(id),
  price_cents int not null check (price_cents > 0),
  delivery_days int not null check (delivery_days > 0),
  message text not null check (char_length(message) between 10 and 2000),
  status text not null default 'submitted' check (status in ('submitted','withdrawn','accepted','rejected','expired')),
  version int not null default 1,
  boost_credits int not null default 0 check (boost_credits >= 0),
  boost_max int not null default 0 check (boost_max >= 0),
  boost_target int not null default 1 check (boost_target between 1 and 5),
  boost_at timestamptz,
  created_at timestamptz not null default now()
);
-- най-много една текуща оферта на изпълнител по задание
create unique index one_live_proposal on proposals (job_id, provider_id) where status in ('submitted','accepted');
create index proposals_job_idx on proposals (job_id, status);
create index proposals_boost_idx on proposals (job_id, boost_credits desc);
alter table jobs add constraint jobs_accepted_fk foreign key (accepted_proposal_id) references proposals(id);

create table proposal_versions (
  proposal_id uuid not null references proposals(id),
  version int not null,
  price_cents int not null,
  delivery_days int not null,
  message text not null,
  created_at timestamptz not null default now(),
  primary key (proposal_id, version)
);

-- Портфейлът пази баланса, ledger-ът пази историята. CHECK прави отрицателен баланс невъзможен.
create table credit_wallets (
  user_id uuid primary key references users(id),
  available int not null default 0 check (available >= 0),
  reserved int not null default 0 check (reserved >= 0)
);
create table credit_transactions (
  id bigserial primary key,
  user_id uuid not null references users(id),
  type text not null check (type in ('purchase','debit_application','hold_boost','release_boost','settle_boost','refund','admin_adjustment')),
  amount int not null check (amount <> 0),
  related text,
  idempotency_key text not null unique,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index credit_tx_user_idx on credit_transactions (user_id, id desc);
-- ledger-ът е само за добавяне
create function forbid_ledger_change() returns trigger language plpgsql as $$ begin raise exception 'credit_transactions е само за добавяне'; end $$;
create trigger credit_tx_immutable before update or delete on credit_transactions for each row execute function forbid_ledger_change();
