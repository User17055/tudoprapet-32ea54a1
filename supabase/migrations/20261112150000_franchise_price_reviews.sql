-- Franquia paga custo. Quando um produto chega ao checkout de franquia sem
-- custo/preço de franquia, o sistema busca o custo na Olist; se não conseguir,
-- o item é bloqueado (nunca cobrado pelo preço cheio) e fica registrado aqui.
-- A franquia só pode pedir revisão de um item que o próprio sistema bloqueou.
-- Uma revisão por produto: várias franquias pedindo viram vários solicitantes.

create table if not exists public.franchise_price_reviews (
  id uuid primary key default gen_random_uuid(),
  shopify_variant_id text not null unique,
  shopify_product_id text,
  sku text,
  product_title text,
  catalog_price numeric(12, 2),
  reason text not null
    check (reason in ('missing_sku', 'not_found_in_olist', 'olist_unavailable')),
  status text not null default 'blocked'
    check (status in ('blocked', 'requested', 'approved', 'changed', 'rejected')),
  block_count integer not null default 0,
  first_blocked_at timestamptz not null default now(),
  last_blocked_at timestamptz not null default now(),
  requested_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_email text,
  decision_cost numeric(12, 2),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.franchise_price_reviews is
  'Produtos bloqueados no checkout de franquia por falta de custo, e a revisão (aprovar/alterar/recusar) feita pelos aprovadores.';

create index if not exists franchise_price_reviews_open_idx
  on public.franchise_price_reviews (status, last_blocked_at desc)
  where status in ('blocked', 'requested');

create table if not exists public.franchise_price_review_requests (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.franchise_price_reviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  unique (review_id, user_id)
);

create index if not exists franchise_price_review_requests_user_idx
  on public.franchise_price_review_requests (user_id, requested_at desc);

alter table public.franchise_price_reviews enable row level security;
alter table public.franchise_price_review_requests enable row level security;

drop policy if exists "Admins read price reviews" on public.franchise_price_reviews;
create policy "Admins read price reviews" on public.franchise_price_reviews
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Requesters read their price reviews" on public.franchise_price_reviews;
create policy "Requesters read their price reviews" on public.franchise_price_reviews
  for select to authenticated using (
    exists (
      select 1 from public.franchise_price_review_requests r
       where r.review_id = franchise_price_reviews.id and r.user_id = auth.uid()
    )
  );

drop policy if exists "Users read own price review requests" on public.franchise_price_review_requests;
create policy "Users read own price review requests" on public.franchise_price_review_requests
  for select to authenticated using (
    user_id = auth.uid() or public.has_role(auth.uid(), 'admin')
  );

-- Registra (ou soma) um bloqueio. Produto liberado que volta a ficar sem custo
-- abre um ciclo novo; produto recusado continua recusado.
create or replace function public.record_franchise_price_block(
  p_variant_id text,
  p_product_id text,
  p_sku text,
  p_title text,
  p_catalog_price numeric,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_previous text;
  v_status text;
begin
  select id, status into v_review_id, v_previous
    from public.franchise_price_reviews
   where shopify_variant_id = p_variant_id
   for update;

  if v_review_id is null then
    insert into public.franchise_price_reviews (
      shopify_variant_id, shopify_product_id, sku, product_title, catalog_price,
      reason, status, block_count
    ) values (
      p_variant_id, p_product_id, nullif(p_sku, ''), p_title, p_catalog_price,
      p_reason, 'blocked', 1
    );
    return 'blocked';
  end if;

  if v_previous in ('approved', 'changed') then
    delete from public.franchise_price_review_requests where review_id = v_review_id;
    v_status := 'blocked';
  else
    v_status := v_previous;
  end if;

  update public.franchise_price_reviews
     set shopify_product_id = coalesce(p_product_id, shopify_product_id),
         sku = coalesce(nullif(p_sku, ''), sku),
         product_title = coalesce(p_title, product_title),
         catalog_price = coalesce(p_catalog_price, catalog_price),
         reason = p_reason,
         status = v_status,
         block_count = block_count + 1,
         last_blocked_at = now(),
         requested_at = case when v_status = 'blocked' then null else requested_at end,
         decided_at = case when v_status = 'blocked' then null else decided_at end,
         updated_at = now()
   where id = v_review_id;
  return v_status;
end;
$$;

revoke all on function public.record_franchise_price_block(text, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.record_franchise_price_block(text, text, text, text, numeric, text)
  to service_role;
