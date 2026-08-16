-- Novos checkouts não cobram mais a taxa operacional de R$ 3.
-- Valores históricos permanecem intactos para preservar pedidos e cobranças.
alter table public.checkout_sessions
  alter column service_fee set default 0;

comment on column public.checkout_sessions.service_fee is
  'Taxa operacional histórica do checkout. Novas sessões usam zero.';
