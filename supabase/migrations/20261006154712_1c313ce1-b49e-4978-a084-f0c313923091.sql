alter table public.checkout_sessions
  add column if not exists olist_invoice_status text,
  add column if not exists olist_invoice_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'checkout_sessions_olist_invoice_status_check'
  ) then
    alter table public.checkout_sessions
      add constraint checkout_sessions_olist_invoice_status_check
      check (olist_invoice_status is null or olist_invoice_status in ('issued', 'pending', 'rejected'));
  end if;
end $$;

create index if not exists checkout_sessions_olist_invoice_retry_idx
  on public.checkout_sessions (olist_invoice_checked_at)
  where customer_type = 'franchise'
    and olist_order_id is not null
    and (olist_invoice_status is null or olist_invoice_status in ('pending', 'rejected'));