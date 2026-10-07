-- Estado durável da ponte Asaas -> Shopify -> Olist. A baixa financeira só é
-- marcada como concluída depois de a API da Olist confirmar (ou informar que a
-- mesma conta já estava paga).

alter table public.checkout_sessions
  add column if not exists olist_payment_synced_at timestamptz,
  add column if not exists olist_payment_sync_attempts integer not null default 0,
  add column if not exists olist_payment_sync_next_attempt_at timestamptz,
  add column if not exists olist_payment_sync_error text;

create index if not exists checkout_sessions_olist_payment_pending_idx
  on public.checkout_sessions (olist_payment_sync_next_attempt_at, created_at)
  where shopify_order_id is not null and olist_payment_synced_at is null;

comment on column public.checkout_sessions.olist_payment_synced_at is
  'Momento em que a conta a receber importada da Shopify foi baixada na Olist após confirmação do Asaas.';
