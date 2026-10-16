-- 005: двуфакторна автентикация, опашка за имейли.
create table user_totp (
  user_id uuid primary key references users(id) on delete cascade,
  secret_enc text not null,                 -- AES-256-GCM, ключ от APP_SECRET
  confirmed_at timestamptz,
  last_step bigint not null default 0,      -- защита срещу повторно използване на кода
  created_at timestamptz not null default now()
);
create table recovery_codes (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  code_hash bytea not null unique,
  used_at timestamptz
);
create index recovery_user_idx on recovery_codes (user_id);
-- Между паролата и кода: кратък, ограничен по опити „въпрос“, който още не е сесия.
create table login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  attempts int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table email_outbox add column attempts int not null default 0, add column last_error text, add column next_attempt_at timestamptz not null default now();
create index outbox_pending_idx on email_outbox (next_attempt_at) where sent_at is null;
