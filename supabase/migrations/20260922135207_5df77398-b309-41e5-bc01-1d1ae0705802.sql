alter table public.employee_referral_codes
  add column if not exists commission_percent numeric(5,2) not null default 0;
do $$ begin
  alter table public.employee_referral_codes
    add constraint employee_referral_codes_commission_percent_check
    check (commission_percent >= 0 and commission_percent <= 100);
exception when duplicate_object then null; end $$;

alter table public.checkout_sessions
  add column if not exists referral_code text,
  add column if not exists referral_employee_name text,
  add column if not exists commission_percent numeric(5,2) not null default 0;
do $$ begin
  alter table public.checkout_sessions
    add constraint checkout_sessions_commission_percent_check
    check (commission_percent >= 0 and commission_percent <= 100);
exception when duplicate_object then null; end $$;

create index if not exists checkout_sessions_referral_code_created_idx
  on public.checkout_sessions (referral_code, created_at desc)
  where referral_code is not null;

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.employee_referral_codes(id) on delete cascade,
  scope text not null check (scope in ('category', 'product')),
  category_id uuid references public.categories(id) on delete cascade,
  shopify_product_id text,
  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rules_target_check check (
    (scope = 'category' and category_id is not null and shopify_product_id is null)
    or (scope = 'product' and category_id is null and shopify_product_id is not null)
  )
);

create unique index if not exists commission_rules_category_unique on public.commission_rules (referral_code_id, category_id) where scope = 'category';
create unique index if not exists commission_rules_product_unique on public.commission_rules (referral_code_id, shopify_product_id) where scope = 'product';
create index if not exists commission_rules_referral_idx on public.commission_rules (referral_code_id);

alter table public.commission_rules enable row level security;
revoke all on public.commission_rules from anon, authenticated;
grant all on public.commission_rules to service_role;

drop trigger if exists commission_rules_updated_at on public.commission_rules;
create trigger commission_rules_updated_at before update on public.commission_rules
for each row execute function public.update_updated_at_column();