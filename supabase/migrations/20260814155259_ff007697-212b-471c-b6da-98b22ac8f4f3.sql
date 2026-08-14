create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  checkout_version text not null default 'asaas-v1',
  customer_type text not null check (customer_type in ('common', 'subscriber', 'franchise')),
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_payment', 'payment_processing', 'paid',
    'paid_pending_shopify', 'shopify_created', 'credit_approved',
    'expired', 'cancelled', 'failed'
  )),
  currency text not null default 'BRL',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total numeric(12,2) not null check (total >= 0),
  shipping_method text,
  shipping_code text check (shipping_code is null or shipping_code in ('pick_up', 'pac', 'sedex', 'local_delivery')),
  customer_snapshot jsonb not null default '{}'::jsonb,
  address_snapshot jsonb not null default '{}'::jsonb,
  items_snapshot jsonb not null default '[]'::jsonb,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  shopify_draft_order_id text,
  shopify_order_id text,
  inventory_reserved_until timestamptz,
  anonymous_access_token_hash text unique,
  anonymous_access_token_expires_at timestamptz,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  is_active boolean not null default true,
  provider text not null,
  provider_customer_id text,
  provider_payment_id text unique,
  external_reference text not null unique,
  method text not null check (method in ('pix', 'boleto', 'credit_card', 'terms')),
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'cancellation_requested', 'confirmed',
    'received', 'overdue', 'refunded', 'chargeback', 'cancelled', 'failed'
  )),
  amount numeric(12,2) not null check (amount > 0),
  due_date date,
  provider_expires_at timestamptz,
  confirmed_at timestamptz,
  received_at timestamptz,
  provider_deleted_at timestamptz,
  raw_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (checkout_session_id, attempt_number)
);

create unique index if not exists payments_one_active_attempt
  on public.payments (checkout_session_id)
  where is_active and status in ('pending', 'processing', 'cancellation_requested', 'confirmed');

create index if not exists payments_session_created_idx
  on public.payments (checkout_session_id, created_at desc);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  provider_payment_id text,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'PROCESSED', 'ERROR')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  processed_at timestamptz,
  processing_error text,
  unique (provider, provider_event_id)
);

create index if not exists payment_events_worker_idx
  on public.payment_events (status, next_attempt_at, received_at);

create table if not exists public.payment_actions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  action_type text not null check (action_type in ('cancel_provider_charge', 'refund_duplicate')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'PROCESSED', 'ERROR', 'REVIEW_REQUIRED')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, action_type)
);

create index if not exists payment_actions_worker_idx
  on public.payment_actions (status, next_attempt_at, created_at);

create table if not exists public.franchise_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payment_term_days integer not null default 7 check (payment_term_days between 0 and 365),
  credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0),
  block_on_any_open_invoice boolean not null default false,
  manually_blocked boolean not null default false,
  blocked_reason text,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkout_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.checkout_sessions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_actions enable row level security;
alter table public.franchise_credit_accounts enable row level security;
alter table public.checkout_rate_limits enable row level security;

revoke all on public.checkout_sessions from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
revoke all on public.payment_actions from anon, authenticated;
revoke all on public.franchise_credit_accounts from anon, authenticated;
revoke all on public.checkout_rate_limits from anon, authenticated;

grant all on public.checkout_sessions to service_role;
grant all on public.payments to service_role;
grant all on public.payment_events to service_role;
grant all on public.payment_actions to service_role;
grant all on public.franchise_credit_accounts to service_role;
grant all on public.checkout_rate_limits to service_role;

drop trigger if exists checkout_sessions_updated_at on public.checkout_sessions;
create trigger checkout_sessions_updated_at before update on public.checkout_sessions
  for each row execute function public.update_updated_at_column();

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.update_updated_at_column();

drop trigger if exists payment_actions_updated_at on public.payment_actions;
create trigger payment_actions_updated_at before update on public.payment_actions
  for each row execute function public.update_updated_at_column();

drop trigger if exists franchise_credit_accounts_updated_at on public.franchise_credit_accounts;
create trigger franchise_credit_accounts_updated_at before update on public.franchise_credit_accounts
  for each row execute function public.update_updated_at_column();

