create table if not exists public.franchise_open_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'converted', 'cancelled', 'expired')),
  shopify_draft_order_id text not null,
  items jsonb not null default '[]'::jsonb,
  reserved_until timestamptz not null,
  checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.franchise_open_orders to authenticated;
grant all on public.franchise_open_orders to service_role;

create unique index if not exists franchise_open_orders_one_open_per_user
  on public.franchise_open_orders (user_id)
  where status = 'open';

create index if not exists franchise_open_orders_user_updated_idx
  on public.franchise_open_orders (user_id, updated_at desc);

alter table public.franchise_open_orders enable row level security;

create policy "Franchisees can view their own open order"
on public.franchise_open_orders for select to authenticated
using (
  auth.uid() = user_id
  and public.is_franchisee(auth.uid())
);

comment on table public.franchise_open_orders is
  'Pedido em aberto de franqueado. O draft correspondente mantem o estoque reservado na Shopify.';

comment on column public.franchise_open_orders.items is
  'Snapshot minimo dos itens: variantId, quantity, title, imageUrl e unitPrice.';

create table if not exists public.subscriber_category_margins (
  category_id uuid primary key references public.categories(id) on delete cascade,
  percent numeric(7,3) not null check (percent >= 0 and percent <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.subscriber_category_margins to anon, authenticated;
grant insert, update, delete on public.subscriber_category_margins to authenticated;
grant all on public.subscriber_category_margins to service_role;

alter table public.subscriber_category_margins enable row level security;

create policy "Anyone can view subscriber category margins"
on public.subscriber_category_margins for select
using (true);

create policy "Admins can manage subscriber category margins"
on public.subscriber_category_margins for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create trigger trg_subscriber_category_margins_updated_at
before update on public.subscriber_category_margins
for each row execute function public.update_updated_at_column();

comment on table public.subscriber_category_margins is
  'Percentual sobre o custo Olist usado no preco de assinante, com heranca pela arvore de categorias.';