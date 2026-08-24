-- Preço regular definido pela TudoPraPet. Quando não existe registro, o
-- aplicativo usa o preço atual da variante na Shopify.
create table if not exists public.customer_prices (
  shopify_variant_id text primary key,
  shopify_product_id text not null,
  price numeric(12, 2) not null check (price > 0),
  previous_price numeric(12, 2) check (previous_price is null or previous_price > 0),
  price_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_prices_product_id_idx
  on public.customer_prices (shopify_product_id);

alter table public.customer_prices enable row level security;

create policy "Anyone can view customer prices"
  on public.customer_prices for select
  using (true);

create policy "Admins can insert customer prices"
  on public.customer_prices for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update customer prices"
  on public.customer_prices for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete customer prices"
  on public.customer_prices for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.customer_prices to anon, authenticated;
grant insert, update, delete on public.customer_prices to authenticated;
grant all on public.customer_prices to service_role;

create or replace function public.track_customer_price_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.price is distinct from old.price then
    new.previous_price := old.price;
    new.price_changed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists customer_prices_track_change on public.customer_prices;
create trigger customer_prices_track_change
  before update on public.customer_prices
  for each row execute function public.track_customer_price_change();