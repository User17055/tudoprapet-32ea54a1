alter table public.employee_referral_codes
  add column if not exists commission_percent numeric(5,2) not null default 0
  check (commission_percent >= 0 and commission_percent <= 100);

alter table public.checkout_sessions
  add column if not exists referral_code text,
  add column if not exists referral_employee_name text,
  add column if not exists commission_percent numeric(5,2) not null default 0
    check (commission_percent >= 0 and commission_percent <= 100);

create index if not exists checkout_sessions_referral_code_created_idx
  on public.checkout_sessions (referral_code, created_at desc)
  where referral_code is not null;
