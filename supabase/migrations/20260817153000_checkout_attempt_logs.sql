create table if not exists public.checkout_attempt_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  user_id uuid,
  customer_name text,
  customer_email text,
  payment_method text not null default 'unknown'
    check (payment_method in ('pix', 'credit_card', 'terms', 'unknown')),
  stage text not null
    check (stage in ('prepare', 'payment', 'shopify_completion')),
  success boolean not null,
  error_message text,
  provider_payment_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists checkout_attempt_logs_created_at_idx
  on public.checkout_attempt_logs (created_at desc);
create index if not exists checkout_attempt_logs_session_idx
  on public.checkout_attempt_logs (checkout_session_id, created_at desc);
create index if not exists checkout_attempt_logs_success_idx
  on public.checkout_attempt_logs (success, created_at desc);

alter table public.checkout_attempt_logs enable row level security;

comment on table public.checkout_attempt_logs is
  'Historico operacional de tentativas de checkout. Nunca armazena numero, CVV ou token de cartao.';