create or replace function public.create_payment_attempt(
  p_checkout_session_id uuid,
  p_provider text,
  p_method text,
  p_amount numeric,
  p_due_date date default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_payment_id uuid := gen_random_uuid();
  v_attempt integer;
  v_customer_type text;
  v_user_id uuid;
  v_credit public.franchise_credit_accounts;
begin
  select customer_type, user_id into v_customer_type, v_user_id
    from public.checkout_sessions
    where id = p_checkout_session_id
    for update;
  if not found then
    raise exception 'checkout_session_not_found';
  end if;

  if v_customer_type = 'franchise' then
    if v_user_id is null then raise exception 'franchise_auth_required'; end if;
    insert into public.franchise_credit_accounts(user_id) values (v_user_id)
      on conflict (user_id) do nothing;
    select * into v_credit from public.franchise_credit_accounts
      where user_id = v_user_id for update;
    if v_credit.manually_blocked then raise exception 'franchise_manually_blocked'; end if;
    if exists (
      select 1
        from public.payments p
        join public.checkout_sessions s on s.id = p.checkout_session_id
       where s.user_id = v_user_id
         and p.checkout_session_id <> p_checkout_session_id
         and (
           p.status = 'overdue'
           or (v_credit.block_on_any_open_invoice and p.status in ('pending', 'processing', 'confirmed'))
         )
    ) then
      raise exception 'franchise_financial_block';
    end if;
  end if;

  if exists (
    select 1 from public.payments
    where checkout_session_id = p_checkout_session_id
      and is_active
      and status in ('pending', 'processing', 'cancellation_requested', 'confirmed')
  ) then
    raise exception 'active_payment_attempt_exists';
  end if;

  select coalesce(max(attempt_number), 0) + 1
    into v_attempt
    from public.payments
    where checkout_session_id = p_checkout_session_id;

  insert into public.payments (
    id, checkout_session_id, attempt_number, provider, method, amount,
    due_date, external_reference
  ) values (
    v_payment_id, p_checkout_session_id, v_attempt, p_provider, p_method,
    p_amount, p_due_date, v_payment_id::text
  ) returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.create_payment_attempt(uuid, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.create_payment_attempt(uuid, text, text, numeric, date) to service_role;

create or replace function public.claim_payment_events(p_limit integer default 25)
returns setof public.payment_events
language sql
security definer
set search_path = public
as $$
  update public.payment_events e
     set status = 'PROCESSING',
         locked_at = now(),
         attempts = attempts + 1,
         processing_error = null
   where e.id in (
     select id
       from public.payment_events
      where (
          status in ('PENDING', 'ERROR')
          or (status = 'PROCESSING' and locked_at < now() - interval '5 minutes')
        )
        and coalesce(next_attempt_at, '-infinity'::timestamptz) <= now()
      order by received_at
      for update skip locked
      limit greatest(1, least(p_limit, 100))
   )
  returning e.*;
$$;

revoke all on function public.claim_payment_events(integer) from public, anon, authenticated;
grant execute on function public.claim_payment_events(integer) to service_role;

create or replace function public.claim_payment_actions(p_limit integer default 25)
returns setof public.payment_actions
language sql
security definer
set search_path = public
as $$
  update public.payment_actions a
     set status = 'PROCESSING',
         locked_at = now(),
         attempts = attempts + 1,
         processing_error = null
   where a.id in (
     select id
       from public.payment_actions
      where (
          status in ('PENDING', 'ERROR')
          or (status = 'PROCESSING' and locked_at < now() - interval '5 minutes')
        )
        and coalesce(next_attempt_at, '-infinity'::timestamptz) <= now()
      order by created_at
      for update skip locked
      limit greatest(1, least(p_limit, 100))
   )
  returning a.*;
$$;

revoke all on function public.claim_payment_actions(integer) from public, anon, authenticated;
grant execute on function public.claim_payment_actions(integer) to service_role;

create or replace function public.consume_checkout_rate_limit(
  p_key_hash text,
  p_limit integer default 8,
  p_window_seconds integer default 600
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_window_seconds < 60 then
    raise exception 'invalid_rate_limit_input';
  end if;

  insert into public.checkout_rate_limits (key_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, now(), 1, now())
  on conflict (key_hash) do update
    set window_started_at = case
          when public.checkout_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then now()
          else public.checkout_rate_limits.window_started_at
        end,
        request_count = case
          when public.checkout_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then 1
          else public.checkout_rate_limits.request_count + 1
        end,
        updated_at = now()
  returning request_count into v_count;

  if v_count > p_limit then
    raise exception 'checkout_rate_limit_exceeded';
  end if;
  return v_count;
end;
$$;

revoke all on function public.consume_checkout_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_checkout_rate_limit(text, integer, integer) to service_role;