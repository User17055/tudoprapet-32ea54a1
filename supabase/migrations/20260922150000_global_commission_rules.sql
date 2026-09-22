-- Comissão deixa de ser por pessoa: passa a valer por categoria/produto, igual
-- para qualquer código de indicação. Mantém-se apenas uma taxa padrão da loja
-- (antes era uma taxa por pessoa) e uma lista de clientes que nunca geram
-- comissão, mesmo comprando com um código de indicação válido.

-- 1) Regras por categoria/produto: remove o vínculo com a pessoa. Quando duas
-- pessoas tinham percentuais diferentes para o mesmo alvo, fica o maior.
delete from public.commission_rules a
using public.commission_rules b
where a.scope = 'category' and b.scope = 'category'
  and a.category_id = b.category_id
  and (a.percent, a.id) < (b.percent, b.id);

delete from public.commission_rules a
using public.commission_rules b
where a.scope = 'product' and b.scope = 'product'
  and a.shopify_product_id = b.shopify_product_id
  and (a.percent, a.id) < (b.percent, b.id);

drop index if exists public.commission_rules_category_unique;
drop index if exists public.commission_rules_product_unique;
drop index if exists public.commission_rules_referral_idx;
alter table public.commission_rules drop constraint if exists commission_rules_referral_code_id_fkey;
alter table public.commission_rules drop column if exists referral_code_id;

create unique index commission_rules_category_unique on public.commission_rules (category_id) where scope = 'category';
create unique index commission_rules_product_unique on public.commission_rules (shopify_product_id) where scope = 'product';

-- 2) Taxa padrão da loja: uma só para todo mundo, não mais por pessoa.
create table public.commission_settings (
  id boolean primary key default true check (id = true),
  store_percent numeric(5,2) not null default 0 check (store_percent >= 0 and store_percent <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.commission_settings (id, store_percent)
select true, coalesce(max(commission_percent), 0) from public.employee_referral_codes;

alter table public.commission_settings enable row level security;
revoke all on public.commission_settings from anon, authenticated;
grant all on public.commission_settings to service_role;

create trigger commission_settings_updated_at before update on public.commission_settings
for each row execute function public.update_updated_at_column();

alter table public.employee_referral_codes drop column if exists commission_percent;

-- 3) Clientes que nunca geram comissão, mesmo com código de indicação válido
-- (ex.: cliente que compra todo dia por conta própria).
create table public.commission_blocked_customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.commission_blocked_customers enable row level security;
revoke all on public.commission_blocked_customers from anon, authenticated;
grant all on public.commission_blocked_customers to service_role;
