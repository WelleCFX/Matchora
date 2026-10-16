-- Фирмени профили: един фирмен профил на собственик (абонаментът и кредитите остават на собственика).
create table companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references users(id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 2 and 200),
  eik text not null unique check (eik ~ '^([0-9]{9}|[0-9]{13})$'),
  vat_number text check (vat_number is null or vat_number ~ '^BG[0-9]{9,10}$'),
  address text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  review_note text,
  reviewed_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  perms text[] not null default '{}' check (perms <@ array['services','requests']),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create table company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null check (email = lower(email)),
  perms text[] not null default '{}' check (perms <@ array['services','requests']),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on company_invites(company_id);
create index on company_members(user_id);
