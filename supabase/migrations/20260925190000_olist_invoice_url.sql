alter table public.checkout_sessions
  add column if not exists olist_invoice_url text;

comment on column public.checkout_sessions.olist_invoice_url is
  'Link de acesso da NF-e emitida pela Olist para o pedido da franquia.';
