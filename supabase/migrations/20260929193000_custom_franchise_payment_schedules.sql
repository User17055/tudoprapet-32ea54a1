-- Cada franquia pode pagar por prazo corrido (N dias depois do pedido) ou em
-- um dia fixo do mes seguinte. A regra usada fica copiada no checkout para que
-- mudancas futuras no cadastro nao alterem pedidos antigos.

alter table public.franchise_credit_accounts
  add column if not exists payment_schedule_type text not null default 'days_after_order',
  add column if not exists payment_due_day integer;

alter table public.franchise_credit_accounts
  drop constraint if exists franchise_credit_accounts_payment_term_days_check;
alter table public.franchise_credit_accounts
  add constraint franchise_credit_accounts_payment_term_days_check
  check (payment_term_days between 1 and 365);

alter table public.franchise_credit_accounts
  drop constraint if exists franchise_credit_accounts_payment_schedule_check;
alter table public.franchise_credit_accounts
  add constraint franchise_credit_accounts_payment_schedule_check
  check (
    (payment_schedule_type = 'days_after_order' and payment_due_day is null)
    or
    (payment_schedule_type = 'fixed_day_next_month' and payment_due_day between 1 and 31)
  );

alter table public.checkout_sessions
  add column if not exists franchise_payment_schedule_type text,
  add column if not exists franchise_payment_due_day integer;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_franchise_payment_term_days_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_franchise_payment_term_days_check
  check (franchise_payment_term_days is null or franchise_payment_term_days between 1 and 365);

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_franchise_payment_schedule_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_franchise_payment_schedule_check
  check (
    franchise_payment_schedule_type is null
    or (franchise_payment_schedule_type = 'days_after_order' and franchise_payment_due_day is null)
    or (franchise_payment_schedule_type = 'fixed_day_next_month' and franchise_payment_due_day between 1 and 31)
  );

comment on column public.franchise_credit_accounts.payment_schedule_type is
  'days_after_order: vence N dias depois; fixed_day_next_month: vence no dia configurado do mes seguinte.';
comment on column public.franchise_credit_accounts.payment_due_day is
  'Dia de vencimento (1-31) para agenda fixa; meses curtos usam o ultimo dia.';
comment on column public.checkout_sessions.franchise_payment_schedule_type is
  'Copia imutavel da modalidade de vencimento utilizada no pedido.';
comment on column public.checkout_sessions.franchise_payment_due_day is
  'Copia imutavel do dia fixo utilizado no pedido.';
