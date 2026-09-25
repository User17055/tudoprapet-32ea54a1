alter table public.payments
  add column if not exists provider_payment_url text;

comment on column public.payments.provider_payment_url is
  'Link seguro devolvido pelo provedor para consultar ou pagar a cobranca.';
