-- Matchora, миграция 001: автентикация, профили, сесии, одит.
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  staff_role text not null default 'none' check (staff_role in ('none','support','moderator','admin')),
  active_mode text not null default 'client' check (active_mode in ('client','provider')),
  is_provider boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint email_lower check (email = lower(email))
);
create unique index users_email_uq on users (email);

create table profiles (
  user_id uuid primary key references users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  city text,
  bio text check (char_length(bio) <= 1000),
  phone text,            -- частно по подразбиране, не се показва публично
  phone_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table provider_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  business_name text,
  category text,
  service_area text,
  work_hours text,
  languages text[] not null default '{bg}',
  verification_status text not null default 'none' check (verification_status in ('none','pending','verified','rejected')),
  updated_at timestamptz not null default now()
);

-- Сървърни сесии: в бисквитката е случаен токен, в базата е само неговият SHA-256.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text,
  ip inet
);
create index sessions_user_idx on sessions (user_id);

-- Токени за потвърждение на имейл и възстановяване на парола (еднократни).
create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('verify_email','reset_password')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (key, window_start)
);

create table email_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Одитът не изтрива история при изтриване на потребител.
create table audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
