create table public.commission_rules (
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

create unique index commission_rules_category_unique on public.commission_rules (referral_code_id, category_id) where scope = 'category';
create unique index commission_rules_product_unique on public.commission_rules (referral_code_id, shopify_product_id) where scope = 'product';
create index commission_rules_referral_idx on public.commission_rules (referral_code_id);

alter table public.commission_rules enable row level security;
revoke all on public.commission_rules from anon, authenticated;
grant all on public.commission_rules to service_role;

create trigger commission_rules_updated_at before update on public.commission_rules
for each row execute function public.update_updated_at_column();
