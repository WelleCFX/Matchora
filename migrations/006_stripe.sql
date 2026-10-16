-- 006: данни за реален платежен доставчик.
alter table payments add column provider_intent text;
create index payments_intent_idx on payments (provider_intent) where provider_intent is not null;
alter table payments add column review_note text;
alter table payments drop constraint payments_status_check;
alter table payments add constraint payments_status_check check (status in ('pending','paid','failed','refunded','disputed'));
