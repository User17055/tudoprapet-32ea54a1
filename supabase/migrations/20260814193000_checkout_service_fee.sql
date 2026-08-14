alter table public.checkout_sessions
  add column if not exists service_fee numeric(12,2) not null default 0
  check (service_fee >= 0);

comment on column public.checkout_sessions.service_fee is
  'Taxa operacional cobrada no checkout e incluída no pedido Shopify.';
