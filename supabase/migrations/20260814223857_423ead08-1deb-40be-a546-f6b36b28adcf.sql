alter table public.checkout_sessions
  add column if not exists service_fee numeric(12,2) not null default 0
  check (service_fee >= 0);

comment on column public.checkout_sessions.service_fee is
  'Taxa operacional cobrada no checkout e incluída no pedido Shopify.';

alter table public.checkout_sessions
  alter column service_fee set default 3;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_total_with_service_fee;

alter table public.checkout_sessions
  add constraint checkout_sessions_total_with_service_fee
  check (
    total = round(subtotal - discount + shipping_amount + service_fee, 2)
  ) not valid;

comment on constraint checkout_sessions_total_with_service_fee on public.checkout_sessions is
  'Impede novas sessões com total diferente de produtos menos descontos, mais frete e taxa de serviço.';