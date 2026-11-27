-- Valores pela Olist: leitura do catálogo inteiro em poucas chamadas, seleção livre
-- e data da mudança real de cada valor.
--
-- Mão única: a Olist alimenta o site; nada aqui grava na Olist. O retrato é lido
-- manualmente pelo admin (sem rotina agendada) e só aparece para admins, porque
-- tem custo.

-- Retrato do catálogo (produtos.pesquisa sem termo: ativos e inativos).
create table if not exists public.olist_product_snapshot (
  olist_product_id text primary key,
  sku text not null default '',
  sku_key text not null default '',
  name text not null default '',
  price numeric(12, 2),
  promo_price numeric(12, 2),
  cost numeric(12, 2),
  status text,
  variation_type text,
  run_id uuid,
  fetched_at timestamptz not null default now()
);

create index if not exists olist_product_snapshot_sku_key_idx
  on public.olist_product_snapshot (sku_key);

-- Listas de preço da Olist (ex.: Franqueados, Plano São Francisco): só para
-- comparar. O preço efetivo de um produto é a exceção, quando existe; senão,
-- o preço de venda com o acréscimo/desconto da lista.
create table if not exists public.olist_price_lists (
  olist_price_list_id text primary key,
  name text not null default '',
  adjustment_percent numeric(8, 2) not null default 0,
  run_id uuid,
  fetched_at timestamptz not null default now()
);

create table if not exists public.olist_price_list_exceptions (
  olist_price_list_id text not null references public.olist_price_lists(olist_price_list_id) on delete cascade,
  olist_product_id text not null,
  price numeric(12, 2),
  promo_price numeric(12, 2),
  run_id uuid,
  fetched_at timestamptz not null default now(),
  primary key (olist_price_list_id, olist_product_id)
);

-- Cada leitura do catálogo e cada aplicação no site.
create table if not exists public.olist_catalog_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('catalog', 'apply')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages integer not null default 0,
  products integer not null default 0,
  price_lists integer not null default 0,
  exceptions integer not null default 0,
  applied integer not null default 0,
  changed integer not null default 0,
  not_found integer not null default 0,
  failed integer not null default 0,
  error text,
  created_by uuid
);

create index if not exists olist_catalog_runs_kind_started_idx
  on public.olist_catalog_runs (kind, started_at desc);

alter table public.olist_product_snapshot enable row level security;
alter table public.olist_price_lists enable row level security;
alter table public.olist_price_list_exceptions enable row level security;
alter table public.olist_catalog_runs enable row level security;

drop policy if exists "Admins can view olist product snapshot" on public.olist_product_snapshot;
create policy "Admins can view olist product snapshot"
  on public.olist_product_snapshot for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists "Admins can view olist price lists" on public.olist_price_lists;
create policy "Admins can view olist price lists"
  on public.olist_price_lists for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists "Admins can view olist price list exceptions" on public.olist_price_list_exceptions;
create policy "Admins can view olist price list exceptions"
  on public.olist_price_list_exceptions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists "Admins can view olist catalog runs" on public.olist_catalog_runs;
create policy "Admins can view olist catalog runs"
  on public.olist_catalog_runs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on public.olist_product_snapshot, public.olist_price_lists,
  public.olist_price_list_exceptions, public.olist_catalog_runs from anon;
grant select on public.olist_product_snapshot, public.olist_price_lists,
  public.olist_price_list_exceptions, public.olist_catalog_runs to authenticated;
grant all on public.olist_product_snapshot, public.olist_price_lists,
  public.olist_price_list_exceptions, public.olist_catalog_runs to service_role;

-- Data da mudança real dos preços de franquia e de assinante, no mesmo padrão
-- de customer_prices (20260824120000): `updated_at` muda a cada gravação, mesmo
-- com o mesmo valor; `price_changed_at` só quando o valor muda. Fica no banco
-- para valer para todo caminho que grava (sincronização, checkout de franquia,
-- revisão de preço, margens por categoria e edição manual).
alter table public.franchise_prices
  add column if not exists previous_price numeric(12, 2),
  add column if not exists price_changed_at timestamptz;
alter table public.subscriber_prices
  add column if not exists previous_price numeric(12, 2),
  add column if not exists price_changed_at timestamptz;

create or replace function public.track_franchise_price_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.price is distinct from old.price then
    new.previous_price := old.price;
    new.price_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists franchise_prices_track_change on public.franchise_prices;
create trigger franchise_prices_track_change
  before update on public.franchise_prices
  for each row execute function public.track_franchise_price_change();

create or replace function public.track_subscriber_price_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subscriber_price is distinct from old.subscriber_price then
    new.previous_price := old.subscriber_price;
    new.price_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists subscriber_prices_track_change on public.subscriber_prices;
create trigger subscriber_prices_track_change
  before update on public.subscriber_prices
  for each row execute function public.track_subscriber_price_change();

-- Histórico das mudanças de franquia, assinante e Valor do Cliente (o custo já
-- tem product_cost_history). Só registra quando o valor muda, nasce ou é apagado.
create table if not exists public.price_value_history (
  id uuid primary key default gen_random_uuid(),
  shopify_variant_id text not null,
  kind text not null check (kind in ('franchise', 'subscriber', 'customer')),
  old_value numeric(12, 2),
  new_value numeric(12, 2),
  changed_at timestamptz not null default now()
);

create index if not exists price_value_history_variant_idx
  on public.price_value_history (shopify_variant_id, changed_at desc);

alter table public.price_value_history enable row level security;
drop policy if exists "Admins can view price value history" on public.price_value_history;
create policy "Admins can view price value history"
  on public.price_value_history for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
revoke all on public.price_value_history from anon;
grant select on public.price_value_history to authenticated;
grant all on public.price_value_history to service_role;

create or replace function public.record_price_value_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := tg_argv[0];
  v_column text := tg_argv[1];
  v_old numeric;
  v_new numeric;
  v_variant text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := (to_jsonb(old) ->> v_column)::numeric;
    v_variant := old.shopify_variant_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := (to_jsonb(new) ->> v_column)::numeric;
    v_variant := new.shopify_variant_id;
  end if;
  if tg_op = 'UPDATE' and v_new is not distinct from v_old then
    return null;
  end if;
  insert into public.price_value_history (shopify_variant_id, kind, old_value, new_value)
  values (v_variant, v_kind, v_old, v_new);
  return null;
end;
$$;

revoke all on function public.record_price_value_history() from public, anon, authenticated;

drop trigger if exists franchise_prices_value_history on public.franchise_prices;
create trigger franchise_prices_value_history
  after insert or update or delete on public.franchise_prices
  for each row execute function public.record_price_value_history('franchise', 'price');

drop trigger if exists subscriber_prices_value_history on public.subscriber_prices;
create trigger subscriber_prices_value_history
  after insert or update or delete on public.subscriber_prices
  for each row execute function public.record_price_value_history('subscriber', 'subscriber_price');

drop trigger if exists customer_prices_value_history on public.customer_prices;
create trigger customer_prices_value_history
  after insert or update or delete on public.customer_prices
  for each row execute function public.record_price_value_history('customer', 'price');
