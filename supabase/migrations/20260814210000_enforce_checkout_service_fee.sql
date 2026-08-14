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
