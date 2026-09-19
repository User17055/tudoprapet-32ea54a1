-- O custo e um dado proprio: nao e o preco da franquia. A sincronizacao da
-- Olist atualiza esta tabela e mantem uma trilha de cada mudanca observada.
create table if not exists public.product_costs (
  shopify_variant_id text primary key,
  shopify_product_id text not null,
  sku text not null,
  cost numeric(12,2) not null check (cost > 0),
  previous_cost numeric(12,2) check (previous_cost is null or previous_cost > 0),
  cost_changed_at timestamptz,
  source text not null default 'olist',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_costs_product_idx
  on public.product_costs (shopify_product_id);
create index if not exists product_costs_sku_idx
  on public.product_costs (sku);

create table if not exists public.product_cost_history (
  id uuid primary key default gen_random_uuid(),
  shopify_variant_id text not null references public.product_costs(shopify_variant_id) on delete cascade,
  old_cost numeric(12,2),
  new_cost numeric(12,2) not null check (new_cost > 0),
  source text not null default 'olist',
  changed_at timestamptz not null default now()
);

create index if not exists product_cost_history_variant_idx
  on public.product_cost_history (shopify_variant_id, changed_at desc);

alter table public.product_costs enable row level security;
alter table public.product_cost_history enable row level security;

create policy "Admins can view product costs"
  on public.product_costs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "Admins can view product cost history"
  on public.product_cost_history for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.product_costs, public.product_cost_history to authenticated;
grant all on public.product_costs, public.product_cost_history to service_role;

drop trigger if exists product_costs_updated_at on public.product_costs;
create trigger product_costs_updated_at before update on public.product_costs
  for each row execute function public.update_updated_at_column();
